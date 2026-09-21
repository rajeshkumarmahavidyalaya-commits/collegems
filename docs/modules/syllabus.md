# Syllabus

What is in a course, and how much of it each class has covered. Migrations
`0255`–`0257`.

Phase 3b's last self-contained gap — no hardware, no third party, no LMS.
Measured before building: **zero occurrences** of a syllabus anywhere.
*Curriculum* in this codebase means `section_subjects` (which subjects a class
studies) and `study_material` is files and links. Neither says what is **in** a
subject, and nothing recorded what had been taught.

So the question a college asks every term had no answer:

> *The year is two-thirds gone. Is Grade 6 Science going to finish?*

## The shape, which is the whole decision

```
syllabus_units      (session, class level, subject)   48 courses here
syllabus_progress   (section, unit)                   12 sections
```

Grade 6 Science has **one** syllabus however many sections study it — the
college teaches one course — and each section covers it at its own pace. It is
`fee_structures` keyed on the class level beside `enrolments` keyed on the
section, which is the same distinction about money.

Writing the syllabus per *section* instead would be twelve copies of one
document, free to disagree, and a head of department editing one of them.
Nothing would fail, which is why `tests/academics/syllabus.test.ts` asserts it.

Demonstrated: one syllabus of 5 units / 20 lessons gave **Grade 1 · A 2/5** and
**Grade 1 · B 0/5** from the same rows.

## Rule 4's device twice in one key

A progress row names a section and a unit, and they must agree about the class.
That is a fact on two different parent tables, so no CHECK can reach it:

```sql
foreign key (tenant_id, unit_id, class_level_id, subject_id)
  references syllabus_units (tenant_id, id, class_level_id, subject_id)
  on update cascade
foreign key (tenant_id, section_id, class_level_id)
  references sections (tenant_id, id, class_level_id)      -- no cascade
```

`subject_id` rides in the same key — rule 4's *one key can carry two of those at
once*, as `marks.component_max_marks` does. It is not decoration: **the write
policy compares it.** A class teacher of Grade 1 A who teaches English must not
be able to declare a Science unit covered, and without the subject on the row a
policy would have to reach into `syllabus_units` to find out which subject it
was looking at.

The unit side cascades, because moving a unit between class levels is a
correction to a plan. The section side does not: a section's class level
changing while somebody has recorded teaching against it is a mistake to
**refuse**, not a rewrite to perform.

## Absence is "not covered", so there is no row for it

`syllabus_progress` holds a row only for a unit somebody has started or
finished. Pre-creating one per unit per section would be hundreds of rows
saying *nothing has happened*, and the first thing every reader would do is
filter them out. `syllabus_for_section` supplies the third state with
`coalesce(p.status, 'pending')`.

## A rate needs two numbers, and this one needs three

| fact | why it cannot be folded into another |
|---|---|
| `share_covered` | **null**, not 0, where no syllabus exists |
| `share_elapsed` | the year, not the course — the same for every row |
| `year_state` | `before` / `during` / `ended` |

*"Grade 4 Hindi: 0%"* is an accusation against a teacher who is teaching
perfectly well; the college simply has not written the course down, and a
college that reads 0% goes and asks the wrong person.

And `year_state` is not a hypothetical. **This college's current session ran
1 Apr 2025 to 31 Mar 2026 and it is now September 2026** — a naive elapsed
fraction reads **173%**, and *"Grade 6 Science is 140% behind"* is a sentence
nobody can act on. The pace function does not second-guess the stale
`is_current` flag that `academics_filing_problems()` already reports; it says
the year has ended.

`paceVerdict` in `src/lib/validations/syllabus-display.ts` turns the three into
one word, and `ended-short` is deliberately **not** `behind`: there is nothing
left to catch up on, and telling somebody to hurry in September about a year
that closed in March is the critic this codebase already refuses to ship.

Measured in **teaching days** through `hr_working_days` — the counting wrapper
`0153` made of `academics_is_teaching_day` — computed **once per call**, not
once per course.

## Who may write what

| act | gate |
|---|---|
| write the syllabus | `academics.manage` — course setup, like creating a class |
| record what was taught | `syllabus.track` **and** teaching that class, that subject |
| read the syllabus | `academics.view`, plus a family's own child's course |
| read progress | `academics.view` only |

`syllabus.track` is the one new code, granted by reading the matrix (whoever
holds `homework.manage`) rather than by naming a role. It exists because
`academics.manage` also creates classes, assigns subjects and rolls sections
forward, and handing a teacher all of that to let them tick off a unit is
`0213`'s finding repeated.

**A family reads the units and not the progress**, deliberately: what a child
will be taught is theirs; how far behind a class has fallen is a conversation
between a college and its staff. Probed as a child of Grade 1 A: **6 units
visible, 0 progress rows.**

The tenant-wide read is gated on `academics.view`, and that is safe here for
the reason `0253` was not — the matrix says it is held by the administrator and
the teacher and by **neither a parent nor a student**. Checked against the
matrix rather than against the policy's own name.

## The defect this work introduced, and the probe that found it

`0256`'s `syllabus_mark` guarded its INSERT with the row-count assertion copied
from `0254`, where the statements were UPDATEs. Probed as the Science teacher
of Grade 1 A marking an **English** unit:

```
refused — new row violates row-level security policy
          for table "syllabus_progress"
```

The policy refused correctly. The sentence never ran.

> **An `UPDATE` that no policy matches writes nothing and raises nothing. An
> `INSERT` whose `WITH CHECK` fails *raises*.** They are opposite failure modes,
> and `get diagnostics` is the tool for the first one only.

Copying the lesson without asking which statement kind it was about produced a
branch that can never execute, sitting exactly where a reader would believe the
refusal was handled. `0257` checks before writing and names both:

> *You are not down to teach English to Grade 1 · A. Only the class teacher,
> somebody the routine puts in front of that class for that subject, or the
> academics office can record this.*

## The critic

`syllabus_problems()` is a parameterless critic, so unlike
`exam_seating_problems` it belongs in the catalogue. It is **silent until the
college has written at least one syllabus** — a new college greeted with 48
findings about a module it has not opened learns to ignore the check page.

Its threshold is a settings row, not a constant: a board-exam year runs tight
and a first-year course does not.

## Deliberately not built

- **Rolling a syllabus forward into next year.** `academics_roll_forward_sections`
  is the shape it would take (rule 13's editable preview), and a course whose
  units are simply copied is not the same decision as a course somebody rewrote.
  Named rather than half-done.
- **A family-facing progress view.** See above — that is a decision, not an
  omission.

## Files

- `supabase/migrations/0255_a_course_has_units_and_a_class_has_covered_some.sql`
- `supabase/migrations/0256_a_rate_needs_two_numbers_and_a_year_that_ended_needs_three.sql`
- `supabase/migrations/0257_an_insert_does_not_fail_silently_so_counting_rows_guards_nothing.sql`
- `src/app/(app)/academics/syllabus-actions.ts`
- `src/app/(app)/academics/syllabus/` — the pace list and one course
- `src/lib/validations/syllabus-display.ts` — no imports, and must keep none
- `tests/academics/syllabus.test.ts` — 21 assertions, no database, 18 planted violations
- `tests/academics/syllabus-pace.test.ts` — the verdict pinned with numbers
