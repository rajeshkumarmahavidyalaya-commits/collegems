# Behaviour and skills

Migration `0303`. A grade from A to E for each child on things that are not a
paper: discipline, punctuality, teamwork, art, sport. It is printed on the report
card beside the marks. CBSE calls this co-scholastic assessment.

| | |
|---|---|
| `behaviour_traits` | the college's list of what it grades, as data |
| `behaviour_ratings` | one grade per child, per trait, per exam |
| `/exams/[examId]/behaviour` | the grid, one class at a time, plus the trait list |

## How it behaves

- **The class teacher grades their own class** (`exams.remark`). The exams office
  (`exams.manage`) can grade any class. Policies decide which children each may
  grade; the page only draws the grid.
- **Publishing the exam freezes the grades.** `behaviour_ratings` carries
  `exam_status` in its composite key, like `exam_remarks`, and every write policy
  requires `'draft'`. Probed: after publishing, the teacher's edit touched 0 rows.
- **A family sees grades only once the exam is published**, and only their own
  child's. Probed: a parent saw 0 while the exam was a draft and 1 after it was
  published.
- **Never gated on `exams.view`.** Every family holds it, and 0249 showed what a
  tenant-wide policy on it does. Staff read on `exams.remark`, `exams.grade` or
  `exams.manage`.

## The trait list

Ten defaults ship (five behaviour, five skill) in
`reference.behaviour_trait_defaults`. An AFTER INSERT trigger on `tenants` copies
them into every new college, for the reason 0300 found with certificate
templates. The exams office adds traits and retires them from the grid. A retired
trait keeps its past grades, so last term's card still prints it.

## On the report card

The card function (`exams_report_cards`) is unchanged. The two card loaders
attach each child's grades from `behaviour_ratings` through its own policies, so
the screen, the class PDF and the single-child PDF all show them.

## Not done

- The scale is fixed at A to E. A school that grades A to C uses the first three.
  A scale with different words would need its own catalogue row.
- The labels are English only.
