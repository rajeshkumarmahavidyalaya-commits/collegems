# Staff — the module HR was built on top of

Migration `0194`.

## A correct write path nobody could call

`staff_exit` shipped in migration `0176`. It was refined in `0180`, given a
library membership and two guards in `0191`, and had **no caller in the
application at all** — because there was no `/staff` screen. No roster, no way
to add anybody, and no surface for recording that somebody had left.

Everything the HR module does — the daily register, leave, salary structures,
payroll runs — is built on a table the app could otherwise only read in
dropdowns. And rule 6 already names the failure, about the fee counter:

> A correct write path nobody can call is not a fix.

The consequence was concrete. `0191` made `timetable_set_entry` and
`substitution_arrange` refuse a member of staff who is not `active`; there was
no screen in this product that could set that status. The guards were real and
guarding a door nobody could open.

## Where the gate is, and why it is not the page

RLS on `staff` is deliberately role-wide: after `0193`, admin, teacher,
accountant and librarian may all read the employment record. So *"an accountant
may not open the staff roster"* is a rule only `role_permissions` expresses —
and rule 4 says where it is checked:

> `report_run` checks it **inside the function that produces the data**, not in
> the UI.

`staff_roster` and `staff_record` do the same, and the server action does not
repeat it. Probed as each role, on the same school:

| caller | `select * from staff` | `staff_roster()` |
|---|---|---|
| teacher | 15 rows | **refused** — *"Your role cannot open the staff list"* |
| admin | 15 rows | 15 rows |

A `hasPermission()` call on the page would be a second answer to a question
that already has one, and would not cover anybody holding a JWT and calling
PostgREST directly. The permission *does* still appear on the page — to decide
whether an **Add staff** button is drawn — which is the distinction rule 4
draws: the UI may hide a control, and may never be what protects the data.

The nav entry carries `roles: ["admin"]` for the same reason and with the same
status: it is a menu, not a boundary.

### One check, in one place, at last

The matrix test — *does this role hold this permission* — had been written out
by hand in `report_run`, `dashboard_summary` and `checks_run`. A fourth copy is
where a rule quietly starts to differ from itself, so `0194` makes it
`role_has_permission(code)` and the new functions call that.

The three existing copies are **deliberately not rewritten**. Each is
load-bearing authorization, and replacing one is a probe of that function's
behaviour as several roles rather than a tidy-up — `checks_run`'s own history
(an administrator saw `ok`, a teacher saw 200 false findings) is the argument
for treating that as its own change with its own measurements.

## Two tables or neither

`staff_admit` and `staff_update` exist because a member of staff is two rows.
supabase-js cannot open a transaction, so a `people` insert followed by a
`staff` insert that fails leaves an orphan person nobody will ever see —
somebody who exists, is nobody, and shows up in a search.

Both are `SECURITY INVOKER`: `admins manage staff` and `admins manage people`
are the enforcement, and the permission check inside is there *for the
message*, per the conventions.

Two details worth keeping:

- **`staff_admit` takes an optional `p_person_id`.** Rule 5's identity model is
  the point: somebody who is already a guardian here keeps one `people` row and
  gains a staff one, which is what makes "a teacher whose child is in Class 4"
  representable rather than duplicated. `staff_tenant_id_person_id_key` then
  makes the second attempt to employ the same person an error, and the function
  tells the two collisions apart — *"that person is already on the staff list"*
  and *"employee code X is already used by somebody else"* are different
  problems with different fixes.
- **Neither writes `status` or `date_of_leaving`.** That is the load-bearing
  absence, and it is asserted in `tests/hr/staff-shapes.test.ts` rather than
  left to a comment. An edit form with a status dropdown would be a second way
  to write the flag and the one that does nothing else — which is exactly the
  bug `0174` closed on the students side, where four of the five read paths
  never consulted the column.

## The record page is one round trip

`staff_record(id)` returns one jsonb document — the person, the employment, what
they are responsible for, their library card, and whether they are away today.
The dashboard's shape (rule 11), for the dashboard's reason: six queries for one
screen is six round trips, and every figure here is an aggregate, so the
response does not grow with the school.

`library` is **null** when somebody holds no card, rather than an object of
zeroes — an object would read as a card with no books out, and those are
different facts. Same instinct as a collection rate being null before anything
is billed.

The counts sit *beside* the leaving date rather than instead of it. After an
exit they all read zero, and that is the exit having worked: `staff_exit`
unassigned the lessons, the class-teacher duty and the subjects. Verified live,
inside a rolled-back transaction:

```
exit: Aditi Agarwal left, lessons 21, library 1, outstanding 1
record after: status=resigned lessons=0 card=expired
```

## What the exit screen shows afterwards

Two kinds of sentence, and they are not the same kind:

- **What was ended** — 21 lessons, a class-teacher duty, a library card. A
  statement of what just happened.
- **What could not be ended** — a book still out, and cover they were down to
  provide after today. Deliberately not cleared: `substitutions` records what
  was *decided*, and rewriting it would erase somebody's decision. Naming it
  lets the office re-arrange, which is the certificates rule again — a function
  that refused would be one schools route around.

## Not built

- **Re-employment.** There is no way back through this screen. Somebody
  returning is a decision with a joining date and a contract in it, and
  `staff_exit_problems()` names anybody left in a strange state rather than this
  guessing at one. Same shape as the students module's deliberate refusal to
  make re-enrolment the inverse of leaving.
- **Reassigning what a leaver taught.** `staff_exit` leaves the lessons
  unassigned and says so; choosing who takes them is rule 13's editable-preview
  shape, not an automatic one.
- **Bulk staff import.** The students module has one; a school onboarding forty
  teachers by hand will want the same. The import module's three rules —
  re-judge every row after any edit, apply partially and record why, refuse an
  oversized input rather than truncating it — port unchanged.
