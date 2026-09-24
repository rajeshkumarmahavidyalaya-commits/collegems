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

## Not built yet

- A parent reads their child's choices through RLS but has no screen for it.
- The office choosing on a student's behalf is supported by the function
  (`p_student_id`) and has no screen.
- Marks entry and the timetable do not yet filter by elective.
- `promotion_undo` knows about the table (`0282`); rolling choices forward is
  deliberately not done — a choice belongs to the year it was made in.
