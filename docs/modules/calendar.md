# School calendar (0297)

`/calendar` is a month of the dates the school already keeps: holidays, exam
fortnights, fee instalment due dates and notices. WPSchool has an *Events*
screen. This one adds no table, because every one of those dates already has an
owner, and a second copy of a date is a date free to disagree with the first.

- **`school_calendar(from, to)`** is an invoker over `holidays`, `exams`,
  `fee_instalments` and `notices`. Each source is read through its own
  policies, so a family sees the notices addressed to them, and the page has
  no role check. A request is capped at 400 days.
- **A notice with no start date starts the day it was published** (`0298`).
  Both of the demo college's notices had none, so the first cut left the notice
  board off the calendar entirely.
- **Every entry links to its module.** A holiday is added under Academics, an
  exam under Exams. The calendar is a view, never a second place to edit.

`src/lib/validations/calendar.ts` holds the month arithmetic. It has type imports
only, which are erased, and compares ISO strings, so no timezone moves a holiday by a day.
`tests/parity/wpschool-parity.test.ts` pins it.
