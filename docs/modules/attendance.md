# Attendance module

The second module built on the library pattern, and the first one whose UI has
a real interaction budget: a class teacher marks forty students in the two
minutes before a lesson starts, often on a phone, sometimes on a phone with no
signal.

Everything below is either enforced in Postgres or explained as a deliberate
deviation.

---

## Schema

`attendance_records` (migration `0019`):

| Column | Notes |
|---|---|
| `tenant_id` | Not null, RLS-enforced. Rule 1. |
| `session_id` | Not null, carried directly rather than joined for. Rule 2. |
| `enrolment_id` | **Not `student_id`.** See below. |
| `attendance_date` | `date`, not a timestamp — a register is a day, not a moment. |
| `period` | `integer not null default 0`, where 0 means whole-day. |
| `status` | Check constraint: `present` / `absent` / `late` / `excused`. |
| `note` | Free text, for "left early — dentist". |
| `marked_by` | `auth.users(id)`, on delete set null. Who took the register. |

### Why `enrolment_id` and not `student_id`

Attendance belongs to a student's *place in a class for a year*, not to the
person. Keying on the enrolment means a student who transfers section in
February keeps January's attendance attached to the class they were actually
in, and a repeating student's two years do not merge into one record. It also
gets `session_id` and `section_id` for free through one join.

### Why `period` is `not null default 0`

Period-wise marking needs the timetable tables, which are still roadmap. A
nullable `period` would force the uniqueness key to be an index over
`coalesce(period, -1)`; a `not null` column with 0 meaning "whole day" keeps it
a plain four-column unique index. When timetables land, period-wise marking is
a data change, not a migration of the key.

### The unique index is the feature

```sql
create unique index attendance_records_unique_mark
  on public.attendance_records (tenant_id, enrolment_id, attendance_date, period);
```

This is what makes marking idempotent. A phone that lost signal mid-save and
replays its queue upserts onto the same rows instead of double-marking, and the
client needs no idempotency key of its own — the natural key already is one.

---

## The atomic write

```sql
mark_attendance(p_section_id uuid, p_date date, p_entries jsonb, p_period integer default 0)
  returns integer   -- rows written
```

`SECURITY INVOKER`, `set search_path = public, extensions`, one statement.

It does four things the client is not trusted to do:

1. **Resolves the session itself** via `current_session_id()`. The client never
   sends `session_id`.
2. **Rejects future dates.** The app checks too, but only to produce a friendlier
   message; the exception here is the gate.
3. **Filters the payload to enrolments genuinely in that section and session.**
   A tampered payload naming another class's students writes zero of them —
   proven in `tests/attendance/attendance-flow.test.ts`.
4. **Upserts**, so the whole register is one statement. supabase-js cannot open
   a transaction, so a per-student loop would leave half a register marked on a
   dropped connection.

It returns the number of rows written, which is how the server action detects
"you may not mark this class" — a teacher aiming at someone else's section gets
`0` rather than an error, because RLS makes those enrolments invisible rather
than forbidden.

---

## RLS

Six policies, each short-circuiting on `current_role_code()` so only one ever
matches:

| Role | Can |
|---|---|
| `admin` | Everything, own tenant only. |
| `accountant` | Read only. |
| `teacher` | Read **and write** — but only enrolments in sections where they are `class_teacher_staff_id`. |
| `student` | Read own rows. |
| `parent` | Read rows of children linked through `guardian_student`. |

The teacher rule is the security boundary. `listMarkableSections()` narrows the
class picker to the same set, but that is a courtesy: hiding the option does not
protect anything, and forging a section id still writes nothing.

Every helper call is wrapped as `( select public.current_tenant_id() )` so it
evaluates once per query rather than once per row.

---

## The marking screen

`/attendance` — `src/app/(app)/attendance/attendance-marker.tsx`.

**Not** a DataTable. The DataTable primitive is built for paginated,
server-sorted lists; a register is a whole class on one screen with no paging,
where every row is an input. Reaching for the primitive here would have meant
fighting it.

### Keyboard

The grid is `role="grid"` with a roving `tabIndex` on rows:

| Key | Does |
|---|---|
| `↑` `↓` | Move between students |
| `P` `A` `L` `E` | Mark present/absent/late/excused **and advance** |
| `←` `→` | Cycle status without moving, for anyone who would rather not memorise letters |
| `Enter` | Advance |
| `Home` `End` | First / last student |

A class of forty is forty keystrokes. The status buttons inside a row are
`tabIndex={-1}` so `Tab` steps between students rather than through 160 buttons.

### Autosave

Debounced 1.2s after the last change, then one `mark_attendance` call for the
whole register. The indicator moves through *Unsaved changes* → *Saving…* →
*Saved 09:14*, and is `aria-live="polite"`.

### Where this deliberately deviates from "optimistic UI with rollback"

On a failed save the draft is **not** rolled back. Discarding marks a teacher
just entered because a train went through a tunnel would destroy real work, and
the write is idempotent, so retrying the same register is always safe. Instead:

- the marks stay on screen,
- the indicator says "Not saved. Your marks are still here." with a Retry,
- and an explicit **Revert to saved** button gives the rollback back to the
  teacher, under their control.

The optimism is still there — the UI shows the new status before the server
confirms it. Only the automatic discard is gone, on purpose.

### Mobile

Rows collapse from a three-column grid to a stack below `sm`. Status buttons are
44px minimum on touch and shrink to 36px once there is a pointer; their labels
degrade from full words → single letters → words again at `lg`, so the row never
overflows at any width. Tested at 375 / 768 / 1024 / 1440.

### States

Empty (no classes assigned, no students enrolled), loading (row skeletons, never
a spinner on a blank page), and error (retry, with "nothing has been changed")
are all designed. Status is never colour-only: every option carries an icon and
a text label, and the summary badges name their status.

---

## The report

`/attendance/report` — this *is* a DataTable, because it is a list.

Per-student totals for a class over a date range, with the percentage banded as
**On track** (≥85%), **At risk** (75–85%) and **Below 75%** — 75% being the
usual exam-eligibility line in Indian schools. The band is stated in words, not
just colour.

Two conventions worth knowing:

- **Late counts as attended.** A late student was there.
- **Excused days leave the denominator** rather than counting against the
  student, which is what "excused" means.

Aggregation happens in the request rather than in SQL because the scope is one
class over one term — a few thousand rows. The day this needs a whole school for
a year, it belongs in a read model built by a job (rule 7), not in a bigger
query here.

---

## Coverage — which registers were never taken

This module says, in four places, that a percentage is **over what was marked,
never over the calendar**: a register half taken must read as half taken, not as
a school half empty. That rule is right, and it has a blind spot which was open
from the day the module shipped:

> The rule that stops a percentage lying is the same rule that hides the
> register nobody took. Those need **two numbers, not one changed one.**

94% over eleven marked days in a forty-day term is not a good month; it is
twenty-nine days nobody wrote down, and no percentage can say so however it is
computed. So migration `0152` adds the second number and leaves every existing
percentage exactly as it was:

| | |
|---|---|
| `attendance_calendar(from, to)` | one row per day: open or closed, and why |
| `attendance_coverage(from, to, section)` | working days against days a register exists for |
| `attendance.gaps` | the catalog report — one row per class per unmarked school day |

The demo tenant made the point immediately: every class showed a healthy
attendance percentage for August and **19 of 26 school days marked**, seven days
per class with no register at all.

### One definition of "is the school open"

Migration `0152` shipped `attendance_calendar` describing itself as a second
reader of `hr_working_days`, pinned by a test. It was wrong about the count —
there were **three**:

| | | |
|---|---|---|
| `academics_is_teaching_day(date)` | `0031` | a boolean |
| `hr_working_days(from, to)` | `0057` | a count, for payroll |
| `attendance_calendar(from, to)` | `0152` | a day and a reason |

And two of them disagreed. `academics_is_teaching_day` filtered holidays by
`session_id` and `hr_working_days` did not, so a query about last April counted
last year's Diwali as a working day in one function and a closure in the other.

> **The date is the discriminator, not the session.** A holiday row already says
> which year it belongs to, in its own date range. Filtering by the *current*
> session is redundant inside that session and wrong outside it — which is
> exactly when somebody is looking at history and least able to tell.

Migration `0153` makes `attendance_calendar` the one definition and the other
two wrappers over it. Payroll prorates on `hr_working_days` in six places, so
the switch was verified numerically first and after: **26 = 26** over August
2026 and **313 = 313** over the whole 2025–26 session.

`attendance_calendar` also **refuses a range over 400 days rather than
truncating it** — `0152` silently capped, which is the shape rule 13 threw out
once already for bulk import, with a payslip on the end of it this time.

### The marking screen warns and does not block

A closed day now says so — *"Weekly holiday"*, or the holiday's name — above the
register. It is a warning, never a block: a school that holds an extra class on
a Saturday must still be able to record it, and that day simply is not counted
as a working day when the school looks for registers that were never taken.

---

## …and eleven of those classes were at 0.0%, none of them true

The coverage function shipped correct for the seat it was written from, and
wrong for the seat it was written for.

Both halves of the coverage question compare two sets:

```
sections   public.sections                        tenant-wide
marked     attendance_records + enrolments        row-ownership
```

One wide side, one narrow side. Probed as each caller rather than as `postgres`,
over 1 Aug – 9 Sep 2026:

| | `attendance_coverage` rows | at 0.0% | worst | `attendance.gaps` |
|---|---|---|---|---|
| administrator | 12 | 0 | Grade 1 A at 58.8% | 168 |
| class teacher | 12 | **11** | **Grade 1 A at 0.0%** | **388** |
| guardian | 12 | 11 | — | **388** |

The function's own comment reads *"worst covered first: the list is read to find
the class nobody has been taking a register for."* To the class teacher — the
person who holds `attendance.mark`, opens `/attendance/report`, and can actually
go and take the missing register — it put eleven fabricated zeros at the top of
that list and buried Grade 1 A, which genuinely is the worst at 58.8%,
underneath them. 220 of the report's 388 rows were accusations about colleagues.

This is migration `0189`'s finding a second time, and `0189` had already written
the sentence: *under row-ownership RLS, absence and invisibility are the same
shape; an under-report is a missing sentence, this is an accusation.* What is
new is the general rule it makes explicit:

> **A `not exists` is only honest when both sides are narrowed by the same
> policy.** Narrow the wide side to the rows the caller could have seen the
> evidence for — never to the rows that happen to *have* evidence, which is the
> thing being measured.

Here that is one predicate on the `sections` CTE:

```sql
and exists (
  select 1 from public.enrolments e
  where e.section_id = s.id and e.status = 'active'
)
```

`enrolments` carries the same row-ownership policies `attendance_records` does,
and seeing the children is exactly the precondition for *"was a register taken
for these children"* to be a question this caller can answer. Measured, it lands
where it should — administrator 12 sections, teacher 1, guardian 1 — and it also
drops a section with no active enrolment at all, which is right: an empty class
has no register to take.

Note what the fix is **not**. It is not `where tenant_id =` (rule 11 forbids
that in a read model, and both callers are in the same tenant anyway), and it is
not a `SECURITY DEFINER` rewrite. The policies were correct throughout; one half
of the query was not consulting them.

### The gate is the second half, and alone it fixes nothing

`attendance.gaps` was catalogued on `attendance.view`, which a guardian and a
student hold. Rule 4's answer is `0189`'s: gate on the permission a school gives
to somebody who may **act** — `attendance.mark`.

But a teacher *holds* `attendance.mark`. Moving the permission on its own would
have left them looking at the same 388. That is `substitution_gaps`' lesson from
the other side: **a permission check cannot make a read model stop lying.** Both
halves, and the read model first.

After migration `0201`, probed as four callers:

| | coverage rows | at 0.0% | worst | `attendance.gaps` |
|---|---|---|---|---|
| administrator | 12 | 0 | Grade 1 A at 58.8% | 168 |
| class teacher | **1** | 0 | Grade 5 B at 58.8% | **14** |
| guardian | **1** | 0 | Grade 6 A at 58.8% | refused |
| accountant | 12 | 0 | Grade 1 A at 58.8% | refused |

The administrator's figures are unchanged to the row, which is the check that
matters: the fix removed fabrications and nothing else. 168 ÷ 12 sections = 14,
and the teacher's own class is missing exactly those 14 days.

`tests/attendance/coverage-scope.test.ts` pins the property rather than the
numbers — the card's `sum(days_missing)` must equal the report's `total_count`,
and every reported section must be one whose enrolments the caller can read.
Narrow one side and not the other and the first fails; widen the section list
back and the second does. The suite signs in as an administrator, which is the
seat the bug was invisible from, so the four-role table above is a probe and is
recorded as one.

### What this left alone, on purpose

**An accountant sees the coverage card's twelve rows and holds no attendance
permission at all.** Their numbers are true — `enrolments` is tenant-wide for
them, so nothing is fabricated — and the card is now gated on
`attendance.mark`, so they no longer see it. What is *not* fixed is the larger
question their presence raises: `/attendance/report` is in an accountant's menu
and its per-student read model is not gated on any attendance permission. That
is rule 4's *"the matrix does real work wherever RLS is deliberately
tenant-wide"* pointing at a whole module rather than at one card, and it wants a
decision about whether a bursar needs attendance figures — not a `where` clause
added while passing.

---

## Known, deliberate gaps

- **`attendance_records_session_id_fkey` has no covering index.** Supabase's
  linter flags it at INFO. The composite `(tenant_id, session_id,
  attendance_date)` index serves every query the app makes; a session-leading
  index would only help a cascade delete of an academic session, which does not
  happen. `book_issues` carries the same gap for the same reason.
- **`multiple_permissive_policies` warnings.** Inherent to one-policy-per-role,
  which is the shape used across this codebase. Each policy short-circuits on
  `current_role_code()`, so at most one ever evaluates its subquery.
- **Period-wise marking is not exposed.** The column exists and defaults to 0;
  the UI needs the timetable tables before it can offer a period picker.
- ~~**Holidays are not modelled.**~~ Closed by migrations `0152`–`0153` — and
  the note was stale long before that. `holidays` and `weekends` arrived in
  migration `0031`, one migration after this module, and are editable on
  `/academics`; what was missing was student attendance *reading* them. See
  **Coverage** above.
