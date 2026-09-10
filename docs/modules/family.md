# The family's side

A parent and a student are two of this product's six roles, and until now the
only screens built for them were the report cards and the homework list. This
note is about what the other twelve menu entries were doing, measured.

## What a guardian actually held, and what the menu offered

Both halves are data, so both were read rather than guessed. The permission
matrix, live, for the demo school:

```
parent   attendance.view  exams.view  fees.view  homework.view  hostel.view
         leave.apply  leave.view  library.view  notices.view  transport.view
student  (identical)
```

Ten permissions. The sidebar offered fourteen entries. Signed in as the mother
of a child in Grade 2 A — a real guardian row, a borrowed profile, inside a
rolled-back transaction — three of the fourteen went nowhere she could use:

| entry | what it rendered for her |
|---|---|
| **Payroll** | *"My pay — what you were paid, month by month"*, empty. `payroll.view` is not hers, so `/payroll` falls to its own-payslips branch. She is not employed by the school. |
| **Leave** (`/hr/leave`) | *"Your leave, and what is left of each kind. Only unpaid leave reaches a payslip"*, empty, with no way to apply. Staff leave. Her child's leave is a different screen, `/attendance/leave`, which she also had. |
| **Needs attention** | 8 of 9 checks withheld and one runnable — `fees.billing`, about the school's own fee-head configuration, linking to `/fees/setup`, which her menu did not have and which she cannot open. |

Each arrived the same way: a nav entry written with **no `roles` list**, under a
comment explaining why every member of *staff* needs it. The comment on
`/hr/leave` read *"everybody employed here has leave"* — which is true, and is
exactly the list that was missing underneath it.

## …and what it withheld

The same guardian, same session:

```
fees_student_balances()      1 row   Vihaan Singh owes 26,908.00
invoices readable            2       IN-2025-00003, IN-2025-00301
ledger entries readable      1
reports her matrix can run   8 of 19   (6 after 0201-0202)
```

`dashboard_summary()` puts that 26,908.00 on her home page — migration `0129`'s
own comment says *"a parent holds `fees.view`"* and gates the block on it. The
fee module has **nine screens**. Every one of them was `roles: ["admin",
"accountant"]`. `/fees/students/[id]` renders the whole account and gates its
*Collect payment* controls on `fees.collect`, which she does not hold, so it was
already read-only for her and had been since the module shipped.

> A number with no link is a bill a family cannot check. Rule 6's sentence, one
> module over: **a correct read path nobody can call is not a fix.**

So `/fees/family` is a chooser and nothing else — no new query, no new
permission, no new policy. It lists the family's children with the balance from
`fees_student_balances()`, the fee module's own read path, and links each to the
account page the office already uses.

Two details worth copying:

- **Driven by the children, not by the balances.** A child enrolled this year
  with nothing billed yet has no row in `fees_student_balances`. Dropping them
  would tell a family the school has forgotten them, so they get a zero and the
  sentence *"Nothing billed this year yet"* — the dashboard's own three-states
  rule (`holiday | not-taken | taken`) applied to money, because "settled" and
  "never billed" are both zero and mean opposite things to somebody deciding
  whether to worry.
- **The relationship is intersected with the policy, and the intersection is
  load-bearing.** A teacher whose own son is in Grade 4 may read every balance
  in the school through RLS. `listMyFamilyAccounts()` drives off
  `listMyChildren()`, so they see one child, not 302 — the rule-14 trap, one
  module along.

## "My children" had three implementations

Rule 14 states it once and names the trap: *"'My children' is a relationship,
not a visibility. RLS lets a teacher read every child they teach; a home screen
is not a roster."* `mobile_my_students()` spelled it out and a test pinned it.

The web app never called it. It grew two more answers:

| where | student | parent | section |
|---|---|---|---|
| `mobile_my_students()` | self | linked children | from the active enrolment |
| `listMyChildren()`, exams | self | linked children | always `null` |
| `listChildren()`, homework | **`[]`** | linked children | from the active enrolment |

The third is not the relationship at all — it opens `if (!ctx?.guardianId)
return []`, so a student is not one of their own children. The page worked only
because it branched on `roleCode === "parent"` before asking, which is to say
the bug was real and a second branch was hiding it.

Migration `0199` makes the relationship one function, in the database:

```
family_my_students()   the definition
mobile_my_students()   that, with the published contract's bound of ten on it
```

The wrapper stays rather than the mobile function simply being renamed, because
the bound is a **contract** fact (rule 14: bound every list and say the bound in
the document) and a web screen has no reason to silently drop an eleventh child.
`src/lib/auth/family.ts` is the single TypeScript caller.

## The check that moved

`fees.billing` was gated on `fees.view`, and `fees.view` is one of a parent's
ten. Migration `0189` had already written the rule for this exact shape:

> A critic of this shape is gated on the permission a school gives to somebody
> who may *act* on it.

Deciding which of two conflicting fee charges is real is a bursar's judgement —
`transport_billing_conflicts()` reports in sentences instead of deleting a
school's fee structure for precisely that reason. So it is `fees.collect` now
(migration `0200`), which is the matrix behind `/fees/setup`, where the finding
is fixed.

## What this deliberately did not do

- **`/reports` stays in a family's menu.** Eight of nineteen reports run on
  their matrix, and the four that matter — fee defaulters, fee collection,
  attendance summary, exam results — are row-scoped by RLS to their own
  children. That is a useful screen, not a dead end.

  Two of the eight were not, and running all eight as a guardian rather than
  reasoning about them turned that note into migrations `0201` and `0202`.
  `attendance.gaps` ("Registers never taken") did not merely show a family an
  administrative question — it **over-reported by 220 rows**, because a
  `not exists` under row-ownership RLS cannot tell absence from invisibility,
  and it did the same to the class teacher it exists for. `notices.reach` was
  the quieter half: a school-wide circular that reached two people reported as
  reaching one. Both are fixed; the audit table is in
  `docs/modules/attendance.md`.

  So a family now runs **six** of nineteen reports, and all six are their own
  children's: fee defaulters, fee collection, attendance summary, student leave,
  exam results and overdue books.

- **`transport.view` and `hostel.view` still lead nowhere for a family.** They
  hold both; `/transport` and `/hostel` are the office's route and room
  managers, and adding them to a family's menu would repeat the Payroll mistake
  in the other direction. What a family wants there — *which bus, which stop,
  which bed* — belongs beside the fee line that charges for it, and is not
  built.

- **Teacher and librarian run 0 of 9 checks too**, on today's matrix, and keep
  the `/checks` entry. The difference from a parent is not the count: a school
  can give a teacher `students.manage` any Tuesday and the page fills in.
  Nobody gives a guardian `staff.manage`. Where the count is a problem it is the
  matrix's to fix, and `checks_run()` names every check it withheld so the
  problem is visible there.

## The guard

`tests/app-shell/nav-audience.test.ts` runs without a database and fails on the
omission rather than on the lists: **an entry with no `roles` is offered to all
six roles, so it must be named in `EVERY_ROLE_ON_PURPOSE` with the reason.**
Payroll, Leave and Needs attention were each that mistake, and each had a
comment above it arguing for the omission — which is why the guard is a list a
person has to edit rather than a heuristic.


---

## The bus and the bed, on the web

The fee screens were the first door a family did not have. This is the second,
and it was hiding behind a comment that described an intention nobody had
implemented.

`nav-config.ts` said, above the Transport entry:

> *"No `roles` filter on the routes screen: staff see the fleet, and a family
> reaching it sees only their own arrangement, which RLS decides rather than
> the menu."*

The list underneath it read `["admin", "teacher", "accountant"]`. **The code was
right and the comment was fiction** — and that is worse than no comment, because
it is the reason nobody noticed a family had no transport screen at all. Every
transport and hostel surface in the product is staff-only, so the arrangement a
family is billed for every month was on their phone and nowhere on the web.

Rule 4's sentence about the fee screens, one module along: **a charge with no
link is a bill a family cannot check.**

### Nothing new was needed underneath

`transport_for_student` and `hostel_for_student` have been `SECURITY INVOKER`
since their modules shipped, and RLS already scopes them to a guardian's own
children. Probed by creating a parent login inside a rolled-back transaction —
because **the demo school has no parent logins at all**, which is itself the
finding: no family-facing screen in this product had ever been exercised from
the seat it is for.

| probe (as that parent) | result |
|---|---|
| `family_my_students()` | 1 child |
| their child's transport | `City Centre / Sector 12` |
| their child's hostel | `Tagore House room A-101` |
| **another child in the same school** | **0 rows** |

So `/arrangements` adds no read path and no permission. It is a door.

### …and the date decides, not the status column

This is the part that mattered, and it is why the screen was built carefully
rather than quickly.

Those functions return a **history**. Migration `0203` is the record of what
happens when a reader takes the first row of it: `mobile_student_card`
re-exported `status`, so a guardian's phone showed `"status": "active"` beside
`"effective_ends_on": "2026-03-31"`, 162 days after the seat ended, to 88
families.

`/arrangements` is a *second reader of the same history*. Rule 12's question —
**who else does this?** — is the whole reason the logic is a shared predicate
rather than an inline `.find()`. Verified against the live row, as the parent:

```
today                              2026-09-10
raw row (what status alone says)   City Centre status=active effective_ends_on=2026-03-31
page: is it CURRENT?               City Centre -> not current
page: PREVIOUSLY list              City Centre ended 2026-03-31
hostel: is it CURRENT?             Tagore House -> not current (ends 2026-03-31)
```

A screen that printed `status` would have said *"on the bus"*. This one says
*"Not on a school bus"* and, underneath, *"City Centre · Sector 12 — ended 31
Mar 2026"*.

Three decisions worth keeping:

- **The rule lives in `src/lib/validations/arrangements.ts`, not in the server
  action.** A `"use server"` module may only export async functions, so a
  predicate defined there could never be imported by a test — and this is
  precisely the rule that shipped wrong once already.
  `tests/family/arrangements.test.ts` pins it with the actual production row and
  **needs no database**, which matters because the DB-backed suites cannot run
  in every environment.
- **Dates are compared as strings.** ISO `YYYY-MM-DD` sorts lexicographically,
  so no `Date` object is built and no timezone can move the boundary by a day.
  Vercel runs in UTC and the school does not; a boundary that drifts is how a
  family is billed for a day they were not on the bus. The inclusive last day is
  pinned too, because `0179` measured that all 46 lapsed seats were still
  charged on their own final day.
- **Finished arrangements are shown, not dropped.** A family checking an old
  invoice needs to see the seat ran until March. A screen that hides them is how
  somebody concludes the school lost the record.
