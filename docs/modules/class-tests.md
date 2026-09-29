# Class tests

Migrations `0304`, `0305`. Weekly tests, quizzes and unit tests: a title, a date,
a maximum, and a mark per child. There is no grading scheme, no publishing and no
report card. The family sees a mark as soon as it is entered.

| | |
|---|---|
| `class_tests` | one test for one subject in one class |
| `class_test_marks` | one mark (or absent) per child |
| `class_test_create()` | the one way a test is made |
| `class_test_sheet()` | the class list beside the marks |
| `/class-tests` | staff: the tests and *Set a test*; family: their child's marks |
| `/class-tests/[id]` | the mark sheet (type a number or AB, Enter moves down) |

## Rules it enforces

- **A test exists only for a subject taught in that class that year.**
  `class_tests` carries (tenant, session, section, subject) as a composite key
  onto `section_subjects`.
- **A mark cannot exceed its test's maximum.** `class_test_marks` carries
  `max_marks` in its key, so lowering the maximum below a mark already given is
  refused.
- **A test's date must fall in its class's year** (rule 2).
  `class_test_create` refuses in a sentence: *"10 Sep 2026 falls outside
  2025-2026, the year this class belongs to."*
- **The subject teacher of that class** (`exams.grade`) or the exams office sets
  and marks tests. A mark must be for a child enrolled in that class. That check
  is `class_test_enrolled()`, a definer that returns a boolean, because the
  subject teacher cannot read that class's enrolments.

Probed as the demo college's teacher:
- they set a test in a class where they are not class teacher, and saw 25 children;
- a date in the wrong year, a subject they don't teach, a mark of 25 out of 20,
  and a child from another class were each refused;
- a parent saw 1 mark (their own child's) and was refused the class's sheet.

## The defect this found: a subject teacher's marks sheet was empty

Before building this I checked how a subject teacher gets a class list. The
exam marks sheet (`exams_mark_sheet`) read `enrolments` through the teacher's
own policy, and that policy covers only classes they are class teacher of. For
every paper the demo teacher teaches elsewhere, a roll of 25 to 27 children
showed an **empty sheet**. The write side was always correct; the names were
simply invisible.

Widening the enrolments policy would have brought back 0201's fabricated 0%
attendance coverage, because attendance records stay class-teacher-only. So
`teaching_roster(section, subject)` is a narrow definer instead:
- it answers only to somebody who teaches that subject there, is the class
  teacher, or holds `exams.manage`;
- it filters by tenant itself;
- it returns four columns;
- it refuses anybody else in a sentence.

`exams_mark_sheet` and `class_test_sheet` both use it. After the change the
teacher's sheets show 25 children, the same count the administrator sees.

## Not done

- Class tests are not on the report card, deliberately.
- There is no class-test report in `/reports` yet.

## A mark carries its year (0306)

0304 put `session_id` on the test and not on the mark. Rule 2 says marks carry
it directly, and the promotion-undo guard is why that matters here. Undoing a
run must refuse while anything in the new year hangs off the children it moved,
and without a `session_id` a class-test mark could not be asked about. The mark
now carries its test's year through the same composite key that carries its
maximum. `promotion_undo` lists it beside `behaviour_ratings`. Probed: a mark
sent with a different year is refused by the key.
