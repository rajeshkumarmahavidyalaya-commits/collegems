# What each role gets after signing in

The product has six roles and, until this pass, **two logins** — both
administrators. Every other seat existed only as a policy and a nav filter that
nobody had ever sat in. This document is what five of the six actually see,
measured rather than read, and the two places the menu was wrong about it.

Each seat below was created in a rolled-back transaction: an `invitations` row,
a real `auth.users` insert through `handle_new_auth_user`, then `set local role
authenticated` with that login's JWT claims. That last step is the whole
instrument — a `DO` block runs as `postgres` and bypasses RLS, so a measurement
taken there is for a query nobody will execute.

## The six seats

Counts are rows the seat can read on the demo college (302 students, 555
guardians, 14 staff), not rows the screen draws.

| | admin | teacher | accountant | librarian | parent | student |
|---|---|---|---|---|---|---|
| dashboard blocks | all | 4 | 4 | 3 | 4 | 4 |
| …withheld, named | — | staff attendance, fees | student attendance, exam, library | student attendance, staff attendance, fees, exam | school, staff attendance | school, staff attendance |
| `students` | 302 | 302 | 302 | 302 | 1 | 1 |
| `attendance_records` | 6,000 | 500 | 6,000 | — | own child | 20 |
| `homework` | 4 | 4 | **0** | **0** | own child's | 3 |
| `student_leave_requests` | all | own section | **0** | **0** | own child's | own |
| `invoices` | 317 | 0 | 317 | — | 2 | 1 |
| `report_list()` | all | 9 | 8 | 2 | 2 | 2 |
| `staff_directory()` | 15 | 15 | 15 | 15 | 15 | 15 |
| `payslips` | 31 | 2 (own) | 31 | 2 (own) | — | — |
| `audit_log` | yes | — | — | — | 0 | 0 |

Two things in that table are the finding. Everything else is the product
working as designed.

## The menu said "every role has business here" and meant four

`nav-config.ts` lets an entry omit its `roles` list, which offers it to all six.
`tests/app-shell/nav-audience.test.ts` has guarded that omission since the
family batch: a role-less entry must be named in `EVERY_ROLE_ON_PURPOSE` **with
its reason**, so a new one nobody has decided about fails the test.

Both of the entries below were named there, with reasons, and both reasons were
wrong:

- **`/homework`** — *"One address, two screens: set it, or do it."* Two screens
  names two audiences and the entry named no roles, so an accountant and a
  librarian were offered it. The page then chose its screen with
  `roleCode === "admin" || roleCode === "teacher"` — two of the **four** staff
  roles — and both fell through to the *family* screen. `homework` has no
  SELECT policy for either role: measured as each of them, **0 rows** and
  `family_my_students()` **0**. The screen greeted them as a family and had
  nothing on it.
- **`/attendance/leave`** — *"The family applies, the school decides — both
  parties on one screen."* `student_leave_requests` has SELECT policies for an
  administrator, a class teacher, a student and a guardian, and **none** for an
  accountant or a librarian. Measured as each: **0 rows**, under a heading
  saying a family tells the school a child will be away.

> **A reason written down is not a reason that was checked.** The guard asks
> whether somebody decided; it cannot ask whether they were right. Both reasons
> were checked against the roles the author had in mind and against no others —
> and the two roles they missed are exactly the two nobody signs into, which is
> why an empty screen sat there for as long as the module has existed.

Both entries now carry `roles: ["admin", "teacher", "parent", "student"]`, which
is the list the policies already implied.

## A tier written out by hand

The page half is the more interesting one, because it would have been wrong
even with the menu right — a URL is a URL, and rule 4 says the menu is never the
gate.

`roles.tier` (migration `0208`) names the three audiences and exists precisely
to decide **what a person is shown**. `roles.subject` (migration `0224`) says
what a login stands for — `staff`, `student`, `guardian`, `none`. Between them
they answer both questions `/homework` was answering with role codes:

| question | answered by | not by |
|---|---|---|
| which of the two screens? | `roleTier === "student"` | `roleCode === "admin" \|\| "teacher"` |
| whose record do I resolve? | `roleSubject === "guardian"` | `roleCode === "parent"` |

The tier cannot answer the second — `parent` and `student` share it, which is
the whole reason `0224` added a second column rather than overloading the first.
Neither is a gate: what a person may *do* on that screen is still
`hasPermission("homework.manage")` and, underneath it, the policies.

Three other screens were making the same copy and are converted:
`/timetable`, `/fees/family`, `/arrangements` and `/report-card` each read
`roleCode === "parent" || roleCode === "student"`, which is the student tier
spelled out.

### …but one list of role codes is right, and it is the interesting one

`/notices/[id]` tests `["admin", "teacher"]` and **keeps it**. `notice_reads`
carries exactly one staff policy —
`current_role_code() = ANY (ARRAY['admin', 'teacher'])` — and widening that page
to the staff tier would hand an accountant a read summary computed from their
own single read receipt: *"1 of 400 have read this"*, a plausible number over a
row-ownership policy, which is the quiet failure mode CLAUDE.md already records
for an invoker function.

So the rule the guard enforces is not *never compare a role code*:

> **One comparison is a mirror of one policy. Two or more is a claim about an
> audience, and a claim needs a reason.**

`tests/app-shell/role-branches.test.ts` fails on any screen in `src/app` or
`src/components` testing two or more role codes unless it is named in
`MIRRORS_A_POLICY` with the policy it copies. Verified by planting a page with
the original `/homework` branch in it, and green on revert. It reads both
directions — a declaration whose screen no longer makes that comparison fails
too, because the nav allowlist had rotted in exactly that way: `/report-card`
sat in `EVERY_ROLE_ON_PURPOSE` for months after it was given
`roles: ["parent", "student"]`, explaining a decision nobody was making.

## What is still true and is not a defect

- **A teacher reads all 302 students.** `staff roles view students` is
  deliberately tenant-wide; the row-ownership narrowing is on `enrolments`,
  which is why a teacher's `attendance_records` is 500 and not 6,000.
- **An accountant reads all 6,000 attendance rows.** That is
  `attendance_records`' own `staff roles view attendance` policy, and migration
  `0201` already decided to leave it and let the matrix express a college's
  answer instead — which is why `/attendance/report` has no accountant in its
  roles list.
- **A librarian's dashboard withholds four blocks of seven and names all four.**
  That is `dashboard_summary()` doing its job, not a thin screen.
- **`report_list()` gives a family two reports.** Migration `0200` moved five
  gates to the permission somebody who may *act* holds; a family keeps the two
  that are about them.

## What is measured and still open

- **302 active students, one email address between them.** The student branch of
  `invitation_preview` works and would produce 301 rows reading *"No email
  address on record"*. A guardian login is reachable today (555 of 555 have an
  address); a student login, at this college, is not. Collecting the address is
  the office's work, and a second channel for the invitation — every one of the
  555 has a phone number — is on the roadmap.
- **A college cannot create a role.** `roles` carries an admins-only write
  policy and nothing in `src/` inserts one, so rule 3's *"a tenant can add
  custom roles later"* is a correct write path nobody can call. `navForRole`
  filters on the role **code**, so a seventh role would also arrive to an empty
  menu — the two halves have to be built together.
