# Exam seating

One plan per sitting: a date, optionally a period, and one numbered seat per
candidate. Migrations `0249`–`0254`.

The roadmap's Phase 3b named this "self-contained and genuinely missing", and
the measurement agreed — zero occurrences of `seat_plan`, `seating`,
`invigilat`, `hall_ticket` or `admit_card` anywhere in `src/`, `supabase/` or
`docs/`.

## What it is for

Measured on the demo college: 12 sections of 25–27, **302 candidates on each of
8 dates**, 12 active rooms of 40 seats.

Seat a section in its own classroom — which is what happens when nothing decides
otherwise — and the room is 63% full and **every neighbour is writing the
identical paper**:

| arrangement | same-paper neighbours | adjacent pairs |
|---|---|---|
| a section per room | 290 | 290 |
| generated (`0252`) | **0** | 290 |

All 12 papers are present in all 12 rooms. That is the module.

## The interleave

Group the candidates by paper, largest paper first, into one list; deal the
first half into the even seats and the rest into the odd ones.

```
list index i  ->  seat  2i                       when i < ceil(n/2)
                  seat  2(i - ceil(n/2)) + 1      otherwise
```

Two neighbouring seats always come from list positions at least `ceil(n/2)`
apart, so they hold one paper only if that paper is more than half the sitting —
which is exactly the case where no arrangement can separate them.

A dominant paper of `m` candidates among `n` admits at least `max(0, 2m-n-1)`
adjacent pairs, because the other `n-m` open `n-m+1` gaps to spread `m` into.
Against that floor:

| shape | adjacent | minimum | |
|---|---|---|---|
| 1×27 + 11×25 (the live sitting) | 0 | 0 | optimal |
| 12×25 | 0 | 0 | optimal |
| 200 / 5 | 194 | 194 | optimal |
| one paper of 25 | 24 | 24 | optimal |
| 100 / 50 / 10 | 40 | 39 | +1 |

3,000 random shapes (1–14 papers, 1–40 candidates each): **worst excess over the
minimum = 1**.

`0251` first used a fractional spread — each paper's candidates over `[0, 1)` —
which measured **1 of 290** and looked like a win. It was not: the live sitting
is one paper of 27 and eleven of 25, so two of the 27 land in one gap on *every*
generation. A warning present every single time is not a finding, it is a label,
and this codebase's own rule is that a critic which fires on a correctly finished
action teaches people to ignore it.

> And the first check of the replacement used the wrong floor — `m - ceil(n/2)`
> rather than `max(0, 2m-n-1)` — which would have recorded it as *suboptimal* on
> three shapes where it is exactly optimal. **The algorithm was fine and the
> instrument was not.**

## Capacity is declarative, because the seats are numbered

Rule 4 says a rule about *how many other rows exist* needs a write function
under an advisory lock, because no constraint sees a second row. A numbered seat
escapes that:

```sql
check (seat_no <= planned_capacity)            -- one row
unique (tenant_id, plan_id, room_id, seat_no)  -- one row per seat
```

Together they say *at most `planned_capacity` candidates are in this room*, with
no lock and no count — the numbering is the count. The advisory-lock answer is
for a capacity whose occupants are anonymous.

## Two of rule 4's devices, doing the two different things they are for

| column | cascade | why |
|---|---|---|
| `run_status` | **yes** | publishing is one UPDATE on the plan; the draft-only write policies then match no row |
| `planned_capacity` | **no, and in no key** | a plan is a statement about a day |

With a cascade, refurbishing a room from 40 seats to 30 would rewrite last
July's plan and record a capacity the room did not have. Without one, the
refurbishment would be *refused* while any historical plan referenced it. So the
capacity is a frozen plain integer, the live room is free to disagree, and —
exactly as with a reassigned timetable lesson behind a `substitutions` row — the
disagreement is what `exam_seating_problems()` can find.

## Who sees what

| seat | draft | published |
|---|---|---|
| administrator | 302 | 302 |
| teacher (invigilator) | 302 | 302 |
| candidate | 0 | **1** — their own |
| guardian | 0 | **1** — their own child's |

Probed as each, with the logins created in a rolled-back transaction, because
this college has two logins and both are administrators.

**`0253` is the migration that matters.** `0249` wrote policies called
*"staff view …"* and gated them on `exams.view` — which the matrix says is held
by admin, teacher, **parent and student**. Probed as a candidate: 302 seats
visible, draft included. Where every child sits, their roll number and their
paper, handed to all 302 families.

> **A permission is not a proxy for an audience.** The word in the policy name
> is not a predicate. Third instance in this codebase, after
> `report_fee_defaulters` and `attendance.gaps`.

`exams.seating` is its own catalogue row, granted by reading the matrix
(*whoever holds `exams.grade`*) rather than by naming `admin`. And the narrow
policies beside the broad one were always correct and were never reached:

> **RLS policies are OR-ed.** Adding a correct narrow policy does not fix an
> over-broad one sitting next to it — the narrow one is not a restriction, it is
> an alternative.

## A silent no-op is worse than an error

`exam_seat_move` returned `{"moved": true, "swapped": true}` having changed **0
rows** on a published plan, under a comment saying the write policy would refuse
it. It did not: a permissive policy that matches nothing grants nothing,
silently. Rule 6 already says *assert the count* — it says it about a test, and
a caller is no different. `0254` asserts it after every UPDATE, and names the
state before the permission so the ordinary case gets the officer's next action.

## What is deliberately not modelled

**Who elected an optional paper.** 12 papers carry `is_optional` and no table
anywhere maps a child to the optional paper they chose, so the candidate list
for one is the whole section. The generator returns the count and the critic
says it in a sentence — the office can check 27 names against their own elective
register in a minute and cannot undo a plan built on an invented one.

**Invigilator assignment.** There is no table for it, so the chart is not scoped
to a room per teacher; the office prints the room sheets, which is what actually
happens.

## Where the critic lives

`exam_seating_problems(plan_id)` is deliberately **not** a `reference.checks`
row. It takes a plan id, and a college-wide check that fired about an exam which
finished in July would be the critic that teaches people to ignore it. It is
read beside the plan, as `audit_history` is read beside a record.

It refuses a caller without `exams.manage` rather than answering nothing — an
empty answer is indistinguishable from a plan with nothing wrong — and its
"seated but no longer sitting" finding narrows the wide side to candidates the
caller can read an enrolment for, because `exam_seat_allocations` is tenant-wide
and the candidate list is row-scoped. Without that predicate a class teacher
would be shown 277 candidates who are sitting perfectly normally.

## Files

- `supabase/migrations/0249_a_seat_is_a_room_and_a_number.sql` — schema, policies, the `exams.seating` setting
- `supabase/migrations/0250_the_guard_caught_it_in_the_same_session.sql` — a redundant index, found by the guard in the session that wrote it
- `supabase/migrations/0251_the_interleave_is_the_whole_point.sql` — rules, candidates, generator, publish, move, chart, critic
- `supabase/migrations/0252_the_measurement_said_one_and_one_is_every_time.sql` — the optimal construction
- `supabase/migrations/0253_exams_view_is_not_a_staff_room_door.sql` — the read gate
- `supabase/migrations/0254_a_policy_that_matches_nothing_does_not_refuse.sql` — row-count assertions
- `src/app/(app)/exams/seating-actions.ts`
- `src/app/(app)/exams/[examId]/seating/` — the sittings list and one plan
- `src/lib/validations/seating-display.ts` — no imports, and must keep none
- `tests/exams/seat-plan.test.ts` — 17 assertions, no database, 13 planted violations
