# Transport (Phase 5.2)

Buses, the stops they call at, and which child boards where.

The module looks like reference data and is not. It is the first place in this
codebase where **a fee depends on something other than a class level**, and that
turns out to be the whole design.

Migrations `0083`–`0090`.

---

## The problem the module exists for

`fee_structures` is keyed on `(session, class_level, fee_head)`. It answers one
question well — *what does a child in Class 6 pay* — and until now that was the
only question `fees_generate_invoice` had ever asked.

Transport asks a different one:

> **What does a child who boards at Sector 12 pay?**

The answer is the same for a six-year-old and a sixteen-year-old on the same
bus, and *different* for two children sitting next to each other in the same
class. On the demo tenant, Grade 1 A contains a child paying ₹800 and a child
paying ₹1,500 — same class, same year, different boarding point.

No amount of data in `fee_structures` expresses that. Adding a `stop_id`
dimension to it would make every other fee carry a null column and would still
be wrong for the next fee that varies by something else — a hostel room, an
optional subject, a music lesson.

So the fix is not another dimension. It is to stop treating `fee_structures` as
**the** source of invoice lines and make it **a** source:

```
fees_billable_lines(student, as_of, heads)   <- one definition
  |- from fee_structures   (what your class pays)
  `- from transport        (what your stop costs)
```

`fees_generate_invoice` inserts what that function returns.
`fees_generate_section_invoices` asks the same function whether there is
anything to bill. One definition of *what would this child be charged*,
consulted by both, so a preview and an invoice cannot disagree.

A real invoice from the demo:

```
IN-2025-00301
  Activity fee                          900.00
  Examination fee                     1,200.00
  Library fee                           600.00
  Transport - Sector 12 (Route R1)    1,100.00   <- from the stop
  Tuition fee                         7,800.00
```

The stop is in the description on purpose. *"Transport 1200"* on a bill starts a
phone call; *"Transport - Sector 12 (Route R1)"* answers it.

---

## A route is a trip, not a bus

The distinction decides how seats are counted. One vehicle that runs a morning
trip and an afternoon trip has forty seats **twice**, not forty seats shared.
Modelling a route as the trip makes *"does this bus have room"* a question about
one route — which is both true and countable.

So `vehicles` is not session-scoped (a bus the school owns outlives an academic
year) and `transport_routes` is (next year's arrangements are next year's rows).

---

## Four rules, four devices

Every rule here is a fact about *other rows*, and each one gets the device
CLAUDE.md prescribes for its shape.

### 1. A child's stop must be on the child's route — a composite foreign key

```sql
constraint transport_assignments_stop_on_route_fkey
  foreign key (tenant_id, stop_id, route_id)
  references public.route_stops (tenant_id, id, route_id)
```

A stop on a different route simply has no matching key. This is the **fourth**
use of the device in the codebase and the first where the carried column is an
**identity** rather than a flag (`time_slots.schedulable`), a value
(`marks.max_marks`) or a status (`payslips.run_status`).

Verified: a direct `INSERT` naming route R2 and a stop on R1 — bypassing the
function entirely — is refused with `23503`.

### 2. A pickup-only route cannot drop anybody — a CHECK over a carried column

The rule between a route's direction and an arrangement's is **compatibility,
not equality**:

| route | may carry |
|---|---|
| `both` | pickup, drop, both |
| `pickup` | pickup |
| `drop` | drop |

The reflex is a trigger, because it spans two tables. It does not have to: carry
the route's direction onto the assignment inside a composite key, and the rule
becomes a plain CHECK over two columns of one row.

```sql
foreign key (tenant_id, route_id, route_direction)
  references public.transport_routes (tenant_id, id, direction)
  on update cascade
-- ...and then:
check (route_direction = 'both' or direction = route_direction)
```

This is the first use where the carried column feeds a **comparison** rather
than an equality. And the cascade does real work in both directions: narrowing a
route from `both` to `pickup` while children on it still need dropping rewrites
every assignment and the CHECK re-evaluates — so the route change is **refused**
(`23514`). That refusal is the correct answer, not a side effect, exactly as
with lowering a paper's `max_marks` below an awarded mark.

### 3. A child cannot be on two buses at once — a GiST exclusion constraint

```sql
exclude using gist (
  tenant_id with =, student_id with =,
  daterange(starts_on, ends_on, '[]') with &&
) where (status = 'active')
```

Partial on `active`, so a **cancelled** arrangement stops blocking a new one for
the same dates — which is the difference between *cancel* (entered in error) and
*end* (the child stopped riding). `23P01` becomes a sentence at the function
boundary: *"That child already has a transport arrangement covering those dates.
End the current one first."*

A null `ends_on` makes the range unbounded, which is what an open-ended
arrangement means — and most of them are, because nobody types a leaving date in
July for a child who will ride all year.

### 4. A bus cannot be oversold — checked at assign time, under a lock

Capacity is the same genre as *debits equal credits*: no CHECK can see the other
forty rows. So it is checked in `transport_assign_student`, and the message
carries the numbers:

> *"Route R2 (RJ-14-CD-5678) seats 26 and 26 are already assigned for those
> dates. Free a seat or use another route."*

Two clerks filling the last seat at the same moment would both pass a
check-then-insert, so the count and the insert are serialised with
`pg_advisory_xact_lock` on the route.

Verified end to end: filling R2 accepted exactly 16 more children — its 16 free
seats — and refused the 27th with the sentence above.

---

## What is frozen and what cascades

Two copied columns, deliberately opposite:

| Column | Cascades? | Why |
|---|---|---|
| `transport_routes.vehicle_capacity` | **yes** | A mirror. Re-licensing a bus for 45 seats must update every route that uses it. |
| `transport_assignments.monthly_fare` | **no** | A historical fact. Revising a stop's fare in October must not restate an invoice raised in July. |

Same instinct as `exam_results`: derived while provisional, frozen when it
matters.

---

## Two things the first billing run showed

Both were found by reading real output, and neither would have failed a test
that called the function one student at a time.

### A `limit 1` inside a CTE is not a guarantee once the function inlines

`fees_billable_lines` resolved the student's class level in a CTE and joined it.
Called on its own it was correct — five structure lines and one transport line.
Called as `students cross join lateral fees_billable_lines(id, …)` — which is how
a screen listing a class would call it — **every line came back three times**,
with three different class levels' tuition. Postgres inlines a `language sql`
function into the calling query, and the correlated CTE did not survive that
rewrite the way the standalone call implies.

The fix is not a better CTE. It is to make the fan-out impossible by
construction: a **scalar subquery** returns exactly one value or null, so there
is no join for the planner to widen.

> When a value must be singular, express it as a scalar subquery, not as a
> one-row relation you promise not to join twice.

### The same head, fed by two sources, bills the family twice

The demo tenant had carried a flat class-level *"Transport fee"* of ₹4,800 since
migration `0025`. Pointing a route's fare at that same head meant every child on
a bus was billed **both** — the class's flat charge and their stop's fare — and
the invoice looked entirely plausible.

This is not a demo quirk. It is what happens to any school that moves a fee from
*"everyone in Class 6 pays this"* to *"you pay for where you board"*, which is
the entire point of this module.

What this codebase does with that kind of problem is **criticise it in Postgres
and return sentences** — `grading_scheme_problems()` is the pattern — rather
than quietly deleting a school's fee structure. Which of the two charges is real
is a bursar's decision, not a migration's.

```
Class Grade 1 has a "Transport fee" fee of 4800.00 in its fee structure, and
2 routes charge their own fares against the same head (R1, R2). Any child in
that class on a bus is billed both. Remove the class-level charge, or point
the routes at a different head.
```

`transport_billing_conflicts()` returns those, the transport screen shows them
in a banner, and an empty list is the passing state. The demo's own overlap was
removed in `0090` — **for the demo tenant only**, because demo data should be
correct and a migration that guesses for a real school silently changes what
families owe.

One sentence per (class, head) pair, not per route: the first version emitted
twelve rows saying one thing, and nobody reads the same warning twelve times.

---

## Screens

| Route | Who | What |
|---|---|---|
| `/transport` | staff | routes with live seat counts, the fleet, and the double-billing banner |
| `/transport/[routeId]` | staff | the manifest, and the stops-and-fares editor |
| `/transport/assignments` | admin | put a child on a bus, end or cancel an arrangement |

**The manifest is the screen the module exists for.** Stop by stop, who gets on,
and a number to ring when they are not there — printing through the same
stylesheet the fee invoice uses. Only the **primary** guardian's number appears:
a list with three numbers per child is one nobody reads on a roadside.

The assign form shows a child's current arrangement while you are still typing
their name — the same idea as the fee counter showing a balance, so a clerk
catches the wrong Ravi before the exclusion constraint does. The constraint is
still the guard; this is a courtesy.

**Refusals from Postgres are shown as written.** Rewording *"Route R2 seats 26
and 26 are already assigned"* in the browser would give the school two wordings
for one rule.

---

## Permissions

RLS already says who may write: routes, stops and vehicles are admin-only, and a
family sees its own arrangement and nothing else. The matrix draws the line RLS
deliberately does not — **running the buses is not the same as putting a child on
one**, and a transport in-charge who plans routes is often not the person at the
admissions desk.

- `transport.view` — routes, stops, vehicles, manifests
- `transport.manage` — create and edit routes, stops, fares, vehicles
- `transport.assign` — put a student on a route, or take them off

---

## Not built

- **Instalments.** `fee_structures.amount` is documented in `0021` as the amount
  *per instalment* and `frequency` has always been descriptive — the generator
  has never divided or multiplied by it. A transport `monthly_fare` is one
  instalment on one invoice, consistent with that. Turning `frequency` into
  arithmetic is a real gap and a **pre-existing** one; it is not fixed here.
- ~~**Pro-rating a part month.**~~ Built in `0317`. The sentence that stood
  here (*"a child who joins on the 20th is billed the full monthly fare"*) was
  wrong in the other direction: the instalment asked whether the seat was
  running on the period's **first day**, so a child who joined on the 20th was
  billed **nothing** for that month, and one who left on the 3rd paid the whole
  of it. Now every arrangement that overlaps the instalment's dates is billed,
  by the day (`fare x days ridden / days in the period`, and the line says
  *"12 of 31 days"*) or, if the college switches `fees.part_month` off, in full
  for any month started, with a replaced seat giving way to its successor so a
  change of stop is never two months. Calendar days, deliberately: a bus runs
  on the days the school is shut too, and nobody can check a school-day count
  against a bill. `transport_fee_lines` keeps answering the one-day question for
  every other reader.
- **GPS, live tracking, or an attendance register on the bus.** All three are
  real products; none is a schema change to this module.
- **Vehicle documents** — insurance, fitness, permit expiry — and the reminders
  a school actually wants from them. That is a documents module plus
  `notify_send`, not transport.
- **Shift-aware capacity.** A route is a trip, so seats are counted per route.
  A vehicle physically double-booked across two overlapping trips is not
  detected.
- ~~**Nothing notifies anybody.**~~ Built (`0316`): a new seat raises `transport.assigned` to the child and their family -- route, stop and time -- from an AFTER INSERT trigger, so every way a seat is made (the transport screen, the student's record, the admission form, renewals) announces it. A failed announcement never undoes the seat. In-app by default.

## Staff ride the same buses (0293)

A member of staff can hold a seat: *Give a member of staff a seat* on
`/transport/assignments`, and the seat shows on their record under
**Transport**. It is the same table, the same checks and the same seat count
under the same advisory lock, so a bus with 40 seats is 40 children and staff
together.

- **One rider per seat.** `num_nonnulls(student_id, staff_id) = 1`.
- **One seat at a time.** The existing exclusion compares `student_id` with
  `=`, and `null = null` is never true, so staff rows have a twin exclusion.
- **Free, by CHECK.** `staff_id is null or monthly_fare = 0`. Charging staff
  would be a payroll deduction that nothing collects yet. A fare the database
  records and nobody bills is the `fee_structures.frequency` mistake, so the
  column cannot hold one until payroll can.
- **Leaving ends it.** `staff_exit` ends a current seat and cancels a future
  one. `guard_staff_delete` counts bus seats among the history that stops a
  delete.
- **Readers that mean children say so.** Renewal and the year-end critic
  filter `student_id is not null`. The manifest lists staff riders by name.

## A route in one form, and who rides what (0296)

- **One form for a new route.** *New route* now takes the first stop, its
  monthly fare and its pickup time beside the route's name, vehicle and fee
  head, as WPSchool's *Add New Route* does. `transport_route_create` writes both
  in one transaction, because two client calls would leave a route with no stop
  behind when the second one failed. A first stop with no fare is refused in a
  sentence rather than given 0.
- **Editing a route kept its fee head only by accident, and not even that.**
  `transport_route_load` does not return `fee_head_id`, so the edit dialog sent
  `""`. Renaming a route silently stopped its fares reaching the bill. Both
  demo routes had a head. The list now reads the head beside the load.
- **The bus list is today's, on the school's day.** `transport_manifest`
  listed a seat from the day it was booked, not the day it starts, and
  compared against UTC's `current_date`. It asks `mobile_today()` on both
  ends. The screen had also been filtering on `studentId !== null`, which
  dropped every staff rider 0293 had added: a rider is now a row with a name.
- **Who rides which bus** is a catalogue report (`transport.riders`),
  filterable by day, route, vehicle, class, section, and children or staff. It
  is gated on `transport.assign`: assignments are row-owned for a family, so
  `transport.view` would answer a parent with their own child. The report
  runner gained `route` and `vehicle` parameter types, and this year's routes
  only, because last year's R1 beside this year's is two identical labels.

Probed as the administrator, rolled back: a route with its first stop created
in one call; a teacher given a seat on it; the report finding them with
*Riders: Staff*; 46 children on 15 January; and nobody today, because the demo
college's year ended in March.
