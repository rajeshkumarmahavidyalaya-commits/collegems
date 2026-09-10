# The SaaS layer

Twenty-five modules, and until migration `0205` no way to become a customer.
Migration `0002` said it in a comment — *"Tenant provisioning (insert / update /
delete) is a privileged, out-of-band operation performed with the service
role"* — and the only `insert into public.tenants` in two hundred migrations
was the demo seed. Onboarding a school meant running SQL by hand.

The same shape, one layer down: `invitations` has carried an *"admins manage
invitations"* policy since migration `0005`, and rule 3 builds the entire signup
path on it — the trigger resolves a pending row by email and stamps the tenant
and role into the JWT. Grepped across `src/`, the table appeared **only in the
generated types**. An administrator could not invite their own office staff.

> This codebase's own sentence, arriving at the front door: **a correct write
> path nobody can call is not a fix.**

---

## Signing up is one form, and the row decides which kind it is

There is no "are you starting a school or joining one?" radio button, because
the answer already exists in the database.

`/signup` creates the login and stops. Rule 3's trigger fires on that insert and
looks for a pending invitation:

- **one matches** — the person is stamped with that school's tenant and role, and
  lands in the app as a teacher, or a bursar, or a parent;
- **none matches** — they get no tenant, which rule 3 calls *"the correct failure
  mode"*. It is. It is also, exactly, the state of somebody who has just decided
  to start a school.

So the tenantless state is not an error to be handled — it is the authorisation
for `/start`. The middleware routes it there, and `platform_start_school` serves
precisely that caller and refuses everybody else:

```sql
if public.current_tenant_id() is not null then
  raise exception 'This login already belongs to a school.';
end if;
```

That one predicate is the whole authorisation, and it gives one school per
login for free.

### The JWT is stale the moment the school exists

`platform_start_school` stamps `raw_app_meta_data`, but the caller's token was
minted seconds earlier, when they belonged to nobody. Every RLS policy reads the
tenant from that claim.

So without a refresh, the person who just created a school is shown an empty
one — every query correct, every answer nothing. The function returns
`refresh_session_required: true` and the server action calls
`supabase.auth.refreshSession()` before redirecting. **A screen that does not do
this looks exactly like a failed provisioning.**

---

## What a new school gets

One call, one transaction:

| | |
|---|---|
| `tenants` | name, permanent slug, timezone |
| `academic_sessions` | the first year, `is_current` — rule 2 means a school without one cannot record anything |
| `roles` | the six of rule 3, as per-tenant rows so this school can add its own |
| `role_permissions` | the same starting matrix the demo tenant seeds |
| `subscriptions` | `trial`, `trialing`, thirty days |
| `user_profiles` | the caller, as administrator |

Two deliberate omissions:

- **No `settings` rows.** `reference.settings_catalog` holds *the* default and
  `setting_value` is the only place one is applied. Seeding them here would be
  the sixth copy of a default that migration `0101` already paid to delete once.
- **`trialing`, not `active`.** The billing callback is what makes a school
  active. A status that claims to have been paid for is how a product loses
  track of its own revenue.

---

## Plans are data, limits are a trigger

`reference.plans` is the fourth catalogue beside permissions, reports and
checks — and outside `public` for the same reason they are: rule 1 requires
every `public` table to carry `tenant_id`, and a plan belongs to no tenant. RLS
is off, writes are revoked by `GRANT`.

`public.subscriptions` is the tenant's own row: `tenant_id not null`, RLS on,
**readable by every member of the school and writable by nobody**. A bursar who
cannot see the ceiling cannot plan for it; an administrator who could edit it
would be setting their own price. The absent write policy is the mechanism, the
same as on `notification_deliveries` and `student_leave_requests`.

Probed as a signed-in administrator of the demo school:

| probe | result |
|---|---|
| existing member starts a second school | refused: *"This login already belongs to a school."* |
| subscriptions readable | **1** — their own, not both tenants' |
| `update subscriptions set plan_code = 'trial'` | **0 rows touched** |
| plan catalogue readable | 3 plans |
| `update reference.plans set price_minor = 0` | refused: `42501 permission denied` |

The third row is the one that needs the count rather than the error. An UPDATE
that no policy matches **succeeds while touching nothing** — so a test asserting
only that it did not raise would pass whatever the policy said. Rule 6 learned
this on `enquiry_follow_ups`; it applies here unchanged.

### Why the limit is a trigger and not a check in a write function

Rule 4's second boundary: a seat limit is a rule about *how many other rows
exist*, and no constraint sees a second row. The module's usual answer is a
check inside the write function under an advisory lock — which is right for a
bus seat, because `transport_assign_student` is the only way a seat is ever
made.

A student is not made that way. Students are created by a server action doing a
plain insert, and **a plain insert through PostgREST routes around any
function**. So the enforcement is `BEFORE INSERT` on `students` and `staff`,
which is the only thing that catches every writer.

It is `SECURITY DEFINER` on purpose, and for the reason this codebase already
documented once: an invoker function counting rows would count *the rows the
caller can see*. A teacher admitting a child would be measured against their own
visible subset of the roll rather than the school's real one. Definer, filtering
by tenant itself — which rule 11 permits precisely here, because inside a
definer no policy runs and that predicate *is* the isolation.

Measured end to end on a freshly provisioned school:

```
1 provisioned    ok, trial ends 2026-10-09
2 what it got    roles=6 admin_perms=64 sessions=1 plan=trial/trialing
                 admin_profile=1 jwt=<tenant stamped>
3 fill the trial ok, 50 admitted
4 the 51st child refused: "The trial plan covers 50 students, and this school
                 already has 50. Upgrade the plan to add more."
```

The numbers are in the message, per rule 4. *"Limit exceeded"* tells somebody
standing at an admission desk nothing they can act on.

### Three states on the usage bar

`allowed` is null for a plan with no ceiling, and **null is not zero**. The same
distinction this codebase draws about a collection rate before anything is
billed, and about a setting nobody has chosen. The screen renders *"no limit"*,
never an empty progress bar.

---

## A trial that never ends is a free product

`0205` wrote `trial_ends_on = current_date + 30` and `status = 'trialing'`, and
then **nothing anywhere read that date again**. Thirty days later the school
keeps its fifty children for ever, and the only way anybody finds out is by
looking.

That is this codebase's own recurring shape, arriving one migration after being
written down: a column that records an intention, with no executable half.
`ends_on` on a bus seat was the same mistake (rule 2); so was
`fee_structures.frequency`, stored for seventy migrations and never acted on.

`0207` is the missing two thirds.

### The write half runs on a timer, and it is the timer that already exists

`subscription_expire_trials()` moves a lapsed trial to `expired`. It passes rule
7's test for scheduled work cleanly — *whether thirty days have elapsed is
arithmetic, with nobody's authority in it* — so it takes the `notify_send_for`
shape: `SECURITY DEFINER`, revoked from `public`, `anon` **and**
`authenticated`.

It is called from `schedule-tick`, not from a Postgres cron job. That function
already exists to be woken every fifteen minutes as the service role across
every school, and **a second timing mechanism is a second place to look when
something did not run**. Its failure is reported in the response and is
deliberately not fatal: a provider outage on the housekeeping must not stop four
hundred parents being told their children were absent.

### What `expired` does, stated rather than left in a boolean

`0205`'s trigger read the plan's limits and ignored the status, so an expired
trial was indistinguishable from a live one. Now:

- **The school keeps everything.** Nothing is deleted, hidden or locked. Every
  register, receipt and report reads exactly as before. A product that holds a
  school's records hostage over a lapsed card is not one to trust with the
  records.
- **It cannot grow.** No new children, no new staff — the whole consequence,
  reversible the moment somebody pays, and the message says so:
  *"This school's trial has ended, so no more students can be added. Everything
  already recorded stays exactly as it is, and adding resumes as soon as the
  plan does."*
- **`past_due` is not `expired`.** A card that failed on Tuesday is a bank, not
  a decision. Only `expired` and `cancelled` refuse.

### And a critic, because a date nobody is warned about is an ambush

`subscription_problems()`, catalogued in `reference.checks` as
`platform.subscription` so it is reachable — rule 11's *"a critic is only worth
what it costs to reach it"*. Gated on `settings.manage` by migration `0189`'s
rule: a critic is addressed to somebody who can act on it, and a class teacher
cannot choose a plan.

Every branch clears rule 12's bar — *is somebody going to have to do something
about it* — and is silent until it does. Probed end to end on a school
provisioned inside a rolled-back transaction:

| step | result |
|---|---|
| fresh trial, 30 days out | **silent** |
| usage as that admin | `staff 0/10, students 0/50` |
| five days left | *"The trial ends on 15 Sep 2026. After that the roll is frozen where it is…"* |
| lapsed, before the sweep | still `trialing` — nothing changes it until the sweep runs |
| the sweep | `1 subscription(s)` expired |
| admit after expiry | refused, with the sentence above |
| the demo school | `premium/active`, untouched |

**The first run of that probe reported 303 students against a school with
none** — because it did `reset role` before setting the JWT claims, so
`subscription_usage()` ran as `postgres`, RLS was bypassed, and it counted every
student in the database. That is precisely the trap `CLAUDE.md` documents about
`DO` blocks under the performance rule, and it produced a plausible number
rather than an error. The design was right; the instrument was not. **Probe as
`authenticated` with the claims set, every time — and be suspicious of a number
that is plausible for the wrong school.**

## What this deliberately does not build

**A platform-operator console.** Reading across tenants is the single thing rule
1 exists to make impossible, and a "manage all schools" screen is that by
definition. Nothing in `0205` or `0206` creates a role, a policy exception, or a
definer read model that can see two tenants at once.

> When that console is built it needs its own decision, its own schema and its
> own guard — not a quiet exception bolted onto a subscriptions table. The cheap
> version of it is the one that puts a hole in every other rule in this file.

**It was built, on those terms** — migration `0209`, `docs/modules/platform.md`.
Its own schema (`platform`, revoked from every role a person holds), its own
guard (`tests/platform/operator-boundary.test.ts`), and the property that made
it possible without touching a single policy: an operator **belongs to no
tenant**, so `current_tenant_id()` is null for them and all sixty policies
already refuse them every row. Metadata only — counts and plans, no student,
fee or mark anywhere in the projection. The paragraph above stands as written;
this is what meeting it cost.

**Self-serve plan changes.** `/settings/plan` lists the other plans and says
plainly that changing is not self-serve yet, rather than drawing a button that
does nothing. Rule 10's instinct: an honest skip beats a queue that can never
drain.

…and *"get in touch"* is only honest if somebody can then act on it, so
`platform_set_plan` is the other half of that sentence. A screen that asks a
college to write in, to a product where nobody could change the answer, is the
failure this codebase keeps naming — a correct read path with no write path
behind it.

**Billing.** `subscriptions` carries `provider`, `provider_customer_id` and
`provider_subscription_id` and nothing writes them yet.

…**and migrations `0214`–`0217` built it**, on the shape described just below.
The one thing that paragraph did not anticipate is that the platform charging a
college is a **different merchant account** from a college charging a family, so
it is a second pair of Edge Functions with `PLATFORM_RAZORPAY_*` secrets rather
than a reuse of the first. See `docs/modules/billing.md`.
 When Razorpay
subscriptions are wired in, the callback copies the shape rule 6 already
established for `fees_settle_gateway_payment`: `SECURITY DEFINER`, narrow,
revoked from `public`, `anon` **and** `authenticated`, idempotent on the
provider's own event id, with the credentials on the Edge Function and never in
the Next.js app.
