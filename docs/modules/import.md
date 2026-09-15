# Bulk student import (Phase 6.4)

Migrations `0106`–`0108`.

---

## Why this is not a queued job

CLAUDE.md rule 7 lists bulk import as `jobs` work. Rule 7's own refinement says
the test is boundedness, not the category: *bound it and say what the bound is,
or queue it.*

The bound here is **500 rows a run**, stated in a CHECK constraint rather than a
comment — and the browser refuses a longer file before uploading it:

> *"That file has 900 rows and an import takes at most 500. Split it — importing
> the first 500 silently would be worse."*

Refusing rather than truncating is the important half. Silently importing the
first 500 of 900 children is the worst available outcome, because nobody notices
until April.

---

## Rule 13, in full

> Every import gets three or four rows wrong, and **the person who can fix them
> is standing at the screen.**

A wrong date format, a duplicate admission number, a class that does not exist —
a preview you can only read is a preview you have to correct afterwards, one
student at a time, in a different part of the app.

So `import_runs` → `import_rows` is the same pair as
`promotion_runs` → `promotion_decisions`:

- **The rows are editable.** Correct a name, pick a class, change an admission
  number, or skip the row entirely.
- **Apply writes what the rows say**, not what the file said. `import_apply_run`
  never re-parses anything.
- **At most one live run per tenant** (`import_runs_one_live`, a partial unique
  index). Two half-corrected previews of one spreadsheet disagree, and whichever
  is applied second silently wins.
- **Applying freezes the rows.** `import_rows.run_status` is carried inside a
  composite key to `import_runs (tenant_id, id, status)`, so applying is one
  UPDATE on the parent and the draft-only write policy then matches nothing.
  Verified: an edit after apply touches **0 rows**.

---

## Validation is in Postgres; parsing is in the browser

The split is deliberate and each half is where it can do its job:

| | Where | Why |
|---|---|---|
| Parsing a CSV | browser | quoted commas, a UTF-8 BOM, Excel's date formats — a file problem |
| Judging the rows | Postgres | needs the school's own data to check against |

`import_validate_run` returns **sentences**, the same contract as
`grading_scheme_problems()`, because the person reading them is about to act on
them:

```
line 3: A first name is required
line 4: Admission number IMP-0002 appears more than once in this file
line 5: Admission number SOS-2025-0001 already belongs to a student in the school
line 6: Gender should be male, female, other or undisclosed;
        The date of birth is in the future;
        No class matched — pick one, or the child is admitted without a class
```

Two duplicate checks, not one, because they fail for different reasons and a
person fixes them differently: a clash *inside the file* and a clash *with the
school*.

**It re-judges every row on every edit**, and that is the point — fixing row 4's
admission number clears row 2 as well, and a *new* duplicate introduced by a fix
is caught before apply rather than during it. A test pins that the problem count
drops by more than the one row edited.

A skipped row is not judged at all: stale problems on a row somebody has already
decided to leave out make the count of what is wrong lie.

---

## Apply is partial on purpose

`import_apply_run` calls `admit_student`, so an imported child goes through the
same one admission path as a child typed in by hand or admitted from an enquiry.

- **Idempotent** on `applied_student_id` — a retry after a timeout tops up
  rather than duplicating.
- **A failed row keeps its reason** in `apply_error` and the batch carries on.
  Stopping at the first failure leaves the office with half an import and no
  list of what did not go in.
- **Re-validated first**, because between the last check and this click somebody
  may have admitted a student by hand with one of these admission numbers.

Verified end to end on a six-row file: 5 rows flagged with the four mistakes real
spreadsheets have, then after corrections and two deliberate skips — **4 applied,
0 failed**, an edit afterwards touching 0 rows, and a second apply refused with
*"This import was already applied"*.

---

## Two decisions that would corrupt records if wrong

### Dates are day-first

`12/06/2015` is the twelfth of June, not the sixth of December. That is what an
Indian school office types, and reading it the other way silently swaps
birthdays for every child born before the 13th. `parseImportDate` is pinned to
it, and anything it cannot read confidently returns null rather than guessing.

### A class is matched exactly, or not at all

`import_match_section` normalises spacing and case — so `Grade 1 A`,
`grade1a` and `GRADE 1  A` all match — but returns nothing when **two** sections
could match. A guess there puts a child in the wrong class, and nobody finds out
until a register is taken.

---

## The bug the tests caught

`normaliseHeading` trimmed the heading *before* turning punctuation into spaces:

```
"Admission No."  →  "admission no "   ← trailing space, matched nothing
```

Every real spreadsheet writes `Admission No.`, so the import would have refused
every realistic file with *"the file needs a column for admission number"* while
looking at a column that said exactly that. Trimming last fixes it, and the test
that found it uses the punctuated heading rather than a tidy one.

*Test with the input the world actually produces, not the one that is easy to
type.*

---

## Permissions

RLS keeps both tables to `admin` — a file holds children's dates of birth before
any of them is a student. The matrix draws the line RLS does not: **preparing an
import is not the same as applying it.** Somebody can spend an afternoon
cleaning a spreadsheet without being the person who creates two hundred students.

- `import.view` · `import.prepare` · `import.apply`

---

## Not built

- **Only students.** `import_runs.kind` is typed for a second kind — staff,
  guardians, opening fee balances — which should reuse this machinery rather
  than growing a second pair of tables.
- **No undo.** Applying creates real students; reversing means withdrawing them
  through the students module. The run records exactly what was written, which
  is what makes that possible by hand.
- **No column mapping screen.** Headings are matched by alias; a file with
  genuinely unusual headings has to be renamed. A mapping step is the obvious
  next thing.
- **No Excel files.** `.xlsx` needs a parser; CSV needs none.
- **No guardian records are created.** The guardian's name and phone are
  captured and validated and then *not written*, because a guardian is a `people`
  row with its own linking rules — see rule 5. Recorded as a gap rather than
  guessed at.

---

## One spreadsheet, two contact columns, two different people

The roadmap said *"302 active students, one email between them"* and filed it
under office work — somebody has to type them in. Reading the importer first,
because 302 of 302 students arrived through it, says otherwise.

`IMPORT_COLUMNS` matches a heading against a list of aliases:

```
guardianPhone   "guardian phone", "parent phone", "phone", "mobile", "contact"
email           "email", "e-mail"                                → the student
```

A school roll has one *Phone* column and one *Email* column and they are the same
person's: the parent's. The importer put the number on the guardian and the
address on the **child** — who, two columns to the left, has a date of birth in
2018.

> **Two contact columns of one spreadsheet must land on one person.** Which
> person a bare heading means is a judgement call; that both bare headings mean
> the *same* one is not.

The consequence is the thing migrations `0227`–`0235` were built for: after an
import the guardian has a phone and **no email**, so an email invitation cannot
reach them — while the child holds an address no invitation will ever be sent to,
because a student login needs the student's own invitation and nothing creates
one.

### The write path was ready and the caller never filled it in

`guardian_add` has read `p_person ->> 'email'` since migration `0221`.
`import_apply_run` built that jsonb with `first_name`, `last_name` and `phone`,
and stopped. So this is `0224`'s shape a second time — a key the schema was
waiting for and a caller that never passed it — rather than a missing feature.

### …and a third column nothing had ever written

`import_rows.phone` exists, `import_apply_run` passed it to `admit_student` as
the student's own number, and the insert in `actions.ts` never filled it: there
was no student-phone heading to fill it from. A read of a column with no writer —
`library_waive_staff_fine`'s `p_note` wearing a table. It gets a writer rather
than being deleted, because this product's first customer is a *mahavidyalaya*:
a college, whose students have their own phones and their own addresses, and for
whom a student login is the ordinary case rather than the exception.

### What the columns say now

| heading in the file | lands on |
|---|---|
| `Phone`, `Mobile`, `Contact`, `Guardian phone`, `Parent phone` | the guardian |
| `Email`, `E-mail`, `Email id`, `Parent email`, `Mother email` | **the guardian** |
| `Student email`, `Child email`, `Pupil email` | the student |
| `Student phone`, `Student mobile`, `Child phone` | the student |

Probed end to end in a rolled-back transaction, with the two shapes a real file
takes:

| row | student email | student phone | guardian email | guardian phone |
|---|---|---|---|---|
| a school roll (`Guardian, Phone, Email`) | — | — | `sunita.nair@…` | `+9198123…` |
| a college roll (both named) | `rohit.verma@…` | `+9198123…` | `anil.verma@…` | `+9198123…` |

Before this, the first row's address went to Meera Nair, aged seven.

### The validator learned two things

- **A guardian needs a way to be reached, not a phone specifically.** The old
  rule — *"A guardian with no phone number cannot be contacted"* — was right
  while a phone was the only thing collected. An email-only guardian is
  contactable, and `0233` made the invitation go by both, so the refusal now
  reads *"A guardian with no phone number and no email cannot be contacted"* and
  a row that would have been refused is now imported.
- **`n/a` is not an address.** `people.email` has no CHECK, so a spreadsheet
  column full of `n/a`, `-` and `not given` was stored verbatim and every
  invitation to it would have failed one at a time. The pattern is deliberately
  loose — the job is to catch those three, not to adjudicate RFC 5322 — and the
  message names the value: *`"n/a" is not an email address, so no invitation
  could reach it`*.

### What this deliberately does not do

**It does not refuse an import for want of an email.** A school whose roll has
no addresses at all must still be able to load its children. `0235`'s report
already names every child left without one, by state, the moment the import
finishes: *the importer collects what the spreadsheet has; the report says who is
left.*

**It does not add an inline editor for the new columns.** Rule 13's preview is
editable where a row is *wrong*; a missing address is not wrong, and the guardian
editor on `/students/[id]` has existed since `0221`.

### And the guard found an ambiguity nobody had decided

The first version of the alias check asserted which column *wins* a heading —
and passed on a planted `email` alias re-added to the student column, because
`IMPORT_COLUMNS.find` returns the first match and the guardian column comes
first. Asserting the winner guards the outcome, not the mechanism: the plant was
harmless for parsing *today* and would flip the moment somebody reordered the
array.

So the check counts claimants instead, and a second one requires that **no two
columns answer to one heading** at all. That one failed on its first run — on
itself: most columns list their own label as an alias too, so `first name`
appeared twice for `firstName`. A Set per heading, and the guard reports on the
data rather than on its own shape.
