# HR and payroll (Phase 2.3)

Migrations `0057`–`0064`. Staff attendance, leave, salary structures as data,
and a payroll run whose preview you can argue with.

```
leave_types              tenant configuration: quota, paid or not, half days
leave_requests           applied for, then approved or refused
staff_attendance         one row per person per day
salary_structures        what a salary is MADE OF, as a JSONB document
staff_salary_assignments who is on which structure, for how much, from when
payroll_runs             one month
  └── payslips           one per person, editable while the run is a draft
        └── payslip_lines  one per component, with how it was worked out
```

Two of the architecture's standing rules meet here, and most of the module is
an application of them: **rule 12** (school policy is data) for what a salary is
made of, and **rule 13** (a bulk operation's preview is editable rows) for the
run itself.

---

## The evaluation order, and the bug that proves it needs writing down

```
1. Resolve earnings at full value, in array order.
   `percent_of` reads a code defined ABOVE it — order in the array is the
   evaluation order.
2. Prorate earnings once, by paid days over working days.
3. Deductions, in array order, against the PRORATED earnings — provident fund
   is a percentage of the basic actually paid, not of the basic on paper.
4. Net = gross − deductions. It may be negative.
5. Round, last, once.
```

Migration `0059` shipped an engine whose stated order was exactly this and whose
*implementation* collapsed steps 1 and 2 into a single pass: it prorated each
earning and wrote the prorated figure back into the resolution map, so the next
`percent_of` earning read an already-reduced base **and** was reduced again on
its own account.

With basic 30,000, DA 12%, HRA 40%, conveyance 1,600 and two unpaid days in
twenty-two, it produced a gross of **41,620** where the arrangement it describes
pays **42,909**. Every allowance was docked at roughly double the rate.

Nothing on the screen showed it. Each line's `basis` read *"12% of BASIC,
prorated for 20 of 22 days"* — precisely what a person checking the payslip
would expect to see. Only the arithmetic caught it, by hand, before the module
shipped. Migration `0063` is the fix: three passes, one per step.

**This is the argument for rule 12's insistence that the order be written down
and pinned to exact numbers.** A comment saying "resolve, then prorate, then
deduct" was present the whole time and was true the whole time; the loop simply
did not do it. `tests/hr/payroll-engine.test.ts` now asserts 42,909 and
explicitly asserts *not* 41,620.

### The defaults, and which direction "conservative" runs in

- **No `lop` block means no proration, ever.** A school that wants to dock
  unpaid leave will configure it; a school that starts docking people by
  accident finds out from somebody's bank balance. The demo seed's
  "Support staff (monthly rated)" structure has no `lop` key deliberately, so
  the default is visible in the data rather than only in a test.
- **A working day with no register entry counts as present.** A school that has
  not started marking staff attendance must not have its first payroll run dock
  everybody for the whole month.
- **No `cap` means uncapped; no `rounding` means exact paise.**
- **A forward or unknown `percent_of` reference resolves to zero, not an
  error** — a half-finished structure must still be previewable, and
  `salary_structure_problems()` says so in a sentence instead.
- **Somebody who joined on the 12th** has their window moved, not days docked.
  They were not employed; putting it on the payslip as unpaid leave they never
  took would be a lie in the person's own record.

### `salary_structure_problems()` returns sentences

Same shape as `grading_scheme_problems()`, and next to the engine for the same
reason: the thing that judges a document and the thing that evaluates it cannot
be allowed to drift. It catches forward references, duplicate codes, components
that are neither an earning nor a deduction, a structure with no earnings, a
deduction of more than 100% of its base, and an unknown loss-of-pay basis.

Deliberately **not** a check constraint. A half-finished structure must be
savable.

---

## The structure is the shape; the assignment is the money

`salary_structures.components` says *that* house rent allowance is 40% of basic.
`staff_salary_assignments.overrides` — `{"BASIC": 32000}` — says what basic is
for one person. Two teachers on the identical structure are on different pay,
and duplicating the whole document per person to change one number is how a
school ends up with forty structures and no idea which is current.

Assignments are effective-dated, and **two salaries in force on the same day are
refused by an exclusion constraint**. A raise closes the old row and opens a new
one, so last March's payslip can still be recomputed against last March's pay.
No CHECK can express that rule, because it is a fact about two rows.

The same device does leave: `leave_requests_no_overlap` is a GiST exclusion over
`daterange(starts_on, ends_on, '[]')`, partial on `(pending, approved)` — so a
refusal does not block re-applying for the same dates.

---

## A finalised payslip is immutable because no policy matches it

This is the nicest thing in the module and it is worth reading before touching
either table.

`payslips` carries `run_status`, denormalised from its parent and held equal to
it by a composite foreign key with `on update cascade`. `payslip_lines` carries
`payslip_status` and points at `payslips` the same way. The write policy is:

```sql
create policy "payroll staff manage draft payslips" on public.payslips
  for all to authenticated
  using (... and run_status = 'draft')
  with check (... and run_status = 'draft');
```

So `payroll_finalise` is **one UPDATE on the run**. The cascade rewrites all 15
payslips and all 84 lines, and from that instant the draft-only policy matches
no row: an update touches nothing, silently, which is what RLS does. There is no
revoke, no trigger, and no `if status = 'finalised' then raise` anywhere.

Verified live: after finalising, `update payslips set net_pay = 999999` returned
zero rows and changed nothing.

**Why RLS here and a SECURITY DEFINER function in `homework_submissions`?**
Because this is a *row* rule and that was a *column* rule. Here, nobody needs
different column rights on the same row — everybody who may edit a draft payslip
may edit all of it. There, a student and a teacher needed different columns on
one row, and a column grant is role-wide, so RLS could not express it. Reach for
the definer function only when the distinction is between people, not rows.

### The corollary: a finalised month cannot be redone

`payroll_discard` refuses a finalised run — it is the record of what was paid.
`payroll_preview` refuses to rebuild a finalised month.

Migration `0059`'s message told the administrator to "discard it first", which
the very next call then refuses. Migration `0064` fixed the sentence, because a
message that sends somebody down a path ending in a second refusal is worse than
a blunt one: they now believe the system is broken rather than that it
deliberately will not do this.

**What a school actually needs here is not built** — a correction or arrears run
against an already-paid month. It is the single biggest gap in this module. The
shape it should take is a second run for the same period flagged as a
correction, which means relaxing `payroll_runs_one_live` to allow one live
*correction* alongside one live original.

---

## Separation of duties is in two places at once

`staff` is readable by four roles, because a librarian has to look somebody up.
What a person is *paid* is not part of that, so the salary tables carry their own
narrower policies, and the permission matrix carries the same distinction for
the UI:

| | `hr.view` | `hr.manage` | `payroll.view` | `payroll.process` |
|---|---|---|---|---|
| admin | ✓ | ✓ | ✓ | ✓ |
| accountant | ✓ | — | ✓ | ✓ |
| everyone else | — | — | — | — |

An accountant reads the register and runs payroll from it, and **cannot mark
it** — the person who decides who was absent must not be the person who decides
what that costs them. That is enforced by RLS (no accountant write policy on
`staff_attendance`), and the matrix says the same thing so the marking buttons
are not rendered for them in the first place.

A teacher gets none of these. Their own attendance, their own leave and their
own finalised payslips reach them through row-ownership policies keyed on
`user_profiles.staff_id` — the distinction rule 4 draws, applied for the first
time to a person looking at their own record rather than at a class they teach.

**A draft payslip is not visible to the person it is for.** It is a number still
being argued about in the office, and showing it would have somebody planning
around a figure that is about to change.

### `hr_cancel_leave` is the same shape as `homework_submit`

An applicant may set `status` to `cancelled` and must never set it to
`approved`, and both live on the same row. A column grant cannot separate two
parties, because a grant is role-wide and both are `authenticated`. So there is
**no staff UPDATE policy on `leave_requests` at all**, and withdrawal goes
through a narrow `SECURITY DEFINER` function that checks the caller owns the
request. The absence is the mechanism.

---

## `hr_working_days()` — a debt paid off

`weekends` and `holidays` have existed since the academic structure landed and
nothing had ever asked them a question. Payroll has to: *"how many working days
were there in March"* is the denominator of every loss-of-pay calculation, and
counting calendar days instead is how a school docks somebody for a Sunday.

It is `SECURITY INVOKER`, so a caller only counts holidays their own tenant can
see. It also closes a gap the attendance roadmap recorded — the student
attendance report can now say "18 of 22 school days marked" rather than counting
only the days that were.

---

## What is not built

- **Nobody is paid by this module.** A finalised payslip is a liability the
  school owes; recording the payment is an accounts entry, and `ledger_entries`
  is a *fee receivable* ledger (`student_id` is `not null`) that deliberately
  cannot hold it. That is Phase 2.2, unbuilt.
- **No correction or arrears run**, as above.
- **Staff library fines still have no home.** `docs/modules/library.md` records
  that a staff fine is "a payroll matter, not a fee receivable". Payroll now
  exists, so the gap has somewhere to go — a deduction line proposed by the
  preview — but wiring it needs a settlement concept on the staff fine, which
  `book_issues.fine_amount` does not have. Recorded, not solved.
- **No payslip PDF and no bank advice file.** Both are unbounded rendering work
  and belong in `jobs` per rule 7.
- **No income tax.** TDS on salary is a slab calculation over projected annual
  income, which is a different kind of document from this one and should not be
  bolted onto `components`.
- **Termination does not stop payroll.** `staff.status` has no date, so a person
  marked `terminated` simply stops appearing; a mid-month leaver is paid for the
  whole month. A `date_of_leaving` beside `date_of_joining` would fix it
  symmetrically.
- **No approval chain.** Leave is approved by an admin, full stop; a department
  head cannot approve their own team's.

---

## Verification

`tests/hr/hr-shapes.test.ts` — 34 pure assertions covering what a person types
and, mostly, what a missing value means: a blank quota versus a quota of zero, a
half day on a single day counting as half rather than nothing, `CODE = amount`
overrides, and the no-`lop` default.

`tests/hr/payroll-engine.test.ts` pins the evaluation order to exact numbers,
including the regression above. `tests/hr/hr-flow.test.ts` covers the run
lifecycle. All eight new tables are in the cross-tenant isolation suite.

Every guard was also driven directly against the live database while the module
was written:

| Property | Result |
|---|---|
| full month, basic 30,000 | gross 47,200 · PF capped 1,800 · net 45,200 |
| 2 unpaid days in 22 | gross **42,909** (the 0063 fix; was 41,620) |
| PF with the cap raised, 2 unpaid days | 3,473 — 12% of the basic *paid* |
| same, no unpaid days | 3,800 — 12% of the basic on paper |
| a structure with no `lop` block | 47,200 with 2 unpaid days — not docked |
| all 22 days unpaid | gross 0 |
| February 2026, 15 staff | 24 working days, LOP correct per person |
| finalise | 15 payslips and 84 lines stamped by cascade |
| update a finalised payslip | 0 rows matched, nothing changed |
| discard a finalised run | refused |
| re-run a finalised month | refused |
| finalise a run with no payslips | refused, naming the month |
| overlapping leave | refused by the exclusion constraint |
| re-applying after a refusal | allowed |
| two salaries in force on one day | refused |
| recompute a corrected payslip | override discarded, six lines rebuilt |
| a month nobody marked | 0 loss-of-pay days |

**The same caveat as every other module:** the demo database has only the two
admin logins. Accountant, teacher and self-service RLS on these tables is
asserted structurally — the policies exist, and the ones that must be absent
verifiably are — but no accountant has signed in to prove the separation of
duties end to end. That is the first thing to test with a real second account.
