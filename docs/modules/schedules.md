# Automatic messages

Everything else in this system, somebody presses a button for. This is the part
that runs on its own.

Migrations `0138`–`0143`, plus `supabase/functions/schedule-tick`.

| | |
|---|---|
| `schedules` | what runs, when, and how late is still worth sending |
| `schedule_runs` | one row per occurrence, unique on `(schedule_id, occurrence_at)` |
| `notify_send_for` | the sender for a caller who is not a person |
| `schedules_due` | which occurrences have arrived, in each school's own clock |
| `schedule_run` | runs one, once |
| `schedules_tick` | one bounded pass over everything due |
| `schedule_problems` | whether anybody is actually hearing it |
| `schedules.runs` | the catalog report |

---

## Four decisions, and the first is the one every scheduler gets wrong

### 1. "Half past seven" is a wall clock, not an instant

A cron expression fires in one timezone. Two schools on one deployment do not
share one, and a school keeping `Asia/Kolkata` does not want its evening SMS at
two in the afternoon because the server keeps UTC.

So a schedule stores `run_at time` — a **local wall clock** — and the runner asks
each tenant *"is it half past seven where you are?"*:

```sql
(((now() at time zone t.timezone)::date - d.offset_days) + s.run_at)
  at time zone t.timezone as occurrence_at
```

Local time first, instant second. Storing a UTC instant instead would also move
every send by an hour twice a year for any school that observes daylight saving.

Verified with two schools on one deployment: same schedule, same wall clock, one
in `Asia/Kolkata` and one moved to `America/New_York` — only the school whose own
clock had passed 10:00 came back due.

### 2. Which days it runs is data, not a branch

Rule 12. `weekdays smallint[]` (ISO 1–7, empty meaning every day) or
`day_of_month` — never both, as a check constraint. "Every weekday", "Mondays",
"the 5th" and "Saturdays too" are all real schools.

`day_of_month` is capped at **28** on purpose:

> "The 31st" silently skips February and the short months, which is a schedule
> that works for seven months of the year and looks broken for five. A school
> that means "month end" needs a different concept, not a number that is wrong
> four times a year.

### 3. An occurrence runs once

`schedule_runs` is unique on `(schedule_id, occurrence_at)` and the first
statement of `schedule_run` is an insert with `on conflict do nothing`. A runner
invoked at 19:30 and again at 19:31 finds nothing to insert, returns the
existing row, and sends nothing.

This is `accounts_sync`'s idempotency rule applied to time: **make the natural
key the thing that cannot repeat.** Not an advisory lock and not a
check-then-act — two ticks racing must have one of them lose at the index.

`occurrence_at` is *the instant the schedule was for*, never the instant it ran.
That distinction is the whole index: a run starting at 19:31 because the tick
was late is still the 19:30 occurrence.

### 4. A schedule that was missed does not catch up

Enabling a daily reminder at three in the afternoon must not fire this
morning's, and a runner down for a week must not send a week of absence notices
on Monday. Two mechanisms:

- `schedules_due` looks back **at most one day**. Nothing older is ever a
  candidate.
- `grace_minutes` is **per schedule**, and past it the occurrence is written
  down as `missed` with the number of minutes in the note.

The window differs by kind, and the differences are the module's argument in
miniature:

| | grace | why |
|---|---|---|
| absence notice | 2 hours | A parent told at nine that their child was absent has had the child at home since four. Late is worse than never. |
| fee reminder | a day | A reminder is a reminder whenever it lands. |
| overdue books | a day | Likewise. |

Recording the miss rather than skipping silently is deliberate: otherwise *"why
did nothing go out on the 3rd"* has no answer.

---

## A caller who is nobody

`notify_send` reads the tenant from the JWT and refuses anybody who is not an
administrator. A scheduler holds the service role, has no JWT, and
`current_tenant_id()` is null for it — the same problem the payment webhook had.

So `notify_send_for` takes the tenant explicitly and is revoked from `public`,
`anon` **and** `authenticated`, exactly like `fees_settle_gateway_payment`. Its
authority comes from `schedules.tenant_id`, a row an administrator of that
school created.

**`notify_send` is now a wrapper over it.** Copying the body would have been two
implementations of "who gets this and on which channels", and the second is
where the WhatsApp template freeze or the preference check quietly stops being
applied. One body, two doors.

One behaviour differs, on purpose: `notify_send` raises when an audience matches
nobody, because a person who pressed Send deserves to be told. A scheduler must
not — "this child's guardians have no logins" is an ordinary fact about one of
four hundred children, and aborting over it would stop the other 399. So the
caller passes `p_require_recipients`, and the run record counts what actually
went out.

### …and where that split stops being safe

`schedule_fee_defaulters` sums invoices and the ledger, which is what
`fees_student_balances` already does — normally the mistake rule 11 names. It is
not avoidable here, and the reason generalises:

> **The `_for` split is only safe where the invoker version's protection is a
> tenant or role check, not a row-ownership one.**

`notify_send` guards with an explicit admin test, so parameterising the tenant
and revoking the door is exactly equivalent. `fees_student_balances` is
`SECURITY INVOKER` and its safety is **row-level** — a parent calling it sees
their own children through RLS, not through an argument. A definer twin would
hand a parent the whole school, and an invoker wrapper cannot delegate row
ownership to a definer helper: there is nothing to pass that means "the rows this
caller may see".

So the background job gets a *narrower* function answering only its own
question, and the two are pinned together by a test rather than by hope — the
same treatment the dashboard's fee figure gets.

---

## A schedule that runs is not a schedule that works

The failure this module is most likely to produce is quiet. A school switches
its SMS channel off and leaves the evening absence notice on. Every night the
register says **Ran · 40 matched · 40 told**, every delivery is skipped for want
of a channel, and nobody is being told anything.

So `schedule_problems()` is `grading_scheme_problems()` aimed at a schedule, and
it reads rule 10's three parts — a driver, the school's decision, credentials:

- *"This schedule sends on sms, which is switched off. It will keep running and
  reporting success while every message is skipped."*
- *"…switched on but has no credentials the dispatcher could find. Messages will
  queue rather than send."*
- *"This schedule has never run. It will run at its next occurrence — it does not
  go back and send the ones it missed before it was switched on."*
- *"The last run matched 40 but told nobody — none of them has a family login on
  file."*

`matched` and `notified` are separate columns for the same reason. The gap
between them is the useful number.

---

## Switched off, on arrival

The three seeded schedules — an evening absence notice, a monthly fee reminder,
a weekly overdue-book reminder — **arrive disabled**, and so does anything
created through the screen.

> A school that installs this and finds four hundred parents were texted at half
> past seven without anybody deciding to has been badly served, however useful
> the feature is.

The rows exist so that a school has something to look at and argue with rather
than a syntax to guess. Turning one on is one click, and the page says next to
it that turning it on does not send what was missed.

---

## A module that sends asks the module that knows

The absence notice, on its own, was rude: a family that told the school on
Monday their daughter has chickenpox got a text every evening for a week saying
she was absent. `schedule_run` now consults `student_is_on_leave` before it
sends, and the run row names the two reasons a matched child was not written to
separately:

| | |
|---|---|
| on approved leave | deliberate, and the school wanted it |
| no family login | a gap the school might want to close |

One number — *"12 matched, 7 told"* — cannot distinguish those, and they call for
opposite responses. The register is untouched: a child on approved leave is
still *absent*, because they were not there. See `docs/modules/student-leave.md`.

---

## Bounded, and it says the bound

Rule 7, three times over:

| | bound |
|---|---|
| `schedule_run` | 500 recipients by default, 2,000 at most — and the run row records that it stopped early |
| `schedules_tick` | 25 occurrences a call, 200 at most, and returns `remaining` |
| `schedule-tick` (Edge) | 60 occurrences or 40 seconds, and returns `truncated` |

A school with four thousand defaulters gets the first five hundred and a note
saying so — not a timeout and no record of anything.

The Edge Function is deliberately thin: all the judgement is in Postgres, and
what lives in Deno is the one thing Postgres cannot do — be woken up. It is
woken *often* (every fifteen minutes is plenty) and the frequency of the wake-up
has nothing to do with the frequency of any schedule. It is deployed with JWT
verification **and** refuses any caller whose token is not the service role,
because `schedules_tick` touches every school and has no tenant to scope itself
to.

---

## A failure is a row, not a stack trace

The task runs inside a plpgsql exception block, so the run row survives and
carries the message. Without it the whole transaction rolls back, the run row
goes with it, the next tick retries the same broken thing, and nothing anywhere
says what happened.

---

## What is still not built

Rule 7 named three things as `jobs` work. Scheduled *notifications* are now
built; **scheduled reports are not**, and the reason is worth keeping:

> A scheduled job has no user, so anything it does must be expressible without
> one.

Sending a message about a row is. Running a catalog report is not:
`report_run` gates on `role_permissions` for `current_role_code()`, and a
scheduler has no role. Making it work means deciding *whose authority* a
schedule runs under — a service identity, or the administrator who created it,
with everything that follows about what happens when they leave. That is a
bigger decision than this module should make quietly, so it is named here
instead of guessed at.

Full exports and PDF rendering are also still not built.

---

## Files

| | |
|---|---|
| `supabase/migrations/0138_notify_send_for.sql` | the sender for a caller who is nobody |
| `supabase/migrations/0139_schedules_schema.sql` | the two tables |
| `supabase/migrations/0140_schedule_engine.sql` | the due-check and the two helpers |
| `supabase/migrations/0141_schedule_run.sql` | running one occurrence |
| `supabase/migrations/0142_schedules_tick_and_critic.sql` | the tick and `schedule_problems()` |
| `supabase/migrations/0143_schedule_permissions_seed_and_report.sql` | permissions, three starters, the log |
| `supabase/functions/schedule-tick/index.ts` | the wake-up |
| `src/lib/validations/schedules.ts` | the sentences a schedule is read as |
| `src/app/(app)/notifications/schedules/` | the screen |
| `tests/schedules/schedule-sentences.test.ts` | those sentences, without a database |
| `tests/schedules/schedules-db.test.ts` | reachability and the constraints, through real RLS |

---

# The waker (migrations `0229`, `0230`)

`schedule_runs` was **empty**. Not one occurrence had ever fired, on a
deployment that has had six schedules and this module since `0110`.

Not a bug in the module. **Nothing was calling it.** Swept: no `vercel.json`,
no `supabase/config.toml`, no cron entry anywhere in the repository, and
`pg_cron` not installed. `schedule-tick`'s own header says its whole job is
*"the one thing Postgres cannot do: be woken up"* — and nothing woke it.

## …and the obvious waker is forbidden by rule 6

`schedule-tick` refuses any caller whose token is not the service role, which is
correct — the URL would otherwise let anybody make every school's messages go
out early. But it means **the waker must hold the service-role key**, and rule 6
says secrets never enter the Next.js app. A Vercel cron hitting a Next route
with that key in its environment is the shortest path, and it is the one this
module forbids.

## Postgres cannot be woken, but it can wake itself

Read what the Edge Function actually calls, rather than assuming it does work:

```
subscription_expire_trials()
notify_expire_stale()
schedules_tick(p_limit, p_max_recipients)
```

**Three RPCs, and all three are Postgres functions with defaults.** The function
is a waker and nothing else — so with `pg_cron` there is nothing to wake. No
HTTP, no service-role key, no secret anywhere, and the jobs run as `postgres`,
which is exactly the authority those three already require: each is
`SECURITY DEFINER` and revoked from everybody holding a JWT.

| job | schedule |
|---|---|
| `schoolos_schedules_tick` | every 5 minutes |
| `schoolos_expire_stale_deliveries` | every 30 minutes |
| `schoolos_expire_trials` | daily, 00:10 UTC |

The Edge Function **stays**: it is the deployment path for anywhere that is not
Supabase, and it is the manual button. Two wakers are safe here by design rather
than by luck — `schedule_runs` is unique on `(schedule_id, occurrence_at)` and
the run begins with `on conflict do nothing`, so an occurrence runs once however
many things ask for it. That was `0110`'s design and this is the first time
anything has depended on it.

**Five minutes, not the fifteen the Edge Function's comment says.** That figure
was chosen when a wake-up cost an HTTP invocation; in-database it costs a
function call, and a five-minute grain is what makes `grace_minutes` mean
anything — at fifteen-minute resolution a five-minute grace can never be met.
The cron's own timezone is irrelevant, which is the module's whole point:
`schedules_tick` asks each tenant *"is it half past seven where you are?"*.

## Probed: the module was right all along

Enabling all six schedules for the demo college in a rolled-back transaction and
ticking once:

| | |
|---|---|
| `fees.due_reminder` | **done** — matched 7, notified 0, *"7 had no family login to send to."* |
| `library.overdue` | **missed** — *"Not run: 286 minutes late, and this schedule is only worth sending within 120. Nothing was sent, and nothing will be sent for this occurrence."* |

Both are the module reporting honestly on itself: the grace mechanism written
down rather than skipped silently, and the reach problem named as its own
number. It has been correct for a hundred and twenty migrations and nobody had
ever seen it run.

Live, the cron has now ticked at 18:45 and 18:50, `succeeded`, 26 ms.

## Why nobody noticed

The module is well instrumented and every instrument was pointed one step too
far in. `schedule_runs` is the register of what ran; `schedule_problems()` asks
whether anybody heard. **Both are silent when the tick never happens at all**,
because a scheduler that is not running produces no runs to criticise and no
deliveries to find fault with.

> An empty register reads as *"nothing was due"*. It reads identically to
> *"nothing is asking"*. That is `attendance_coverage`'s lesson — a rate cannot
> say what was never measured — arriving at the scheduler.

`scheduler_problems()` is the missing number, catalogued as `schedules.alive` so
it is reachable from `/checks`. It reads `cron.job` and `cron.job_run_details`
through a `SECURITY DEFINER` function, because that catalogue belongs to the
`postgres` role — and the projection is deliberately *whether a job exists and
when it last succeeded*, with no tenant data in it at all.

**An external waker is not accused.** Where no in-database job exists the
finding is `info` and says what would make it fine, because `schedule-tick` is a
supported answer that leaves no trace in `cron.*`. Probed as an administrator
(silent — it had just run) and as a parent (silent, and `scheduler_liveness()`
itself refuses: *"Your role cannot see the scheduler."*).

One limit, written down rather than implied: **the no-waker and stalled branches
were verified by reading the body and by the guard, not by probing** — this
connection cannot modify `cron.job`, so the branch could not be induced live.

---

# Scheduled reports — whose authority does a run use?

Migrations `0238`–`0241`. This is the thing rule 7 said the module *deliberately
stops short of*, and the sentence it stopped at was right:

> A scheduled job has no user, so anything it does must be expressible without
> one. Sending a message about a row is. Running a catalog report is not —
> `report_run` gates on `role_permissions` for `current_role_code()`, and a
> scheduler has no role.

So the decision had to come first, and it is one sentence: **a scheduled report
runs as the person who scheduled it.** `schedules.created_by` is stamped by a
`BEFORE INSERT` trigger from `auth.uid()` — never sent by the client — and is
**immutable**, because moving a schedule to another owner would be a way of
borrowing somebody else's permissions:

```
A schedule's owner cannot be changed. It decides whose permissions the run uses,
so moving it would be a way of borrowing somebody else's. Delete this schedule
and create it again as the person who should own it.
```

The authority is **re-checked every occurrence, never remembered**. An
administrator who left in March is not still running the fee digest in June;
neither is one whose role lost the permission last Tuesday on
`/settings/permissions`. Probed by revoking `fees.collect` from the Administrator
role in a rolled-back transaction:

```
Administrator may no longer run Fee defaulters, so nothing was sent.
That role lost fees.collect.
```

## The mechanism, which `0238` got wrong

`0238` built the function `SECURITY DEFINER`, like everything else in the
scheduler. Probed the moment it applied:

```
ERROR: 42501: cannot set parameter "role" within security-definer function
CONTEXT: SQL statement "reset role"
```

> **Postgres forbids `SET ROLE` anywhere inside a `SECURITY DEFINER` frame**,
> and the scheduler is definer all the way down — `schedules_tick` and
> `schedule_run` both are, necessarily, because they write rows for a tenant
> whose JWT nobody is holding.

The decision was right and the mechanism was impossible, which is worth keeping
apart: the feature was never blocked on taste. It was blocked on a rule of the
engine that nobody had looked up.

**Both halves of the impersonation are needed and neither is optional.**

| | alone | why not |
|---|---|---|
| the JWT claims | `postgres` carries `BYPASSRLS` | the report answers with **every college's rows**, looking entirely ordinary |
| `set role authenticated` | `current_tenant_id()` is null | the answer is **zero** |

Measured rather than reasoned. `schedule_report_digest` on `fees.defaulters`,
same function, same day, two colleges:

| caller | rows |
|---|---|
| Rajesh Kumar Mahavidyalaya's principal | **96** — what they get asking themselves |
| Northgate Academy's principal | **0** |

`BYPASSRLS` would have answered 96 to both. And `current_user` is back at
`postgres` afterwards, including down the exception path — leaving the session
as `authenticated` would make every later statement in the tick answer for a
person who is not there.

## Two wakers, and only one of them can

Building the tick turned up the fact that decides its shape:

> **`service_role` is not a member of `authenticated`.** Measured:
> `pg_has_role('service_role','authenticated','USAGE')` is **false**, and
> `pg_has_role('postgres','authenticated','USAGE')` is **true**.

So the `schedule-tick` Edge Function — which authenticates as `service_role` —
cannot run a report as anybody. The tempting repair is
`grant authenticated to service_role`, which edits the role graph of the
platform this product runs on, permanently and for everything else that key
touches, to save a second cron entry. It is not done.

```
cron (postgres)                       Edge Function (service_role)
  ├── schedules_tick()          <---- also called here
  └── schedule_digests_tick()         cannot be: no SET ROLE
```

It costs nothing. A digest is queued through `notify_send_for` like every other
message, and the dispatcher — which is where the provider secrets are, and the
only reason the Edge Function exists — sends it afterwards either way.

`tests/schedules/waker.test.ts` asserts the cron wakes everything the Edge
Function wakes. That direction is the one that matters and still holds; the
reverse is now **deliberately false**, so
`tests/schedules/digest-authority.test.ts` carries the other half: the Edge
Function must never be given this RPC, because the failure would be a runtime
error naming a role rather than a report, every morning, at a school. The tick
also refuses such a caller in a sentence at its top rather than as `42501` from
inside a report somebody is waiting for.

## The claim is the thing that must not race

`schedule_runs` is unique on `(schedule_id, occurrence_at)` and the run opens
with `on conflict do nothing`, so **whichever tick reaches an occurrence first
owns it.** A message tick that kept picking up digest schedules would claim the
occurrence and then refuse it — a race whose loser is always the one that could
have done the work.

So the two ticks take disjoint sets of kinds out of **one list**,
`schedule_kinds_needing_authority()`. Two hand-written lists are two answers and
the second one drifts.

The filters are shaped differently on purpose, and the asymmetry is the point:
the digest tick names what it **takes**; the message tick names only what it
**leaves**. A kind added to the CHECK next year is therefore picked up by the
message tick, where an unimplemented kind raises by name into a `failed` run
somebody can read — rather than being run by neither.

Excluded at the source rather than skipped in the loop, too: skipping would let
a college with twenty-five digest schedules starve its own absence notices out
of the tick's limit, without either tick doing anything wrong.

And the report runs **before** the occurrence is claimed. Two ticks racing would
both compute an answer and one would discard it — a wasted read. Claiming first
and computing second would cost a *sent message with nothing behind it*, which
is the worse of the two.

## What the digest carries

**A count, never the rows.** The subject is *"Fee defaulters — 96 rows today"*
and the body is *"Fee defaulters has 96 rows today. Open Reports to see them."*
The recipient is the creator and nobody else, because here the authority
question and the audience question are the same question — which is also what
makes editing somebody else's digest useless as an attack: the answer goes to
its owner, not to whoever changed it.

Three bodies, because a sentence with a number in it needs its number agreeing
in every word:

| rows | body |
|---|---|
| 0 | *"… found nothing today. That is the whole answer, not a message that failed to arrive."* |
| 1 | *"… has 1 row today. Open Reports to see it."* |
| n | *"… has n rows today. Open Reports to see them."* |

Zero is deliberately still sent. *"Nothing to report"* is an answer; silence is
indistinguishable from a tick that did not run, which is this module's oldest
lesson.

## …and the card had to learn what `matched` counts

`runSentence` read `matched` as people for a hundred migrations, because for the
three message kinds it is. A digest's `matched` is **rows of a report**, so the
same helper would have said *"1 of 96 were told"* about a fee reminder that went
to nobody but the bursar.

> A number right about arithmetic and wrong about what it counted is this
> codebase's oldest recurring defect — `subscription_usage` at 303 students for
> a college with none, `attendance_coverage` at eleven classes on 0.0%, a cost
> printed for an SMS that was never sent.

`runSentence(run, kind)`, with both plural forms carried rather than a stem and
a rule, and the register's own note always winning.

## A digest that refuses itself is a schedule that does not work

`schedule_problems()` warned when a run *matched somebody and told nobody*. A
digest whose creator left, or whose role lost the permission, matches nobody
**and** tells nobody — so it landed as a clean `done` with a sentence in the
register that no screen read. Rule 7's line, arriving at the one kind that can
refuse itself:

```
The last run sent nothing. Administrator may no longer run Fee defaulters,
so nothing was sent. That role lost fees.collect.
```

And the waker critic gained the case `0230` could not have: where the **message**
schedules' absent in-database job is `info` — an Edge Function is a supported
and invisible-from-here answer — a **digest**'s is a `warn`, because nothing
outside the database can run one. Silent unless the college actually has a
digest switched on, which is the bar CLAUDE.md sets for a critic.

## The picker is the same question the run asks

`report_list()` already filters by the caller's own permission matrix, and a
digest runs as its creator — so the form offers exactly what its owner may run,
and a report cannot be scheduled by somebody who would be refused it at seven
the next morning. One definition consulted by both: `listSchedulableReports`
wraps `listReports` rather than issuing its own `report_list`, and the server
action re-asks the same question at the boundary, because a Server Action takes
whatever is posted to it.

The second filter is **parameters**. A digest runs with none — there is nobody
at the screen to type a date range — so a report with a *required* parameter
cannot be scheduled at all. Of the twenty catalogued reports, **16 are
schedulable and 4 are not** (`attendance.summary`, `fees.collection`,
`notifications.deliveries`, `timetable.section_routine`). Saying so beats
offering them and failing every morning: *a control that will refuse you is
worse than no control, because it costs the person the work of trying.*

## Probed live, end to end

A digest created at the demo college with its occurrence ten minutes past, run
through `schedule_digests_tick()` as `postgres`:

```json
{"ran": 2, "sent": 1, "refused": 0, "missed": 1, "failed": 0, "remaining": 0}
```

- today's occurrence: `done`, matched **96**, notified **1**
- yesterday's: `missed`, *"Not run: 1450 minutes late…"* — the grace mechanism
- the message: *"Fee defaulters — 96 rows today"*, `in_app`, `sent`, to the creator
- the message tick sees **0** digest occurrences
- a second tick is `ran: 0` — the unique index holds
- `current_user` afterwards: `postgres`

And in production rather than in a probe: `cron.job_run_details` for
`schoolos_schedule_digests_tick` shows two firings at 12:55 and 13:00,
both `succeeded`.

Refusals, each in a rolled-back transaction:

| planted | answer |
|---|---|
| `fees.collect` revoked from the creator's role | *"Administrator may no longer run Fee defaulters…"* |
| `report_key` naming a report that does not exist | *"There is no report called fees.gone_away any more."* |
| `params` with no `report_key` | *"This schedule does not say which report to run."* |
| `created_by` updated | raises: *"A schedule's owner cannot be changed…"* |
| the tick called as `service_role` | raises: *"This role cannot become a member of the college…"* |

## What this still does not do

- **A digest is a count, not an attachment.** Mailing the rows themselves is a
  PDF or a spreadsheet, which is `jobs` work and is not built.
- **`schedule_report_digest` reads `total_count` only.** That costs a full pass
  over the report whatever the page size — rule 7's honest ceiling, paid once a
  morning rather than designed around.
- **One digest is one report.** A single morning email combining four is a
  second concept (an ordered list, a per-report failure, a partial send) and is
  named rather than half-built.
