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
- **Holidays are not modelled.** The report says "20 days marked in this range"
  rather than "20 of 22 school days", because a school calendar table does not
  exist yet.
