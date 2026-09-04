# Dormitory (Phase 5.3)

Boarding houses, their rooms, and who sleeps where.

Built immediately after transport, and deliberately: transport forced a change
to how invoices are assembled, and a second module of the same shape is the
only honest test of whether that change was an architecture or a patch.

Migrations `0095`–`0097`.

---

## The test it was built to be

Transport's central finding was that `fee_structures` — keyed on
`(session, class_level, fee_head)` — cannot express a fee that varies by
something other than the class. The fix demoted it from *the* source of invoice
lines to *a* source, behind one definition:

```
fees_billable_lines(student, period, as_of, heads)
  |- fee_structures     what your class pays
  |- transport          what your stop costs
  `- hostel             what your room costs      <- added here
```

Adding the third source was **one function and one `union all`**. Nothing in
`fees_generate_invoice`, `fees_generate_section_invoices`,
`fees_instalment_preview` or the screens changed. That is the answer.

A boarder's bill, from the demo, in the opening period:

```
Tuition fee                              6,900.00
Activity fee                               900.00
Examination fee                          1,200.00
Library fee                                600.00
Transport - Bypass Chowk (Route R2)        800.00
Hostel - Nivedita House room B-101       3,200.00
                                        ---------
                                        13,600.00
```

…and in an ordinary month, ₹4,000: the bus and the room, nothing else.

**The fare is on the room, not the house** — a four-bed dormitory costs less per
child than a two-bed room — for exactly the reason a bus fare is on the stop.

---

## Where the composite-key device stops

This module is the first place the codebase's favourite trick does not reach,
and that boundary is worth stating.

Two of the three rules use it as usual:

- **A room must be in the house the allocation names** — the identity form,
  `(tenant_id, room_id, hostel_id)` into `hostel_rooms (tenant_id, id,
  hostel_id)`. A direct `INSERT` naming a girls' house and a boys' room is
  refused with `23503`.
- **A child cannot occupy two beds at once** — a GiST exclusion constraint over
  the date range, partial on `active`.

The third cannot:

> **A boys' house takes only boys.**

The device carries a column from **one** parent table into a child's composite
key. A student's gender is not on `students`; it is on `people`, one join
further. Reaching it would mean denormalising gender onto `students` and keeping
it in step — a second copy of a fact that already has an owner, to enforce a
rule a school may well want to relax (a warden's own child, a sibling pair, a
school that does not classify at all).

> **The composite-key trick reaches exactly one table.** A fact two joins away
> is a function check with a readable message, or nothing.

So `hostel_allocate` checks it, and says:
*"Tagore House is a boys hostel, so this student cannot be placed there."*

**An unrecorded gender is not a refusal.** The office often places a child
before the admission form comes back, and blocking that pushes the work onto
paper. `other` and `undisclosed` pass for the same reason. The browser mirrors
this in `genderAllowed`, and a test pins the two to the same truth table — the
copy exists to save a round trip, not to be the gate.

---

## Beds are counted the way seats are

A room's capacity is a fact about other rows, so it is checked in
`hostel_allocate` under an advisory lock on the room, and the message carries
the numbers:

> *"Room A-201 in Tagore House has 2 bed(s) and 2 are taken for those dates.
> Free one, or choose another room."*

Verified: filling a two-bed room accepted exactly one more child and refused the
next.

`hostel_occupancy` is the one definition of "beds free", used by the screen and
by the allocate check, so the two cannot disagree.

---

## What is frozen

`hostel_allocations.monthly_fare` is copied from the room at placement and
deliberately **not** cascaded — revising a room's rate in October must not
restate an invoice raised in July. Same instinct as
`transport_assignments.monthly_fare` and `exam_results`.

---

## The conflict detector, generalised

`transport_billing_conflicts()` was right about transport and wrong about its
own name the moment a second per-student source existed. It is replaced by
`fees_billing_conflicts()`, which covers every source — so a school adding
hostels gets the same double-charge warning without anybody remembering to write
a second detector, and both screens show the same list.

The rename was caught by the typechecker the moment the types were regenerated,
which is the argument for regenerating them as a step rather than a chore.

---

## Screens

| Route | Who | What |
|---|---|---|
| `/hostel` | staff | rooms with live bed counts, the houses, and the placement desk |
| `/hostel/[hostelId]` | staff | the warden's register, printable |

The register prints through the same stylesheet as the bus manifest and the fee
invoice: a boarding house does a roll call on paper at night.

The placement form carries the child's **gender** in the search results, because
that is the one refusal a clerk cannot predict from the room list — being told
before choosing a room beats being told after.

---

## Permissions

The same line transport draws: **running the house is not the same as putting a
child in a bed.**

- `hostel.view` — houses, rooms, the register
- `hostel.manage` — create and edit houses, rooms and fares
- `hostel.allocate` — place a student, or move them out

---

## Not built

- **Lowering a room's bed count below its occupants is allowed.** The room then
  reads as *"Full — 5 of 4"* rather than being refused. Enforcing it means a
  multi-row check on the write path for rooms, the same shape as the allocation
  check; it is visible rather than silent, which is why it is a gap and not a
  bug.
- **No pro-rating.** A child placed on the 20th pays the whole month, exactly as
  with transport. Both need the same policy document.
- **No room-change history as a first-class move.** Moving a child is end one
  stay, start another — correct, audited, and two clicks instead of one.
- **No mess or laundry charges**, no visitor log, no leave/out-pass register.
  All real; all separate tables rather than columns here.
- **Nothing notifies anybody** — a placement, a room change or a child signed
  out is exactly what `notify_send` is for, and no code calls it yet.
