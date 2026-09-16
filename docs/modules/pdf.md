# Documents as files — server-side PDF

`src/lib/pdf/`, two route handlers, and no worker.

This is the last item on the roadmap's *genuinely unbuilt* list, and the whole
thing turned on one question being asked properly: **what actually makes PDF
rendering expensive?**

---

## The assumption that kept it queued

Rule 7 listed "PDF rendering" as `jobs` work for two hundred migrations, and
nothing ever checked why. The reason was never measured — it was inherited from
the mechanism everybody pictures: *render the page to PDF*, which means a
headless browser, which is heavy, which is queued work.

**Building the document from the row that already holds it is not that.**
Measured warm, six runs, on the demo college's live certificate:

| | bytes | time |
|---|---|---|
| one certificate | **5,360** | **57 ms** |
| 302 of them | — | **10.4 s** |

So rule 7's own test decides it, exactly as it decided exports: *bound it and
say what the bound is, or queue it.* One document is an ordinary request,
answered as the person who asked. A whole school is not, and is named below as
unbuilt rather than half-built.

> The two numbers are the argument. `57 ms` is a query; `10.4 s` is a job. The
> line falls between them and not at the word *PDF*.

And the consequence that matters most: **no service identity is invented.** The
route reads the row through the caller's own client, so RLS is the whole gate —
the same argument that made `report_run`'s paged export work, and the same one
`0240` had to solve the hard way for scheduled reports.

---

## The font, which is where the real findings are

### A built-in PDF font cannot print a bill

PDF's fourteen built-in fonts are WinAnsi-encoded. Measured:

```
THROW  ₹ / Helvetica:  WinAnsi cannot encode "₹" (0x20b9)
```

Every money figure in this product carries a rupee, so **a fee invoice is
impossible with a built-in font** — before any question about Hindi arises.

The four typographic characters the English catalogue does contain — `–` `—` `’`
`…` — are all *inside* WinAnsi and drew fine. Worth measuring rather than
assuming: the reason to embed a font is the rupee, not the dashes.

### …and a missing glyph is silent, which is worse than a crash

`drawText` does **not** fail on a character the embedded font lacks. It maps it
to `.notdef` and draws nothing. Measured against the shipped font:

| text | glyphs | `.notdef` |
|---|---|---|
| `Vivaan` | 6 | 0 |
| `₹` | 1 | 0 |
| `हर माह` | 6 | **5** |

A valid PDF, no warning, and a leaving certificate blank where the words were.

> This codebase's oldest recurring defect — *a plausible result rather than an
> error* — arriving in a document a family keeps. Beside `subscription_usage`'s
> 303 students for a college with none, `attendance_coverage`'s eleven classes
> at 0.0%, a cost printed for an SMS that was never sent, and `runSentence`
> nearly reporting 96 families told about a digest.

So the renderer asks the font what it can draw **before** drawing, and refuses
with the characters named:

```
This document cannot be turned into a PDF: the document font has no glyphs for
“य”, “ह”, “प”, … . PDFs are produced in Latin script only — printing the page
from your browser uses your own system fonts and will render it correctly.
```

A `422`, not a `500`: the request was understood, the row is intact, and the
document is genuinely unprintable by this build. That is a fact about the font,
stated, not a failure to retry.

### What it would take to print Hindi — measured, not guessed

Three obstacles, and **two of them are library bugs rather than design
decisions**:

- `@pdf-lib/fontkit`, the companion package pdf-lib's own documentation tells
  you to install, **throws `ReferenceError: regeneratorRuntime is not defined`**
  the instant its Indic syllable state machine runs. Its UMD bundle ships a
  Babel-transpiled generator without the polyfill. Latin text never reaches that
  code path, so the bug is invisible until somebody's Hindi certificate.
- Upstream `fontkit` shapes the same word correctly — `हिन्दी` is 6 codepoints
  and 5 glyphs, `क्ष` is 3 and 1, no `.notdef` — but pdf-lib's embedder calls a
  subsetting API it no longer has: `_this.subset.encodeStream is not a function`.
- `registerFontkit(upstreamFontkit)` with **`subset: false`** works end to end:
  69,639 bytes, 486 ms, correctly shaped.

> **The one combination that works is the one nobody would pick** — the *other*
> package, with the option you would turn *on* to save bytes turned off.

And a fourth obstacle that is nobody's bug:

> **A web-font subset is cut for a browser, which can load two files and fall
> back between them. A PDF embeds one font and has no fallback.**
> `@fontsource/fira-sans`'s `latin` slice has the em dash and no rupee; its
> `latin-ext` slice has the rupee and no em dash. Neither can render
> *"Fee reminder — ₹1,234.00"*.

So the shipped file is a **complete** font — Work Sans Regular, 189 kB, OFL,
licence beside it — not a web slice. One weight, deliberately: hierarchy in
these documents is size, space and rules, and a bold face would double what
every PDF carries to save one heading a few grams of ink.

---

## Three documents, because one is a decision and three are a pattern

They are deliberately unalike, and the difference is the interesting part.

| | certificate | invoice | report card |
|---|---|---|---|
| shape | a page of prose | a table that has to add up | a table about a term that ended |
| source | `certificates.body`, **frozen at issue** | `getInvoiceDocument()`, **live** | `exam_results`, **frozen at publish** |
| identical in 2034? | yes, and must be | no, and must not be | yes, once published |
| cache header | `private, must-revalidate` | `no-store` | `must-revalidate`, or `no-store` while it is a draft |

### The certificate renders the row and nothing else

Rule 12: *preview computes; issue freezes.* The screen already refuses to look
the student up. **A file has to refuse harder, because it outlives its session**
— it is attached to an email, saved to a phone, forwarded to a board. If it
recomputed anything, two copies of one certificate could disagree while both
looked authentic, and the wrong one is whichever was produced later.

`tests/pdf/document.test.ts` reads the renderer's source and fails on
`createClient`, `supabase`, `from(`, `rpc(` or `current_`. Verified by planting
each.

A **cancelled** certificate still renders, keeps its serial, and says
`CANCELLED` with the reason at the top. Withholding it would leave a family
holding a claim with no retraction; striking the body out would make the one
thing a cancelled certificate is kept for — reading what it said — impossible.

### The invoice wraps the module's own read path

Rule 11's sentence arriving at a document: the input is the very shape the
invoice *screen* renders. A PDF that recomputed a balance would be free to
disagree with the counter where the money is actually taken, and the family
would be holding the copy that disagrees.

A reversal is shown as a negative rather than netted out — rule 6's whole
argument is that a correction is a row, and a bill that quietly nets one away
cannot be reconciled against the receipt somebody is holding.

An account moves, so the footer says when the file was produced. A certificate
needs no such line and deliberately does not have one.

---

### The report card renders the frozen row, and so does the class

A published card is read out of `exam_results` — the marks, the rank, the
cohort size it was taken over, the `rules_snapshot` that chose the scope, and
the attendance. Nothing in the renderer recomputes any of it, and nothing may:
rule 12's argument is that a rank cannot be worked out again later *because the
cohort has changed*, so recomputing produces a plausible card that is not the
one the family was given.

That was checked rather than assumed, and the check was worth running.
Migration `0078` originally computed the attendance line with a lateral call at
read time — which is precisely the defect rule 12 describes, *"a reprint in
December disagreed with the card handed out in March"* — and `0080` is the
migration that froze it onto the row. `0080` is the **latest** definition of
`exams_report_cards`, so the read path this renders is the fixed one.

#### …and the warning has to move onto the document

A draft card renders too. A class teacher checking marks before publication
wants them on paper, and refusing would send them to a screenshot. But the
screen's banner — *"Do not hand this to a parent"* — is addressed to **the
person looking at the screen**, and a file has a different reader: whoever it
reaches, in a folder, a week later.

> **The chrome is not the document.** A warning that lives in the interface
> around a file does not travel with it.

So a provisional card says so at the top *and* in the footer of every page —
which is only possible because `Sheet.finish` stamps the footer after the last
page is written. And one piece of chrome **does** travel, which the first cut
missed:

> **The filename is chrome that travels.** Without the suffix, a draft checked
> in August and the published card land in a folder under identical names.

#### A class is one file, and the per-card cost is not what it looks like

A school prints a class in one pass, so `renderReportCards` writes one PDF with
one child to a sheet. Measured warm, the live card repeated:

| cards | bytes | total | each |
|---|---|---|---|
| 1 | 8,305 | 75 ms | 75.5 ms |
| 25 (a class) | 67,935 | **572 ms** | 22.9 ms |
| 40 | 105,001 | 750 ms | 18.7 ms |
| 301 (the school) | 753,606 | **5,450 ms** | 18.1 ms |

> **The per-card cost falls by four times, and that is the finding.** The font
> is embedded **once per document**, not once per card. A first draft of the
> comment above this function said *"66 ms each, so a class is about a second
> and a half"* — extrapolated from the single-card number and **three times too
> pessimistic**. A number you extrapolated is not a number you measured.

It also re-prices the school-wide case: the **10.4 s for 302 certificates** at
the top of this page was 302 *separate documents*, each embedding the font. In
one file it is 5.5 s. Still far past a request, so it stays queued work — but
for a different reason than the one written down.

#### Two routes, two different questions

| | who may have it | why |
|---|---|---|
| `/report-card/[studentId]/[examId]/pdf` | **nobody checks** | `exams_report_card` is row-scoped and refuses in two directions of its own. A second answer to a question Postgres answers is a second place to get it wrong. |
| `/exams/[examId]/report-cards/pdf?section=` | `exams.view` | *"May I pull a whole class"* is not *"may I see this child"* — the `staff_record` / `staff_roster` distinction — and the screen this is the file version of already answers it. |

Both 404s are flat. *Not published yet* and *not yours* must not be
distinguishable, or iterating over student ids says which children are in which
class.

#### The guard that took three attempts to measure the right thing

`renderReportCards` turns the page between children. Deleting that line gives
**exactly the same page count** — 1, 2, 3 and 7 cards all produce 1, 2, 3 and 7
pages either way — because `Sheet.signature` sinks to the foot of the sheet and
the next card's opening lines then fall off the bottom and turn the page by
themselves. What breaks is the **layout**: the second child's school name and
exam line are stranded at the bottom of the first child's sheet, under their
signature.

A check on *where each page starts* could not see it either, because every page
still begins at the top; the strandings are at the bottom. The property that
can is **one card opens per page**, and the school's name at 17pt is the only
thing on a card drawn that large:

```
cardOpeningsPerPage(doc) -> [1, 1, 1, 1, 1, 1, 1]
```

The rendered *text* cannot be read back at all — the font is embedded as a
subset, so `drawText` writes glyph ids — but the **font-size operators and
coordinates are plain numbers** in the (Flate-compressed) content stream, which
is what makes a structural assertion possible.

> Two planted violations passed before this one failed. A count is the easiest
> thing to assert about a document and it is usually measuring something else.

And the comment-stripping bug arrived for the **fourth** time in this
repository, from a new direction: the bulk route's comment *explains* that "no
such section" and "no permission" must be indistinguishable, and the guard
forbidding that wording failed on the explanation. `codeOf()` strips first now,
and the certificate's two guards were moved onto it — they had the same latent
weakness and had simply not been triggered.

---

## The locale is the reader's, and that is a decision

Rule 15: the locale is a property of a person. So a file is produced in the
language of whoever asked for it, exactly as the screen is, and money and dates
go through `src/lib/i18n/format.ts` rather than a hardcoded `en-IN`.

The alternative — the **school's** `default_locale`, on the grounds that a bill
is the school's document and the bursar downloading it may not be its reader —
is a real argument and is *not* what this does. It would mean a family and the
office holding two differently-worded copies of one bill with no way to say
which is authoritative. Named rather than left as an accident.

A consequence, honest rather than hidden: **a Hindi or Urdu reader gets the
422**, because `formatDate` returns Devanagari month names. The message says so
and points at printing, which uses the reader's own system fonts and works.
`tests/pdf/document.test.ts` asserts that refusal, so if it ever stops throwing
either the font gained Devanagari (good — and the English-only `pdf.invoice.*`
keys are then owed translations) or the coverage check stopped working (bad — a
family is holding a blank).

The `pdf.invoice.*` keys are therefore **English only**, with the reason in the
catalogue: translating a label the renderer cannot draw is *a correct string
nobody renders*.

---

## Printing is kept, and the comment that said otherwise was fixed

`print-button.tsx` used to end: *"so there is no PDF to render and no job to
queue. That is deliberate."*

> That was a claim about **printing** standing in for a claim about **sending**.
> A comment that answers the question somebody was about to ask is worse than no
> comment when it answers a slightly different one.

Both are kept, because they fail in opposite directions:

- **printing** renders in the reader's browser with the reader's system fonts,
  so it prints scripts `src/lib/pdf` cannot — and produces nothing anybody can
  attach to an email;
- **the PDF** is a file, and is Latin-script only.

---

## Weight, and the boundary that keeps it there

Built after: all **four** PDF routes are **151 B / 103 kB** — the shared
baseline and nothing else. pdf-lib (~400 kB) stays entirely server-side, and the
download controls are plain `<a href … download>` links rather than client
components, so a Server-Component-only route is not charged the i18n catalogue
to draw one word. The two pages that gained a link are 118 kB
(`/report-card/[studentId]/[examId]`) and 152 kB
(`/exams/[examId]/report-cards`), both already client routes for other reasons.

One `"use client"` file importing `pdfFileName` for its filename helper would
quietly end that — `fees-display.ts`'s lesson one library along — so the guard
is on the **client boundary**, not on a byte count. A byte count only fails
after somebody has already shipped it.

### …and a comment that measurement disproved

`next.config.ts` gained an `outputFileTracingIncludes` entry with a confident
comment: *without this the font is not in the serverless bundle and every PDF
request 500s in production.* **Built with those lines deleted — the tracer finds
the `.ttf` on its own, for both routes.** The comment was wrong and now says so.

The entry stays, because *why* the tracer succeeds is narrow: it can follow
`readFile(join(process.cwd(), "<string literal>"))` and cannot follow a computed
path. A refactor that builds the filename from a weight or a locale drops the
font silently and only production finds out. So the executable half is a guard
on **the literal**, verified by planting a template literal, and the config is
the declaration of intent beside it.

---

## What is not built

- **Storage, and therefore attachment.** These routes stream bytes; nothing is
  written to the `documents` bucket. A PDF *attached to an email* needs the file
  to exist before the dispatcher runs — which is rule 8's choreography (object
  first, path in the row, signed URL after a permission check) plus a rule 10
  change to carry an attachment on a delivery. Two modules' surface, named
  rather than half-built.
- **A whole class at once.** 302 report cards is **10.4 s** by the measurement
  above, which is exactly what rule 7 says to queue. This measurement is what
  made the queue worth building — `0242`–`0244`, see
  [jobs.md](./jobs.md) — and `report_cards.render` is still not one of its
  kinds, for a reason that is real rather than effort: the renderer is Node
  (pdf-lib, an embedded font) and a job runs inside Postgres, so it needs a
  worker process that is neither, plus the Storage item above to put the files
  somewhere.
- **ID cards.** The other document a school hands out, and the one that is not
  frozen: rule 12's *"a statement about now, not about a day that has passed"*.
  It needs a CR80 page rather than A4 and an embedded photograph, and this
  college has **0 objects in Storage**, so there is nothing to embed yet.
- **A school's letterhead.** The header is the school's name and address as
  text. An uploaded logo is a Storage read and an image embed — small, and not
  attempted here because no school has uploaded one.
