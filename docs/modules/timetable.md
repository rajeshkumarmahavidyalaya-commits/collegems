# Class routine (Phase 1.2)

One row per (class, weekday, period). Everything interesting about this module
is a constraint rather than a column, because a timetable is defined by what it
refuses:

1. A class has one lesson per period.
2. A teacher cannot be in two rooms at once.
3. A room cannot hold two classes at once.

Migrations `0040`–`0042`.

---

## The rules are indexes, not code

All three are unique indexes on `timetable_entries`. That is the whole design.

A clash detected in TypeScript is a clash two concurrent requests can still
create; a clash detected by a unique index cannot happen. The readable error
message is built **on top of** the index, never instead of it —
`timetable_set_entry` looks for the conflict first so it can say *"That teacher
is already taking Grade 7A · Mathematics (period 3)"*, and if two saves race,
the index still refuses the second one and the caller still gets an error.

```sql
create unique index timetable_entries_teacher_clash
  on public.timetable_entries (tenant_id, session_id, teacher_staff_id, weekday, time_slot_id)
  where teacher_staff_id is not null;
```

Partial, because a period with no teacher assigned yet is not a clash with
every other unassigned period. Same for rooms.

### Why not an exclusion constraint

`docs/domain/erd.md` originally sketched this as exclusion constraints. That
would be right if periods were time *ranges* that could partially overlap. They
are not: a period is a `time_slots` row, and two lessons either occupy the same
slot or they do not. An equality-only exclusion constraint is a unique index
with a GiST index and no `on conflict` support. If a school ever schedules by
wall-clock ranges instead of named periods, that is when it earns its keep.

---

## Two constraints doing unusual work

### `slot_schedulable` — a constant column that enforces a cross-table rule

A lesson may not be scheduled in an exam period or in the lunch break. Both are
properties of `time_slots`, and **a CHECK constraint cannot look at another
table**.

Rather than a trigger, the fact is materialised on `time_slots` as a generated
column and joined into the foreign key:

```sql
alter table public.time_slots
  add column schedulable boolean
  generated always as (kind = 'class' and not is_break) stored;

alter table public.time_slots
  add constraint time_slots_schedulable_key unique (tenant_id, id, schedulable);
```

`timetable_entries` then carries `slot_schedulable boolean not null default true
check (slot_schedulable)` — a column whose only value is `true` — and points a
composite foreign key at `(tenant_id, id, schedulable)`. A break slot has
`schedulable = false`, so the key simply does not exist and the row is refused.
One constraint enforces "same tenant" **and** "a real lesson period" together,
declaratively.

Migration `0042` adds an explicit check ahead of it purely so the message reads
*"Period 5 is a break, so no lesson can be scheduled in it"* instead of
`violates foreign key constraint "timetable_entries_slot_fkey"`. The foreign key
is still the enforcement.

### The curriculum FK subsumes three others

```sql
constraint timetable_entries_assignment_fkey
  foreign key (tenant_id, session_id, section_id, subject_id)
  references public.section_subjects (tenant_id, session_id, section_id, subject_id)
  on delete cascade
```

One constraint carries tenant, session, section and subject together, and means
*"this subject is actually on this class's curriculum this year"*. Separate FKs
to `sections` and `subjects` would be redundant underneath it.

`on delete cascade` is the only coherent answer: unassigning a subject from a
class removes its periods, because a routine entry for a subject the class no
longer studies is not something anyone would want kept.

### `teacher_staff_id` is denormalised on purpose

It is reachable through `section_subjects`, and it is stored here anyway — for
two reasons. The clash index needs it on this row, and **a period covered by a
substitute is still that section's mathematics lesson**. Letting the routine's
teacher differ from the curriculum's default teacher is a feature, not drift.

---

## Functions

| Function | What it is for |
|---|---|
| `timetable_set_entry(...)` | The one write path. Upserts a cell, with named clash messages. |
| `timetable_copy_day(section, from, to)` | Fills empty periods on the target day. |
| `timetable_for_section(section)` | The grid, names resolved. |
| `timetable_for_teacher(staff?)` | One person's week; defaults to the caller. |
| `timetable_busy_in_slot(weekday, slot, section?)` | Who is committed elsewhere in this period. |
| `timetable_teacher_load()` | Periods per week per teacher. |
| `timetable_describe_entry(id)` | "Grade 1 A · Science (period 1)", for error messages. |

All `SECURITY INVOKER`. Nothing here needs to act as anyone but the caller.

**`timetable_set_entry` is an upsert** because the grid's mental model is that a
cell holds one lesson. Clicking a filled cell and picking a different subject
means *replace this*; making somebody delete first would be ceremony.

**`timetable_copy_day` fills empty periods only.** Most schools run four or five
near-identical days, so building each by hand is the single most tedious part of
setting up a routine — but a copy that overwrote the target day would be a
destructive action disguised as a convenience, with no undo. Periods already
filled, and periods where the teacher or room is busy elsewhere, are skipped and
counted; the UI reports both numbers.

It is written as a filtered `insert … select` with the clash rules restated as
`not exists` guards, because a single statement cannot see the rows it is
inserting — the index would raise halfway through and abandon the rest.

**`timetable_for_teacher` defaults `p_staff_id` to the caller's own staff
record**, resolved from `user_profiles`. A teacher opening "My week" passes
nothing and cannot point the page at a colleague by editing a URL. Passing an id
explicitly is how an administrator reviews someone's load; RLS allows it because
a routine is public within the school.

**`timetable_busy_in_slot` is asked before the save, not after.** A dropdown
that offers a teacher who is demonstrably teaching elsewhere, and only then
refuses, wastes the one thing a two-hour timetable-building session is short of.

---

## RLS

**Everyone in the tenant reads it.** A routine is the least secret thing a
school owns, and a student who cannot see their own timetable is a bug.

**Writing is `academics.manage`, admin-only at the policy level.** A teacher who
could edit the routine could move themselves out of a period, which is a
staffing decision rather than a teaching one — so it sits with
`section_subjects` rather than with attendance.

---

## Screens

| Route | Who | What |
|---|---|---|
| `/timetable` | everyone reads; admins edit | The weekly grid for one class. |
| `/timetable/me` | anyone with a staff record | Their own teaching week. |
| `/timetable/teachers` | `academics.manage` | Teaching load, and a drill-down per teacher. |

**The grid is one day at a time on a phone and a full week from `md` up.** A
six-column week at 375px is a scroll bar pretending to be a table, and a routine
is read one day at a time anyway. On wider screens the table scrolls inside its
own container with the period column pinned — never the page.

**Breaks are rendered, not scheduled.** The lunch row spans the whole grid as a
muted band, so the shape of the day is visible without offering a cell that the
foreign key would refuse.

**`/timetable/me` is a pure Server Component** — 805 B of JavaScript, because a
read-only view of your own week needs none. The interactive grid is a different
screen with a different job; sharing a component between them would have shipped
the editing code to every student who looks at their routine.

**The teaching load view is the routine turned ninety degrees.** The class grid
cannot show that one teacher has twenty-two periods and another has six. It
warns when the spread exceeds six periods, and when a teacher on the staff list
has no periods at all — an unbalanced load being the usual reason a routine gets
rebuilt.

---

## The demo seed

Migration `0042` builds a week for every section, **row by row in a loop**, not
as one set-based insert — for the same reason `copy_day` uses guards: a single
statement cannot see what it is inserting, so it would either raise halfway or
need the clash rules restated as a window function, which is the same logic
written twice and free to disagree with the index.

The loop lets a busy teacher simply skip the cell. It fills 276 of 420 possible
periods (66%). **The 144 gaps are not a defect of the seed** — they are teacher
clashes, which is exactly what free periods are in a real routine, and a demo
where every cell was full would misrepresent what building one feels like.

Each section keeps one home room, so rooms never clash in the seed. That is also
how most schools in this product's market run: the class stays put and the
teachers move.

---

## What is not built

- **No automatic timetable generation.** Constraint solving over teacher
  availability, subject period-quotas and room types is a genuinely hard problem
  and a bad first version of it is worse than none. The constraints that a
  generator would need to satisfy are already in the schema, which is the part
  worth having first.
- **No period-wise attendance yet.** `attendance_records.period` has existed
  since `0019`, defaulting to `0` (whole day). Now that periods exist per class
  per day, wiring the register to them is a follow-on change in the attendance
  module.
- **No substitute-teacher log.** A period's teacher can be changed, but the
  change is not recorded as "X covered for Y on this date" — that needs a date,
  not a weekday, and belongs with staff attendance.
- **No room-utilisation view.** The data supports it (`timetable_busy_in_slot`
  already answers the per-period question); nothing renders it.
- **No printable routine.** The grid prints acceptably through the global print
  stylesheet, but there is no per-class handout layout.
