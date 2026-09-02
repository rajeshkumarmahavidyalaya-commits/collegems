# Academic structure (Phase 1.1)

What is taught, by whom, where, when, and on which days the school is actually
open. Nothing here is interesting on its own — it exists because the timetable,
the exam planner, marks entry and homework all need something to point at.

`class_levels` and `sections` already existed from the foundation migration.
Migration `0031` adds the rest.

---

## Scoping is deliberately not uniform

| Tenant-scoped | Session-scoped as well |
|---|---|
| `subjects`, `class_rooms`, `time_slots`, `weekends` | `section_subjects`, `holidays` |

A subject, a room and a bell schedule outlive an academic year. Who teaches
Grade 6B mathematics does not, and neither does a holiday calendar. Rule 2 asks
for `session_id` on transactional tables, and those two are the transactional
ones here.

## The tables

**`subjects`** — name, `code` (unique per tenant), `kind` (theory/practical),
`is_active`. Deactivated rather than deleted once assigned: `section_subjects`
holds an `on delete restrict`, because marks and homework will hang off it and
a subject that ever had marks must stay resolvable. The UI says so instead of
surfacing a foreign-key error.

**`class_rooms`** — name, capacity. Capacity is what the exam seat-plan
generator will divide by.

**`time_slots`** — **two** bell schedules, separated by `kind`. Exam periods run
longer than lesson periods in every school that runs both, so the routine grid
and the exam scheduler each read their own. Unique on
`(tenant, kind, period_number)`, so an exam "period 1" and a lesson "period 1"
coexist. `ends_at > starts_at` is a check constraint, not a form rule.

Migration `0040` adds a generated `schedulable` column
(`kind = 'class' and not is_break`). It exists to be the target of the class
routine's composite foreign key, so "you cannot timetable a lunch break" is a
database fact rather than a trigger — see
[docs/modules/timetable.md](./timetable.md).

**`weekends`** — one row per weekday, `is_teaching`. **ISO numbering
(1 = Monday … 7 = Sunday)**, matching `extract(isodow …)`, so the app, the RPCs
and the attendance seed all agree without a translation table in someone's
head. A weekday with no row counts as teaching: a school that has not filled
this in should not find its whole calendar closed.

**`holidays`** — a closure is **one row with a date range**, not one row per
day. "Diwali break, 20th to 24th" is one thing a school decides, and storing
five rows makes editing it five edits and an inconsistency waiting to happen.
Both ends inclusive.

**`section_subjects`** — the join the prompt pack calls *Assign Subject*, and
the thing every later module reads. `teacher_staff_id` is **nullable**: a
subject can be on the curriculum before a teacher is chosen, and a school
should not have to invent one to save the row. Unique on
`(tenant, session, section, subject)`, so assigning a subject a class already
has is an *edit of who teaches it*, not a duplicate — the action upserts.

All the child tables use **composite `(tenant_id, …)` foreign keys**, per
migration `0024`: foreign key checks are not subject to RLS, so a single-column
reference would happily accept another tenant's subject or teacher.

## One answer to "is the school open?"

```sql
academics_is_teaching_day(p_date date) returns boolean
```

Weekday config **and** the holiday list, in one place. Attendance, the routine
grid and any future calendar all need this, and three implementations of
"is this a working day" is three chances to disagree about a holiday.

## The screen

`/academics` — **one area with tabs, not six sidebar links.** These are small
setup screens an administrator visits together at the start of a year and then
rarely; scattering them across the navigation costs every other user permanent
sidebar space for something they will never open. (The prompt pack calls this
out as something eSkooly gets wrong.)

Tabs: Subjects · Who teaches what · Periods · Rooms · The week · Holidays.

Assignments are grouped by class rather than listed flat, because "what does
Grade 6B study" is the question people actually arrive with, and each card
names how many of its subjects still have no teacher.

## What this unblocks

| Module | Needs |
|---|---|
| 1.2 Class routine | `time_slots` (class), `class_rooms`, `weekends`, `section_subjects` |
| 3.1 Examinations | `subjects`, `time_slots` (exam), `class_rooms` |
| 3.2 Online exams | `subjects` |
| 4.3 Homework | `section_subjects` |

## Known, deliberate gaps

- **The Base Setup lookups are not built** — `genders`, `blood_groups`,
  `religions`. `people.gender` and `people.blood_group` are free text today
  with the allowed values fixed in Zod, so converting them to admin-editable
  lookup tables is a data migration of every existing person plus changes to
  the student forms. That is its own change, not a rider on this one.
- **Front-office lookups** (`sources`, `purposes`, `complaint_types`,
  `references`) belong with Front Office (5.5); nothing reads them yet, and
  creating four empty tables now would just be four tables to migrate later.
- **`academic_years` as a separate table** — `academic_sessions` already
  carries name, start, end and `is_current` with a partial unique index. A
  year-above-session layer buys nothing until a school runs two sessions in one
  year, and none of the modules ahead need it.
