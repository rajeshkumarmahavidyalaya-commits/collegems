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
