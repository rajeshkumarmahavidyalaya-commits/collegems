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
role holds. Six roles × 64 permissions assembled in the browser is three round
trips and a join written in TypeScript; assembled in Postgres it is one row on
the wire.

That is `dashboard_summary()`'s argument and it applies for the same reason —
the screen has no parameters, answers several questions at once, and is glanced
at rather than looked up. It is bounded by construction rather than by a cap:
a college's roles are a handful and the catalogue is a fixed 64 rows, so neither
grows with the size of the school.

`SECURITY INVOKER`, and it shows **any** signed-in member what every role may
do. That is not a leak: `role_permissions` has been readable tenant-wide since
`0005` because `hasPermission()` needs it, and the matrix describes the product
rather than anybody's data. The write is the admin policy, unchanged.

The tier is in the document for one job — the word under each column heading,
so somebody editing knows who a column is *for*. Staff first, families next,
the principal last, because a column of sixty-four ticks is not what anybody
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
