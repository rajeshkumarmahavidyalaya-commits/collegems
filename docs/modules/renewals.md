# Carrying arrangements into the new year

**Migrations** `0182` (routes and stops roll forward), `0183` (one body, two
doors), `0184` (schema), `0185` (engine).
**Tables** `renewal_runs`, `renewal_decisions`. **Screen** `/promotion`, and
`/promotion/renewals/[runId]`.

Migration `0178` made an arrangement end with the academic year it was made
for. That was right, and it left a hole the size of a school year: on 1 April a
school that ran **46 bus seats and 13 hostel beds** runs none, and somebody has
to re-enter all 59 by hand in the busiest fortnight of the calendar.

`academics_session_problems()` says the number. This is what a person does about
it.

---

## Three things had to exist first

**Routes are per-year.** `transport_routes` and `route_stops` carry
`session_id`, so the receiving year starts with no routes at all — and
`transport_assign_student` refuses a stop from another year by name. Not one
seat can be created until they exist. `transport_roll_forward_routes` copies
them, matching routes on `code` and stops on `name`, skipping what is already
there (migration `0182`), and it is a **button rather than something a promotion
run does silently** because a fare is a decision: fares rise, and last year's is
a starting point somebody edits.

It returns three numbers, and the third is the honest one. `route_stops` is
unique on `(route, sequence)` as well as `(route, name)`, so a hand-built
receiving route with a *different* stop already at position 3 cannot take this
one. Renumbering to the end would be worse than not copying — "the third stop"
is a fact about a trip, not a tie-break — so it is skipped and **counted**, and
the screen says the number. A silent skip there is a child waiting at a stop
that is not on the driver's list.

**A write has to be able to name its year.** A school prepares the rollover in
March; `is_current` flips in April, deliberately and separately. So both write
functions refused the work — one compares the stop's session to
`current_session_id()`, the other does not take a session at all. Migration
`0183` is the fix, in the shape rule 6 already names from `notify_send` /
`notify_send_for`: **one body, two doors**, never a copy, because a copy is
where a check quietly stops being applied in one of them.

Rule 6 also states when that split is safe — *"only where the invoker version's
protection is a tenant or role check, not a row-ownership one"* — and it is:
both functions are `SECURITY INVOKER` over tenant-wide admin policies, and both
do their own explicit checks. Parameterising the session changes which year is
written, not who may write it.

**And the default start date moved**, which is the change that makes March work:

> The default is now the later of today and the year's own first day, not today.

Inside the current year that is still simply today. For a year that has not
begun it is 1 April — the only date that satisfies the boundary CHECK from
`0178`, and the only date a person would have typed.

---

## The run is rule 13's shape

One table typed by `kind`, not two nearly identical ones — `ledger_entries`'
precedent, with the constraint written per kind. And `kind` is **carried onto
the decision** rather than read from the run, because a CHECK cannot reach
another table (rule 4); it is held equal to the run's by the composite foreign
key, so "this decision belongs to this run" and "this decision is the same kind
as its run" are one constraint.

```sql
constraint renewal_decisions_target_chk check (
  case
    when decision = 'skip'
      then to_stop_id is null and to_room_id is null and direction is null
    when kind = 'transport'
      then to_stop_id is not null and to_room_id is null and direction is not null
    else to_room_id is not null and to_stop_id is null and direction is null
  end
)
```

A skip that pointed at a stop would apply as a silent write, which is the same
failure `promotion_decisions_target_chk` exists to prevent one module over.

**What is frozen and what is not** is the other half. `from_label` and
`from_fare` are plain text and a number — a statement about last year, not a
pointer — so ending or correcting last year's arrangement cannot rewrite what
the preview said (rule 4's second boundary). The *target* is a live foreign key,
because a decision pointing at a stop somebody has since deleted is a decision
that cannot be applied, and finding that out at apply time is worse than the row
going null.

---

## Two things the promotion module does not do

**Apply calls the module's own write function**, not an INSERT.
`transport_assign_student_for` and `hostel_allocate_for` know that the route
must be running, the child must be enrolled *in the receiving year*, the bus
must have a seat, the house must take this child and the dates must fall inside
the year. Writing rows directly would be a second implementation of all five,
free to disagree — rule 11's "wrap the module's own read path", applied to
writing.

**A row that fails keeps its reason and the run carries on.** Each write sits in
its own exception block, so a refusal is caught, written to
`renewal_decisions.error`, and the next child is tried. The import module's
lesson: stopping at the first failure leaves the office with half a bus and no
list of who is missing.

What the preview deliberately does **not** check is capacity. A bus seat and a
bed are rules about *how many other rows exist*, which no query over one row can
see (rule 4's second boundary), so they are checked at apply under the advisory
lock the write functions already take — and the refusal arrives as a sentence
with the numbers in it.

---

## Promote first, then renew

Not an instruction in a manual: it is what the rows say. A child with no active
enrolment in the receiving year is proposed as **skip**, with

> Not enrolled in 2026-2027, so there is nobody to carry.

Run against the demo school before promoting, all 46 transport rows come back
`skip` with exactly that sentence. Run after, they come back as 40 renewals and
6 skips — the 6 being the graduating cohort, who genuinely have nobody to carry
forward.

Measured end to end on the demo tenant, inside a rolled-back transaction:

```
routes=2 stops=7 skipped_stops=0
transport  renewed=40  skipped=6  failed=0
hostel     renewed=11  skipped=2  failed=0
2026-27:   40 seats, 12 beds
```

Every skip reason: *"Not enrolled in 2026-2027, so there is nobody to carry."*
Nothing else was refused.

And it runs inline, which rule 7 requires an argument for rather than an
assumption. `renewal_preview` over the whole school: **47 ms, 2,618 buffers, 46
rows.** It is bounded by the number of arrangements a school has, not by
anything that grows without limit — unlike the `audit_log` report that forced
`docs/performance.md` to be written. Applying is a few dozen short
transactions, each one a write the office would otherwise have made by hand.

---

## Why a concession is not a third kind

`RENEWAL_KINDS` has two entries and the database refuses a third by name. That
is deliberate, and it is the same refusal `docs/modules/concessions.md` already
made:

> A concession is an award, not an inferred rule. It is granted by a person, on
> a date, for a required reason.

Carrying one forward would grant an award nobody granted, in a year nobody
reviewed it for — and the family would find out from a bill that was quietly
cheaper than the school intended. The rollover screen says so in a sentence
rather than leaving the absence to be read as an oversight.

---

## What is not built

- **No fare revision inside the run.** The fare comes from the receiving year's
  stop or room, so editing fares is done in Transport or Hostel before
  applying. The preview says *"Same place, 1350.00 a month instead of 1200.00"*
  so a rise is visible rather than discovered in May, but it cannot be changed
  from here.
- **No hostel reallocation logic.** The proposal is always the same room. A
  warden who moves the whole first year upstairs does it row by row, which is
  honest but not fast.
- **No undo.** Applying is final, like a promotion run. `renewal_discard_run`
  only works on a draft.
- **Nothing notifies anybody.** No family is told their seat was renewed.
