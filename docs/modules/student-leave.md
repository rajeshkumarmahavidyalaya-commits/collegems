# Student leave

A family tells the school a child will be away; a class teacher or the office
decides.

Migrations `0147`–`0151`.

---

## Why this exists at all

Migration `0141` built a schedule that texts a parent the evening their child was
marked absent. It works, and on its own it is rude: a family that told the school
on Monday their daughter has chickenpox gets a text every evening for a week
saying she was absent.

> **A module that sends must ask the module that knows.** Otherwise a school
> spends its SMS credit telling parents things the parents told the school — and
> the messages that matter start being read as noise.

So this module is half a feature and half the other end of one that already
existed. `schedule_run` now calls `student_is_on_leave` before it sends, and the
run row separates the two reasons a matched child was not written to:

- **on approved leave** — deliberate, and the school wanted it;
- **no family login** — a gap the school might want to close.

One number (*"12 matched, 7 told"*) cannot distinguish those, and they call for
opposite responses.

Verified as a pair against the demo tenant. Same child, same absence, same
schedule: without leave, `matched 1, notified 1, note null`. With approved leave
covering the day, `matched 1, notified 0` and

> *"1 of 1 were on approved leave, so their families were not told again."*

---

## Approving leave does not write attendance

The obvious shortcut is to stamp `excused` across the range at the moment of
approval. It is wrong twice over:

- **It writes the future.** The register is taken daily, by a person. A child on
  approved leave who turns up must be marked present.
- **It makes `attendance_records` say something no teacher marked.** The register
  is what was *observed*; an approval quietly rewriting it is exactly the edit an
  attendance record must not permit.

So the fact travels two ways, and both are reads:

| where | how |
|---|---|
| the marking screen | `student_leave_on(section, date)` folds "on approved leave · reason" into the roster, beside the child, and the teacher marks what they see |
| the absence notice | `student_is_on_leave(tenant, student, date)` is consulted before sending |

A leave approved *after* the register was taken does not retrospectively change
it. That is correct, and re-marking is the school's to do.

---

## Two live requests cannot cover the same day

A CHECK cannot see a second row and an application that queries first and inserts
second is a race, so this is the exclusion constraint CLAUDE.md names — the same
shape staff leave already uses:

```sql
alter table public.student_leave_requests
  add constraint student_leave_no_overlap
  exclude using gist (
    tenant_id with =, student_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('pending', 'approved'));
```

**Partial on `pending`/`approved`**, so a refused or cancelled request does not
block re-applying for the same dates — a family whose first note was refused for
want of detail must be able to send a better one.

`23P01` is translated at the point of insert, because *"conflicting key value
violates exclusion constraint"* is not something to show a parent:

> *There is already a leave request for this student covering 2026-09-09 to
> 2026-09-12. Cancel or refuse that one first.*

Two client-side functions exist only to agree with that constraint, and are
tested for it: `leaveDays` counts inclusively the way `daterange(..., '[]')` does,
and `blocksTheDates` mirrors the partial `where` exactly. If either drifts, the
screen offers something the database then refuses.

---

## Two parties, different columns, one row

This is CLAUDE.md rule 4's `homework_submissions` case, not its
`notification_deliveries` one:

- a **family** sets the dates, the kind and the reason;
- a **teacher** sets the status and the decision note.

A role-wide column `GRANT` cannot express that — every user of this application
is `authenticated`, so narrowing the columns would break one party to protect the
other. So:

> The narrower party gets a `SECURITY DEFINER` function that sets exactly one
> column after checking who is asking, and **no UPDATE policy at all**.

`student_leave_cancel` is that function. **The absence of a family UPDATE policy
is the mechanism**, and it is commented on the table where somebody would add
one: a later migration that tidily "adds the missing update policy" hands every
parent the power to approve their own child's leave.

Everything else is `SECURITY INVOKER`, because the table already carries a policy
for each party. `student_leave_apply` and `student_leave_decide` are functions
for the *message*, not for the permission.

`student_leave_decide` raises when nothing was decided rather than reporting
success. Under RLS an update that matches nothing succeeds while touching
nothing, and a refusal silently turning into nothing is a family watching a
screen that says it worked.

---

## The permission matrix does not follow seniority

| | view | apply | decide |
|---|---|---|---|
| parent / student | ✓ | ✓ | |
| teacher | ✓ | | ✓ |
| admin | ✓ | ✓ | ✓ |

A **teacher may not apply.** A teacher entering a request on a family's behalf
and approving it in the same breath is a record with nobody's word behind it. An
**administrator may**, because somebody has to be able to record what a parent
said at the gate.

RLS then narrows each of those to the right rows — a class teacher decides only
for their own section, a guardian applies only for their own children. The matrix
decides *who may ask the question at all*; the policies decide *about whom*. Rule
4, both layers, doing different work.

A leave note names an illness, so **only the class teacher** sees their section's
requests — not every teacher who takes that class. "Who teaches this child" is a
wider circle than "who is responsible for them".

---

## Files

| | |
|---|---|
| `supabase/migrations/0147_student_leave_schema.sql` | the table, the exclusion constraint, the policies |
| `supabase/migrations/0148_student_leave_engine.sql` | apply, decide, cancel, and the two read paths |
| `supabase/migrations/0149_absence_notice_asks_about_leave.sql` | the scheduler consults it |
| `supabase/migrations/0150_student_leave_permissions_and_report.sql` | the matrix and the register |
| `supabase/migrations/0151_leave_across_the_school.sql` | a default the body always meant |
| `src/lib/validations/student-leave.ts` | the two functions that agree with the constraint |
| `src/app/(app)/attendance/leave/` | asking and deciding |
| `src/app/(app)/attendance/actions.ts` | leave folded into the register as a third overlay |
| `tests/attendance/student-leave-forms.test.ts` | without a database |
| `tests/attendance/student-leave-db.test.ts` | the constraint, the decision and the scheduler's door, through real RLS |
