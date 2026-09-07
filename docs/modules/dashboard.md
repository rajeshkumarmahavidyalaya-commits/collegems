# The dashboard, and the reports behind it

The home screen is a **brief of everything** in one round trip, and three of the
questions it raises have a second, deeper answer in the report catalog rather
than on a page of their own.

Migrations `0126`–`0131`.

| | |
|---|---|
| `dashboard_summary()` | one jsonb document: roll, enrolment, both registers, money, pass/fail, library |
| `dashboard_enrolment_by_grade()` | active enrolment per year group with its gender split |
| `hr.staff_attendance` | catalog report — how often each member of staff was in |
| `hr.teacher_summary` | catalog report — one row per teacher: class, load, homework, attendance |
| `exams.results` | catalog report — pass, fail and incomplete for a published exam |

---

## Why the dashboard is a function and the rest are catalog rows

Rule 11 says *do not add a screen to answer a question*: a question with
parameters is a row in `reference.reports` plus one `SECURITY INVOKER` function,
and `/reports` renders it without being edited. "How often was each teacher in
last month, in the science department" is exactly that shape, so it did not get
a page.

The dashboard is the other shape, and naming the difference is the point:

| | a report | the dashboard |
|---|---|---|
| parameters | yes — that is what makes it a catalog row | none |
| questions answered | one | nine, at once |
| what it is for | somebody looking something up | somebody glancing before they sit down |
| what it must be | bounded and honest about truncation | **one round trip** |

A dashboard assembled in the page is a dozen queries fired on every load by
every member of staff every morning. The old home page made seven, and one of
them pulled *every active enrolment* with its student's person row across the
wire to count them in JavaScript — three hundred rows to draw twelve bars, and a
shape that gets slower exactly as a school grows.

Rule 7's test is boundedness, not category. Every figure in the brief is an
aggregate, so **one row crosses the wire however large the school gets**. That is
why this may run inline; it is also why `dashboard_enrolment_by_grade()` lives
in Postgres rather than in the page.

---

## The rule the brief lives under

> **It must not answer a question the module it borrows from would answer
> differently.**

Every figure either aggregates a module's own read path or counts the frozen
table a module writes:

| block | comes from |
|---|---|
| fees | `fees_student_balances()` and `fees_day_book()` — the fee screens' own paths |
| staff register | `hr_attendance_sheet()` — what the HR screen shows |
| pass / fail | `exam_results` — the frozen rows the exam module wrote, never a recomputation from `marks` |

A dashboard free to disagree with the screen the money is actually taken on is
worse than a dashboard without the number, because somebody will act on the
wrong one. `tests/dashboard/summary.test.ts` asserts the fee total to the paisa
against `fees_student_balances`, and the staff register row by row against
`hr_attendance_sheet` — those are the assertions that would catch an
"optimisation" that sums `ledger_entries` directly and quietly drops write-offs.

---

## Permissions are checked inside the function

`dashboard_summary()` is `SECURITY INVOKER`, so RLS decides what each caller can
see. That alone would make it **dishonest rather than unsafe**: a teacher may
read only their own row of `staff_attendance`, so an ungated staff card would
tell them *"1 present, 39 unmarked"* about a school where forty people were
marked in.

So each block is gated on the permission matrix the same way `report_run` gates
a report — inside the function that produces the data, which is the refinement
rule 4 already makes for reads RLS leaves tenant-wide.

| block | permission |
|---|---|
| `school` (roll, sections, enrolment) | `students.view` (`staff` count additionally needs `staff.view`) |
| `student_attendance` | `attendance.view` |
| `staff_attendance` | `hr.view` |
| `fees` | `fees.view` |
| `exam` | `exams.view` |
| `library` | `library.view` |

**Silence is not the answer either.** A card that is simply absent reads as a
bug, so every withheld block is *named* in `withheld` and the page turns that
list into a sentence: *"Your role does not see staff attendance and fee figures,
so those cards are not shown."* Absent-and-withheld and absent-and-empty are
different sentences, and only the server knows which applies.

Consequently there is **no `if (isAdmin)` in `src/app/(app)/page.tsx`**. Adding
one would be a second answer to a question that already has one.

---

## Three states of a register, and why they cannot be collapsed

`registerState()` in `src/lib/validations/dashboard.ts` is the single place a
register becomes words, and both register cards go through it.

| state | when | what the card says |
|---|---|---|
| `holiday` | `is_working_day` is false | "Holiday" |
| `not-taken` | working day, nothing marked | "Not taken" |
| `taken` | something marked | a percentage |

**"0% present" and "nobody has taken the register" look identical on a card and
mean opposite things.** That is the whole reason this is a discriminated union
rather than `number | null`.

The percentage is over **what was marked, not over the roll** — a register half
taken reads as half taken, not as a school half empty. Late counts as in;
excused is in neither half. On the staff side, on duty is in, a half day is half,
and leave is in neither half while still counting as a marked day, so a month of
approved leave reads as 0% rather than as a blank.

The same reasoning governs money: `collectionRate()` returns **null, not 0**,
when nothing has been billed. A school that has not raised an invoice has not
failed to collect, and an empty progress bar says it has.

---

## The three reports

### `hr.staff_attendance`

Per-person counts of present, absent, half day, on leave and on duty over a date
range, worst attendance first — because that is the row the head is looking for.
Anybody with nothing marked sorts **last** rather than reading as perfect.

Two details worth knowing:

- **`teachers_only` matches `designation` loosely.** Designation is free text.
  One school writes "Teacher", the next writes "TGT", "Asst. Teacher" and "PGT
  Physics", and an exact list would silently drop three of those and report a
  school with no teachers in it.
- **The date defaults come from `mobile_today()`**, not `current_date`. Supabase
  and Vercel both run in UTC, and "this month" on the 1st at 9am in Kolkata is
  last month in UTC — the same reason rule 11 gives for `report_day_bounds()`,
  applied to a default rather than to a filter.

### `hr.teacher_summary`

One row per teacher: the class they are responsible for, the periods, sections
and subjects they carry, the homework they set, and how often they were in. It
**wraps `timetable_teacher_load()`** rather than recomputing periods, per rule
11 — and migration `0128` is what that rule is worth in practice.

Somebody who is a teacher in fact but not in designation ("Coordinator", with
eighteen periods a week) is included on the strength of the timetable.

### `exams.results`

Pass, fail and incomplete for a published exam, failures first: the list is read
to find the children who need something done about them, not to admire the
toppers. It reads `exam_results` — the frozen rows carrying `rules_snapshot` —
so it always agrees with the card that went home.

The exam is chosen **by name**, because the catalog's parameter types are static
(`section`, `class_level`, `date`, `number`, `select`, `text`) and there is no
control that can list this tenant's exams. Blank means the most recently
published one, which is the answer wanted nine times in ten.

---

## Three bugs this module produced, and what each is worth

### `"Grade 4 A, Grade 4 A"` — migration `0128`

The teacher summary listed what each teacher is class teacher of by grouping
`sections`, and printed the same class twice for a school in its second year.
Not a duplicate row: rule 2 says every transactional table carries `session_id`
directly, and `sections` is one of them.

It reads as a rendering bug and is not one. The **number beside it was already
right**, because `timetable_teacher_load()` has filtered on the current session
since migration `0041`. So the half of the report that wrapped the module's own
read path was correct, and the half written by hand was not — rule 11 earning
its place twice on one row.

### `22P02: malformed array literal` — migration `0129`

Every one of the six `withheld` lines raised at run time. `text[] || 'fees'` is
ambiguous: the literal is `unknown`, both `array || element` and `array || array`
are candidates, and Postgres resolves it to `text[]`, so a plain word is parsed
as an array literal. `|| 'fees'::text` picks the operator by hand.

The part worth keeping is not the cast. **The function was probed as an
administrator and came back perfect, because an administrator is withheld
nothing** — the array append is dead code for the only role anybody tests with,
and the first teacher to open the home page would have met a 500.

> A branch that exists to describe a *restricted* caller has to be probed as one.

### A promise the test could not keep — migration `0131`

`0129` then wrote down that lesson and ended by claiming the test file asks for
the brief as each of the six roles. It does not, because it cannot: the suite has
two logins and both are administrators, which is what makes the cross-tenant
suite possible and is also its limit.

Leaving the sentence would have been the same species of mistake it was written
about — a comment describing a check that is not there.

> A test environment has a shape, and it decides which claims a test file can
> make. Write down what was actually checked and how, not what the ideal check
> would have been, because the next person reads the comment and stops looking.

What is actually true: the gating was probed by running `dashboard_summary()`
under each role's JWT claims directly; the test file pins the structural
invariant that survives having one role to sign in as (every block present is one
not named in `withheld`, and vice versa, and nothing is named that the page has
no sentence for); and the sentence the page builds is unit-tested for one,
several and unknown block names.

---

## A fourth, smaller one: `63.286%`

`exam_results.percentage` is numeric to three places and the exams screen renders
one. The report catalog's `percent` column type rendered the raw value, so the
same child's mark read `63.286%` in a report and `63.3%` on the screen.

Fixed in `formatCell` rather than in the SQL, so **every** report's percentage
column agrees with the module it came from — that file already claims to be "one
formatter for every report", and this is what that claim costs.

---

## Files

| | |
|---|---|
| `supabase/migrations/0126_staff_and_teacher_reports.sql` | the three catalog reports |
| `supabase/migrations/0127_dashboard_summary.sql` | the brief |
| `supabase/migrations/0128_a_section_belongs_to_a_year.sql` | the session filter |
| `supabase/migrations/0129_the_withheld_list_was_never_reached.sql` | the array cast |
| `supabase/migrations/0130_the_brief_carries_its_own_chart.sql` | enrolment by year group |
| `supabase/migrations/0131_what_the_test_can_actually_reach.sql` | the comment correction |
| `src/lib/validations/dashboard.ts` | parsing, and the readings the cards use |
| `src/components/dashboard/brief-cards.tsx` | the cards |
| `src/app/(app)/page.tsx` | the page |
| `tests/dashboard/readings.test.ts` | the readings, without a database |
| `tests/dashboard/summary.test.ts` | the brief and the reports, through real RLS |
