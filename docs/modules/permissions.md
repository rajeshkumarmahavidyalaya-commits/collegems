# The permission matrix, finally editable

*Migrations `0211` and `0212`. Screen: `/settings/permissions`. Guard:
`tests/auth/keystone-permission.test.ts`.*

Rule 4 opens with *"Authorization is two layers"*, and the second of them has
been read from the application since migration `0005` and **written by
nothing**. `hasPermission()` reads it, every nav entry and every button consults
it, and there was no screen, no server action and no RPC that could change a
single row of it.

So rule 4's own sentence — *"a school can grant a teacher `students.manage` any
Tuesday"* — was not true of this product. It was true of somebody holding a
`psql` session.

That is the failure this codebase keeps naming from the other direction: a
correct write path nobody can call. Here the write path was a *policy* —
`admins manage role_permissions`, in place since `0005`, correct the whole time
— and what was missing was a caller.

## What this screen is not

- **Not the boundary.** RLS is, and every policy in the schema compares
  `current_role_code()` rather than the matrix. Clearing every box exposes no
  row; ticking every box hands nobody another college's data. What changes is
  what the product *offers*.
- **Not a role editor.** Roles are per-college rows and a college may add its
  own later. This edits what the existing ones may do; a seventh role is a
  different decision with a different screen.
- **Not gated in TypeScript.** `setPermission` has no permission check of its
  own, deliberately. Probed live as a teacher: the same delete touched **0
  rows** — the count rule 6 asks you to assert, rather than the error it does
  not raise.

## One call, because a grid is a dashboard

`permission_matrix()` returns one jsonb document: this college's roles with
their tiers, the permission catalogue grouped by module, and which codes each
role holds. Six roles × sixty-odd permissions assembled in the browser is three
round trips and a join written in TypeScript; assembled in Postgres it is one
row on the wire.

That is `dashboard_summary()`'s argument and it applies for the same reason —
the screen has no parameters, answers several questions at once, and is glanced
at rather than looked up. It is bounded by construction rather than by a cap:
a college's roles are a handful and the catalogue grows only when somebody
writes a migration, so neither grows with the size of the school.

`SECURITY INVOKER`, and it shows **any** signed-in member what every role may
do. That is not a leak: `role_permissions` has been readable tenant-wide since
`0005` because `hasPermission()` needs it, and the matrix describes the product
rather than anybody's data. The write is the admin policy, unchanged.

The tier is in the document for one job — the word under each column heading,
so somebody editing knows who a column is *for*. Staff first, families next,
the principal last, because a column of sixty-odd ticks is not what anybody
came to read.

## The one box that cannot be cleared

`users.manage` draws this screen, and `platform_start_school` gives it to
exactly one role. Clearing that box leaves the matrix editable only from a
database console — which a college does not have.

> Ending a relationship and refusing to make a new one are two different jobs.
> Here they are the same edit, and the second one is a door closing behind you.

It is refused in two places, and the difference between them is the point:

- **The trigger is the enforcement.** `keep_a_way_back`, `BEFORE DELETE OR
  UPDATE` on `role_permissions`. Rule 4's usual answer for a rule about how many
  other rows exist is a check in the write function — which only works when the
  function is the only way in, and here it is not: the screen writes through
  PostgREST, and **a plain delete through PostgREST routes around any function**
  (the lesson `0205` learned about seat limits). It covers the UPDATE that sets
  `allowed = false` as well, because that is the same act with different SQL.
- **`isLastWayBack()` only draws the lock**, so somebody meets the rule before
  the click rather than after it. It is a copy, which is why it is the half with
  a test.

Probed live, all five behaviours, and the college put back exactly as it was:

| edit | result |
|---|---|
| delete the only `users.manage` | refused, with the sentence |
| set `allowed = false` on it | refused, with the same sentence |
| the same delete, once a second role holds it | allowed |
| an ordinary permission, held by one role | removable and restorable |
| afterwards | 1 role holds `users.manage` |

The message names the consequence rather than the rule, because somebody meets
it while trying to do something reasonable: *"This is the last role that can
open the permissions screen, so taking it away would leave nobody able to give
it back. Grant it to another role first."*

`SECURITY DEFINER` on the trigger function, for the reason
`subscription_enforce_limit` already documents: an invoker function counting
rows counts *the rows the caller can see*. `role_permissions` is readable
tenant-wide, so an invoker count is right today — and would silently start
being wrong the day somebody narrows that policy.

## Why it exists now

`0210`'s critic (`report_audience_problems()`) names reports whose gate
disagrees with who they are written for, and points at `/settings/permissions`
for the repair. Without this screen it would have been a critic whose fix is a
migration — which is the shape of a check people learn to ignore.

---

## One permission doing nine jobs, and five doing none

*Migration `0213`. Guard: `tests/auth/permission-catalogue.test.ts`.*

Making the matrix editable is what turned this from untidiness into a defect.
The checkboxes are now a screen somebody reads and acts on, so the names
on them have to mean what they say — and swept against the code, they had
drifted in **both directions at once**.

### `settings.manage`, twelve times

It was the most-used gate in the product by a factor of three, and nine of its
twelve sites are not settings:

| screen | what the gate actually controls |
|---|---|
| `/academics` | classes and sections |
| `/exams`, `/exams/[id]` | creating an exam, adding papers |
| `/promotion` ×3 | the rollover into next year |
| `/fees`, `/fees/setup`, `/fees/instalments` | fee heads, structures, billing periods |

> **A college could not let its examination officer create an exam without also
> handing them the school's address, its fee heads, its notification channels
> and its invitations screen.** Nobody chose that; it was the gate nearest to
> hand when each screen was written.

`/academics` shows it plainly: `/academics/sessions`, one level down in the same
module, already gated on `academics.manage`. Two screens, one module, two
answers.

Three codes were missing and are added — `exams.manage`, `fees.manage`,
`promotion.manage` — and `/settings/team` moved to `users.manage`, the same
permission that draws this screen, because both answer *"who may sign in to this
college and as what"*.

**The backfill is what makes it a rename.** `0213` grants the three new codes to
exactly the roles holding `settings.manage` today, in every college — not to
`admin` by name, because a college may already have granted it to somebody else
and this must not quietly demote them. Verified per screen, before and after:

| screen | was | now | held before | held after |
|---|---|---|---|---|
| `/academics` | settings.manage | academics.manage | admin | admin |
| `/exams` | settings.manage | exams.manage | admin | admin |
| `/promotion` | settings.manage | promotion.manage | admin | admin |
| fee setup | settings.manage | fees.manage | admin | admin |
| `/settings/team` | settings.manage | users.manage | admin | admin |
| publish results | settings.manage | exams.publish | admin | admin |

Six of six identical. Nobody gains or loses anything on the day it runs.

### …and five codes that decided nothing

Every one of the 64 codes that existed before this migration, grepped across
`src/` and `supabase/`. Five appeared
**only in the migration that seeded them**: `certificates.issue`,
`certificates.manage`, `exams.publish`, `schedules.manage`, `guardians.manage`.

Rule 15's UI note arriving in the authorization layer: *a correct string nobody
renders is not a feature.* A college could tick and untick these five and
nothing anywhere changed.

### What it cost, measured

The boundary was never in doubt — `certificates` INSERT, `exams` ALL and
`schedules` ALL are each `current_role_code() = 'admin'`. This is rule 4's *"the
menu and the boundary must not disagree, and only one of them is load-bearing"*
with the load-bearing half right, and therefore invisible from an
administrator's seat.

`/certificates` had **no gate at all** and the menu offers it to a teacher and
an accountant, over an unconditional *Issue a certificate* button. Probed as a
teacher:

```
preview   succeeded — "This is to certify that Vivaan Verma…"
issue     42501 — new row violates row-level security policy
                  for table "document_sequences"
```

…after choosing a child, a template, a date and two template fields. The serial
counter did not move (2 → 2) and no row was written (1 → 1), so the gapless
sequence is unharmed. That sentence is what a teacher was shown.

`/notifications/schedules` was the same shape for an accountant: every switch
drawn, every click refused.

### Where the fix stops, deliberately

It does **not** make the policies read the matrix. They all compare
`current_role_code() = 'admin'`, so a college that grants `certificates.issue`
to its office clerk is still refused by Postgres — the same raw error, one step
along.

> **Replacing a load-bearing authorization check is a probe of that function as
> several roles, not a tidy-up.** `CLAUDE.md` already says so about
> `role_has_permission`, and the isolation suite that would prove sixty
> rewritten policies safe cannot run in this sandbox.

So today the *matrix* is narrowed to agree with the boundary, which removes the
raw error for every role that exists; the boundary is untouched. Making the
matrix genuinely load-bearing is the next decision, and it is a policy rewrite
with its own probes.

### The guard

Two checks, both reading the source so they need no database:

1. **No code decides nothing.** Codes are parsed from the
   `insert into reference.permissions` statements — not from a list in the test,
   which would be the sixth copy of `library.fine_per_day` — and each must be
   consulted somewhere: an app gate, a report or check's
   `required_permission`, or a policy. Deliberate exceptions go in
   `NOT_YET_A_CONTROL` **with the reason**, and the bar is *the feature is
   unbuilt*, never *we have not got round to the gate*. Two qualify today:
   `guardians.manage` (guardians are read-only everywhere — there is no create,
   edit or link control) and `certificates.manage` (its row means *write and
   retire certificate templates*, and the template editor does not exist).
2. **`settings.manage` stays on settings**, meaning the school's own profile and
   the channel switches.

Both verified by planting the violation — a catalogue row nothing reads, and
`settings.manage` put back on `/exams` — and each named the offender and went
green on revert.

And a measurement mistake worth keeping, because it is this codebase's own
sweep rule again: the first draft of check 1 excluded the whole *file* a code
was declared in and reported **four false positives**. A module's migration
usually seeds its permission and registers the report gated on it a few lines
apart, so `certificates.view` is consulted — eight lines below where it is
declared. Cutting the *declaration* rather than the file asks the question that
was meant.

### A catalogue description is a decision somebody already made

The first draft gated cancelling a certificate on `certificates.manage`, which
reads plausibly. The catalogue row said otherwise, in as many words:
`certificates.issue` is *"Issue and cancel certificates"* and
`certificates.manage` is *"Write and retire certificate templates"*.

> When the code and the catalogue disagree about what a permission means, the
> catalogue is usually the older decision and a coherent one. Read it before
> inventing a better split.
