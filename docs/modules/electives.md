# Elective subjects

Migrations `0282` (tables, the student's save, the two read models) and `0283`
(`subject_group_create`).

## The shape

- `subject_groups` — a choice for one class in one year: *"Language electives,
  choose 1"*. `min_choices`/`max_choices`, `is_open`, optional `closes_on`.
  Created **closed**; the office opens it when choices are due.
- `subject_group_options` — the subjects **allotted** to that group.
- `student_subject_choices` — what a student picked, one row per subject.

A student sees **only the groups for their own class** and can pick **only the
subjects allotted to that group**:

- `subject_choices_for_student()` finds the class from the student's current
  enrolment, never from the browser, and returns the compulsory subjects
  (those on the section not offered in any group) beside each group.
- `subject_choice_save()` is `SECURITY DEFINER` and checks the window, the
  class, the count and the allotment, then asserts what it wrote.
- The choices table has **no student or parent write policy**. The absence is
  the mechanism (the `homework_submit` shape): a student insert policy would
  route around every one of those checks.
- Composite foreign keys make the rest structural: a choice must be one of its
  group's options, in the group's own year, for a student enrolled in that year.

## Screens

- `/academics/electives` (super admin, `academics.manage`) — create a group,
  open/close it, set a closing date, see how many of the class have chosen and
  how the choices split. `subject_group_overview()` is an invoker whose counts
  are true only for somebody who can read every enrolment, which is one reason
  the page is gated.
- `/my-subjects` (student) — compulsory subjects, and a checkbox group per
  choice. At the limit the remaining boxes are disabled, so the rule is visible
  before anybody breaks it.

## Exams read the same choice (0285)

A paper in an elective belongs only to the children who chose it. Before
`0285`, every exam function read the class roll, so a French paper listed all
forty children and the thirty who chose Sanskrit got an unmarked French paper:
their result read *incomplete* for ever.

`student_takes_subject(student, subject, session, class level)` is the one
definition -- yes for a subject not offered in any elective group for that
class and year, and yes for an elective only if the child chose it -- and all
three exam functions ask it:

- `exams_mark_sheet` lists only the children who take the paper's subject;
- `exams_subject_breakdown` (read by the result sheet, publishing and the
  report card) builds each child's papers from it;
- `exams_enter_marks` refuses a mark for a child who did not choose the subject,
  by name, instead of writing a row every result would then ignore.

It is `SECURITY DEFINER`, tenant-filtered by hand, and returns a boolean:
`student_subject_choices` has no accountant policy, so as an invoker it would
tell an accountant that nobody chose French and drop the paper from every
result on their screen. Measured on the demo college: results identical to the
row before and after (2,416 and 200 rows; no elective groups exist yet), and
the Half-Yearly breakdown 791 -> 767 ms, i.e. unchanged. Probed with a group
in a rolled-back transaction: 25 in the class, 3 chose the paper, mark sheet 3,
results 3, and a mark for a non-chooser refused naming the child.

## Who sees and changes a choice

- **The student**, on My subjects, while the choice is open.
- **A parent**, on the same screen, read-only, for each of their children.
  Probed with a real guardian link: their child's subjects shown, another
  family's child answered as *not enrolled*, and a save refused.
- **The office**, on the student's record, open or closed -- a late admission, a
  child with no login, a change after the window. Drawn for `academics.manage`;
  `subject_choice_save` (administrator only on behalf of a child) is the gate.

The subject screens live in `src/components/electives/` and take their save as a
prop, so the student's and the office's actions keep their own checks. The
student record grew 171 -> 174 kB for the tick boxes.

## A child who has not chosen is counted (0286)

A child who has not chosen has no paper in the elective (0285). The exam's
problem list now says so, per class and group:

> *24 students in Grade 4 A have not chosen from "Second language" yet, so they
> have no paper in Art & Craft or Hindi in this exam. Choose for them on each
> student's page, or open the choice under Academics > Electives.*

The count comes from `exams_unchosen_electives`, a definer read model. The
invoker version would be a `not exists` over enrolments and choices, which carry
different policies for different roles, so an accountant granted
`exams.manage` would have been told nobody had chosen. The read model:

- filters the tenant by hand;
- is gated on `exams.manage` or `academics.manage`;
- returns counts, never names.

A teacher is shown no sentence, rather than a guess. The sentence counts
children below the group's `min_choices`, so an optional group (minimum 0)
never appears.

## The timetable splits by elective (0286)

A period can hold one lesson per option of an elective group, and a family sees
only their child's. See `docs/modules/timetable.md`.

## Not built yet

- `promotion_undo` knows about the table (`0282`); rolling choices forward is
  deliberately not done -- a choice belongs to the year it was made in.
