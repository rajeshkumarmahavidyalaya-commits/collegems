# The queue — what resumes a bounded operation until it is finished

Migrations `0242`–`0244`, `/settings/jobs`, and one cron entry.

`public.jobs` was created in `0007`. Two hundred and thirty-five migrations
later it had **0 rows**. Rule 7 named it the home of "anything unbounded" the
whole time, so the honest question before writing a worker was why nothing had
ever queued anything.

---

## It was not neglect, and that is the finding

Every module obeyed rule 7's *other* half. Measured across the product:

| operation | its declared bound | what it tells the office |
|---|---|---|
| `import_apply_run` | 500 rows | *"Split it — importing the first 500 silently would be worse."* |
| `invitation_preview` | 1,000 people | *"Narrow it to one class at a time."* |
| `accounts_sync` | 200 documents a page | returns `remaining` |
| `report_run` | 1,000 default, 5,000 max | returns `total_count` |
| `checks_run` | first 200 | *"showing the first 200"* |
| `notify-dispatch` | 200 deliveries or 40 s | returns how many are left |

Every one of those is correct and none of them changed. But read the
right-hand column as a whole and the defect is there in the product's own
words:

> **A bound that fits a request is not a bound that fits the work.** Every
> module capped its run, and the cap became the office's job: press again,
> narrow it again, split the spreadsheet again. A college loading five thousand
> historical receipts presses *Sync* **twenty-five times**.

So the queue is not a way to do bigger work in one go. It is **the thing that
presses the button again** — which is why `accounts_sync` is the first kind
rather than the most impressive one. It already returns `(created, remaining)`,
which is exactly the contract a resumable job needs, and that second number had
no reader except a person's patience.

### …and a number this module's own header nearly quoted

The first draft of `0242` opened with *"323 fee receipts are unposted today"*.
Measured with `source_kind = 'ledger_entry'`; `accounts_sync`'s own predicate is
`'fee_ledger'`. Re-measured, the backlog is **0** — an earlier session pressed
the button.

*A number measured with a broken instrument is worse than no number, because it
is a number people quote.* The argument rests on the structure instead, and the
migration says so where the number would have been.

---

## Whose authority does a job run under?

Rule 7's answer was written before `0240` found the mechanism:

> *"Edge Functions use the service role (bypassing RLS), so they must filter by
> `tenant_id` explicitly."*

Taken literally here it means rewriting **six** correct `SECURITY INVOKER`
functions — `accounts_sync`, `import_apply_run`, `invitation_apply`,
`promotion_apply`, `renewal_apply`, `fees_generate_section_invoices` — as
definers with hand-written tenant filters. **Reimplementing RLS six times in
order to avoid using it**, and losing row ownership on every one.

So the worker is `schedule_digests_tick`'s mechanism generalised: pg_cron as
`postgres`, `SET ROLE authenticated` with the creator's claims, **outside every
definer frame**, calling the module's own function unchanged. Three constraints
carry over verbatim and are not re-derived:

- a `SECURITY DEFINER` frame may not `SET ROLE`, so `job_run_as_creator` and
  `jobs_tick` are the two INVOKER functions in a definer module and the
  bookkeeping is a separate definer call;
- `service_role` is not a member of `authenticated`, so an Edge Function cannot
  run a job and is not given the tick;
- both halves of the impersonation are needed — claims alone leave the caller as
  `postgres` with `BYPASSRLS`, the role change alone leaves `current_tenant_id()`
  null.

### The authority is re-checked every attempt, never remembered

`job_run_as_creator` re-reads the creator's `user_profiles` row and their role's
`role_permissions` on **every** attempt. Probed by revoking `accounts.manage`
from the Administrator role between two ticks of a live job:

```
status  refused
error   Administrator may no longer post receipts to the ledger, so the rest of
        this was not done. That role lost accounts.manage.
```

A bursar who left in March is not still posting vouchers in June.

**And `refused` is deliberately not `failed`.** A failure may come right on a
retry; a refusal is a decision that changed and calls for somebody to do
something different. `0207`'s `past_due` is not `expired`, for the same reason —
and `job_record`'s refusal branch does not touch `attempts`, because there is
nothing to retry.

---

## What it looks like running

A 250-voucher backlog, planted by deleting vouchers and their lines (voiding a
posted one violates `journal_vouchers_posted_chk`, which is rule 6 working):

| tick | returned | note on the row | status after |
|---|---|---|---|
| 1 | `{"ran":1,"continued":1}` | *"200 posted, 50 still to go."* | `queued` |
| 2 | `{"ran":1,"completed":1}` | *"50 posted. The ledger is up to date."* | `completed` |

`result` is `{done: 250, remaining: 0}`, and `current_user` is back to
`postgres` after both. **Nobody pressed anything between the two.**

### The lease, because a worker that dies holds a job for ever

`processing` with no lease is the classic queue bug: the row sits there and
nothing on earth moves it. `jobs_reap()` returns expired leases to the queue and
charges the attempt. Probed by expiring one by hand:

```
reaped 1 -> status "queued", attempts 1
```

### Four refusals, each a sentence

| tried | answer |
|---|---|
| `service_role` calls the tick | *this can only be run by a role that may act as a member of a college* |
| a teacher inserts into `jobs` directly | *Your role cannot start Post receipts to the ledger. That needs accounts.manage.* |
| an undeclared kind | *There is no kind of job called x. Add it to reference.job_kinds first.* |
| a second live job of one kind | *That is already running. It will carry on by itself — starting a second one would have the two of them racing for the same rows.* |

The second is the one that matters architecturally. `jobs` carries an INSERT
policy, so **a plain insert through PostgREST routes around any function**
(`0205`'s lesson): the permission lives in a `BEFORE INSERT` trigger, which also
stamps `created_by := auth.uid()` so the client cannot nominate whose
permissions the job will later use. `job_enqueue` is the door with the good
manners — a readable duplicate refusal — rather than the gate.

---

## The catalogue, and the two kinds

`reference.job_kinds` is the fifth catalogue-as-data, beside permissions,
reports, checks and plans. In `reference` because a job *kind* belongs to no
college, which keeps rule 1's schema guard over `public` meaningful.

| kind | permission | page | attempts |
|---|---|---|---|
| `accounts.sync` | `accounts.manage` | 200 | 3 |
| `invitations.apply` | `users.manage` | 1,000 | **1** |

> **`max_attempts = 1` is right for anything that sends.** An invitation is a
> message: a half-sent list retried from the start writes to some families
> twice. So that kind runs once, reports one outcome, and is not paged — rule
> 10's *"a failed announcement is not a failed publish"* arriving at the queue.

Which *function* implements a kind is product code and lives in the branch
inside `job_run_one`, exactly as `schedule_run` does. The catalogue says what
exists and who may start it; it does not say how.

`job_run_one` is executable by `authenticated`, and that is not a widening: it
is called **while already impersonating**, and both branches call functions a
member of the college may call anyway with RLS deciding the rows. The privileged
part is `job_run_as_creator`, which decides *whose* permissions those are, and
that one is revoked from everybody.

---

## The waker, and why one minute rather than five

`0242` built the queue and stopped one step short of the thing that makes it a
queue. That omission has a shape this codebase has recorded twice before —
`0229` gave the scheduler a waker a hundred and twenty migrations late, `0163`
gave `audit_log` a reader after 24,000 rows. **The machinery is the part that
gets built; the thing that turns it on is the part that gets left.**

Both existing cron entries run every five minutes. This one runs every minute:

> **A schedule is the school's standing decision and nobody is waiting. A job is
> somebody's request, made now.** A bursar who presses *Post to the ledger* and
> watches nothing happen for five minutes concludes it is broken and presses
> again — and `jobs_one_live_per_kind` then refuses them, which is correct and
> reads as a second failure.

The cost is a query a minute that usually returns nothing: `jobs_due` is an
index-only scan of a partial index over a table that is empty when there is no
work. Live: **20 firings, 20 succeeded, 0 failed.**

And the critic, because a queue that fails quietly is worse than none:
`job_problems()` has three branches — given up on, refused, and stuck behind a
lease — catalogued in `reference.checks` as `jobs.queue` so it reaches
`/checks`. Both plural forms are carried per `0196`.

---

## The screen

`/settings/jobs` lists this college's jobs, offers the kinds the caller may
start, and stops one. Three things about it:

- **The picker asks the matrix.** `job_kinds_available()` filters by
  `role_has_permission`, `report_list()`'s shape, so what is offered is exactly
  what `job_enqueue` would accept. *A control that will refuse you is worse than
  no control* — the fourth instance this codebase has fixed, after a teacher
  taken through a whole certificate form to meet a raw `42501`, an accountant
  shown every schedule switch, and an unmapped plan drawing a *Buy* button.
- **It polls only while something is live**, and stops when nothing is. A page
  that refreshes for ever is a page that costs a college money to leave open.
- **A job that has done 200 of 250 and gone back on the queue is *carrying on*,
  not "waiting".** `jobSentence` says so, and a guard pins it. Saying "waiting"
  would put the office back where they started, wondering whether to press
  something — which is the defect the whole module exists to remove.

The *Sync* button on `/accounts` now queues instead of running. What it used to
say is quoted in the comment that replaced it:

```
`${remaining} still to go — run it again.`
```

And `syncSubledgers()` was **deleted rather than kept beside it**: an exported
server action with no caller is a second way in, and it would bypass
`jobs_one_live_per_kind` entirely.

---

## Guards

`tests/jobs/queue-authority.test.ts` — 14 assertions, no database, each verified
by planting the violation and confirming it goes green on revert. Twenty-five
plants; **two of them passed**, and both were the same mistake:

> **An assertion that a string appears somewhere guards the string, not the
> mechanism.** `expect(record).toContain("'refused'")` passed on a body that
> read the flag and wrote `'failed'` anyway, because `p_outcome ->> 'refused'`
> still contained the word. `expect(body).toContain("request.jwt.claims")`
> passed on a body that set some other setting, because the saved copy and its
> two restores still mentioned it.

Both are anchored on the statement now — the refusal branch and the failure
branch read separately, and the claims asserted as a `set_config(... ,
jsonb_build_object(` carrying the college. This codebase had already written
that rule down twice, in `0232` and in the `0219` guard; it cost two rewrites
here anyway, which is the argument for planting every violation rather than
reasoning about the assertion.

A third plant "passed" and should not be counted against the guard: it added
`security definer` to `invitation_apply` in `0232`, and `0233` redefines that
function. `latestDefinition()` resolved to `0233` and was right to — *"what does
this function do"* is always a question about the highest-numbered file that
defines it, which is `tests/schema/a-reason-is-kept.test.ts`'s rule doing its
job. The plant moved to `0233` and was caught.

---

## What is not built

- **A third kind.** `report_cards.render` is the obvious one — 302 report cards
  is the 10.4 s that `docs/modules/pdf.md` measured and named as the first thing
  genuinely needing a queue. It is blocked on something real rather than on
  effort: the renderer is Node (pdf-lib, an embedded font) and a job runs inside
  Postgres, so the kind needs a worker process that is neither, plus rule 8's
  Storage choreography to put the files somewhere. Named rather than half-built.
- **`import_apply_run` and `promotion_apply`** are both good candidates and both
  are rule 13 previews a person is standing in front of. Queueing them would
  turn *"a screen somebody argues with"* into a job id, which rule 7 already
  refused once for promotion. The case to revisit is a college importing
  thousands of historical rows, not a school admitting a class.
- **Priority, and more than one job at a time.** `jobs_due` orders by
  `not_before, created_at` and the tick takes a handful. A college with two
  kinds of work in flight is served correctly and not quickly, and nothing here
  measures a case where that matters.
