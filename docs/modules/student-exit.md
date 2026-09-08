# Leaving — the end of several relationships, not one flag

**Migrations** `0174` (the act, and `certificate_issue` performing it), `0175`
(a fencepost in the critic). **Function** `student_exit`.
**Critic** `student_exit_problems()`. **Screen** the student record.

`certificate_issue` set `students.status = 'transferred'` and stopped, under a
comment saying *"issuing a leaving certificate **is** the act of the child
leaving"*. The comment was right about the intent; the code did a fifth of it.

---

## Measured, not assumed

Checked against the live function bodies rather than guessed:

| read path | consults `students.status`? |
|---|---|
| `fees_billable_lines` | no |
| `transport_fee_lines` | no |
| `hostel_fee_lines` | no |
| `schedule_student_audience` | no |
| `fees_student_balances` | **yes** — the only one |

…and `fees_generate_section_invoices` loops `enrolments.status = 'active'`,
which the certificate never touched.

So a child whose leaving certificate was issued in April kept being invoiced
every month, kept a seat on a bus and a bed in a hostel that were both still
being charged for, and their family got an absence text every evening for a
child who was at a different school.

---

## The fix is not to teach every reader about the flag

Nine read paths would each have to remember it, and the tenth is the one
somebody writes next year.

> A status column is a **summary**. The relationships are owned by the modules
> that made them, so **leaving is one act that ends them**, not a flag every
> reader has to check.

`student_exit(student, reason, on, status)` ends the enrolment, the bus seat,
the hostel bed and any live concessions, then sets the status **last** — so a
failure part-way leaves the child visibly still here rather than half-gone.

Verified on a real record: one call returned
`closed: {enrolments: 1, transport: 1, hostel: 1}` — including a hostel bed
nobody had thought to check — and `fees_billable_lines` for the following day
returned nothing. Running it again returned all zeroes: idempotent.

### `ends_on`, never `cancelled`

The child genuinely did ride the bus until the day they left. Rewriting that to
`cancelled` erases a fact the school was right to record — the same instinct
that keeps a revoked concession's credits and a withdrawn leave request's
history. Both fee-line functions honour `ends_on`, so the charge stops from the
following day and the record stays intact.

### What it cannot end is a sentence, not a refusal

An unreturned library book and an unpaid balance both survive a child leaving,
and neither is this function's to decide about. Certificates already settled the
principle — *whether unpaid fees withhold a leaving certificate is a real
school's real policy and unlawful in some states* — so `student_exit` reports
them in its return document and proceeds. **A function that refused would be a
function schools route around.**

---

## Two doors, one act

`setStudentStatus` in the students module was a second path to the same flag,
and it was one `update … set status`. It is now routed through `student_exit`
for any leaving status, and requires a reason for the same purpose the database
does.

Going the other way is deliberately **not** the inverse act. Re-enrolling a
child is a decision with a section and a roll number in it, so setting them back
to `active` writes only the status, and the critic names anybody left active
without an enrolment rather than this guessing at one.

---

## The fencepost that the critic got wrong

`0174`'s critic accused a correctly-performed exit:

```
student_exit(...)        -> closed: {enrolments: 1, transport: 1, hostel: 1}
student_exit_problems()  -> "…still has a bus seat and still has a hostel bed."
```

He did not. The two predicates look identical and ask opposite questions:

```sql
transport_fee_lines    ends_on >= as_of        -- charged ON the last day: right
student_exit_problems  ends_on >= current_date -- "still has a seat" ON the
                                               --  last day: wrong
```

A seat that ends today is a seat that has been given up. The *charge* runs to
the final day inclusive because the child rode the bus that morning; the
*relationship* is over from the moment it is ended. Fixed in `0175`, and only
visible by running the thing and reading what it said.

> A critic that fires on a correctly finished action teaches people to ignore
> it, which costs more than the check was worth. The bar for a `problems()`
> function is not "could this be wrong" but "is somebody going to have to do
> something about it".

---

## The critic, both directions

- **Gone but still attached** — enrolled, or holding a bus seat or hostel bed.
  These are the children who left before `student_exit` existed, and any future
  path that bypasses it.
- **Active but nowhere to be** — on the roll with no enrolment this year, so
  they appear on no register. This is the state a *cancelled* transfer
  certificate leaves behind: `certificate_cancel` restores the student status,
  and deliberately does not re-seat them on a bus or put them back in a class.

Neither is anybody's fault and both are recoverable, so they are sentences
rather than constraints.

---

## Not built

**Alumni as a first-class thing.** `alumni` is a status and nothing reads it —
no alumni register, no way to find a leaver's old report cards from a name.
Rule 5's identity model already makes it representable (`people` outlives
`students`), which is the hard part; the module is a screen and a report
whenever a school asks for one.


---

# The same question, asked about staff

**Migrations** `0176` (the roster learns to see a vacant post), `0177`
(`staff_exit`, and `terminated` is not the only way to leave).
**Critic** `staff_exit_problems()`.

Asking the student question about the other half of the identity model found a
sharper version of it — and this one was **true in the demo data**:

```
Rudra Rai            status: terminated
staff_is_away(today) false
lessons today        3
substitution_gaps    0 of them flagged
```

Across the timetable that one departure left **19 lessons**, **2 sections**
whose class teacher had gone, and **6 section-subject assignments**. Three
classes had nobody in front of them that day and the morning roster said the
school was fully covered.

Payroll was already fine — `payroll_preview` and `hr_attendance_sheet` both read
`date_of_leaving`, from the payroll-gaps work. The timetable side was never
taught.

## "Mark them away" is the wrong one-line fix

It is tempting, and it would light the roster up. But *away* means temporarily
absent, and the answer to a temporary absence is **cover**: a substitution row,
arranged this morning, for today. A departed teacher's lessons do not need
covering every day until July; they need **a different teacher**.

> "Nobody is here today" and "nobody teaches this any more" are different
> problems for different people. The morning roster wants the first; whoever
> owns the timetable wants the second. A screen showing only one of them makes
> the other invisible.

So `substitution_gaps` gained a `reason` — `away` or `unassigned` — and the card
says *"nobody teaches this — the timetable needs a teacher, not just cover"*.

## Unassigning alone would have traded one silence for another

`staff_exit` clears `teacher_staff_id`, because a timetable entry's teacher is a
statement about **now** — migration `0155`'s distinction, where a statement
about a day that has passed gets frozen instead, which is what
`substitutions.absent_staff_id` does. Same schema, two kinds of column, treated
oppositely on purpose.

But `substitution_gaps` required `teacher_staff_id is not null`. Nulling those
lessons would have dropped them off the morning list altogether — a quieter bug
than the one being fixed. **So the roster learned about vacant posts first, and
only then was it safe to unassign.** Verified in that order: after the exit,
the three previously-invisible lessons appeared by name — *Grade 2 A p6, Grade
3 A p8, Grade 4 A p1*.

`substitutions.absent_staff_id` was widened to nullable so a vacant post can be
covered at all, and **null means something specific**: the post was vacant, as
against a named person being absent. `substitution_problems` had to move to a
left join at the same time, or every vacant-post arrangement would have dropped
out of the critic — the same failure mode, one layer down.

## Terminated is not the only way to leave

`staff_status_check` allowed `active`, `inactive`, `terminated`. A retirement
and a dismissal are not the same fact — they read differently on a reference and
are treated differently in law in several jurisdictions — so `resigned` and
`retired` are now representable. The CHECK stays the enforcement; the guard
inside `staff_exit` is there *for the message*, per the conventions.

## What it cannot end

- **Library books**, and the reminder that a staff fine is a payroll deduction
  rather than a fee receivable — `ledger_entries.student_id` is `not null`, so
  it cannot go to the fee ledger.
- **Future cover they were down to provide.** Deliberately not cleared:
  `substitutions` records what was arranged, and rewriting it would erase a
  decision somebody made. Naming it lets the office re-arrange.

## Not built

**Reassignment.** `staff_exit` leaves 19 lessons unassigned and says so; it does
not suggest who should take them. `substitution_candidates` already knows how to
rank who is free for one period, and the same ranking over a whole timetable is
the obvious next step — but choosing a permanent teacher for a class is a
decision with a workload and a subject specialism in it, which is rule 13's
editable-preview shape rather than an automatic one.
