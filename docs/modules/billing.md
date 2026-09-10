# Subscription billing

*Migrations `0214`–`0217`. Edge Functions: `platform-subscription-link`,
`platform-subscription-webhook`. Screen: `/settings/plan`. Guard:
`tests/platform/billing-boundary.test.ts`.*

`0205` created `reference.plans` with prices on it and `public.subscriptions`
with `provider`, `provider_customer_id` and `provider_subscription_id`.
**Nothing had ever written those three columns.** `0207` added trial expiry and
`0209` gave a platform operator a dropdown, so a college's plan changed because
somebody moved it by hand.

That is the shape this codebase keeps naming — `fee_structures.frequency`
stored and never acted on, `trial_ends_on` written and never read, a bus seat's
`ends_on` documented in a comment nobody could execute. **A column recording an
intention with no executable half.**

## Whose Razorpay account — the first question, not a detail

Rule 6 already puts gateway credentials on the Edge Functions. What it did not
have to say, until now, is that there are **two flows of money running in
opposite directions**:

| | who charges whom | credentials |
|---|---|---|
| `razorpay-create-link` + `razorpay-webhook` | a **college** charges a **family** | `RAZORPAY_*` |
| `platform-subscription-link` + `platform-subscription-webhook` | the **platform** charges a **college** | `PLATFORM_RAZORPAY_*` |

> Two flows of money in opposite directions must not share a secret. A signature
> bug in the fee webhook would then also be a signature bug in the one that
> decides whether a school keeps its subscription — and a college's own merchant
> credentials would be collecting the platform's revenue.

Separate functions, separate secrets, and a guard that reads the source for both
directions.

## Two tables, because "asked for" and "on" are different facts

- **`subscription_checkouts`** — *this college pressed Upgrade to standard at
  14:02*, plus whatever the provider answered. One live row per college, as a
  partial unique index (rule 13): two half-finished upgrades disagree, and
  whichever is paid second silently wins.
- **`subscriptions.plan_code`** — what they are actually **on**.

Collapsing them hands a college the plan the moment they click, which is the
whole reason `payment_intents` exists one module along.

**`subscription_invoices`** is what the platform charged and whether the money
arrived: append-only by **revoke** (rule 6's stronger shape), idempotent on the
provider's event id, and in **minor units** throughout — Razorpay speaks paise,
and a rupee here with paise at the provider is `library.fine_per_day`'s mistake
with a decimal point in it.

Neither table has a write policy. Every write is a definer function: one for the
college's own intent, one for the callback — and the callback's is revoked from
`public`, `anon` **and** `authenticated`, exactly as
`fees_settle_gateway_payment` is.

## What the callback is trusted for

Very little. **The amount is not taken from the body**:
`subscription_settle_provider_event` reads `reference.plans.price_minor` and
refuses a mismatch, so a forged callback cannot decide what a college paid even
if it somehow arrived signed. Its authority comes from a checkout row this
system wrote.

Probed end to end, with the college restored afterwards:

| step | result |
|---|---|
| charged, wrong amount | refused: *"Provider reported 100 but Standard costs 499900"* |
| charged, correct amount | `standard/active`, period end 2026-10-09, trial cleared |
| **the same event redelivered** | `already_applied: true`, **1 invoice, not 2** |
| restored | `premium/active`, 0 checkouts, 0 invoices |

And the boundary, probed as several roles:

| seat | result |
|---|---|
| admin, plan not mapped at provider | *"Standard is not set up for online payment on this deployment yet."* |
| teacher starting a checkout | `42501 — Your role does not change the college's plan.` |
| teacher calling the callback function | `42501 — permission denied for function` |
| **admin** calling the callback function | `42501 — permission denied for function` |
| admin starting a checkout | ok: Standard 499900 INR |
| admin deleting a checkout | **0 rows touched** |

The fourth row is the one worth reading twice: nothing holding a JWT can reach
the settle function, an administrator included.

Only three events are applied — `subscription.charged`, the halted/pending pair,
and cancelled/completed. `subscription.authenticated` and
`subscription.activated` are acknowledged and **not** treated as money, because
they are not: applying them would give a college the plan before the first rupee
arrived.

## `past_due` is not `expired`

`0207` drew that line and this keeps it: a failed charge marks the subscription
`past_due` and limits nothing. A card that failed on Tuesday is a bank, not a
decision. Only a college that never had a live plan stays where it was.

## What the screen draws

`subscription_overview()` gained two additive keys in `0217` — `purchasable` per
plan, and the college's own open `checkout`. Without the first, the screen would
draw *Upgrade* on every card and let the refusal arrive after the click:

> **A control that will refuse you is worse than no control**, because it costs
> the person the work of trying.

That is the same defect this codebase found twice in the same week — a teacher
taken through a whole certificate form to meet a Postgres error, an accountant
shown every schedule switch and refused on each.

The second key means somebody who left a payment page open in another tab is
given it back rather than made to create a second subscription at the provider.
Starting again is still allowed and supersedes the old one — refusing would
strand them behind their own abandoned click.

`/settings/plan`'s old copy said *"changing plan is not self-serve yet — tell us
which one and we will move you"*, which was honest while nothing could take the
money. It moved with the code.

## The critic, and a comment that described an intention

`subscription_problems()` gained `plan.unpurchasable`: the college is on a paid
plan that has no id at the provider, so no checkout can start. It is phrased as
the **platform's** fault, because a bursar reading *"we cannot take your money"*
would go and check their bank, and what is missing is a row in a dashboard only
the platform can reach. Silent on `trial`, silent once mapped, and silent for a
college that is paying happily — rule 12's bar: *is somebody going to have to do
something about it.*

It exists because `0214`'s header said *"see `subscription_problems()` below"*
and there was no such thing below. Migrations are immutable, so `0216` is the
correction — the `0129` → `0131` shape a second time in three migrations, which
is the general lesson:

> A comment describing what a migration *ought* to contain reads exactly like
> one describing what it does. The tell is the cross-reference: **if a comment
> names a function, open it.**

## The guard caught the other comment too

`0214` created `subscription_invoices` without an audit trigger under a comment
asserting rule 9's exemption — *append-only, so the row is the record*.
`audit_guard_violations()` disagreed by name in the same session, and the
precedent settles it against the comment:

| table | append-only by revoke | audited |
|---|---|---|
| `ledger_entries` | yes | **yes** |
| `stock_movements` | yes | **yes** |
| `notice_reads` | yes | exempt |
| `schedule_runs` | yes | exempt |

> **Append-only is not the exemption test; "the row is the record" is**, and a
> money row fails it. The audit log records *inserts* as well as edits, so for a
> table that can never be edited the trail still answers a real question: **who
> created this, and when.** A read receipt has nobody to name. A charge does.

`0215` adds the trigger. All four guards — schema, privilege, audit, index —
are green.

## Setting it up on a deployment

1. Create the plans in the Razorpay dashboard (the **platform's** account).
2. `update reference.plans set provider = 'razorpay', provider_plan_id = '<id>'
   where code = '…';`
3. Set `PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_KEY_SECRET` and
   `PLATFORM_RAZORPAY_WEBHOOK_SECRET` as Edge Function secrets.
4. Point a Razorpay webhook at `platform-subscription-webhook` for the
   `subscription.*` events, deployed with **JWT verification off**.

Until step 2, `subscription_start_checkout` refuses in a sentence and
`plan.unpurchasable` says so on `/checks`. Until step 3, both functions fail
closed with 503 — an unconfigured deployment rejects callbacks rather than
accepting unsigned ones.

## Not built

- **Proration and mid-period changes.** A college moving from standard to
  premium on the 14th is charged the new price from the next cycle. Razorpay can
  do better; deciding what a school is owed for eleven days is a product
  decision, not a default.
- **Dunning.** `past_due` is recorded and surfaced; nobody is emailed about it
  yet. That is `notify_send` work with a schedule, and it wants somebody to
  choose the wording and the cadence.
- **Self-serve cancellation.** A college can stop paying and Razorpay will halt
  the subscription; there is no *Cancel* button, because "what happens to the
  data" deserves an explicit answer before a one-click path to it exists.
