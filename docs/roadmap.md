# Roadmap — from built to working

Written on 14 September 2026 and **re-measured on 20 September 2026**, against
measurements rather than impressions. Every number came from the live project or
the repository on the day it is dated; if you are reading this later, re-measure
before trusting it.

---

## The governing fact

Seven days on, the left-hand column moved and the right-hand one did not. That is
the finding, not the individual numbers.

| built (14 Sep → 21 Sep) | exercised (21 Sep) |
|---|---|
| 229 → **261** migrations | **0** scheduled runs ever fired |
| 100 → **106** tables, 493 → **541** functions, 251 → **262** policies | **1** notification ever composed; its only `sent` delivery is in-app |
| 92 → **98** page routes, and **9** route handlers | **0 of 5** channels configured — `in_app` is on, and it needs no provider |
| 6 Edge Functions | **0** devices registered |
| 67 → **69** permissions, 19 → **20** reports, 12 → **15** critics | **0** payment intents, **0** promotion runs, **0** jobs |
| 45 → **51** module docs | **3** logins, **all three** administrators |
| 5 cron entries, all active | **0** objects in Storage |

Two things did move on the right, and both are worth naming:

- **Somebody used the invitation screen.** There is one real `email` delivery
  addressed to a live mailbox, sitting at `queued`. It is not stuck — it is the
  held-queue rule working exactly as written: email is `is_enabled = false` and
  `provider_configured = false`, so the dispatcher will not claim it, and it
  will go out on the day a key is set rather than being dropped.
- **The scheduler has its waker.** Five pg_cron entries are live and firing
  (`schedules_tick`, `schedule_digests_tick`, `jobs_tick`,
  `expire_stale_deliveries`, `expire_trials`). `schedule_runs` is still 0
  because all six schedules are `is_enabled = false` — which is the *"anything
  seeded arrives switched off"* rule, not a broken tick.

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

| Do | Acceptance | 20 Sep |
|---|---|---|
| The database suites skip *loudly* when unconfigured | `npm test` green on a clean checkout, with a named skip count | **done** — verified by moving `.env.local` aside: `56 passed \| 48 skipped`, 776 passed, 510 skipped, **0 failures** |
| CI on every push: typecheck, lint, build, tests | A migration that breaks isolation fails before merge | **built and running** — and red on all 13 runs; see below |
| Document how to create the two test tenants | Somebody new can run the full suite in under ten minutes | `docs/testing.md` |

### …and CI was red for two different reasons, one of them mine

Thirteen runs, every one a failure, and the two jobs fail for reasons that
should not be confused:

- **`database-suites` fails on purpose.** The six repository secrets are unset,
  so the isolation suite skipped, and the job then runs
  `echo "::error::The database secrets are not configured, so tenant isolation
  was never proved." && exit 1`. That is Phase 0's own rule — *skipping is not
  passing* — working exactly as designed. It goes green the moment the secrets
  exist, and **only the repository owner can set them.**

- **`check` failed on a real defect, and it was invisible locally.**

  > `PageProps<…>` and `LayoutProps<…>` are not imports. They are **globals Next
  > generates into `.next/types` during a build**, so `tsc --noEmit` resolves
  > them on a machine that has built recently and fails on one that has not.

  Three files used them — `certificates/[id]/page.tsx`, `notices/[id]/page.tsx`
  and `layout.tsx` — and **five commits were pushed reporting "typecheck clean"
  while CI failed on every one.** Each of those reports was true of a working
  tree and false of a clean checkout, which is this codebase's own rule about a
  check that passes for the wrong reason, turned on its own toolchain.

  The fix is not to run `next build` before `typecheck` in CI — that makes a
  type check depend on a build and hides the next instance. The three files now
  write their props out, as every other page already did, and
  `tests/app-shell/typecheck-without-a-build.test.ts` fails on a reappearance.
  Verified by moving `.next` aside: clean typecheck, lint and build all pass.

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

**And the `jobs` worker is done** (migrations `0242`–`0244`). The honest
question before writing it was why `jobs` had 0 rows two hundred and thirty-five
migrations after it was created, and the answer was not neglect: **every module
obeyed rule 7's other half and capped its own run.**

> **A bound that fits a request is not a bound that fits the work.** Six modules
> cap correctly and every one of them made the cap the office's job — press
> again, narrow it again, split the spreadsheet again. A college loading five
> thousand historical receipts pressed *Sync* twenty-five times.

So the queue is not a way to do bigger work in one go; it is the thing that
presses the button again. `0240`'s impersonation made it possible without
rewriting six correct `SECURITY INVOKER` functions as definers with hand-written
tenant filters. Two kinds today — posting receipts to the ledger, and sending an
invitation list — and a screen at `/settings/jobs`. See [jobs.md](./modules/jobs.md).

What is genuinely left:

- **The `report_cards.render` kind.** A whole class is the 10.4 s that made the
  queue necessary, and it is the one thing the queue cannot yet take: the
  renderer is Node (pdf-lib, an embedded font) and a job runs inside Postgres,
  so it needs a worker process that is neither — plus the item below, to put the
  files somewhere.
- **Storage, and therefore attachment.** The PDF routes stream bytes; nothing is
  written to the `documents` bucket. A file *attached to an email* has to exist
  before the dispatcher runs — rule 8's choreography plus a rule 10 change to
  carry an attachment on a delivery.
- **A digest that carries the rows.** `report.digest` sends a count and a link,
  deliberately — the attachment is the item above, wearing a different hat.
- ~~**A real measurement of a class of ID cards.**~~ Measured — the renderers
  take plain documents, so a set can be sized without a database. **302 ID cards
  is 93.6 MB and 9.3 s; 302 report cards is 744 kB and 5.9 s** — 126× apart at
  the same number of children. The step that mattered is that **a set is its
  photographs**: at forty cards the file is 1.0019× the portraits it carries, so
  `MAX_PHOTO_BYTES`, which bounds the *input*, is within 0.2% a bound on the
  *response*. That was the assumption the ceiling rested on. Still unmeasured: a
  real photograph (0 objects in Storage, and a JPEG is ~10× smaller than the PNG
  used here) and the platform's own response ceiling. See
  [performance.md](./performance.md).

  The other half of that entry stands: `cardGaps()` had marked a missing
  photograph `blocking: true` since the module shipped and `blocking` decided a
  **text colour**. It is executable now — the PDF refuses where printing still
  goes ahead.

---

## Phase 3b — What a competitor's docs named that this did not have

`pro.eskooly.com/docs` is blocked by this environment's egress proxy, so the
list below came from search results describing eSkooly's feature set rather than
from the documentation itself. Each gap was then checked against **this**
codebase, which is the half that is certain.

**Closed: the syllabus.** Measured before building: zero occurrences anywhere —
*curriculum* here means `section_subjects`, and `study_material` is files.
Nothing said what was **in** a subject, and nothing recorded what had been
taught. Migrations `0255`-`0257`; see [syllabus.md](./modules/syllabus.md). The
shape is the decision: a syllabus is about a **course** (session, class level,
subject) and coverage is about a **class**, so one syllabus serves every
section that studies it and each covers it at its own pace — demonstrated,
Grade 1 · A 2/5 and Grade 1 · B 0/5 from the same rows. The pace carries three
numbers rather than one, because this college's current session ended on
31 Mar 2026 and a naive elapsed fraction reads **173%**.

**Closed: the exam seat plan.** Measured before building: 12 sections of 25-27,
302 candidates on each of 8 dates, 12 rooms of 40 — and the arrangement a
college gets for free, a section in its own classroom, puts **290 of 290**
adjacent pairs in front of the identical question paper. Generated, it is **0 of
290**. Migrations `0249`-`0254`; see [seating.md](./modules/seating.md). The
sharp part was again the policy: `0249` gated the tenant-wide read on
`exams.view`, which the matrix says is held by parent and student, so every
family could read the whole college's plan including the unpublished draft.
Found by probing as a candidate, which needed a login created in a rolled-back
transaction because this college has two logins and both are administrators.

**Closed:** *certificates for students **and employees***. `certificates.student_id`
was `not null`, so the whole frozen-document engine was structurally
student-only and `staff_exit` handed a departing lecturer nothing. Migrations
`0245`–`0248`; see [certificates.md](./modules/certificates.md). The sharp part
was not the schema but the policy — `staff view certificates` was tenant-wide,
and would have handed every teacher their colleagues' experience certificates
the day this shipped.

**Closed: inventory selling.** The note above read *"`stock_movements.kind` is
`adjustment | issue | receipt`"* and was measuring the **data in use** — the
CHECK has listed five kinds since the module shipped. The second half was
right, and is what made it a money change: migrations `0261`-`0264` take rule
6's library-fine pattern unchanged (a narrow INSERT policy for one entry type
carrying a source id, a partial unique index for idempotency, the charge booked
when the amount is final). Two things found on the way — `allowed_values`
answering **2 of 6** because it matched a different constraint, and a sale whose
charge was filed into the year the *date* falls in rather than the year the
school bills, so stock moved and **the balance did not**.

`0265` is the counter screen, and building the caller found the defect the
caller would have triggered: `0263` wrote *"a correction is two writes too"* and
guarded two of the three doors, leaving `stock_reverse_movement` — the one the
item screen already drew a button for, on every row — putting the goods back and
leaving the family charged. **A rule written into one function is not a rule.**
Plus three columns `0261` added that no reader had been taught to show, so a
sale could not name its buyer. See [inventory.md](./modules/inventory.md).

**Still open, measured as zero occurrences in `src/` and the migrations:**

| | notes |
|---|---|
| Online exam / quiz | a whole LMS; eSkooly sells it as an add-on |
| Live virtual classes (Zoom, BigBlueButton, Jitsi, Meet) | four third-party integrations, none testable here |
| Biometric attendance | needs hardware |
| QR / barcode on ID cards | the card renderer exists; a code with **no reader** would be a string nobody scans, so it is only worth building with the thing that reads it |
| Online parent/student registration | **structurally absent**: every route is behind the login wall, and `/signup` needs an invitation to get a tenant. `enquiry` is staff-entered |

And the counter-direction, stated because absence of evidence is not evidence:
the double-entry general ledger, the append-only money ledger with gapless
receipts, RLS isolation with four executable schema guards, the audit log's read
path, catalogue-as-data reports and checks, i18n with RTL, and scheduled reports
that run as the person who scheduled them were not visible in what search
returned — but the docs could not be read, so that is not a claim about eSkooly.

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
