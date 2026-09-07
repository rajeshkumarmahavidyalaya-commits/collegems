# Audit — what happened, who did it, and what the log could not say

**Migrations** `0008` (the trigger), `0162` (coverage guard + two missing
triggers), `0163` (the read path), `0164` (report + permission).
**Guard** `audit_guard_violations()`. **Report** `settings.audit_trail`.
**Component** `src/components/audit/audit-trail.tsx`.

Rule 9 got the writing right in migration `0008` and then stopped. Two things
were wrong with that for six months, and neither would ever have announced
itself.

---

## The log had holes, and holes are silent

Eighty-seven of the ninety-three tables in `public` carried an audit trigger.
Six did not. Nothing in the codebase, the tests, or the schema would have said
so.

> An audit log with holes in it is worse than no audit log. It answers *"who
> changed this"* with silence, and silence reads as *"nobody did"*.

`audit_guard_violations()` is rule 9's executable half — the third guard, beside
`schema_guard_violations()` (shape) and `privilege_guard_violations()` (grants).
Three functions rather than three columns on one, because they fail for
different reasons and a caller should be able to ask one question.

Of the six, four were deliberate and are now written where the code can see
them, and two were oversights:

| Table | |
|---|---|
| `audit_log` | cannot audit itself — the trigger would recurse |
| `jobs` | a queue; auditing it doubles the write volume of the busiest table to restate what the row says |
| `schedule_runs` | the run register **is** the audit record for schedules — the whole reason `0139` created it |
| `notice_reads` | append-only and revoked; the row is the fact, and there is no later edit to describe |
| `notice_files` | **oversight, fixed.** Attaching or removing a file changes what a circular says |
| `notification_preferences` | **oversight, fixed.** *"I never opted out of fee reminders"* is a dispute, and an opt-out with nobody's name on it cannot settle it |

The test for exempting a fifth table is not "it is noisy":

> A table is exempt when **the row *is* the record** — append-only, written
> once, never edited. Auditing it stores a second copy of a fact that cannot
> change.

`jobs` is the one exemption resting on volume instead. It is called out as such
rather than blended in, because volume is the argument that eventually exempts
everything.

---

## Nobody could read it

24,000 rows, an admin-only policy, and not one caller in the application.
*"Who cancelled that receipt"* was a question this system had the answer to and
no way to ask.

**Every function in `0163` is `SECURITY INVOKER`,** and that is load-bearing
rather than habitual: `audit_log` is a copy of every row in every table, so its
policy is the strictest in the schema and anything that could read it broadly
would be a way around every other policy in the database. A definer function
here would be exactly that hole.

`audit.view` (`0164`) sits beside the policy and is not the same check twice.
The policy expresses what the schema believes; the matrix expresses what this
school decided — and it is what lets a school withhold the trail from one
administrator (a bursar-admin who runs fee collection but should not read the
head teacher's edits) without touching a policy. No non-admin role is offered
it, because a non-admin cannot read the table however the matrix is edited.

---

## `updated_at` is not a change

Every table carries a `set_updated_at` trigger, so `updated_at` moves on every
write without exception. A diff that keeps it reports a change for a write that
changed nothing, and pads every real change with a line nobody wants. Both
observed in the live log before the fix:

```
subjects              update   1 field changed: updated_at      (a no-op touch)
certificate_templates update   2 fields: body, updated_at       (one real edit)
```

`audit_changed_fields` excludes it, and those now read *"Saved with no changes"*
and *"body"*. The exclusion is a list, so the next such column — a search
vector, a cached count — belongs beside it. It is **not** a general "boring
columns" list: `created_at` is absent deliberately, because `created_at` moving
is a fact somebody should see.

An update whose diff is empty gets its own sentence rather than *"0 fields
changed"*, which would send a reader hunting for a change that is not there.

---

## The two ways the log cannot name a person

`actor_id` is `auth.uid()`, which is null whenever there was no JWT. In the demo
tenant that is most of the log — all 6,000 `attendance_records` inserts, 871 of
878 `people` inserts. One blank cell would hide a real distinction:

| | |
|---|---|
| `actor_id` null | nobody was signed in — a seed, a migration, a background job. **Not a person, and never was.** |
| `actor_id` set, no profile | somebody *was* signed in and their login has since been removed. There was a person; this is as close as the record now gets. |

`audit_actor_label` returns **System** and **Deleted login**, and the UI renders
both as states rather than as names. Same instinct as `attendance_coverage`: a
value that cannot distinguish "zero" from "never measured" is a value that lies.

---

## Two surfaces, because there are two questions

Rule 11 draws the line and this module falls neatly on both sides of it:

- **"What happened to *this* row"** has no parameters a person would type and
  belongs beside the record. So it is `audit_history(table, row_id)` and the
  `<AuditTrail>` component, mounted today on `/certificates/[id]` — a
  certificate is a legal record that can be cancelled, which is exactly the case
  the log exists for. `data-print="hide"` keeps it off the printed sheet: it is
  the school's record *of* the document, not part of the document.
- **"What did anybody change on Tuesday"** is a report, so it is a catalog row
  and there is no new screen.

**The component is gated on `audit.view`, and the gate is not decoration.**
`audit_history` is invoker over an admin-only policy, so a teacher calling it
gets an empty list rather than an error — which would render as a panel saying
nothing ever happened to a certificate that has been cancelled twice. That is
migration `0158`'s lesson in a second place: *an invoker function over a policy
the caller fails answers them with a plausible zero, so the page must not ask.*

---

## Two things it deliberately does not do

- **It never joins to the row it describes.** The log outlives the row — most of
  the point of keeping it — so a deleted student's history has to still say what
  it said. Names come out of `old_data`, not out of `students`. Same frozen-copy
  instinct as `substitutions`, for the same reason.
- **A foreign key stays a uuid.** Resolving it would mean a generic function
  joining to an arbitrary table, and the log outlives its rows, so the join
  would often find nothing and tell the reader "unknown" about a record that
  definitely existed. `fieldLabel` therefore keeps the `_id` suffix — dropping
  it would read as *"Substitute staff: 8f3c…"*, a label promising a name beside
  a value that is plainly not one. The suffix is the warning.

---

## Not built

**Retention.** `audit_log` grows without bound and nothing prunes it. That is
correct for now — the table is small and deleting audit rows is a decision with
legal weight, not a maintenance task — but a school five years in will need an
answer, and the answer has to be a policy (how long, for which tables) rather
than a cron job somebody wrote. It belongs with rule 12 when it arrives.

---

## Verified

Against the demo tenant, as an administrator and as a teacher:

- `audit_guard_violations()` → empty, after adding the two missing triggers;
- the two no-op `subjects` touches → `field_count 0`, `changed_fields {}`;
- a real certificate-template edit → exactly `body`, no `updated_at`;
- actor resolves to a name for a signed-in write and to *System* for a seed;
- `report_run('settings.audit_trail', {"action":"update"})` → 2,942 rows, newest
  first, with this session's own edits at the top;
- as a teacher: `audit.view` false, `audit_log` 0 rows readable,
  `audit_history` 0 rows — so the component is gated rather than shown empty.
