# Invitations — naming the person a login is for

**Migrations** `0224` (`roles.subject`, the composite key, `invite_candidates`,
the critic), `0225` (the trigger that fills the carried column), `0226` (number
agreement), `0227` (telling somebody), `0228` (the session the new writer
forgot), `0231`–`0232` (a whole school at once).
**Screens** `/settings/team`, `/settings/team/bulk`. **Permission**
`users.manage`. **Guard** `tests/settings/invitations.test.ts`.

---

## The gap

`0221` made 555 guardians writable. This is the question one step along, and the
answer measured on the demo college was stark:

| | |
|---|---|
| guardians | **555** |
| guardian logins | **0** |
| student logins | **0** |
| logins in total | 2, both administrators |
| notification deliveries | 2, ever |
| registered devices | 0 |

**The database had been ready since `0004`.** `invitations` carries `person_id`,
`student_id`, `staff_id` *and* `guardian_id`; `handle_new_auth_user` resolves all
four and stamps them onto `user_profiles`; the server action accepted all three
ids and inserted them.

`team-view.tsx` mentioned `guardianId` **zero times**. It sent an email address
and a role.

So an administrator inviting somebody as *Parent* created a login with
`guardian_id = null` — and the policies are not ambiguous about what that means:

```
parents view own children   ... up.guardian_id = gs.guardian_id
students view self          ... id = up.student_id
teachers view own section   ... up.staff_id = s.class_teacher_staff_id
```

Null on either side and the policy matches nothing. The family signs in, every
query is correct, and every answer is nothing. `0205`'s lesson one layer along:
*a JWT minted before a tenant existed does not have one*, and a profile minted
without a guardian is not one.

**Read the other way, the policies also say why it stayed invisible.**
`admins manage students` and `staff roles view students` compare the role code
alone, so an administrator works with nothing attached. The only seats that
break are the ones nobody in this codebase had ever signed into.

## What a role stands for is a column, not a branch

`roles.tier` (migration `0208`) groups the picker and cannot answer this:
`parent` and `student` share the `student` tier and need *different* records. A
`case role.code` in TypeScript would be this product's six roles hardcoded —
exactly what `0208` refused for the tier.

`roles.subject` — `staff | student | guardian | none` — carries the same warning
as its neighbour:

> **A subject decides what an invitation must name. It never decides what the
> holder may do.** That stays `role_permissions`, editable per college.

`admin` is `staff` rather than `none`: a principal is employed by the school, and
letting their login attach to nothing is how *"my pay"* and *"my leave"* quietly
return nothing for the one person who would never think to report it. The
founding principal is unaffected — `platform_start_school` writes
`user_profiles` directly and touches `invitations` not at all (checked, not
assumed).

## The composite-key device's sixth use, carrying a *requirement*

A CHECK cannot reach `roles`, so:

```sql
invitations (tenant_id, role_id, role_subject)
  -> roles  (tenant_id, id,      subject)      on update cascade
```

One key does three things:

- `role_subject` is held equal to the role's own, so the CHECK can ask about
  `roles` without joining to it;
- `tenant_id` in the key closes a hole nobody had noticed —
  `invitations_role_id_fkey` referenced `roles(id)` alone, so an invitation
  could name **another college's role**. Not a leak: the tenant in the JWT comes
  from `inv.tenant_id`, and a foreign role code absent from this college's
  matrix is refused everywhere by `role_has_permission`. It fails closed. It is
  closed here because the device needed the key anyway;
- `on update cascade` means changing what a role stands for rewrites its
  invitations and re-evaluates the CHECK.

**The CHECK applies while the row is still a promise** — `status <> 'pending'`
exempts accepted and revoked rows. That is load-bearing in both directions:
history is not rewritten by a decision taken today, and changing a role's
subject is refused only while *pending* invitations contradict it, which is
recoverable by revoking them rather than by a constraint error on a row from two
years ago.

### …and a carried column needs a writer

`0224` shipped the key without one, and the probe meant to demonstrate it
refused a **correct** insert:

```
insert into invitations (tenant_id, email, role_id, guardian_id)
  values (..., <the Parent role>, <a guardian>)
-> 23514  invitations_subject_present
```

`role_subject` defaults to `'none'`, so an insert that does not mention it says
*this role stands for nobody* about a role that stands for a guardian.

> **A carried column is a copy, and a copy needs somebody to write it.** In the
> device's five earlier uses the child carries either a constant the writer
> already knows (`slot_schedulable` is always `true`) or a value it is holding
> anyway (`marks.max_marks`). This one is neither: it is a fact about the
> *parent row*.

Making every caller look it up is a second copy of the rule in every writer, and
**a plain insert through PostgREST routes around any function** (`0205`), so it
cannot live in a write function either. `0225` is a `BEFORE INSERT OR UPDATE`
trigger, and the split of responsibility is the point: the trigger **populates**,
the key and the CHECK **enforce**. A trigger dropped by a later migration makes
writes fail rather than letting a wrong value through — which is what keeps this
consistent with rule 4 rather than an exception to it.

It also buys a readable refusal for the cross-tenant case: the composite key
answers a foreign role with an error naming three columns; the trigger gets
there first and says *"That role does not belong to this school."*

## One field, not three

`inviteSchema` takes a single `subjectId`. **The role decides which column it
lands in**, server-side — so the client cannot put a student's id into
`guardian_id`, and there is no three-way "exactly one of these" rule in the
browser to get wrong. The action reads the role's subject from the database
first, so a missing choice is a sentence (*"Whose parent or guardian is this
login for?"*) rather than `23514`: a control that will refuse you is worse than
no control.

`invite_candidates(subject, query)` is one read model for all three kinds —
three server-side searches would be three places to forget the permission check.
`SECURITY INVOKER` so RLS decides, **and** gated on `users.manage` inside
besides, because reading `people` is tenant-wide for every staff role and the
policy alone would let a librarian enumerate the roll through a picker.

`has_login` is the half a person actually needs. Inviting somebody who already
signed in is the common mistake and it is silent — the second invitation
supersedes the first and nothing looks wrong — so it is a warning beside the
name rather than a refusal: a second login for one guardian is a decision a
school is allowed to make.

## Probed end to end, from a seat nobody had used

In a rolled-back transaction: the office invites, the person signs up (which
fires the real `handle_new_auth_user` trigger), and then the product is read as
them.

| step | result |
|---|---|
| the office invites | Yash Bansal, guardian of Dhruv Bansal |
| they sign up | role `parent`, `guardian_id` set |
| JWT stamped | `parent`, tenant `2d15d1fc` |
| the invitation | `accepted` |
| their children | **1** |
| named | Dhruv Bansal (father, Grade 1 A) |
| fee account | charged 15,900.00 − discounts 2,880.00 − paid 11,520.00 = **due 1,500.00** |
| `students` readable | **1 row**, of 302 |
| `notices` readable | 1 |
| `timetable_entries` readable | 276 |
| `staff` readable | **0** (migration `0183` dropped that policy) |
| `audit_log` readable | **0** |

And the constraint, probed the same way: a Parent invitation naming nobody is
`23514`; naming a *student* is `23514`; naming a guardian succeeds with
`role_subject` filled in as `guardian`; a teacher invitation naming staff
succeeds; another college's role is refused in a sentence.

## The critic

`family_login_problems()` — catalogued as `users.family_logins`, so it is
reachable from `/checks` rather than from one screen. On the demo college:

> **302 of 302 active students have nobody who can sign in: no fee account,
> timetable, result or absence notice reaches their families.**

The count is of **children whose whole family cannot sign in**, not of
guardians, because the family is the unit a school thinks in and one parent with
a login is enough. Silent once every family has one.

### …and it shipped the grammar error CLAUDE.md warns about

The first version ended *"reaches those family."* Subject agreed, verb agreed,
last noun did not — `0196`'s lesson, written by somebody who had read the
paragraph about it, which is the useful part: the rule is easy to half-apply
because the first two agreements are the ones you are looking at while you write
the `case`.

`0226` also fixed an agreement the first draft had not noticed at all: there are
**two counts in one sentence**, and the noun agrees with the total while the verb
agrees with the numerator.

```
  1 of 302 active students has  ...
302 of 302 active students have ...
  1 of 1   active student  has  ...
```

Both forms are carried rather than derived, because English plurals are not
derivable and *family/families* is exactly the pair that proves it.

## What it cost

| `/settings/team` | First Load JS |
|---|---|
| before | 149 kB |
| with the picker importing `platform.ts` | **176 kB** |
| after splitting the prompts out | **150 kB** |

Twenty-six of those twenty-seven kilobytes were **Zod**, pulled in because
`SUBJECT_PROMPT` lived beside `inviteSchema`. That is `fees-display.ts`'s split
made a second time, and CLAUDE.md already warns about it in the words that now
head `invitations-display.ts`: *one `import { z }` and it silently becomes the
thing it was extracted from.* The whole picker costs **1 kB**.

## What it deliberately does not do

- **No email is sent.** An invitation is a row; `handle_new_auth_user` resolves
  it on signup. Sending the address a link is the notifications module's job and
  needs a decision about which channel a not-yet-user can be reached on.
- **A guardian may be invited twice.** Two logins for one guardian is a real
  arrangement — two parents sharing one guardian record is not — so the screen
  warns and does not refuse.
- **`person_id` is not offered.** It is the fourth column
  `handle_new_auth_user` resolves and there is no role that stands for a bare
  person; adding one to the picker would be a fourth kind with no caller.

---

# Telling somebody they were invited

`0224` made an invitation able to name a person. It was still a row in a table
the named person had no way of knowing existed. Swept across `src/` and
`supabase/functions/`: **nothing sent an invitation.** The only two mentions of
the word outside this module are interface copy telling somebody to *ask* their
administrator for one.

An office wanting its 555 families online told 555 families by hand.

## The audience could not express it, again

`0219` found five declared events that were never raised, and the reason was not
neglect — `notify_resolve_audience` could not say *"this child's family"*, so a
receipt could not be addressed, so it was never sent. This is the same sentence
one step further out:

> `notify_resolve_audience` returns `TABLE(user_id uuid)` and every branch of it
> reads `user_profiles`. **An invitee is, by definition, not a user.** There is
> no `kind` that could be added to fix this, because the function answers *which
> of our people* and an invitation is addressed to somebody who is not one yet.

So the resolver was **not** widened. Widening it would mean a branch returning
null ids through a function typed to return ids, and every existing caller
learning to cope.

## …and the delivery table was already ready

Read before designing anything, and it settled the shape:

| | |
|---|---|
| `notification_deliveries.recipient_user_id` | **nullable**, with an `address` column beside it |
| `notify_claim_deliveries` | joins channel settings, notifications and the type catalogue — **never `user_profiles`** |
| `notify-dispatch` | reads `delivery.address`, and already fails permanently when it is empty |

A delivery to a bare address therefore drains through the existing dispatcher
with **no change to the Edge Function at all**. That is rule 10's bargain paying
out: one table and one dispatcher means a new *kind of recipient* is also a
driver-free change.

`invitation_announce` is `SECURITY DEFINER` for the reason rule 10 already gives
— `notification_deliveries` has no INSERT policy at all — and is gated on
`users.manage`, the permission that draws the screen it is called from.

**`in_app` is deliberately not a default channel for this event.** The recipient
has no account to open. A queued in-app message for somebody who cannot sign in
is the queue-that-can-never-drain this codebase already refused once for
WhatsApp. `stale_after` is 7 days: a week-old invitation email is not worth
sending when a channel is finally switched on.

## The URL is a fact about the deployment

Postgres has no idea what this deployment's address is, and a setting would be a
second copy of what the request already carries. It is a parameter: the server
action reads `origin`, or the forwarded host and protocol behind a proxy, and
**returns null rather than guessing** — an email containing `undefined/signup`
is worse than an invitation nobody was told about. `invitation_announce` checks
it is an `http(s)` URL rather than pasting it into an email unread.

A raiser still writes its own words. Only the hostname comes from the caller.

## Probed

| step | result |
|---|---|
| a non-URL (`javascript:alert(1)`) | *"The sign-up address is not a web address"* |
| announced | 1 delivery queued |
| the delivery | `email -> probe.invitee@example.test`, **recipient_user_id NULL**, queued |
| an administrator claiming deliveries | `42501` — the dispatcher's function is not theirs |
| a revoked invitation | *"That invitation was already revoked"* |
| as a teacher | *"Your role cannot invite people to this school."* |

And the body, rendered:

> Hello Yash Bansal,
>
> Rajesh Kumar Mahavidyalaya has invited you to create a login as Parent.
>
> Go to https://school.example.com/signup and sign up with this email address —
> probe.invitee@example.test — and no other. The invitation is open until 28 Sep
> 2026.
>
> If you were not expecting this, you can ignore it: nothing happens until
> somebody signs up.

**The claim returned 0 at first, and that is the channel rather than the
delivery** — this school has email `is_enabled=false, provider_configured=false`.
The control that proves it: switching the channel on inside the same rolled-back
transaction, the dispatcher claims **2** — the invitation and one older queued
message that had been waiting. *A held channel keeps its queue*, demonstrated
rather than quoted.

## A failed email is not a failed invitation

The notice board's rule, at the invitation screen: the row is the mechanism and
the email is the courtesy, so a school whose email channel is off must still be
able to invite people and tell them by hand. The action returns
`{ emailed, emailError }` beside the success, and the toast says **three** facts
— who was invited, who the login is for, and whether the email went. Saying only
the first is how a school comes to believe four hundred families were told.

*Send again* is drawn only on a **pending** invitation, because
`invitation_announce` refuses an accepted or withdrawn one and a button that
will refuse you is the same defect one click along.

## `invitations.token` is gone

It had existed since `0004` and was referenced **nowhere** — not in one
migration, not once in `src/`. `handle_new_auth_user` matches a signup to an
invitation **by email**, so the token authorised nothing.

`0220`'s rule decides it: a column recording an intention with no executable
half is the defect, not the safeguard. And the specific danger of keeping it is
that it is exactly the sort of thing somebody puts in a link — **a token that
authorises nothing must never appear in a URL**, because a link that looks like
an invitation link and is not one is worse than no link.

What it would take to make it real, written into the migration so nobody re-adds
it blindly: the signup form would pass it through `options.data`,
`handle_new_auth_user` would prefer `raw_user_meta_data ->> 'invitation_token'`
over the email match, and it would still have to check the email agrees — which
is the match it already does.

## Two mistakes, both caught by probing

- **`0227` forgot `session_id`.** `notifications` carries it `not null` because
  rule 2 says every transactional table does, and `notify_send_for` — the
  table's only other writer — has supplied it since the module shipped.
  *Rule 1's "every table carries `tenant_id`" has a rule-2 twin, and a new
  writer inherits both.* Reading the table would have said so; reading the
  existing writer would have said so. `0228` adds it, and `created_by` with it,
  so the trail names the administrator rather than the definer function.
- **The guard anchored on `lastIndexOf` of a function's name** — which finds the
  `comment on function` that comes *after* the body, so the slice contained
  nothing and the assertions passed on emptiness. CLAUDE.md records this exact
  bug from the `0219` guard. Writing it again is why it is now a
  `functionBody()` helper anchored on `create or replace function` rather than
  an inline `indexOf` at each call site.

  A second instrument bug in the same commit: a non-greedy
  `insert into reference.notification_types[\s\S]*?;` run over *every migration
  concatenated* started at an earlier file's insert and swallowed everything up
  to this one, so an `in_app` assertion failed on somebody else's CHECK
  constraint. It reads the one migration now.

## Still not built

- **An SMS invitation.** All 555 guardians have a phone number as well as an
  email, and the delivery table would take it unchanged. What stops it is that
  the body is 340 characters and an SMS is not; that is a second message, not a
  second channel on the same one.

---

# Inviting a school (migrations `0231`, `0232`)

`0224` made an invitation able to name a person and `0227` made it arrive. Both
work on **one** invitation, and the demo college has 555 guardians of 302
children. An office asked to do that through a search box 555 times will not do
it — which leaves the family half of this product unreachable in practice,
however correct each single invitation is.

Rule 13's third instance after promotion and renewals, and all four of its
devices transfer unchanged.

## One definition of "make an invitation"

The single-invitation screen supersedes any earlier pending invitation to the
same address before inserting — *"the same intent, expressed twice, usually
because the first mail went astray"* — and that rule lived in a server action. A
bulk apply that inserted rows would be a second implementation of it, and the
two would differ the first time either changed.

`invitation_create` is that definition and **both callers use it**. Rule 6's
billing sentence, applied a third time.

## The preview decides nothing a person cannot see

Every row arrives as `invite` or `skip` **with the reason on it**, and each of
the three reasons is a fact the office would otherwise discover one at a time:

| reason | why it matters |
|---|---|
| No email address on record | there is nothing to send to |
| Already has a login | inviting again makes a second account, silently |
| Already invited, and that invitation is still open | re-sending is the *Send again* button, not a second row |

**None of them is a refusal.** A person can type an address, or decide they do
want a second login, and `is_override` records that they did — the difference
between *"the rules decided"* and *"the office decided"*, which is what an audit
trail is for.

## One row per address, not per person and not per child

Two `distinct on`s, and both are load-bearing:

- the inner one is **per guardian**, because a mother of three is one invitation
  and not three;
- the outer one is **per email**, because in a great many families both parents
  give the school one address — and an invitation is addressed to an address, so
  a second row for the same one collides with
  `invitation_decisions_one_per_address` and takes the whole preview down with
  a `23505`.

Rows with no address fall back to the person's own id, so each keeps its place
in the list — they are exactly the rows the office needs to see.

## Probed

The whole school, as an administrator, in a rolled-back transaction:

| step | result |
|---|---|
| whole-school preview | **555 rows**, all `invite` |
| a second live list | *"There is already an invitation list waiting. Finish or discard it first — two half-corrected lists of the same people disagree."* |
| apply | **555 invited, 0 failed, 555 emailed** |
| invitations afterwards | 555 pending |
| deliveries queued | 555 |
| run | `applied`, `applied_by` set |
| applying twice | *"This list was already applied"* |

**The demo data has 555 distinct addresses, so neither the dedupe nor any skip
reason was exercised by it** — which would have left three quarters of this
module unverified. Planted instead: two guardians sharing `one.family@example.test`,
one with no address, one already invited, and one with a login.

```
rows by decision   invite 552, skip 2
skip reasons       Already invited, and that invitation is still open × 1
                   No email address on record × 1
the shared address 1 row, from 2 guardians who share it
total rows         554  (555 with no duplicates)
```

…and with a planted login, the third reason: `Already has a login × 1`.

## Bounds

- **Refuse, do not truncate.** Past 1,000 people the preview declines and says
  the number, because a list that quietly held the first thousand of fourteen
  hundred would look complete and the families left off it would be discovered
  by their absence in April.
- **One live list per school**, as a partial unique index — two half-corrected
  previews of the same people disagree, and whichever is applied second silently
  wins. The index would refuse with `23505`, so the function says it in words
  first.
- The apply is a few hundred short statements whose result is a screen somebody
  argues with, which is rule 7's promotion argument unchanged.

## What it deliberately does not carry

A decision names a guardian, a student or a member of staff, and which is right
depends on the *role's* subject — one table away, which is where rule 4 says to
reach for the composite key.

It does not, because **the boundary already refuses the bad row one layer
down**: `invitations_subject_present` (`0224`) will not accept an invitation
whose subject does not match its role, so a decision naming the wrong kind fails
at apply with that constraint's own sentence and lands in `error` beside the
row. Carrying `role_subject` a third time would buy a slightly earlier refusal
and a third copy to keep in step.

The run *does* carry it, by the same composite key — and by **the same trigger
function** `0225` installed for `invitations`, which works here unchanged
because it reads `new.tenant_id`, `new.role_id` and `new.role_subject` and this
table has all three. Two instances of the device, one implementation.
