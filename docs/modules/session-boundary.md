# The session boundary — an open-ended arrangement is not an eternal one

**Migrations** `0178` (the boundary on the row), `0179` (the eleven readers).
**Columns** `session_starts_on`, `session_ends_on`, `effective_ends_on` on
`transport_assignments`, `hostel_allocations` and `student_concessions`.
**Critic** `academics_session_problems()`. **Screen** `/promotion`.

Three tables carried `session_id` and let `ends_on` be null, under a comment
saying what null meant:

```sql
-- Open-ended by default: most arrangements run to the end of the year and
-- nobody types a date for that.
ends_on date,
```

The sentence was never implemented. To every reader, null meant **for ever**.

---

## Measured, not assumed

All four of these were true of the demo school on the day the fix was written.
The fifth was found by the constraint refusing to be created.

| | |
|---|---|
| **The bill never stops** | All 46 bus seats and 14 beds are open-ended. `transport_fee_lines` and `hostel_fee_lines` match on a student and a date window and never look at the session, so both still returned a line for **15 June 2027** — a stop on a route belonging to a year that ended fifteen months earlier. |
| **The bed is never free** | `hostel_occupancy` counts the same way. 14 of 14 beds occupied today by a cohort whose year ended in March; **1** after the fix, which is the one allocation that genuinely belongs to this year. |
| **The roster and the bill disagree** | `transport_route_load` is session-scoped, so from 1 April the new year's route list is empty while 40 families are still being charged. Neither screen is wrong on its own. |
| **Next year cannot be booked** | `transport_assignments_no_overlap` built `daterange(starts_on, ends_on, '[]')`, and `[2025-04-01,)` overlaps every future range. Probed: assigning the same child a seat for 2026-27 was refused with `23P01`, which the module renders as *"That child already has a transport arrangement covering those dates. End the current one first."* — said in April, about a seat that ended in March. |
| **A bed outside its own year** | A live row: Tagore House A-201, **starting 4 September 2026**, on the 2025-26 session. `hostel_allocate` checks that the *room* belongs to the current session and then defaults `starts_on` to `current_date` without ever comparing the two. Nothing in the product could have reported it. |

The last one is the interesting one, because it is a consequence of the same
gap seen from the other side: a school whose `is_current` session has run out
underneath it can still write rows, and every one of them lands outside its own
year.

---

## The fix is a column, not eleven predicates

There were eleven readers asking `ends_on is null or ends_on >= <date>`. Teaching
each one about `session_id` would have meant eleven joins, eleven
`current_session_id()` calls, and eleven decisions about what to do when the
caller passes an `as_of` in a different year — which is exactly where
`fees_concession_lines` had already gone wrong.

So the row was made to know the answer. This is the composite-key device
(CLAUDE.md rule 4) carrying a **boundary**:

```sql
foreign key (tenant_id, session_id, session_starts_on, session_ends_on)
references public.academic_sessions (tenant_id, id, start_date, end_date)
on update cascade

check (
  starts_on between session_starts_on and session_ends_on
  and (ends_on is null or ends_on <= session_ends_on)
)

effective_ends_on date
  generated always as (coalesce(ends_on, session_ends_on)) stored
```

One key carries both bounds — the `marks.component_max_marks` shape rather than
a new kind of carried column. `on update cascade` does the second half:
correcting a year's dates moves every arrangement's implicit end with it, and a
correction that would pull the year in behind an explicitly-typed end date is
refused. Same shape as refusing to lower a paper's maximum below an awarded
mark.

Then `effective_ends_on` is what every reader asks for, including the exclusion
constraints — which is what stops last year's seat refusing this year's.

### Where the asymmetry is deliberate

`student_concessions` is bounded at the **end only**. `starts_on` on a bus seat
is the day a child starts riding, so it falls inside the year by definition;
`granted_on` is the day a person *decided*, and a scholarship awarded in
February for the coming September is not a data error.

### What the boundary is not

It is not a filter on the current session. `transport_fee_lines(student, date)`
answers for the date it is given, in whatever year that date falls — which is
what an invoice re-run for last March needs. `fees_concession_lines` used to
filter on `current_session_id()` *and* take an `as_of`, and the two disagreed:
a back-dated invoice raised after a rollover credited nothing. That filter is
gone; the window is the only mechanism now.

---

## The one row that had to be placed

Migration `0178` moves an arrangement whose `starts_on` falls outside its stated
session into the session that actually contains that date, and **raises by name**
for any it cannot place. Deliberately a move rather than a `problems()` sentence:
which year a bed starting 4 September 2026 belongs to is not a judgement anybody
has to make — exactly one session contains that date. A row with no such session
stops the migration rather than being quietly dropped.

Where it *is* a judgement — a fee structure and a bus stop both charging the
same head — the codebase still says a sentence and lets a bursar decide
(`transport_billing_conflicts()`).

---

## Two sentences, for the enforcement that reads badly

`transport_assign_student` and `hostel_allocate` now check the start date
themselves, ahead of the constraint, *for the message*:

> A stay starting 8 Sep 2026 would fall outside 2025-2026 (1 Apr 2025 to 31 Mar
> 2026). Start the new academic year first.

The constraint is the enforcement. The sentence exists because the school this
actually catches is one whose current session has run out underneath it, and
*"violates check constraint hostel_allocations_within_session_chk"* does not
tell a warden to roll the year forward.

---

## The question the boundary makes askable

Once an arrangement ends with its year, *"what ends with this year that nobody
has renewed?"* becomes answerable. `academics_session_problems()` answers it, in
sentences, on `/promotion` — where the person who can act is standing.

On the demo school today:

```
warning  The current session 2025-2026 ended on 31 Mar 2026. Until a new year is
         made current, nothing can be dated today -- a bus seat, a hostel bed
         and a concession all have to fall inside their own year.
info     46 bus seats end with 2025-2026 and have not been renewed for 2026-2027.
info     13 hostel beds end with 2025-2026 and have not been renewed for 2026-2027.
```

Two things about *when* it speaks, both following CLAUDE.md rule 12's bar for a
critic — "is somebody going to have to do something about it":

- **Not all year.** A seat that ends in March is not a problem in July, so the
  renewal lines are silent until six weeks before the year ends.
- **Not after it is done.** Each line counts only students with no arrangement
  in the receiving session, so a school that has rolled forward is told nothing.
  That is why the hostel line says 13 and not 14: one child's bed already exists
  in 2026-27.

---

## What is deliberately still not built

**Nothing carries an arrangement forward.** `promotion_apply` moves the child
and the unpaid balance; it does not create next year's bus seat or hostel bed,
and it must not create next year's concession — an award is granted by a person
for a stated reason, and inferring one is the thing `docs/modules/concessions.md`
already refused.

Renewing the other two is a bulk operation and therefore rule 13's shape: a
preview of editable rows, not a button. Until it exists, the critic naming the
number is the honest state — a school that is told *"46 bus seats end with this
year"* can act; one told nothing cannot.

**And `promotion_apply` still stamps `students.status = 'alumni'` on a graduate
without calling `student_exit`.** That is the rule-12 status-column gap in the
one place that creates alumni in bulk — 6 riders and 2 hostel residents in the
demo cohort — and it is the next thing to fix here.
