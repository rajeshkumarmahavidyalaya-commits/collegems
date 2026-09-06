# Notification service (Phase 4.1)

One abstraction for telling somebody something. The rule it exists to enforce:

> **Nothing in this codebase may call an email or SMS API directly.** A module
> that wants to tell somebody something writes a row here and stops caring how
> it travels.

The failure this avoids is specific. When sending is hardcoded at each call
site, adding a channel means editing every module that sends — which is why a
competitor can charge separately for WhatsApp. One table and one dispatcher
makes a new channel a driver, not a migration through twelve modules.

Migrations `0033`–`0039`.

---

## What actually sends, and how you know

This is the thing to understand before reading anything else.

**Whether a message leaves the building has three parts**, and no single column
carries the answer:

| Part | Where it lives | What it means |
|---|---|---|
| a driver | `CHANNELS[].driver` in `src/lib/validations/notifications.ts` | this *build* knows how to send on the channel |
| the school's decision | `notification_channel_settings.is_enabled`, `from_address` | this *school* has turned it on and said who it comes from |
| credentials | `notification_channel_settings.provider_configured` | the dispatcher looked for its API key and found one |

`channelState(status)` is the one place those three are combined, and every
surface that offers a channel goes through it. Today's answer, on a deployment
with no provider secrets set:

| Channel | Driver | State |
|---|---|---|
| `in_app` | built | **Sends.** The row *is* the delivery, so it is `sent` the moment it exists. There is nothing to connect and nothing that can be down. |
| `email` | Resend | Sends once `RESEND_API_KEY` is set on the Edge Function and the school has a from-address. |
| `sms` | Twilio | Sends once `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are set and there is a sender number. |
| `push` | FCM | Sends once `FCM_SERVICE_ACCOUNT` is set. No from-address: a push notification carries the school's name in its own title. |
| `whatsapp` | Meta | Sends once `WHATSAPP_ACCESS_TOKEN` is set — **as an approved template**, never as free text. See below. |

### The honesty used to be a constant, and could not stay one

`CHANNELS[].live` was `false` for every external channel, and a test asserted
that value so it could not drift. That was exactly right while the answer was
*"never, for anybody"* — and became a lie the moment a driver shipped, because
liveness turned into a fact about a deployment and a school rather than about
the source tree. A constant compiled into the bundle cannot know whether a
Supabase secret is set.

So the flag was split. `driver` stays in the app and answers only *"does this
build have a sender for this channel"*. The other two thirds moved into
Postgres, where the dispatcher writes what it found. The test moved with it: it
no longer pins today's values, it pins the *shape* of the answer — that a
channel with no driver can never claim to send however it is configured, that a
school which has not switched one on is told so first, and that *the dispatcher
has never run* stays distinguishable from *it ran and found nothing*. That last
distinction matters more than it sounds: conflating them tells a school its
email is broken when in fact nothing has ever tried.

### A held channel keeps its queue

A channel that is off, unconfigured, or unbuilt does **not** get its deliveries
marked `skipped`. They stay `queued`, they are counted on the Channels screen
with the age of the oldest, and connecting a provider in March sends February's
reminders. Dropping them would be tidier and would lose a school's mail.

---

## The dispatcher

`supabase/functions/notify-dispatch` is the only thing in this repository that
has heard of Resend or Twilio. It holds every provider credential, which is why
it exists at all — the same split as the Razorpay functions, and the same rule:
**secrets never enter the Next.js app.**

Two callers, two scopes:

- **the service role** → every tenant. The scheduled run.
- **an administrator's JWT** → their own tenant, taken from the token's
  `app_metadata` and never from the request body. That is the "send the queued
  ones now" button, and reading the tenant from the body instead is how one
  school ends up spending another school's SMS credit.

**Report, then claim.** `notify_claim_deliveries` will not hand out work for a
channel whose `provider_configured` is false, and the dispatcher is the only
thing that can set it — so every run reports what each driver can do *before*
asking for anything to send. Read the wrong way round that looks like a
deadlock; it is the point. A dispatcher that only tried to send would turn one
missing API key into a thousand failed deliveries with five attempts each.

**Bounded, and it says the bound**: at most 200 deliveries or 40 seconds per
invocation, and the reply carries `remaining`. That is what keeps it on the
right side of rule 7 — a large backlog is a button pressed twice, not a request
that times out.

**At-least-once, deliberately.** A row left in `sending` by a dispatcher that
ran out of wall clock is claimable again after fifteen minutes, so a provider
that accepted a message just before the process died may send it twice. That is
the right trade for this traffic — a duplicated fee reminder is a nuisance and a
lost absence notice is a child nobody called about — and `provider_ref` is what
lets somebody prove which happened.

**A missing address is a dead letter, not a retry.** A recipient with no email
or phone number recorded will not have one in four minutes, so that failure is
recorded once rather than backed off five times.

### A failure can be permanent

Email and SMS fail transiently almost always. Push does not: a token is a
*capability that expires*, and once the handset is wiped or the app uninstalled,
FCM answers `UNREGISTERED` for ever. Five attempts with exponential backoff then
cost five requests and five lines of delivery log **per message, per dead
handset**, until somebody reads the log and works out why.

So `SendResult` carries `permanent`, and `notify_record_result` believes it: the
delivery is `failed` at once, with no retry and no backoff — and, for push, **the
device is revoked in the same statement**. That pairing is the point rather than
a tidiness. "The provider says this handset is gone" is one fact; recording it
against the delivery and not against the device would queue another delivery to
the same dead token with the next notification, and the one after that.

`isPermanentFailure()` in `fcm.ts` is the classification: a 404, an
`INVALID_ARGUMENT`, and a sender-id mismatch are dead; a quota error and a 503
are not. It is not unit-tested from vitest because it lives in the Deno runtime
and reads `Deno.env` — the consequential half, what the database does when told
a failure is permanent, is what the tests and the live probe cover.

The probe, run against the demo tenant:

| token | told | status | attempts | device |
|---|---|---|---|---|
| `probe_live` | `UNAVAILABLE: try again` | `queued`, retry in 1 min | 1 | untouched |
| `probe_dead` | `UNREGISTERED: the app was uninstalled` | `failed` | 1, not 5 | **revoked**, with the provider's reason |

A permanently failed row also leaves `next_attempt_at` where it was (migration
`0123`). Nothing reads it — the claim query only looks at `queued` rows — but a
row marked `failed` next to "retry in 1 minute" costs a reader the time to work
out which of the two is lying, and a column that means nothing is worse than a
column that is absent.

### WhatsApp: the template *is* the message

Every other channel takes a string. WhatsApp does not, and building it as though
it did is the single most likely way to ship a WhatsApp integration that appears
to work and does not.

Outside a 24-hour window opened by the **recipient** messaging the school first,
Meta accepts only templates registered and approved in advance: a name, a
language, and positional parameters. Free text is rejected. A school sending a
fee reminder is always outside that window — nobody replies to a fee reminder —
so for this product the template path is not a fallback, it is the only path.

**The 24-hour window is deliberately not modelled.** Using it would mean
recording every inbound message to know when a window opened, which is an
inbox: a second feature, with its own webhook, its own storage and its own
unread state, built so that a fee reminder could occasionally be sent as free
text. That is not a trade worth making.

So a WhatsApp template has two halves in two places:

| | where | what |
|---|---|---|
| Meta's copy | registered with Meta | the text actually delivered. This system never sees it. |
| our copy | `notification_templates.body` | what the delivery log shows a human, and what a channel added later could re-render. |

`notification_templates` gained the pointer — `provider_template_name`,
`provider_template_locale` — and `provider_template_params`, the payload keys in
the order Meta's `{{1}}`, `{{2}}` expect. Positional because that is Meta's API;
named in our data because `{{2}}` in a configuration screen is unreadable and
gets filled in wrong.

Both are **frozen onto the delivery** at compose time, beside the address and
for the same reason: a school that renames or re-registers a template must not
change what a delivery from six weeks ago says it sent.

A WhatsApp delivery with no registered template is **skipped with a sentence**,
not queued. Queuing it would put a message in a queue that can never drain, and
sending it as free text would have Meta reject it after five retries and blame
the recipient rather than the configuration.

A CHECK refuses `provider_template_name` on any channel but WhatsApp — otherwise
somebody fills it in on the email row and wonders why nothing changes.

#### The critic, and the wrong question it asked first

`notify_template_problems()` reports in sentences, like
`grading_scheme_problems()`. Its first version asked *which events default to
WhatsApp and have no template?* — and on this schema the answer is always none,
because `reference.notification_types.default_channels` lists in-app, SMS and
email and never WhatsApp. **The sentence that mattered most could never fire.**

Two things were wrong with that question. The narrow one: WhatsApp is in nobody's
defaults yet. The broader one: **the defaults are the wrong evidence** — a school
chooses channels per message at compose time, so an event that does not default
to WhatsApp can still be sent on it fifty times a term.

The right evidence was already in the delivery log. `notify_send` skips and says
why, so the skips *are* the record of what a school tried and could not do.
Migration `0125` counts them:

> WhatsApp messages for "Library book overdue" have been skipped 1 time(s): no
> template is registered for it, and WhatsApp only accepts templates approved in
> advance. Register one, or stop choosing WhatsApp for that event.

Widening it to *every* event instead would have been the other mistake: nine
complaints the moment somebody enables the channel, most about events they will
never send that way, which is the kind of list people learn to scroll past.

### Push has no sender, and that is not an omission

Every other channel has a from-address the school sets. Push does not: the
notification carries the school's name in its own title, so the Channels screen
hides the sender fields for push rather than offering a box the driver ignores.
Somebody would fill it in and wonder why it never appeared.

One service account covers iOS, Android and web, which is why FCM was chosen
over Expo or a direct APNs integration — `devices.platform` already carries all
three and the driver needs no branch per handset. The credentials are **one**
environment variable holding Google's service-account JSON verbatim; splitting
it into three invites a private key pasted with its newlines mangled, which
fails at signing time with a message that explains nothing.

---

## Shape

```
reference.notification_types   the global catalog of things worth saying
notifications                  what happened, once
  └── notification_deliveries  one row per recipient per channel
notification_templates         per tenant × event × channel, {{interpolated}}
notification_preferences       per user opt-outs, and only opt-outs
```

The split between `notifications` and `notification_deliveries` is the load
bearing decision. *"Did the absence notice go out?"* is one question an
administrator asks about one thing. *"Did Ravi's mother's SMS arrive?"* is a
different question about one copy of it. Collapsing them makes the second
unanswerable, and the second is the one that gets a school shouted at.

**`reference.notification_types`** lives outside `public`, like
`reference.permissions`, because it is not tenant data — which keeps the schema
guard invariant in `tests/rls/schema-invariants.test.ts` meaningful. Nine event
keys today, each with `default_channels`.

**`notifications.audience`** stores *how the recipients were chosen*, not who
they were. `{"kind":"section","section_id":…,"who":"parents"}` stays meaningful
after a student changes class; a frozen list of user ids would not, and would
also make the log unreadable a year later.

**`notification_deliveries.address`** freezes the email address or phone number
**as it was at send time**. A delivery log that re-reads the current address
cannot answer "where did we actually send it", which is the only question worth
asking when a parent says they never got it.

**Preferences store opt-outs only.** An absent row means "use the catalog
default". That is what lets a school turn a channel on for everybody by editing
one catalog row instead of backfilling a row per user per event — and it means
a person who never visited the preferences screen keeps following the school's
default as it changes, which is what "I have no opinion" should mean. The server
action deletes rather than writing `enabled = true` for exactly this reason.

---

## The functions

| Function | Security | Notes |
|---|---|---|
| `notify_render(template, payload)` | invoker, immutable | `{{key}}` substitution |
| `notify_resolve_audience(tenant, audience)` | invoker | the four audience shapes |
| `notify_send(...)` | **definer** | the one write path, admin-guarded |
| `notify_inbox(limit, only_unread)` | invoker | my in-app messages |
| `notify_unread_count()` / `notify_mark_all_read()` | invoker | the bell |
| `notify_outbox(limit, event_key)` | invoker | the log, outcomes rolled up |
| `notify_event_types()` | invoker | the catalog, without exposing `reference` |
| `notify_claim_deliveries(limit, tenant?, channel?)` | **definer**, revoked from everyone | the dispatcher's claim |
| `notify_record_result(id, ok, error, ref)` | **definer**, revoked from everyone | the dispatcher's write-back |
| `notify_channel_report(tenant, channel, provider, configured, error)` | **definer**, revoked from everyone | what the dispatcher found |
| `notify_channel_status()` | invoker | what a screen needs to tell the truth |
| `notify_retry_failed(channel?, limit)` | **definer**, admin-guarded | put failures back in the queue |

### Why `notify_send` is `SECURITY DEFINER`

Reluctantly, and narrowly. `notification_deliveries` has **no INSERT policy at
all** — which is what stops a student inventing a message from the principal.
An admin who could insert deliveries directly could also forge one, so granting
admins INSERT to make an invoker function work would have handed away the
property the table exists to have.

So the function runs as the owner and does the admin check itself:

```sql
if ( select public.current_role_code() ) <> 'admin' then
  raise exception 'Only an administrator can send a notification';
end if;
```

This is the same shape as `fees_settle_gateway_payment`: definer, narrow, and
taking its authority from something this system knows rather than from its
arguments.

### The dispatcher's two functions are unreachable from a browser

`notify_claim_deliveries` and `notify_record_result` are revoked from `public`,
`anon` **and** `authenticated`. They exist for an Edge Function holding the
service role. A JWT cannot claim a delivery or mark one sent, however it asks.
`notify_claim_deliveries` uses `for update skip locked`, so two dispatcher
instances claim disjoint batches; `notify_record_result` backs off
exponentially — 1, 4, 16, 64 and 256 minutes — and gives up as `failed` after
five tries. A queue that retries for ever is how a dead SMS gateway turns into a
bill.

`notify_channel_report` is on the same footing and for the same reason: a school
that could call it could claim its email was configured when it was not, and
then wonder why nothing arrived.

### A school configures a channel; it does not write its history

`notification_channel_settings` has two writers with different rights on the
same row — an administrator sets `is_enabled`, `from_address` and `sender_name`,
and the dispatcher sets `provider`, `provider_configured`, `last_attempt_at`,
`last_success_at` and `last_error`. A policy alone gives an administrator the
whole row, and a school that can rewrite `last_error` can hide the fact that its
parents stopped receiving anything.

This is the case CLAUDE.md's "RLS cannot restrict columns" rule describes, and
it takes the same answer as `notification_deliveries`: a column-level GRANT
beside the policy. It works here — and not on `homework_submissions` — because
only one role holding a JWT writes this table at all, so narrowing what
`authenticated` may write narrows exactly the right person.

INSERT and DELETE are revoked outright (migration `0116`). Deleting a channel
row is worse than it looks: the claim query joins deliveries to settings, so a
school with no email row does not get an error — its email simply stops being
claimable and every screen goes quiet about a queue that is still filling up.
The rows are created by the seed and by a trigger on `tenants`, one per tenant
per channel, for ever.

---

## Two bugs worth keeping in the record

### Inline text was not being interpolated (fixed in `0036`)

The first version rendered `{{variable}}` in *templates* and passed the caller's
own `p_body` through untouched. Every count in every probe was correct — one
notification, three deliveries, right statuses — and the message said
`Sports day has moved to {{date}}`.

Counting rows proves fan-out. It does not prove the message is right. The probe
that caught this read the delivered body.

An unsupplied variable is deliberately **left in place** rather than blanked:
`Your fee of {{amount}} is due` shows a missing payload key to whoever reads it,
where `Your fee of  is due` reads as a bug in the amount.

### A recipient could rewrite their own delivery (fixed in `0039`)

Migration `0033` carried this comment above the update policy:

> "Marking your own in-app message read is the only update a person may make,
> and `read_at` is the only column they could want to change."

The second half was a hope, not a rule. **RLS cannot restrict columns.** The
policy decides which *rows* an update may touch; once a row qualifies, every
column on it is writable — and with Supabase's default blanket
`grant all … to authenticated`, a recipient could rewrite the `body`, the
`subject`, the `address`, the `status` and `sent_at` of their own delivery. That
is the row the delivery log treats as the school's evidence of what it told
them.

Confirmed against the live database, not reasoned about: a recipient's
`update notification_deliveries set body = '…'` succeeded and returned the
rewritten row.

The fix is a column-level `GRANT`, the only mechanism in Postgres that expresses
"this column and no other":

```sql
revoke update on public.notification_deliveries from authenticated, anon;
grant update (read_at) on public.notification_deliveries to authenticated;
```

RLS keeps deciding which rows; the grant decides which column. Neither
substitutes for the other.

**The general rule, which applies to any future table:** a
"users may update their own row" policy where only some columns should be
writable needs a column GRANT beside it. Every other `UPDATE`/`ALL` policy in
this schema was audited after this — they all grant to a role that legitimately
owns the whole row (admins, librarians, finance roles, a teacher on their own
section), so this was the only instance.

---

## Screens

| Route | Who | What |
|---|---|---|
| `/notifications` | everyone | The inbox. Unread/all, opening marks read, mark-all-read. |
| `/notifications/compose` | `communication.send` | The four audience shapes, live reach count, channel honesty. |
| `/notifications/log` | `communication.view` | Outcomes per message, drill-down per delivery, CSV export, templates tab. |
| `/notifications/preferences` | everyone | Per-event, per-channel opt-outs. |

The header bell is a link with a count, not a dropdown preview — a preview needs
its own fetch, empty state, error state and mark-read behaviour, which is a
second inbox to keep in step with the real one. The count is the part that
changes behaviour.

**The reach counter calls `notify_resolve_audience`**, the same function the send
path uses, rather than counting on the client. "All parents of 6B" is easy to
type and hard to picture, and an administrator who sees `0` finds out before
`notify_send` refuses — or, once a driver exists, before 400 SMS go out. A
number derived independently would eventually disagree with the send, which is
worse than no number.

**In-app cannot be muted.** It is the channel that always works and the only
record a person has of what they were told. Muting it would mean a fee reminder
with nowhere to land.

---

## Authorization

Both layers, as rule 4 requires.

**RLS** is the boundary: `notify_send` refuses a non-admin outright, and the
policies on `notifications` say the same thing again. Recipients can see their
own deliveries and the notifications behind them — otherwise their own inbox
could not render its text — and nothing else.

**`communication.view` and `communication.send`** (migration `0038`) gate the
UI. They exist so that a tenant which later wants its office clerk to send
announcements can tick a box, rather than waiting for a release that changes a
hardcoded `roleCode === 'admin'`. They are backfilled onto every existing
tenant's admin role, because tenants are provisioned by migration in this system
and there is no single place a new permission would otherwise reach them from.

---

## What is not built

- ~~**No driver for any external channel.**~~ Email (Resend) and SMS (Twilio)
  have drivers; WhatsApp and push do not, and say so rather than queueing in
  silence. Adding one is a file in `supabase/functions/notify-dispatch/drivers.ts`
  and a line in `DRIVERS` — no migration, no application change. That is what
  rule 10 was for.
- **No delivery-status callbacks.** `provider_ref` is stored and is what such a
  callback would match on, but nothing consumes a provider webhook yet, so
  "sent" means the provider accepted it — not that it arrived.
- **No scheduled run is configured.** The dispatcher is deployed and can be run
  from the Channels screen; wiring a cron to invoke it with the service role is
  a deployment step, not a code change.
- **No spend limits.** A school with a misconfigured audience can send a lot of
  SMS. A per-tenant daily cap belongs next to `notification_channel_settings`
  and is not built.
- **No per-notification read receipts for the sender** beyond the delivery log's
  counts — `read_at` is stored per delivery, but the log rolls up status rather
  than showing who has opened what. That is a product decision to revisit, not
  an oversight.
- **No modules emit notifications yet.** The service is built and proven; wiring
  `attendance.absent`, `fees.invoice_raised` and `library.book_overdue` into
  their modules is the next step, and each is a single `notify_send` call at the
  point the event becomes true.
