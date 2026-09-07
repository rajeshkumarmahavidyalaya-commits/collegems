# Substitutions — who covers the class when a teacher is away

**Migrations** `0155` (schema + `staff_is_away`), `0156` (engine), `0157`
(permissions + report), `0158` (the teacher's half).
**Screen** `/timetable/substitutions`. **Report** `timetable.substitutions`.

A school with four hundred children loses two or three teachers on a normal
morning. The roster that covers them is usually a whiteboard, and the
whiteboard is wrong by nine o'clock — somebody's leave was cancelled, somebody
else went home ill, the timetable changed last term and nobody redrew the
grid. This module is that whiteboard with the three mistakes it cannot make.

---

## What "away" means, and where it is decided

**Nowhere in this module.** `staff_is_away(date, staff_id)` reads two things
that already exist:

- an **approved `leave_requests`** row covering the date — what the school knew
  in advance;
- a **`staff_attendance`** row for the date with status `absent`, `on_leave` or
  `on_duty` — what actually happened.

Both are needed. A teacher who did not turn up and never applied for leave
still leaves five periods uncovered; a teacher `on_duty` at a district meeting
is working, just not here. `half_day` is deliberately *not* away: half a day is
a conversation, not a roster entry.

Nothing on the cover screen marks anybody absent. If somebody has just phoned
in, the register is where that is recorded, and the list fills itself.

---

## The three questions, in the order somebody asks them

| Function | Question |
|---|---|
| `substitution_gaps(date)` | what has nobody in front of it |
| `substitution_candidates(entry, date)` | who is genuinely free for this period |
| `substitution_problems(date)` | what I arranged yesterday that is now wrong |

The third is the one a whiteboard cannot do at all, and it is why this is worth
building rather than printing.

**"Free" is four conditions**, and every one has bitten a school that worked it
out on paper: not away themselves; nothing of their own scheduled in that
period; not already covering something else in that period; and not the person
being covered for. Ranking — subject first, then whoever is carrying the fewest
covers today — is **advice**, not a rule. Every eligible person is returned,
because a head of department overruling the order is the normal case.

Condition three is checked in the candidate list *and* enforced by a partial
unique index. Offering somebody and then refusing them is a worse screen than
not offering them, and a check without the index is a race between two people
doing the roster together.

---

## An arrangement with nobody in it is still an arrangement

`substitute_staff_id` is nullable and null is a **real answer**: "merged into
5B", "supervised study". The gap is the *absence of a row*, not a row with no
substitute. Collapsing the two would make the morning list wrong in the
direction that leaves a class unattended — so the schema allows it, the screen
offers it as a button, and `substitution_problems` lists it as `info` so it
still gets read out.

---

## What the composite-key device cannot do here

`substitutions` carries `absent_staff_id` and `time_slot_id` as **frozen
copies**, not as keys into the live `timetable_entries` row. That is a
deliberate departure from the pattern the rest of this codebase reaches for
first, and migration `0155`'s header records why. Both alternatives are worse:

- **With `on update cascade`** — reassigning Monday period 3 to a different
  teacher next term rewrites last October's substitution, so the record now
  names somebody who was not there.
- **Without the cascade** — the same reassignment is *refused*, because old
  rows still point at the old teacher. The timetable becomes uneditable to
  protect a record of a morning nobody is looking at.

The rule that came out of it:

> The composite-key device ties a child to its parent's **current** state. A
> row that records what was true on a day is not that child. Freeze the values
> and check them in the write function instead.

`substitution_arrange` is where the checks live, and each refusal is a sentence:
*"Aditi Agarwal is not marked away on 7 Sep 2026"*, *"That lesson is not taught
on a Tuesday"*, *"Dhruv Bansal is already covering another class in that period
on 7 Sep 2026"*. The last one is a translated `23505` — the raw text is
`duplicate key value violates unique constraint
"substitutions_one_class_per_period"`, which is not something to show a person
at half past seven in the morning.

The freezing is also what makes one of the critic's findings possible at all:
*"…but now teaches their own class in that period. The timetable changed after
this was arranged."* Comparing the frozen slot against the live lesson is
exactly what detects that the two have diverged.

---

## The same screen answers two different questions

This is the module's second finding, and it is a general one.

`substitution_gaps` returns **nothing at all** to a teacher. Not an error —
nothing. It is derived from `staff_is_away`, which reads `staff_attendance`,
and RLS there is row-ownership: a teacher may read their own register row and
nobody else's. Probed both ways against the demo tenant:

```
as admin    substitution_gaps() -> 4 rows   staff_attendance -> 51 rows,
                                                across every member of staff
as teacher  substitution_gaps() -> 0 rows   staff_attendance -> 51 rows,
                                                across exactly 1
```

> An INVOKER function that derives its answer from a table with
> **row-ownership** RLS does not refuse a narrower caller. It answers them,
> with a smaller number, and the number is plausible.

A permission error is loud. *"No cover needed today"* is quiet, and it is what
a teacher would have been shown every morning.

The fix is not to widen the policy — who is off sick is a fact about them, not
about a colleague's day. It is that a teacher's question is genuinely a
different one: **"where do I have to be"**, answered by
`substitution_my_covers`, which reads `substitutions` directly (every member of
staff may, by the policy in `0155`) and never asks who is away.

So the page gates the office's half on `substitutions.manage` and shows the
teacher's half to everybody. Showing the same empty list to both would have
been the worst of the three outcomes, and the one nobody would report as a bug.

---

## Permissions

| Code | admin | teacher |
|---|---|---|
| `substitutions.view` | ✓ | ✓ |
| `substitutions.manage` | ✓ | |

There is deliberately no `substitutions.decide`. Cover is **directed, not
requested** — pretending otherwise means a class with nobody in front of it
while an approval sits unread.

RLS on the table matches: every member of staff may `select`; only an
administrator may write.

---

## The report

`timetable.substitutions` — *Cover arranged*. Reads every column off the
substitution row rather than the live lesson, for the reason above, and filters
by a teacher on **either** side of the arrangement: "show me Priya's term"
means both the days she was away and the days she covered for somebody else.

Adding it needed one new parameter control type, `staff`, which is now
available to any report. Two other things were corrected while adding it: the
Class dropdown on `/reports` listed every session's sections side by side, two
"Grade 4 A" and no way to tell them apart — the same fault migration `0128`
fixed on the dashboard, in the other half of the codebase.

---

## Verified

Against the demo tenant, driving SQL with JWT claims set, cleaned up afterwards:

- a teacher marked absent → their four Monday lessons appear in
  `substitution_gaps`, ordered unarranged-first by period;
- `substitution_candidates` excludes the absent teacher, everybody teaching
  their own class in that period, and everybody already covering;
- arranging succeeds; a second arrangement for the same substitute in the same
  period is refused **by name and date**, not by constraint number;
- the same person *is* offerable for a different period on the same day;
- wrong weekday → *"That lesson is not taught on a Tuesday"*;
- teacher not away → *"…is not marked away on 7 Sep 2026. Approve their leave
  or mark the register first."*;
- all three critic branches fire — leave cancelled under a standing
  arrangement, substitute now away themselves, class deliberately left with
  nobody;
- as a teacher: `substitution_gaps()` → 0 rows, `substitution_my_covers()` →
  the one cover, with the room and who it is for;
- `schema_guard_violations()` → empty.
