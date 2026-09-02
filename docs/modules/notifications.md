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

## What actually sends today: in-app, and only in-app

This is the thing to understand before reading anything else.

| Channel | Status |
|---|---|
| `in_app` | **Delivers.** The row *is* the delivery, so it is `sent` the moment it exists. |
| `email`, `sms`, `whatsapp`, `push` | **Queue only.** Real delivery rows, real preference handling, real retry state — and nothing drains them, because no provider is connected. |

That is deliberate, and it is the user's decision: *"wait for sending email for
now."* The important part is that the product does not lie about it. The
compose screen labels every channel `Delivers now` or `Queues only`, warns
before sending when a queue-only channel is selected, and the delivery log
raises a banner whenever anything is sitting in `queued`. A message that has
not gone anywhere never appears as though it has.

Connecting a driver is a small, contained change: an Edge Function that calls
`notify_claim_deliveries()`, sends, and calls `notify_record_result()`. No
application code moves. The one thing that must change with it is
`CHANNELS[].live` in `src/lib/validations/notifications.ts`, which is the single
source of the UI's honesty — and `tests/notifications/notification-shapes.test.ts`
asserts today's value so that flag cannot drift from reality silently.

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
| `notify_claim_deliveries(limit)` | **definer**, revoked from everyone | the dispatcher's claim |
| `notify_record_result(id, ok, error)` | **definer**, revoked from everyone | the dispatcher's write-back |

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
instances never send the same message twice; `notify_record_result` backs off
exponentially (`4^attempts` minutes) and gives up as `failed` after five tries.

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

- **No driver for any external channel.** Deliberate. See the top of this file.
- **No scheduled sending.** A message goes out when it is composed.
- **No per-notification read receipts for the sender** beyond the delivery log's
  counts — `read_at` is stored per delivery, but the log rolls up status rather
  than showing who has opened what. That is a product decision to revisit, not
  an oversight.
- **No modules emit notifications yet.** The service is built and proven; wiring
  `attendance.absent`, `fees.invoice_raised` and `library.book_overdue` into
  their modules is the next step, and each is a single `notify_send` call at the
  point the event becomes true.
