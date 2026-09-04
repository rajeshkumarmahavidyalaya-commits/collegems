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
