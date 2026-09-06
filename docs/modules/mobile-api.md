# The mobile API

## There is already an API

That is the first thing to be honest about. A phone signs in with Supabase Auth
and reads tables through PostgREST, and **RLS is the same boundary it is for the
web app**. Nothing in this module exists to add security; inventing a second
authorization layer for mobile would be inventing a second place to get it
wrong, and the two would drift.

What a phone needs and does not have is **shape and cost**.

A parent opening the app on a train wants one screen: her two children, today's
lessons, what is owed, what homework is due, whether anybody was marked absent.
Assembled from tables that is eleven round trips over a connection that drops.
Assembled in Postgres it is one — and the assembling happens next to the data,
which is the same argument `exams_report_cards` and `notify_outbox` already
make.

---

## Three calls, and that is the whole surface

| Call | Returns | For |
|---|---|---|
| `mobile_bootstrap()` | one `jsonb` document | app start: which school, which year, who am I, what may I do |
| `mobile_home(on?)` | one `jsonb` document | the home screen, every child at once |
| `mobile_student(student_id)` | one `jsonb` document | one child, in more detail |

Plus three small ones a client needs on its own:

| Call | For |
|---|---|
| `mobile_today()` | today's date **in the school's timezone** |
| `mobile_my_students()` | the children this login is a family member of |
| `mobile_register_device` / `mobile_revoke_device` | push registration |

Every one is `SECURITY INVOKER`, so RLS decides what goes in the document.
**There is no `where tenant_id =` written by hand anywhere in this module** —
rule 11's read-model rule, which applies with more force here because these are
the widest read paths in the system.

---

## Versioning, which matters more than it does on the web

A web client is redeployed with the server. A phone is not: somebody is still
running last April's build, and will be until they reinstall.

So the contract is:

- Every document carries **`api_version`**.
- Within a version, changes are **additive only**. A new key is safe; a renamed
  or removed key is not.
- A breaking change is a **new function** (`mobile_home_v2`) and a bumped
  version, with the old one kept working until the store analytics say nobody is
  on it.
- **`min_supported_version`** in the bootstrap document is the other half: a
  build older than that is told to update rather than left to render a screen
  from keys that no longer exist. Raise it only when a released build genuinely
  cannot render the document, and **never lower it** — telling somebody to
  update and then telling them they need not is worse than either answer alone.

`src/lib/validations/mobile.ts` is where that contract is written down so a test
can hold it, and every schema there is `.passthrough()` **on purpose**: a client
compiled in April must keep parsing when the server starts sending a field added
in September. Removing `.passthrough()` would quietly turn every additive change
into a breaking one.

`versionVerdict()` also lets a client *newer* than the server through. That
happens during every staged rollout, the contract is additive, so the older
document still parses — treating it as an error would break each release.

---

## "My children" is a relationship, not a visibility

`mobile_my_students()` is deliberately **not** "the students this login can
see". RLS lets a teacher read every child they teach and an administrator read
all of them, and neither of those is a home screen.

So the relationship is spelled out — the student themselves, plus a guardian's
children through `guardian_student` — and a member of staff gets an **empty
list** even though they can read the same rows elsewhere. A test pins that,
because "make the admin's home screen show the whole school" is a plausible
mistake that nobody would report as a bug.

The detail screen's gate is `exams_may_see_student()`, reused rather than
rewritten: it is the same question the report card asks, and a second answer
would eventually be a different answer.

---

## Today is a fact about the school

Vercel runs in UTC, Supabase runs in UTC, and the phone runs wherever the parent
is standing. `tenants.timezone` is the only correct answer to *"what is today's
timetable"*, so `mobile_today()` computes it there and the bootstrap document
carries it. Building the date in the client from the handset's clock is how a
parent in Dubai sees Tuesday's lessons on Monday evening.

---

## Bounded, and the bounds are in the document

Per rule 7: at most **10 children**, **20 homework items**, **10 notices**,
**8 exam results**, **12 invoices**. A family larger than ten is real; a
*response* larger than that is a bug, and the cap is stated in the migration
rather than left to a comment.

Every part of a child's card **wraps the module's own read path** rather than
recomputing it — `fees_student_balances`, `timetable_for_section`,
`homework_for_student`, `exams_published_for_student`, `exams_attendance_summary`,
`transport_for_student`, `hostel_for_student`. A phone that disagreed with the
screen the money is taken on would be worse than a phone with no fee balance at
all.

`mobile_student_card` exists as its own function for the same reason: the home
screen needs it once per child and the detail screen needs it once, and two
implementations of "what does this child's day look like" would be free to
disagree.

---

## Devices, and why a token is not an address

`devices` is one row per handset per login: platform, push token, app version,
`last_seen_at`, and a `revoked_at` rather than a delete — because a token that
stopped working is a fact worth keeping, and deleting it would make *"she
uninstalled it"* and *"we never had a token"* the same row, which is to say no
row.

**A push token is a capability.** Anybody holding one plus the provider's key
can send that handset a notification that looks like the school's. So:

- The policies are `user_id = auth.uid()`, and there is **deliberately no
  administrator read policy**.
- `mobile_device_summary()` is definer and returns **counts only** — enough to
  answer "is the app installed anywhere", which is the actual support question.
- The Channels screen shows those counts and says out loud that tokens are never
  shown.

`mobile_register_device` is called on **every app start**, not only on install:
an operating system rotates a push token without telling the user, so
"register" has to mean *"this is my token now"*, idempotently. Revoking twice is
a no-op rather than an error, because the caller is usually a retry.

### This closed a hole in the notification module

`notify_send` resolved an email from `people.email` and an SMS from
`people.phone`, and for `push` it had nowhere to look — so every push delivery
was written with a null address. Nothing drained the queue, so nothing noticed.
The dispatcher notices, correctly, as a dead letter.

Migration `0118` gives push somewhere to look, and it changes the **shape** of
the fan-out rather than just filling in a column:

```
email / sms / whatsapp   one address per person
push                     one address per HANDSET, and a person has three
```

The address lateral now returns a *set*. For every other channel it returns
exactly one row and nothing about those deliveries changes; for push it returns
one row per live device — and, when there are none, exactly one row with a null
address so the log says *"No device registered for this person"* rather than
saying nothing.

The join is a `LEFT JOIN LATERAL` and that is load-bearing: a login with no
`user_profiles` row produces no rows from the first arm, and a cross join would
drop that recipient from the delivery log entirely rather than recording a skip.
Vanishing silently is the one outcome that table exists to prevent.

---

## What is not built

- **No push driver.** Registering a device makes a push delivery *addressable*;
  sending it still needs a driver in `supabase/functions/notify-dispatch`, and
  `CHANNELS[].driver` says `none` for push until there is one. Deliveries queue
  and are counted rather than being silently dropped.
- **No signed-URL path for the phone.** The web app issues signed URLs only
  after reading the row back through RLS (rule 8). A phone can create its own
  signed URL through supabase-js, and Storage RLS would enforce the tenant
  prefix — but *not* the row-level question ("is this the student's own
  submission"). Until an Edge Function does that check, the mobile documents
  carry object **paths** and no URLs, and attachments are not fetchable from a
  phone. That is a real gap, named rather than papered over.
- **No writes.** A phone can register a device and mark a notification read
  (through the existing policy); it cannot submit homework or pay a fee. Those
  need their own narrow RPCs and are not built.
- **No offline cache contract.** The documents are safe to cache — they are
  read models — but nothing says how stale is too stale, and `Cache-Control` is
  not set.
- **No rate limiting.** `mobile_home` is a handful of indexed queries and is
  bounded, but a client in a retry loop is not currently slowed down.
