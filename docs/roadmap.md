# Roadmap — from built to working

Written on 14 September 2026, against measurements rather than impressions.
Every number here came from the live project or the repository on that day; if
you are reading this later, re-measure before trusting it.

---

## The governing fact

| built | exercised |
|---|---|
| 229 migrations | **0** scheduled runs ever fired |
| 100 tables, 493 functions, 251 policies | **1** message ever sent, and it was in-app |
| 92 routes, 47 server-action modules | **1 of 5** channels enabled and configured |
| 6 Edge Functions | **0** devices registered |
| 67 permissions, 19 reports, 12 critics | **0** payment intents, **0** promotion runs |
| 45 module docs | **2** logins, both administrators |

The office-facing product is broadly complete and the isolation boundary is the
strongest part of the system. What has never happened is **traffic**. Every
module in this codebase is written against a dispatcher that has delivered one
message and a scheduler that has run zero times.

So this plan is ordered by **risk retired per unit of work**, not by feature
count. Phases 0 and 1 are small and retire almost all of the unknown; everything
after them is ordinary work.

---

## Phase 0 — Make the test suite runnable

**Why first:** every later phase is a schema or policy change, and the two
suites that make those safe — `tenant-isolation` and `schema-invariants` —
are among the 49 of 97 test files that need a database.

Worse than not running: **they fail rather than skip.** Without
`.env.test.local`, `npm test` is red in every environment, so a real regression
is indistinguishable from a missing password. That is this codebase's own rule
about a check nobody can get green, turned on its own suite.

| Do | Acceptance |
|---|---|
| The database suites skip *loudly* when unconfigured | `npm test` green on a clean checkout, with a named skip count |
| CI on every push: typecheck, lint, build, tests | A migration that breaks isolation fails before merge |
| Document how to create the two test tenants | Somebody new can run the full suite in under ten minutes |

---

## Phase 1 — The cold start: one real family, end to end

The highest-value work in the plan, and most of it is configuration.

1. Set `RESEND_API_KEY` on `notify-dispatch`; enable the email channel.
2. Invite one real guardian from `/settings/team`; confirm the email arrives.
3. They sign up, then open their child's fee account and timetable **in a
   browser** — not in a rolled-back probe.
4. Point a cron at `schedule-tick` every five minutes.
5. Let one evening absence notice reach one family.

| Measure | Now | Target |
|---|---|---|
| `schedule_runs` | 0 | > 0, with `sent` outcomes |
| deliveries `sent` on a real channel | 0 | > 0 |
| family logins used from a browser | 0 | ≥ 1 |

**Budget real time for what this breaks.** Everything in this codebase that was
probed but not lived has had defects — the register that filed into a year that
had ended, the phone that still said the child had a bus, the card that showed a
lapsed seat. Do not plan past Phase 1 until it is green.

---

## Phase 2 — Onboarding at school scale

One family proves it works; 555 families is the product.

- **Bulk invitation.** Rule 13's shape: a preview of editable rows, applied
  through `invitation_announce` so the preview and the send cannot disagree.
  Skip rows with no address; name the ones who already have a login.
- ~~**SMS invitation.**~~ Done, migrations `0233`–`0234`. The delivery table
  took it unchanged, as predicted; the body needed the second message, as
  predicted. What was not predicted: the email body is **UCS-2 because of two em
  dashes, so sending it as-is would have been 6 segments — 3,330 billable parts
  for 555 families.** The short one measures 137–147 GSM-7 characters, 555 of
  555 in one segment. `sms_segments()` is the executable half.
  **Still open underneath it: DLT.** Indian carriers accept transactional SMS
  only from a registered sender ID and template. Not modelled — by this work or
  by the three events that have defaulted to SMS since `0033` — so SMS here is
  deliverable outside India today and needs a driver change plus a per-tenant
  sender ID setting to be deliverable inside it.
- ~~**A list behind the critic.**~~ Done, migration `0235`. Rule 11's shape: a
  catalogue row, not a screen. Writing it found the critic **over-reporting to
  any non-administrator holding `users.manage`** — 302 of 302 where the truth was
  301, plus a severity escalation and a silently missing second finding, because
  `user_profiles` and `invitations` are admin-only and a `not exists` cannot tell
  absence from invisibility. Both halves now read one definer model, so the count
  and the list cannot disagree. On the demo college the list is **299 not
  invited, 2 with no guardian at all, 1 able to sign in** — and the two are the
  sharper finding, because no invitation run would ever have reached them.
- ~~**A student's address.**~~ Partly done, migration `0236`, and the premise
  was wrong. This was filed as office work — *302 active students, one email
  between them, somebody has to type them in* — and reading the importer first
  found that **a bare `Email` column landed on the child while a bare `Phone`
  column landed on the guardian**, so one spreadsheet's two contact columns were
  filed against two different people. The guardian, who is the one who signs in,
  finished every import with a number and no address; `guardian_add` had read the
  email key since `0221` and no caller ever set it. Fixed, with student email and
  phone given headings that say whose they are.
  **What is still office work:** the 302 children already imported. `0235`'s
  report names them, and re-importing is not the repair — the guardian editor on
  `/students/[id]` is. Migration `0237` makes that report a **worklist**: the
  student column links straight to the child, so the afternoon is 301 clicks
  rather than 301 copy-paste round trips.

| Measure | Now | Target |
|---|---|---|
| students whose family can sign in | 0 of 302 | > 80% |
| students with an address of their own | 1 of 302 | the college's call |

**Done in this phase, beyond the list above:** every seat probed once. Five of
the six roles had never been signed into, and two screens were wrong about who
they were for — see [role-access.md](./modules/role-access.md).

---

## Phase 3 — The genuinely unbuilt

**Scheduled reports are done** (migrations `0238`–`0241`). The decision was the
blocker and it is made: *a scheduled report runs as the person who scheduled
it*, stamped by a trigger, immutable, and re-checked every occurrence. Building
it turned up two facts about Postgres that shaped the whole thing — a
`SECURITY DEFINER` frame may not `SET ROLE`, and `service_role` is not a member
of `authenticated`, so the digest tick has exactly one waker. See
[schedules.md](./modules/schedules.md).

**And this list said something false about printing.** *"Report cards,
certificates and ID cards are screen-only, and a school hands parents paper"* —
checked, and there are **seven** `window.print()` entry points and a full
`@media print` block with per-child page breaks, an eight-up ID-card sheet, and
`print-color-adjust: exact` so photographs survive the browser's
background-graphics default. A school can hand parents paper today.

> **A roadmap entry ages into a claim nobody re-checks.** This one had been true
> when it was written and was quietly wrong for months, in the direction that
> costs most: it described work as missing that was done, next to work described
> as missing that was.

**Server-side PDF is done too**, and it turned out not to be `jobs` work at all.
The entry had inherited its mechanism rather than measured it: *render the page
to PDF* needs a headless browser, which is heavy, which is queued. Building the
document from the row that already holds it is **5,360 bytes and 57 ms** — a
query, not a job. Certificates and fee invoices download as files today; see
[pdf.md](./modules/pdf.md).

> **The line falls between two numbers, not at a word.** One document is 57 ms;
> 302 of them is 10.4 seconds. Rule 7's test is boundedness, and *PDF* was never
> the thing that made it unbounded.

What is genuinely left:

- **The `jobs` worker.** Still zero rows since `0007`, and now there is finally
  something that needs one: a whole class of report cards is 10.4 s, which is
  exactly what rule 7 says to queue.
- **Storage, and therefore attachment.** The PDF routes stream bytes; nothing is
  written to the `documents` bucket. A file *attached to an email* has to exist
  before the dispatcher runs — rule 8's choreography plus a rule 10 change to
  carry an attachment on a delivery.
- **A digest that carries the rows.** `report.digest` sends a count and a link,
  deliberately — the attachment is the item above, wearing a different hat.
- **Report cards and ID cards as files.** Both belong in `Sheet`; the report card
  must render `exam_results`' frozen numbers and `rules_snapshot` rather than
  recompute a rank whose cohort has changed.

---

## Phase 4 — Performance, measured at real size

Not urgent, and the reason is specific: 302 students is a small college and
nothing here is slow at that size. It matters at 2,000–5,000.

- Seed a 3,000-student tenant and re-run `docs/performance.md`'s numbers.
- **Measure as the caller.** The dominant cost in this codebase has consistently
  been RLS policy evaluation rather than rows — `checks_run` was 35× cheaper as
  `postgres` than as an administrator, which is a measurement of the instrument,
  not of the query.
- Watch `report_run` over `audit_log`: 24,777 rows today and unbounded, and a
  set-returning function is an optimisation fence, so its projection runs for
  every matching row rather than every returned one.

The front end is already fine: 103 kB shared, worst route 236 kB.

---

## Phase 5 — The deferred security rewrite

Sixty policies compare `current_role_code() = 'admin'`, so a college that grants
`certificates.issue` to its clerk is still refused by Postgres. Migration `0213`
narrowed the matrix to agree with the boundary for every role that exists today;
making the matrix load-bearing is the real fix.

**Explicitly gated on Phase 0.** Its proof is the isolation suite, and doing it
unproven would be the worst version of it.

---

## Deliberately not on this list

- **A platform-operator console that reads across tenants.** Rule 1 exists to
  make that impossible. The metadata-only version is correct; the cheap version
  puts a hole in every other rule.
- **Support impersonation.** Needs consent, a time limit, and an audit trail the
  college itself can read. Its own project, with its own guard.
- **More modules.** There are 45. The constraint is not coverage.
