# The platform operator

*Migration `0209`. Screen: `/platform`. Guard:
`tests/platform/operator-boundary.test.ts`.*

Rule 1's whole argument is that the policy is the boundary and application code
cannot be. A console that reads across colleges is, on its face, the one thing
that argument forbids — so this was refused twice in `docs/modules/saas.md`
before it was asked for, and it arrives as its own migration with its own schema
rather than as a policy exception bolted onto `subscriptions`.

There are now **two** things the word "superadmin" could mean, and they are not
the same job:

| | belongs to | sees | gate |
|---|---|---|---|
| **principal** | one college | everything in that college | `roles.tier = 'principal'` + the permission matrix + RLS |
| **operator** | no college | counts and plans about every college | `platform.require_operator()` inside four definer functions |

A principal is a tier (see `docs/modules/saas.md` and rule 4's note that a tier
is presentation, never the gate). An operator is not a role at all — there is no
row for them in `roles`, no permission code, and no policy anywhere mentions
them.

## The property the whole design rests on

> **An operator has a login and no tenant.** So `current_tenant_id()` returns
> null for them, and every RLS policy in `public` already refuses them every
> row.

Nothing was weakened to allow this console to exist. To the rest of the
database an operator is exactly the tenantless caller rule 3 calls "the correct
failure mode" — and their entire reach is the four `SECURITY DEFINER` functions
in `0209`.

Probed live, signed in as an operator through PostgREST rather than in a `DO`
block:

| probe | result |
|---|---|
| `platform_colleges()` | 2 colleges, e.g. `Rajesh Kumar Mahavidyalaya: premium/active students=302 staff=14 logins=2` |
| `select … from students` | **0** |
| `select … from people` | **0** |
| `select … from ledger_entries` | **0** |
| `select … from subscriptions` | **0** |
| `select … from platform.operators` | refused: `permission denied for schema platform` |

…and the same functions as a college principal:

| probe | result |
|---|---|
| `platform_colleges()` | refused: *"This is not available."* |
| `platform_set_plan(…)` | refused |
| `platform.access_log` after both | 2 rows, action `colleges.list` |

The direct-read refusal is the one worth reading twice. `revoke all on schema
platform` means even an operator cannot select from the operator tables: the
functions are the only door, and a stray `select * from platform.operators`
added by a future migration fails at the schema rather than at a policy somebody
forgot to write.

## Metadata only, and that is a decision

Colleges, plans, usage counts, health. **No student row, no guardian, no
invoice, no mark, no attendance record**, and none of them reachable by adding a
`where` clause — they are not in the projection at all.

> It is the decision that makes the blast radius of a mistake here **counts**
> rather than **children**.

"Is this college alive?" is answered by `max(audit_log.created_at)` — the
*timestamp* of the most recent audited change and never the change itself. That
is the shape to copy when the next health signal is wanted: a question about
whether a college is using the product, answered without reading anything the
college wrote.

**Support impersonation is deliberately not built.** Entering a college and
seeing what a principal sees needs consent, a time limit, and an audit trail the
*college itself* can read. Bolting it on later must be a migration that argues
for itself, not a quiet `or is_operator()` added to sixty policies.

## Every look is written down, before it is answered

`platform.require_operator(action, tenant, detail)` refuses a non-operator and
inserts the access-log row **before** the function produces its answer, so a
query that errors part-way still leaves a trace that somebody asked.

`platform.access_log` is append-only by **revoke**, not by an absent policy —
rule 6's stronger of the two shapes, chosen because this table is the record of
what the platform's own staff did and a write here should raise rather than
silently match nothing.

Two things it deliberately does not log:

- **`platform_am_i_an_operator()`**, which fires on every request to `/platform`.
  An access log padded with routing checks is one nobody reads.
- **anything about a college's data**, because there is none to log.

## The refusal says nothing

`require_operator` raises the same flat sentence — *"This is not available."* —
whether the caller is a principal, a student, or a session belonging to nobody.
A message that distinguished them would be a way of asking the database which
addresses are operator accounts.

The page carries the other half of that: `listColleges()` returns
`College[] | null`, and **null is not an empty array**. One means *you should not
be here*; the other means *there are no customers yet*. They are different
screens.

## An operator cannot also own a college

`platform_start_school` authorises on *"the caller has no tenant"* — and an
operator has no tenant. Without a second predicate an operator could provision a
college, become its principal, and hold both identities at once.

> Dual identity in an authorisation system is how a boundary quietly stops being
> one.

So it is refused in a sentence: *"This login runs the platform and cannot own a
college on it. Use a separate account."*

## Routing is not authorization

`/platform` lives outside the `(app)` route group, because it has no tenant and
therefore no academic year, no permission matrix and no school name to put in a
sidebar; rendering it inside the school shell would mean inventing all four.

The middleware allows a **tenantless** session to reach `/platform` — otherwise
the `/start` redirect would send every operator to a form inviting them to found
a college — and deliberately does **not** ask whether this particular session is
an operator. That would be a database round trip in front of every request, and
it would be the wrong place for the decision anyway. The gate is
`require_operator()` inside each function; the page renders what it was allowed
to fetch.

## The guard

`tests/platform/operator-boundary.test.ts` reads the migrations rather than the
database, so it runs anywhere. Four properties, each of which would silently
undo the design:

1. **No `grant` reaches the `platform` schema for `anon`, `authenticated` or
   `public`** — excepting `grant execute on function public.platform_*`, which is
   exactly how the console is reached. A grant here would turn the operator
   tables into ordinary readable data and make the definer wrapper decorative.
2. **No `create policy` mentions an operator.** The tempting shortcut is
   `or platform.current_operator() is not null` added to a policy so an operator
   "can just see it" — which would hand them every row of that table in every
   college, invisibly, since the policy still reads as if it were tenant-scoped.
3. **Every `public.platform_*` function calls `require_operator()`**, except
   three that answer a question about the caller alone
   (`platform_am_i_an_operator`, `platform_slug_available`,
   `platform_start_school`). One that did not would be open to every signed-in
   person on the deployment.
4. **The access log keeps its explicit revoke.**

Verified by planting each violation and watching the test name the file and
quote the line, then go green again on revert. The fourth one is why the file
strips comments first:

> The first draft read the raw SQL, so **commenting the revoke out left the
> check green**. A guard that a `--` disarms is a guard that reports on the prose
> rather than on the schema.

## Adding an operator

There is no screen, deliberately: an operator account is created by somebody with
database access, which is the same set of people who could grant it anyway.

```sql
insert into platform.operators (user_id, email, name)
select id, email, 'Full Name' from auth.users where email = 'ops@example.com';
```

The login must already exist (sign up first), and it must **not** belong to a
college — check `raw_app_meta_data ->> 'tenant_id'` is null before inserting, or
the operator will carry a tenant and every RLS policy will start answering them.

Switch one off with `is_active = false` rather than deleting the row, so the
access log keeps pointing at a name. Same instinct as a revoked concession
keeping its credits.
