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
