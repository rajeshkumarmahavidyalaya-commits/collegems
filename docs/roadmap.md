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
- **SMS invitation.** All 555 guardians have a phone as well as an email, and
  email deliverability to Indian parents is poor. The delivery table takes it
  unchanged; the body needs a second, short message, because an SMS is not 340
  characters.
- **A list behind the critic.** `family_login_problems()` gives the number; the
  office needs the names to work through.

| Measure | Now | Target |
|---|---|---|
| students whose family can sign in | 0 of 302 | > 80% |

---

## Phase 3 — The genuinely unbuilt

- **The `jobs` worker and PDF rendering.** Report cards, certificates and ID
  cards are screen-only, and a school hands parents paper. This is the last
  named `jobs` work.
- **Scheduled reports.** Blocked on a decision, not on code: *whose authority
  does a schedule run under?* The recommendation is the creator's, stamped on
  the schedule and re-checked at each run, so revoking their permission stops
  the schedule. It has stayed unbuilt because that is a decision the module
  should not make quietly.

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
