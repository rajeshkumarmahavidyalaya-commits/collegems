# Academic years — the flag nobody could move

Migrations `0195`, `0196`, `0197`.

## What was measured

`current_session_id()` is one line:

```sql
select id from public.academic_sessions
where tenant_id = p_tenant_id and is_current
limit 1
```

A flag. Fifty-four functions read it, every dated write stamps its row with it —
and **nothing in the application could set it.** `promotion` reads the list of
years, `getUserContext` reads the current one, and that was every reference to
`academic_sessions` in `src/app`. There was no way to create next year and no
way to switch to it.

On the demo school, on 9 September 2026, with 2025-2026 (1 Apr 2025 – 31 Mar
2026) still flagged current:

| table | dated outside the year they are stamped with |
|---|---|
| `attendance_records` | **6,000 of 6,000** |
| `ledger_entries` | 323 of 323 |
| `invoices` | 317 of 317 |
| `journal_vouchers` | 274 of 274 |
| `homework` | 32 of 32 |
| `book_issues` | 25 of 26 |
| `stock_movements` | 14 of 14 |
| `visitors` | 4 of 4 |
| `exams` | 2 of 2 |
| `certificates` | 1 of 1 |

And the control, which is what makes this a finding rather than a coincidence:
`staff_attendance` (765 rows) and `leave_requests` (4) are **clean**. Those are
the tables the seed dated with a fixed date inside the year; every table above
was dated `current_date - n`.

That is exactly what the application does. It dates a row today and files it
under whichever year holds the flag, so the moment the flag is stale every row
lands in a year it did not happen in — invisible to every report of the year it
belongs to, and counted in the year it does not.

Probed rather than reasoned: `mark_attendance` accepted today's date (five
months after the year ended) and also accepted `2024-06-10`, writing one row
each time, with no error either way.

## Two questions, and the flag answers neither

> **`session_id` says which year a row is filed under. The row's own date says
> which year it happened in.** Those are different questions, and
> `current_session_id()` — *which year has the school decided it is working in*
> — is a third.

`academics_session_for_date(date)` is the second question, given a name so the
codebase can stop conflating it with the third. It is arithmetic; the flag is a
decision. The decision is deliberately still a decision — a school sets next
year up in February and switches in April, and a product that switched
automatically on 1 April would file the last week of enrolment work into the
wrong year in the opposite direction.

## Years may not overlap

```sql
alter table public.academic_sessions
  add constraint academic_sessions_no_overlap
  exclude using gist (
    tenant_id with =,
    daterange(start_date, end_date, '[]') with &&
  );
```

Rule 4's exclusion constraint, and load-bearing rather than tidy:
`academics_session_for_date` and the critic below both answer *"which year does
this date belong to"*, and that question needs exactly one answer. Two
overlapping years also make `current_session_id()`'s own `limit 1` arbitrary.

The refusal is translated at the boundary, because `23P01` reads *"conflicting
key value violates exclusion constraint"*:

> Those dates overlap 2026-2027 (1 Apr 2026 to 31 Mar 2027). Two years cannot
> share a day, or no row can say which year it is in.

## Moving the dates of a year that already has arrangements in it

`academics_session_update` is where migration `0178`'s device shows itself from
the other side. `transport_assignments` and `hostel_allocations` carry
`session_starts_on`/`session_ends_on` inside a composite foreign key with
`on update cascade`, so editing a year rewrites every seat and bed made for it,
their `effective_ends_on` regenerates, and their exclusion constraints
re-check. Shortening a year under a bus seat that would then overlap next year's
is **refused** — the same shape as refusing to lower a paper's maximum below a
mark already awarded, and the same answer: that refusal is the device working.

## Activating is two statements, not one

`academic_sessions_one_current_uk` is a partial unique index over
`(tenant_id) where is_current`. A single `update … set is_current = (id = $1)`
can trip it mid-statement as btree entries are written, so the function clears
first and sets second. Both are in one transaction, so there is no window in
which the school has no current year.

## The critic, and what it deliberately does not do

`academics_filing_problems()` is a new `reference.checks` row rather than
another message on `academics.session`, because the remedy is different: that
one sends you to a rollover, this one to the year list, and a critic whose
message and whose link disagree is one people stop following. Live, as an
administrator, in 180 ms:

> 6,000 register rows are dated between 5 Aug 2026 and 1 Sep 2026 but filed
> under 2025-2026, which ended on 31 Mar 2026. They belong to 2026-2027.
>
> 1 certificate is dated on 7 Sep 2026 but filed under 2025-2026, which ended
> on 31 Mar 2026. It belongs to 2026-2027.
>
> Rows are dated today and stamped with whichever year is current, and
> 2025-2026 is current though it ended on 31 Mar 2026. 2026-2027 covers today —
> make it current under Academics → Years.

**It does not repair the 6,000 rows**, and the reason is not squeamishness:

> Re-stamping a register row's `session_id` would file it in 2026-2027 while
> `attendance_records.enrolment_id` still points at a **2025-2026** enrolment.
> The row would be consistent with the calendar and inconsistent with the
> child's place in the school.

The register was taken in August 2026 against last year's enrolments because
nobody promoted the school into this year. The repair for that is a promotion
run, which is a decision with named children in it (rule 13) — not something a
migration may do on a school's behalf. Same answer as
`transport_billing_conflicts`: name it in sentences and let a bursar decide.

## Two grammar migrations, and why they are their own migrations

`0195`'s critic said, verbatim:

```
1 certificates is dated between 7 Sep 2026 and 7 Sep 2026 ...
32 homework are dated between 30 Aug 2026 and 30 Aug 2026 ...
6000 register rows are dated between 5 Aug 2026 and 1 Sep 2026 ...
```

A plural noun with a singular verb, an uncountable noun counted, a four-figure
number with no separator, and a range whose ends are the same date. None is a
wrong answer; all four are why a school stops reading a screen that exists
purely to be acted on.

`0196` fixed the noun, the verb, the number and the range — and left `They
belong to` standing in front of one certificate. `0197` is that, and it is a
separate migration on purpose, because the lesson is worth having a number:

> **Number agreement is a property of the whole sentence.** Fixing the subject
> and the verb and leaving the pronoun is not a partial fix; it is the same
> error, one clause later, and it reads exactly as careless.

Every count-dependent word now comes out of one `worded` CTE, so the next person
adding a clause has somewhere obvious to put its two forms. English plurals are
not derivable (`entry`/`entries`, and `homework` has none), so each table
carries both.

## Stamping from the date, not from the flag

`0195` named the three questions and stopped. `0198` answers the first with the
second wherever the second is the whole answer:

| function | what decides |
|---|---|
| `mark_attendance` | the register's date |
| `hr_mark_attendance` | the same, for staff |
| `library_issue_book` | the day the book left the shelf |
| `stock_record_movement` | `happened_on`, defaulting to today |
| `visitor_check_in` | now |

Probed on the demo school, where the flag still says 2025-2026 and today is 9
September 2026:

```
staff register today: wrote 1, filed under 2026-2027
book issued today            filed under 2026-2027
visitor pass                 filed under 2026-2027
stock back-dated to 15 Jan 2026 filed under 2025-2026
```

Four rows, three years' worth of dates, each filed where it happened.

### Two refusals, both in sentences

```
9 Sep 2026 falls in 2026-2027, and these children are enrolled in 2025-2026.
Promote them into 2026-2027 first, or check the date.

No academic year covers 6 May 2019. Add one under Academics → Years.
```

The first is the one worth explaining. The old body filtered entries to
`enr.session_id = current_session_id()` and returned the count, so a register
taken on a day in a year the children are not enrolled in **wrote nothing and
said nothing** — the server action was left guessing between "no permission"
and "no longer enrolled", and could not name the real reason. It can now, and
the guess survives only for the cases RLS genuinely hides.

Re-stamping those rows is still refused, for the reason above: a register row
in 2026-2027 pointing at a 2025-2026 enrolment is consistent with the calendar
and inconsistent with the child. The function refuses to *create* that; the
critic reports the ones that already exist.

### What is deliberately not date-driven

- **Invoices, and the ledger and vouchers that follow them.** An invoice's
  `session_id` is *which year's fees it bills*, and `fees_billable_lines` reads
  the current session to decide that: a bill raised on 3 September for 2026-27
  is a 2026-27 invoice whatever the calendar says about the day it printed.
  Rule 6 ties every ledger entry to its invoice by foreign key and
  `accounts_sync` follows the source document, so converting these would misfile
  April's arrears notice in the opposite direction.
- **Leave requests, homework and exams**, because each carries a *range* rather
  than a day, and "which year does a range belong to" is a different question
  with a real answer needed at the boundary — a leave from 28 March to 3 April
  belongs to one of two years, and which one is a school's decision rather than
  arithmetic. They were both clean in the audit; they are named here so the next
  person knows the omission was noticed.

The distinction is the point: **"stamp from the date" is the rule for a row that
records a day**, not a blanket sweep.

### What this broke, which is the useful part

Two test suites encoded dates no academic year covers — `2020-02-03` for the
student register, "well in the past, so the suite can never collide with a
register a human is taking today", and `2030-12-02` for the staff one. Both are
now refused, and the premise was always wrong: a register in a year the school
did not have was never a legal row, and the constant was hiding that. Both now
derive a date from the session their subjects belong to, which is what the test
meant in the first place.

## Not built

**A constraint refusing the write.** The declarative half of all this is rule
4's boundary device on the dated tables — `session_starts_on`/`session_ends_on`
on the child inside a composite key, with a CHECK that the row's own date falls
between them, exactly as `transport_assignments` carries it. The write
functions now make the violation unreachable through the app; the constraint is
what would make it unreachable full stop. It is still not here because 6,000
rows already violate it and cannot be mechanically repaired (see above), so
adding it means deciding what a school does with a year of registers taken
against the wrong enrolments — which is the school's decision, not a
migration's.

---

## The rollover creates next year, and seventeen screens had not been told

`0198` gave a dated write its year. This is the read side of the same question,
and it stayed hidden for two hundred migrations for a reason worth stating: **it
is not a bug until a school rolls a year forward.**

`academics_roll_forward_sections` had run on the demo school, so `sections` is
the one table in this schema holding two years at once. Measured:

| list | all years | this year |
|---|---|---|
| **sections** | **24** | **12** |
| section_subjects | 96 | 96 |
| fee_structures | 24 | 24 |
| homework | 32 | 32 |
| study_material | 8 | 8 |
| exams | 2 | 2 |
| transport_routes | 2 | 2 |
| notices | 1 | 1 |

Every other row of that table is a coincidence: only sections have been rolled
forward, so only sections can disagree. The readers were equally unfiltered in
all eight cases — the data simply had not caught up with them yet.

### What that cost, today

`listSections()` feeds the class picker on **seventeen screens** — students,
fees, fee setup, instalments, study material, academics, front office,
notification compose, three exam screens, student new and edit, import, notices
and the timetable. It returned 24 rows over two academic years, with
*"Grade 1 · A"* appearing **twice, under an identical label**.

> A picker cannot answer *"which of these two Grade 1 A's is mine"*, and neither
> can the person using it. The row count is not the failure; the duplicate name
> is.

RLS does not help and is not meant to: **a policy answers which tenant and whose
rows, never which year.** Rule 2 puts `session_id` on the table precisely so a
reader can filter without a join — and then three readers did not
(`listSections`, `listAllSections`, `listMarkableSections`).

### …and a family landed on another child's class

The same page showed what an unscoped picker does to somebody who cannot correct
for it. `/timetable` handed a guardian the office's screen unchanged: a picker
of all twenty-four entries, defaulting to `sections[0]`. Probed as the guardian
of a child in **Grade 6 A**:

```
sections in the picker      24
picker defaults to          Grade 1 · A
lessons shown on arrival    35   (Grade 1 A's, in full)
their own child's class     Grade 6 A, 14 lessons
```

The fix is the list, not the component: `RoutineGrid` already defaults to its
first entry, so narrowing the list narrows the default with it.
`listMyChildren()` (migration `0199`) supplies the relationship, a member of
staff gets `[]` from it and keeps the whole school, and the page's copy stops
telling a parent that *"the grid you build is one that can actually be taught"*.

The empty state moved with it. *"Add a class under Academics first"* is the
right sentence for an administrator and the wrong one for a family whose child
has no enrolment, and only the page knows which caller it is drawing for — so it
passes the sentence in rather than the component guessing.

### The guard, in two halves because neither is enough

`tests/academics/section-picker.test.ts`:

- **the source**, and it reads the query rather than calling it. These are
  Server Actions — they call `cookies()` from `next/headers`, so importing one
  into a test throws outside a request and the assertion never runs. A check
  that can never go green is a check people learn to ignore.
- **the data**, asserting no two classes in one year share a label — because the
  source check would still pass if somebody filtered on the wrong session.

### The rest of them, one at a time

The first sweep of this reported **90 unfiltered statements, 42 of them
whole-table reads**, and both numbers were wrong. The script split a query at
the next `;`, and this codebase builds a query across several statements:

```ts
let query = supabase.from("fee_structures").select(…);
if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);
```

`listFeeStructures` was already correct and was counted as a defect. Reading the
whole enclosing function instead gives **54 reads with no year anywhere in the
function, 19 of them whole-table lists** — and that is the number the triage was
actually done against.

> A sweep's number is a claim, and a claim measured with a broken instrument is
> worse than no number: it is a number people quote.

Of the 19, **eight were "now" and are filtered**, and **eleven are "ever" and
are left alone with the reason written down.**

Filtered (migration-free; these are all read paths in `src/app`):

| reader | why it means "now" |
|---|---|
| `listExams` | the exam list on `/exams` |
| `listHomework` | what has been set this year |
| `listStudyMaterial` (and its section labels) | this year's material, for this year's classes |
| `listCurriculum` (and its section labels) | who teaches what, now |
| `listConcessionAwards` | capped at 500 rows, so last year's revoked awards would push this year's off the end |
| `listLeave` | capped at 200, same argument |

Left cross-year, and a later "fix" would break each one:

| reader | why it means "ever" |
|---|---|
| `accounts` (`journal_vouchers` ×2) | rule 6: the module is date-ranged; a voucher book that hid last March would not reconcile |
| `certificates` | a register is a history — a certificate issued in 2024 must be findable in 2034 |
| `library` (`book_issues`) | a book issued last year and still out is exactly the row being looked for |
| `hr` (`leave_requests`) | a balance is derived from everything taken |
| `payroll_runs` | last year's finalised runs are the payslips people ask about |
| `notices` | rule 10: the board's whole point is coming back in March to check what the circular said |
| `exams` (scheme usage), `section_subjects` (subject usage), `transport_routes` (vehicle usage) | three counts that answer *"is this safe to delete"*, where crossing years is the conservative direction |
| `promotion` (`sections`) | the one module whose job spans two years; filtering it would filter out the destination |

### A list read is not a lookup

Filtering `listExams()` alone would have been a **worse** bug than the one being
fixed, and finding out why was the useful part.

Four pages — the exam, its mark sheet, its remarks and its report cards — found
their exam with `listExams().find((e) => e.id === examId)` and called
`notFound()` if it was absent. So the moment the list learned about the year,
every past exam's page would have 404'd.

> **A lookup by id needs no year**: the id names the row and RLS decides whether
> the caller may have it. A list needs one, because a list is a claim about what
> is happening.

`getExam(examId)` is that lookup — one row, `maybeSingle()`, deliberately not
session-scoped — and it also takes four pages off reading every exam in the
school to find one.

### The guard

`tests/academics/session-scope.test.ts` runs the corrected sweep in CI and
requires every whole-table read of a session-scoped table to be **named in
`CROSS_YEAR_ON_PURPOSE` with its reason**. It is the `nav-audience` guard's
shape applied to rule 2: the failure is the omission, so the test fails on a
list nobody has decided about rather than on a pattern. Verified by removing
`listHomework`'s filter and watching it name the line.
