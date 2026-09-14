# Identity cards

*`/students/id-cards`, `/students/[id]/id-card`, `src/components/id-card/`,
`src/app/(app)/students/photo-actions.ts`. Guard:
`tests/students/id-card.test.ts`. **No migration** — see below.*

A printable student ID card, eight to an A4 sheet, built entirely from records
that already existed.

## It is not frozen, and that is the whole design

Rule 12 is emphatic: *"anything printed on a document a person keeps is frozen
when the document is made."* Report cards freeze. Certificates freeze — preview
computes, issue writes the rendered text down, and a duplicate printed in 2034
reads that row.

An ID card looks like a third case and is not one:

> A report card is a statement about **a term that has ended**. A certificate is
> a statement about **a day**. An identity card is a statement about **now** —
> and freezing it would print last year's class on the card a child is carrying
> this year.

That is rule 4's second boundary asked of a document instead of a foreign key:
*is this child a statement about now, or about a day that has passed?*
`substitutions` freezes because it records a morning; this recomputes because it
records a fact that is still true.

Three things follow, and together they are why this module needs **no schema at
all**:

- **No serial.** `document_sequences` exists for a *gapless* record — a
  certificate with a hole in its numbering is one nobody can audit. Reprinting a
  lost ID card is not an auditable event, and numbering it would make losing one
  a paperwork problem.
- **Nothing stored.** No table, no `rules_snapshot`, no issued-on date.
- **It says which year it is valid for.** A document about *now* has to carry the
  now it was true of, or it is a card with no expiry that a fifteen-year-old is
  still holding at twenty. That comes from the session resolved server-side
  (rule 2), never from the caller.

The guard asserts all three, including that no migration ever creates an
`id_cards` table or an `id_card` document-sequence kind — because "add a serial"
is exactly what somebody who has read rule 12 and not this page would do.

## The column and the bucket that had neither end

Building this found the reason nobody had built it. Swept first:

> **`people.photo_path` is rendered in no component in the application, and
> nothing anywhere uploads to `avatars`.**

The column has existed since migration `0003`; the bucket, with a 5 MB limit, a
MIME list and storage RLS, since `0053`. Both correct, both unreachable — rule
6's *"a correct write path nobody can call"* with the read half missing too. And
a card with an empty square where the face goes is not an identity card, so the
photograph and the card are one feature rather than two.

`photo-actions.ts` is both ends, and it follows rule 8 exactly:

- **The row-level question is asked against `public` first.** Storage RLS only
  knows the tenant segment of a path; *"may this person edit this child's
  record"* lives in the policy on `people`, and only an administrator has an
  UPDATE policy there. A teacher's update touches **0 rows**, which is silent by
  design — so the action counts rows rather than catching an error (rule 6) and
  turns the zero into *"Ask the office"* rather than a raw failure.
- **Object first, row second, and delete the object if the row write fails.** An
  orphaned object costs bytes nobody sees; an orphaned row is a broken image on
  somebody's screen. The *previous* object is removed only after the row points
  at the new one.
- **The path is stored, never a URL**, and a signed URL is issued at render —
  after the row came back through the policy, because the signature *is* the
  authorization.

### `next/image` is refused, and the guard says why

The optimiser fetches a signed URL server-side and caches the result behind a
stable, unsigned `/_next/image?url=…` address.

> That converts a ten-minute bearer token into a permanent public one. **A
> child's photograph is the last thing in this product that should acquire a
> stable URL.**

So both places that render one use a plain `<img>` with the lint rule disabled
at the line and the reason above it, and the guard fails if `next/image` appears
in either file.

## What is missing is said, not refused

Certificates refuse: *"a certificate reading 'Father's Name: —' is a document a
school has to apologise for"*. A card is not that — one with no blood group is
still a usable card. So `cardGaps()` is the `grading_scheme_problems()` shape:
sentences, ordered worst first, and a person decides.

The one exception is the photograph, marked `blocking`, and the set gets one
sentence rather than eighty — *"6 cards have no photograph"* — because nobody
reads eighty sentences before pressing print. Both plural forms are carried in
all three languages, per rule 2: English plurals are not derivable and neither
are anybody else's.

## Two details that cost paper if you get them wrong

- **CR80.** 85.60 × 53.98 mm, the bank-card rectangle, which is what a school's
  laminating pouches and badge holders are cut for. Any other ratio produces
  cards that do not fit the holders the school already owns — discovered after
  four hundred have been cut.
- **`data-print="page"` goes on the grid of eight, not on the card.** The
  report-card module puts it on every card, correctly, because a report card *is*
  a page. Copying that here would waste seven sheets in every eight. The cards
  carry `data-print="keep"` so one is never guillotined by a page break, and
  `print-color-adjust: exact` on the photograph so it survives the browser's
  "background graphics off" default.

## The 22 kB that props removed

`PhotoControl` first called `useI18n()`, which is the ordinary shape for a client
component and the wrong one here. Built three ways:

| `/students/[id]` | |
|---|---|
| before | **165 kB** |
| with `useI18n()` | **187 kB** (+22) |
| with labels as props | **166 kB** (+1) |

`sonner` was already on that route through `ExitControl`, so every byte of the
22 kB was the message catalogue arriving for the **first** time on a route that
had never had a client-side i18n consumer — the `/hr 156 → 172 kB` shape
recorded in `docs/ui-review.md`, which also named 16 kB as the point where it
stops being worth paying. This was past it.

> **A component that needs a handful of words does not need the dictionary.**

The parent is a Server Component already holding `t` from `getT()`, so it
resolves eight strings and passes them down — rule 15's fourth shape, applied
for a weight reason rather than a correctness one. The guard pins it, because
"tidy this into `useI18n` like everything else" is a plausible and expensive
edit.

The two new routes cost **172 kB** (`/students/id-cards`) and **139 kB**
(`/students/[id]/id-card`); the card face and both pages are Server Components,
so the only client JavaScript in the module is the class picker and the print
button.

## Three issues found by reading it back

This session has no database access, so nothing here could be run against a
school. Everything below was found by re-reading the code afterwards, which is
the honest half of building blind — and all three are shapes CLAUDE.md already
names somewhere else.

- **Forty round trips to sign forty photographs.** The first version mapped the
  single-path signer over the class, which is a server client and an HTTP
  request *per child* to render one page. The rule is already written for SQL:
  *"a scalar function that queries another table is a correlated subquery
  wearing a nicer name… resolve a set as a set"*, where `audit_actor_label` cost
  8.4 ms a row and 525 ms to name sixty-two rows holding two people. Same shape
  in TypeScript. `photoUrls()` is one `createSignedUrls` call, and it returns a
  **map** rather than an array so a path that failed to sign is absent rather
  than shifting every later child by one.
- **The roll sorted as text.** `enrolments.roll_number` is `text`, so
  `order by roll_number` gives 1, 10, 11, 2, 3 — and a sheet of cards handed out
  in roll order is exactly where that is noticed. Text is the *right* column
  type (`12A` and `VI-07` are both real), so the fix is `Intl.Collator` with
  `numeric: true`, pinned to `en`. That pin is not rule 15's hardcoded-locale
  mistake: **a roll number is an identifier, not a word**, and the order a class
  is called in must not change with who printed the sheet — the same reasoning
  that keeps `audit.fieldLabel` untranslated.
- **A join nobody read.** The class query carried a nested `enrolments (…)`
  under each student that the projection never touched: N × M rows fetched and
  discarded. Rule 7 again — the projection runs for every *matching* row, not
  every returned one.

### And the test that caught the third one had the wrong window

The assertion sliced the source from `getIdCards` to `indexOf("async function
toCard")` — and `toCard` had just stopped being `async`, so `indexOf` returned
**-1**, `slice(start, -1)` ran to the end of the file, and the check failed on
the *single-card* query, which legitimately reads enrolments.

> **A silent `-1` widens a window instead of emptying it.** A guard that slices
> source has to prove both ends before it uses them, or it reports confidently
> on code it was never pointed at.

Both ends are asserted now, before the slice.

## Staff cards, and the gate a student card does not need

The same document with different facts — and **a different authorization story**,
which is the part worth reading twice.

| | RLS on the table | what narrows the rows | what the page needs |
|---|---|---|---|
| student card | **row-ownership** | the policy: a class teacher gets their own children | nothing beyond `students.view` |
| staff card | **role-wide** | nothing — admin, teacher, accountant and librarian each read every row | `staff.view`, checked in the function |

That is rule 4's refinement arriving in a module: *the matrix does real work
wherever RLS is deliberately tenant-wide.* `staff_roster` already makes the same
check **inside the function that produces the data**, and this module cannot
simply call it — the roster returns no `photo_path`, and a card without a
photograph is not a card — so it **repeats** the gate rather than inheriting it.

> The thing to notice is that skipping it would have been **invisible**. The
> rows come back to a librarian exactly as they come back to the principal, so
> there is no empty screen and no error to notice. Only the matrix says no.

Two smaller decisions:

- **A leaver gets no card.** `status = 'active'`, and the button disappears from
  a departed member of staff's page. A badge that still opens a door is
  `student_exit`'s *"an ending is not a door that stays shut"*, pointed at a
  piece of plastic.
- **The department list is built from the rows**, not from an enumeration,
  because `staff.department` is free text. A school that has typed "Science" and
  "Sciences" sees two entries — the honest rendering of what is in the column,
  and a better prompt to tidy it than a silent merge.

### The face had to stop being student-shaped

`IdCardFace` was built around `admissionNumber`, `className`, `rollNumber` and
`guardianName`. Staff cards would have meant either a second component or a type
where half the fields are always null, and **neither survives a third kind of
card** — a visitor pass, an examiner's temporary badge.

So it renders a `PersonCard`: a heading, a subtitle, and a list of
already-labelled facts.

> **Each module decides what a card says; the face decides what one looks
> like.** Labels arrive resolved because the module building a card already
> holds `t`, and the face is a Server Component.

`studentFace()` and `staffFace()` are the two mappers. The guard asserts the face
mentions no student-only field — and `className` is deliberately *not* in that
list, which is the instructive omission: it is both a student field and React's
own prop, so every `<div className=…>` matches it. **A field name that collides
with a framework prop cannot be swept for by name.** The type covers it instead:
`PersonCard` has no such property, so reading one would not compile.

Measured: the two new routes are **139 kB** and **173 kB**, identical to the
student pair because they are the same components, and `/staff/[id]` did not move
— the card link is a plain `<Link>`, not a client component.

## Who may print one

Gated on `students.view`, and the nav entry agrees with the page. A card carries
the name, class, admission number and guardian phone that `/students` already
shows the same roles — and **RLS decides which children**, so a class teacher
printing "their" class gets their own. That is the right answer and it needs no
second gate to produce it.

## Not built

- **Staff photographs have no upload control.** `setStudentPhoto` writes
  `people.photo_path` through the student's `person_id`; a member of staff has a
  `person_id` too and no screen that reaches it, so every staff card prints the
  placeholder until one exists. The action generalises — the object path is
  already namespaced under `people` rather than `students` — but the row-level
  check is "may this person edit *this staff record*", which is a different
  select and deserves to be written rather than parameterised in a hurry.
- **A barcode or QR code.** A card that can be scanned is a card the library and
  the gate can use, which is a real feature and a real decision: what the code
  encodes (an admission number? a uuid?) determines whether a photograph of a
  card is enough to impersonate its holder.
- **A back face.** School rules, an emergency number, a bus route. Easy, and it
  wants a school to choose the wording — which means `reference.settings_catalog`
  rather than a constant.
