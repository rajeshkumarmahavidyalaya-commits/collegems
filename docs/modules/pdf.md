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

## Two documents, because one is a decision and two are a pattern

They are deliberately unalike, and the difference is the interesting part.

| | certificate | invoice |
|---|---|---|
| shape | a page of prose | a table that has to add up |
| source | `certificates.body`, **frozen at issue** | `getInvoiceDocument()`, **live** |
| identical in 2034? | yes, and must be | no, and must not be |
| cache header | `private, must-revalidate` | `no-store` |

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

Built before and after: both PDF routes are **145 B / 103 kB** — the shared
baseline and nothing else. pdf-lib (~400 kB) stays entirely server-side, and the
download controls are plain `<a href … download>` links rather than client
components, so a Server-Component-only route is not charged the i18n catalogue
to draw one word.

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
  above, which is exactly what rule 7 says to queue. `jobs` has existed since
  `0007` and has **0 rows** and no worker; this is the first thing that would
  genuinely need one.
- **Report cards and ID cards.** Both are documents a person keeps and both
  should come through `Sheet`. The report card is the harder one and worth doing
  carefully: it must render `exam_results`' frozen numbers and its
  `rules_snapshot`, never recompute a rank whose cohort has changed.
- **A school's letterhead.** The header is the school's name and address as
  text. An uploaded logo is a Storage read and an image embed — small, and not
  attempted here because no school has uploaded one.
