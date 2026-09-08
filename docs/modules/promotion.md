# Promotion (Phase 1.4)

Moving a whole school up a year. Migrations `0050`–`0052`.

The naive version is a button that promotes everybody. It is also the version
that gets a school ringing you in tears, because promotion is the one operation
where the machine's answer and the staff-room's answer differ for three or four
**named children** every single year — one who was ill for the examination, one
whose parents are transferring in June, one the head has decided to keep back
regardless of marks.

**So the preview is not a report. It is a set of rows an administrator can edit,
and applying writes what the rows say — not what the rules said.**

```
promotion_runs        one rollover, with the rules it was computed under
  └── promotion_decisions   one row per student, editable, then applied
```

---

## The rules document

```json
{
  "no_detention_up_to_sequence": 8,
  "criteria": {
    "require_exam_pass": true,
    "exam_kind": "annual",
    "max_failed_subjects": 0,
    "min_attendance_percent": 75
  },
  "on_missing_result": "hold",
  "carry_forward_fees": true
}
```

Every key is optional. An empty `{}` promotes everybody who has somewhere to go,
which is a real policy — plenty of primary schools have exactly that one — not a
degenerate case.

### Evaluation order, which is the part that matters

1. **The no-detention band** promotes regardless of marks or attendance. First,
   because that is what the policy *is*: a statutory floor, not a tie-break.
2. **Attendance.** Below `min_attendance_percent` repeats, even having passed.
3. **The examination.** Only a **published** result counts — a draft is a number
   still being argued about, and promoting on it would act on something the
   school has not agreed to.
4. **A missing result** falls to `on_missing_result`, `hold` by default.

That default is load-bearing. *"We have not marked this child yet"* is not the
same answer as *"this child failed"*, and defaulting to either of the other two
quietly decides something nobody decided.

Then the shape of the school decides the rest: a promotion with no next class
level is a **graduation**; a promotion or repeat with no section to land in is a
**hold**, and the reason says which class is missing.

Verified against the demo cohort of 301 students, one rule at a time:

| Rules | Promote | Repeat | Graduate |
|---|---|---|---|
| `{}` | 251 | 0 | 50 |
| Exam-conditional, no allowance | 212 | 49 | 40 |
| …allowing one failed subject | 249 | 2 | 50 |
| …no-detention to sequence 3 | 236 | 25 | 40 |
| …attendance ≥ 95% | 146 | 128 | 27 |

The 49 repeats in row two are exactly the 49 students the exams module recorded
as failing. An integration test asserts that equality, because the moment those
two numbers diverge one of the modules has started computing its own answer.

---

## Applying follows the rows

`promotion_apply` walks `promotion_decisions` and does what each says. Proved on
the demo cohort: with one decision overridden from *promote* to *hold*, applying
reported `promoted: 211` where the rules had produced 212, and that student's
outgoing enrolment stayed `active`.

What it writes:

- **Promote / repeat** — a new enrolment in the receiving session, and the
  outgoing one closed as `promoted` or `repeated`. That is what makes
  `enrolments` a history rather than a snapshot.
- **Graduate** — no new enrolment (they have left), the outgoing one closed as
  `promoted`, and then **the whole act of leaving**: `student_end_relationships`
  ends the bus seat, the hostel bed and every live concession and sets
  `students.status = 'alumni'` last. Not `graduated`: `alumni` is the word the
  column uses, and keeping alumni representable is one of the four things the
  layered identity model exists for.

  The order is not a style choice. The outgoing enrolment is closed **first**,
  with `promoted`, because a graduate finished the year — they did not withdraw
  from it, and the word is what somebody reads on a class list in five years.
  The act then finds no active enrolment and closes none.

  See "Graduating is leaving" below for why this is a shared function rather
  than a call to `student_exit`.
- **Hold** — nothing at all, deliberately. The outgoing enrolment stays `active`,
  so the student is still visibly somebody's problem rather than quietly gone.

**Idempotent on the enrolment's unique key.** A rollover retried after a timeout
converges instead of double-enrolling.

`SECURITY INVOKER`, unlike `exams_publish`. Everything it writes — enrolments,
invoices, invoice lines — already has an admin policy, so RLS decides every row
and the function only supplies atomicity. A definer function here would take
authority it does not need.

---

## Graduating is leaving

Until migration `0180` the graduate branch was two statements:

```sql
update public.enrolments set status = 'promoted' ...;
update public.students set status = 'alumni' ...;
```

Two statements, five relationships. `student_exit` had existed since `0174`
precisely because a status column is a summary rather than a switch — and the
one place that turns children into alumni **fifty at a time** had never been
taught it. In the demo cohort that is 6 bus riders, 2 hostel residents and every
fee concession they hold.

The fix is not a third copy of the five updates. That is the mistake rule 12
names: nine readers would each have to remember. So the *act* was extracted —
`student_end_relationships(student, on, status, reason)`, `SECURITY INVOKER`,
no validation and no reporting — and both callers use it. `student_exit` is that
call plus its validation and its per-child note; `promotion_apply` is that call
per graduate.

### Why not simply call `student_exit`

Two reasons, and the second was measured rather than assumed.

1. **The outgoing enrolment must read `promoted`, not `withdrawn`** — see above.
2. **`student_exit`'s outstanding note costs 97 ms per child.** It reads
   `fees_student_balances()`, and a `where student_id =` outside a
   set-returning function is an optimisation fence (rule 7): the function runs
   to completion for every student in the school and the filter is applied
   afterwards. Measured: 97 ms and 5,113 buffers to return one row. Fifty
   graduates is 4.9 seconds — and it grows with the school, not with the
   cohort.

So the cohort's version of that note is one grouped query after the loop, in
`promotion_left_behind`.

### The date is the end of the outgoing year, not today

A run applied in February must not end a bus seat in February. The arrangement
is closed on the outgoing session's `end_date`, because that is when the child
left. (Since migration `0178` an open-ended arrangement already ends there of
its own accord, so this usually closes nothing and correctly reports zero. What
it does close is an arrangement made for a year the graduate will never attend,
and every live concession — neither of which lapses on its own.)

---

## What a run could not close

`promotion_left_behind(run_id)` returns sentences, and
`promotion_runs.left_behind` freezes them when the run is applied.

```
329860.00 is still owed by 23 graduates who are leaving. There is no enrolment
in 2026-2027 to carry it onto, so chasing it or writing it off is the school's
to decide.
```

Three things about it:

- **It is answerable of a draft.** The screen asks it *before* applying, which
  is the only time anybody can act on it, and asks the same function afterwards
  — so the sentence a person reads and the sentence the run freezes cannot
  disagree.
- **It is written to a column, not toasted.** Applying cannot be undone, and a
  message that scrolls away is a message nobody acted on. Same instinct as
  `notices.announce_error` (rule 10).
- **The money figure comes from `outstanding`, not `carry_forward`** — see
  below.

### `outstanding` and `carry_forward` are two facts

Migration `0181`. The probe that found it: a run created with an empty rules
document reported `carried = 0` on a school where **96 families owe
₹10,60,904**. Nothing was wrong — `carry_forward_fees` defaults to false, which
is the conservative reading rule 12 asks for — but the run had no record of the
debt at all, because the only column that could hold it was the one the policy
had zeroed.

| column | what it is |
|---|---|
| `outstanding` | what the child owed at the end of the outgoing year, as the preview measured it |
| `carry_forward` | what the run decided to bill in the receiving year — `outstanding`, or zero |

A measurement and a decision. A graduate's debt is not carried whatever the
policy says, so the sentence about it must not depend on the policy being
switched on: the school least likely to carry fees forward is the school most
likely to forget the money.

Older rows are backfilled from `carry_forward`, and where the policy was off
the debt was never recorded and cannot be recovered. Said out loud rather than
backfilled by recomputing, because today's balance next to a run applied last
March is a number in the wrong place.

---

## Fee carry-forward

An unpaid balance becomes an **opening invoice in the receiving year**, with its
own gapless number, rather than a figure copied between sessions. Rule 6: money
moves by documents, so what crosses the year boundary is something the family
can be shown.

Two honest limitations, both surfaced on screen rather than hidden:

- **A graduate's debt is not carried.** They get no enrolment in the receiving
  year, so there is nothing to carry it onto. The preview totals it up and says
  so — ₹2.46L across 17 leavers in the demo cohort — because writing it off
  silently and inventing a policy are both worse than telling the bursar.
- **Outstanding is computed inline**, not through `fees_student_balances`, which
  is bound to whichever session is *current* — and the whole point of a rollover
  is that the session you are leaving may not be. Same arithmetic: billed, plus
  the signed ledger, where positive means "owes more". An integration test
  asserts the two agree when the outgoing session is the current one.

---

## `academics_roll_forward_sections`

`sections` are session-scoped, so next year's 6B is a different row. Promotion
cannot invent them — a section carries a capacity and a class teacher, which are
decisions — but making an administrator retype twelve of them before they can
even see a preview is the kind of friction that gets a product abandoned in June.

So the screen offers to copy this year's shape across, skipping anything that
already exists.

---

## Constraints doing real work

```sql
constraint promotion_decisions_target_chk check (
  (decision in ('promote', 'repeat')) = (to_section_id is not null)
)
```

A promotion or a repeat has to land somewhere; a graduate and a hold must not.
Without it, "promote" with a null section would apply as a silent no-op and the
student would vanish from next year.

```sql
create unique index promotion_runs_one_live
  on public.promotion_runs (tenant_id, from_session_id, to_session_id)
  where status <> 'discarded';
```

At most one live run per session pair. Two half-built previews of the same
rollover would disagree, and whichever was applied second would silently win.

---

## Authorization

**Admin-only, read as well as write, and deliberately so.** A preview says "this
child will repeat" before anybody has decided it, and that is not a sentence to
leave lying around a staff room. Once applied, the outcome is visible through
`enrolments` like any other year.

A class teacher wanting to review their own class's list before it is decided is
a real use this does not serve. It is a deliberate trade, not an oversight.

---

## What is not built

- **It does not run through `jobs`.** Rule 7 names promotion runs as queued
  work, and for a school of 300 the preview is a single indexed query and the
  apply is 300 short transactions — fast enough to do inline, and far more
  useful when the result is a screen you can argue with rather than a job id.
  At ten thousand students that stops being true, and the apply is the half that
  should move: it is already row-by-row and already idempotent.
- **No undo.** Applying is final by design; `promotion_discard_run` only works
  on a draft. Correcting an applied run means editing the affected enrolments
  directly, which is honest but not comfortable.
- **Nothing notifies anybody.** No parent is told their child was promoted;
  `notify_send` is not called.
- **The new session is not made current.** Flipping `is_current` is how a school
  says "the new year has started" and stays a separate, deliberate act — every
  other module reads whichever session is current.
- **No bulk section rebalancing.** Students land in the same-lettered section
  where one exists (6B → 7B), and overriding is one row at a time. A school that
  reshuffles its classes every year has to do it by hand.
- **Roll numbers are not assigned** in the receiving year — they arrive null.
