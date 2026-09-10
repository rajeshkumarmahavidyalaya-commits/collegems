# SchoolOS — working agreement

Multi-tenant school ERP. Next.js 15 (App Router, RSC by default, Server
Actions) + Supabase (Postgres, Auth, Storage, Edge Functions) + Tailwind v4 +
shadcn/ui + TanStack Query/Table + Zod + react-hook-form.

This file is the contract. If a change would break one of these rules, change
the rule here first — deliberately — rather than working around it in code.

---

## 1. Multi-tenancy is the core, not an add-on

- **Every table in `public` carries `tenant_id uuid not null` and has RLS
  enabled.** No exceptions except `tenants` itself, which *is* the tenant (its
  policy compares `id` instead).
- **Isolation is enforced by Postgres, never by application code.** Policies
  read the tenant from the JWT: `public.current_tenant_id()` returns
  `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`. A missing `where tenant_id =`
  in a query is a performance bug, not a security hole — RLS still holds.
- `tests/rls/schema-invariants.test.ts` fails if anyone adds a table to
  `public` without `tenant_id` or with RLS off. It calls the
  `schema_guard_violations()` RPC; an empty result is the passing state.
- `tests/rls/tenant-isolation.test.ts` proves, in both directions, that one
  tenant's signed-in client cannot read, update, delete, or insert into
  another's rows. Extend it whenever you add a tenant-scoped table.
- Truly global, static reference data (the permission catalog) lives in the
  `reference` schema, **outside** `public`, so the invariant test stays
  meaningful. `reference.permissions` deliberately has RLS off: it holds no
  tenant data, and writes are revoked from `anon`/`authenticated` via GRANTs.
  Do not "fix" this by enabling RLS without policies — that would break reads.

### …but a policy only governs four statements

The sentence above — *"isolation is enforced by Postgres"* — is true of every
statement a policy can see, and that qualification is load-bearing:

> **A policy gates SELECT, INSERT, UPDATE and DELETE. It gates nothing else.**
> Row security does not apply to `TRUNCATE` at all; there, the privilege is the
> only check there is.

Supabase's default `grant all on tables to anon, authenticated` includes it, so
all 93 tables in `public` were truncatable by any signed-in user — `audit_log`
and `ledger_entries` among them — behind policies that were correct and
irrelevant. Probed on a scratch table whose policy read `for select using
(false)`: a caller acting as `parent`, unable to see a single row, emptied it.

So `authenticated` and `anon` keep the four privileges RLS can see and lose the
four it cannot — `TRUNCATE`, `TRIGGER`, `REFERENCES`, `MAINTAIN` (migration
`0159`). Three things generalise:

- **Revoking on today's tables fixes today only.** The grant is a *default
  privilege*, and a Supabase project has two entries for `public` — one owned by
  `postgres`, one by `supabase_admin`. Amend both, then create a table and check.
- **A guard, or it comes back.** `privilege_guard_violations()` is rule 1's
  second executable check, kept separate from `schema_guard_violations()`
  because shape and grants are different questions that fail for different
  reasons. It uses `has_table_privilege`, which follows role membership, rather
  than the grant tables, which do not.
- **A check that can never go green is a check people learn to ignore.** The
  guard covers `public` and `reference` and deliberately not `storage`, whose
  grants were made by a role this project is not a member of — a `REVOKE` there
  succeeds and changes nothing, silently. That exclusion is written down in
  migration `0160` and `docs/modules/privileges.md` rather than being a quiet
  `where` clause.

#### …and a third guard, on the indexes that hold rule 1 up

`tenant_id` leads every table, so it leads every composite index — and the
convention put `x_tenant_idx ON (tenant_id)` on every table too. The moment a
composite index arrived beside it, the single-column one answered nothing.
Measured with a prefix test over `pg_index`: **87 of the 262 plain indexes in
`public` and `reference` were strict prefixes of another plain index on the same
table**, a third of them. Migration `0204` drops them;
`index_guard_violations()` is the fourth executable check, beside the schema,
privilege and audit ones.

> **A btree on (a) is a strict prefix of a btree on (a, b): every seek the short
> one serves, the long one serves too.** That is a property of the structure,
> not a guess about query shapes — which is why the guard needs no workload to
> be true, and why partial and expression indexes are excluded on both sides.
> A partial index is a different index over different rows and is doing real
> work.

Two things about it are the point, and the second cost a rewritten migration:

- **The advisor is not the instrument.** Supabase's performance advisor reports
  103 unindexed foreign keys here. It asks whether an index's leading columns
  *exactly match* the FK's, in order; a foreign-key check needs a seek, which
  any index starting with one of those columns serves. Re-measured, it is **55**,
  and only **2** sit on an `ON UPDATE CASCADE` path — both pointing at
  `reference.locales`, whose key never changes. Rule 4's composite-key device is
  correctly indexed everywhere: the cascade from `exam_subjects` runs
  `Index Scan using marks_paper_idx`. Do not "fix" the 103.
- **It is not a speedup, and the first measurement said it was.** Inserting 300
  register marks went 635.5 ms → 329.8 ms, which would have been a 48%
  improvement in a commit message. In the same trace the *audit trigger* moved
  342.4 → 183.7 ms — and dropping an index on `attendance_records` cannot make
  `audit_log` faster. It was cache warmth. Measured properly, four runs each in
  one warm session with the control recreated inside the transaction: **102.0 ms
  with the redundant indexes, 105.7 ms without.** Indistinguishable.

> **When a number moves that your change cannot explain, the number is measuring
> something else.** The sweep rule — *a number measured with a broken instrument
> is worse than no number, because it is a number people quote* — has a timing
> half, and this is it.

So the justification is that the claim "two indexes are needed here" was false,
and that the write removed scales with the table: ~nothing at 6,000 attendance
rows, real at the 80,000 a school writes each year. Five other candidates in the
same pass measured clean and are recorded in `docs/performance.md` so nobody
proposes them twice — the RLS helpers are already `STABLE`, no policy calls a
bare `auth.uid()`, and a statement-level audit trigger buys 8% because the cost
was never the per-row invocation.

And the honest scope, because overclaiming a finding is its own inaccuracy:
PostgREST emits only the SQL it builds, so no browser was one request away from
this. What was missing was **the last line of defence** — the whole argument of
rule 1 is that the policy is the boundary and application code cannot be, and a
privilege no policy governs is a gap in that argument whatever today's routes
happen to reach.

## 2. Sessions (academic years) scope every transactional table

- Fees, marks, attendance, enrolments, payroll, timetable and library issues
  all carry `session_id uuid` **directly**, even when it is reachable via a
  join — so every query can filter on it without one.
- **The current session resolves server-side.** Use
  `public.current_session_id(tenant_id)` in SQL or `getUserContext()` in the
  app. Never accept `session_id` from client input.

### …and a row that carries a session must end with it

`session_id` says which year a row belongs to. That is a label, and a label
enforces nothing — so three tables carried one, let `ends_on` be null, and
documented null as *"runs to the end of the year"* in a comment nobody could
execute.

> **A null end date means the end of the row's own session, never "for ever".**
> Say that with a column, not with a predicate in every reader.

Eleven readers were asking `ends_on is null or ends_on >= <date>`, and to all
eleven an open-ended bus seat made in 2025-26 was still running in June 2027.
Measured on the demo school, one root cause with five faces:

- **the bill never stops** — 46 seats and 14 beds still billable fifteen months
  after their year ended;
- **the bed is never free** — `hostel_occupancy` read 14 of 14 rooms full, so
  next April the warden could place nobody. It reads 1 now;
- **the roster and the bill disagree** — the route list is session-scoped and
  `transport_fee_lines` is not, so from 1 April the transport screen is empty
  while 40 families are charged;
- **next year cannot be booked** — `daterange(starts_on, ends_on, '[]')` with a
  null end overlaps every future range, so the exclusion constraint refused a
  2026-27 seat with `23P01` and the module said *"End the current one first"*
  about a seat that ended in March;
- **a row outside its own year** — found by the constraint refusing to be
  created: a live bed starting 4 September 2026 on a session that ended on 31
  March, because `hostel_allocate` checked the *room's* session and defaulted
  `starts_on` to `current_date` without comparing the two.

The fix is rule 4's composite-key device carrying a **boundary** — the year's
own dates held on the child, `effective_ends_on` generated from them — and then
the eleven predicates are mechanical, *because* the row now knows the answer.
Migrations `0178` and `0179`; see `docs/modules/session-boundary.md`.

**The twelfth reader was a published contract, and it was found by probing a
phone.** The eleven were all SQL in `public`, all found by grepping for
`ends_on is null or`. `mobile_student_card` does not ask the question at all —
it re-exported the raw columns, so today's document for a guardian carried
`"status": "active"`, `"ends_on": null` **and** `"effective_ends_on":
"2026-03-31"` in one object, 162 days after the seat ended.

> *"Say that with a column, not with a predicate in every reader"* — and
> **publishing the column is not saying it.** A contract that ships all three
> facts and expects the reader to resolve them has moved the predicate, not
> removed it.

Measured: `0179` fixed the bill (**0 of 46** lapsed seats charged today, and all
46 still charged on their own last day, so the boundary is inclusive), and left
the screen. **88 families** were opening an app that said their child had a bus.
The money stopped; the screen did not.

Two mistakes, and the second is why the first survived a year:

- **`limit 1` over a history is "the latest", not "the current one".** The two
  read paths return every arrangement a child has ever had, which is right for
  the history screen; the card took its first row.
- **The card has a date and those two blocks never used it**, while every other
  date-sensitive block did. On the day an arrangement is made the latest one *is*
  the current one — **a bug that needs a year to pass is a bug that ships.**

Rule 14 is satisfied without a new version: no key is added, renamed or removed,
and `null` is what a day scholar's block already contains. Migration `0203`.

Two things worth copying from it:

- **A window is not a filter on the current session.** `fees_concession_lines`
  had both — an `as_of` parameter *and* a `current_session_id()` filter — and
  they disagreed: a back-dated invoice raised after a rollover credited
  nothing. One mechanism; the filter went.
- **Bounding a row makes a question askable that was not.**
  `academics_session_problems()` can now say *"46 bus seats end with 2025-2026
  and have not been renewed for 2026-2027"*, which nothing could say while the
  seats did not end. It is silent until six weeks before the year turns and
  silent again once the arrangements exist in the receiving session — rule 12's
  bar for a critic, applied to a date.

### …and the year a row is filed under is not the year it happened in

The rule above bounds a row by its session. This is the question one level up,
and it went unasked for 194 migrations: **which session does a row get in the
first place?**

`current_session_id()` is `select id from academic_sessions where is_current` —
a flag. Fifty-four functions read it, every dated write stamps its row with it,
and **nothing in the application could set it**: `promotion` read the list of
years, `getUserContext` read the current one, and that was every reference to
`academic_sessions` in `src/app`. There was no way to create next year and no
way to switch to it.

Measured on the demo school on 9 September 2026, with a year that ended on 31
March still flagged current: **6,000 of 6,000 register rows**, 323 of 323 ledger
entries, 317 of 317 invoices and 274 of 274 journal vouchers were dated outside
the year they were stamped with. The control is what makes it a finding rather
than an accident — `staff_attendance` (765 rows) and `leave_requests` (4) are
clean, and they are precisely the tables the seed dated with a fixed date inside
the year rather than with `current_date - n`.

> **`session_id` says which year a row is filed under; the row's own date says
> which year it happened in; and `current_session_id()` says which year the
> school has decided it is working in.** Three questions. A stale flag answers
> the first with the third and files a year of registers into a year that ended.

Three things follow, and the third is the one that is easy to get wrong:

- **Give the second question a name.** `academics_session_for_date(date)` is
  arithmetic, and it is only well defined because `academic_sessions_no_overlap`
  (rule 4's exclusion constraint) makes a date belong to at most one year. That
  constraint is load-bearing, not tidiness: without it `current_session_id`'s
  own `limit 1` is arbitrary too.
- **The flag stays a decision.** A school sets next year up in February and
  switches in April; a product that flipped automatically on 1 April would
  misfile the last week of enrolment work in the opposite direction. What was
  missing was not automation but a screen — `/academics/sessions`, and rule 6's
  sentence again: a correct write path nobody can call is not a fix.
- **A critic that cannot repair says so.** `academics_filing_problems()` names
  the misfiled rows and stops there, because re-stamping a register row's
  `session_id` would file it under a year while its `enrolment_id` still points
  at an enrolment in the previous one — consistent with the calendar and
  inconsistent with the child's place in the school. The repair is a promotion
  run, which is a decision with named children in it.

And one about writing for people, which cost two migrations to learn properly.
`0195`'s critic said *"1 certificates is dated between 7 Sep 2026 and 7 Sep
2026"*; `0196` fixed the noun, the verb, the number formatting and the
degenerate range, and left *"They belong to"* in front of one certificate.

> **Number agreement is a property of the whole sentence.** Fixing the subject
> and the verb and leaving the pronoun is not a partial fix; it is the same
> error one clause later, and on a screen whose only purpose is to be acted on
> it reads exactly as careless. Put every count-dependent word in one place —
> and carry both forms rather than a stem and a rule, because English plurals
> are not derivable.

And the write half, which `0195` named and did not do. `0198` stamps the year
from the row's own date wherever the date is the whole answer —
`mark_attendance`, `hr_mark_attendance`, `library_issue_book`,
`stock_record_movement`, `visitor_check_in` — and refuses, in a sentence, where
the row would then disagree with its parent:

> *9 Sep 2026 falls in 2026-2027, and these children are enrolled in 2025-2026.
> Promote them into 2026-2027 first, or check the date.*

That refusal replaces a **silent zero**. The old body filtered entries to
`enr.session_id = current_session_id()` and returned the count, so a register
taken in a year the children are not enrolled in wrote nothing and said
nothing, and the server action was left guessing between "no permission" and
"no longer enrolled".

Two boundaries keep this from becoming a blanket sweep, and both are the rule
rather than exceptions to it:

- **A row that bills a year is not a row that records a day.** An invoice's
  `session_id` is which year's fees it charges — `fees_billable_lines` decides
  that from the current session — so a bill raised on 3 September for 2026-27
  is a 2026-27 invoice whatever the calendar says. Rule 6's foreign key then
  ties the ledger to the invoice. Date arithmetic there would misfile April's
  arrears notice in the opposite direction.
- **A range is a different question from a day.** Leave, homework and exams
  carry two dates, and a leave from 28 March to 3 April belongs to one of two
  years by somebody's decision rather than by arithmetic. Named, not converted.

And the part worth copying: **the change broke two test suites, and that was
the useful half.** Both marked registers on dates no academic year covers —
`2020-02-03`, chosen so the suite "can never collide with a register a human is
taking today" — which was never a legal row. A constant that cannot exist in
production is a test asserting the wrong thing quietly; both now derive their
date from the session their subjects belong to.

Migrations `0195`–`0198`; see `docs/modules/academic-years.md`.

### …and the read side of it is not a bug until somebody rolls a year forward

`0198` gave a dated *write* its year. The reads were never given one, and the
reason that survived two hundred migrations is worth stating: **a list with no
session filter is indistinguishable from a correct one until a second year
exists in the table.**

`academics_roll_forward_sections` had run on the demo school, which makes
`sections` the only table holding two years — and the only place the omission is
visible. Everything else measured identical across years (`fee_structures` 24/24,
`homework` 32/32, `exams` 2/2) because nothing has been rolled forward into it
*yet*.

What it cost today: `listSections()` feeds the class picker on **seventeen
screens** and returned **24 rows across two years**, with *"Grade 1 · A"*
appearing twice under an identical label.

> **RLS answers which tenant and whose rows. It never answers which year.**
> `session_id` is on the table so a reader can filter without a join; a reader
> that does not is not protected by anything. And the failure is not the row
> count — it is the **duplicate name**, which no picker and no person can
> resolve.

Three things generalise:

- **The same omission handed a family another child's timetable.** `/timetable`
  defaulted to `sections[0]`, so a guardian of a child in Grade 6 A arrived on
  Grade 1 A's 35 lessons and had to find their own among twenty-four entries.
  The fix is the *list*, not the component: narrowing what a picker is given
  narrows its default with it.
- **A sweep is a starting point, not a bug count — and measure the instrument
  first.** The first pass here reported 90 unfiltered selects and 42 whole-table
  reads. Both were wrong: the script split a query at the next `;`, and this
  codebase builds one across several statements (`let q = …; if (x) q =
  q.eq(…)`), so functions that were already correct were counted as defects.
  Reading the whole enclosing function gives **54 and 19**. *A number measured
  with a broken instrument is worse than no number, because it is a number
  people quote.* Of the 19, eight meant "now" and are filtered; eleven mean
  "ever" and are named — the accounts module and the fee account are
  deliberately date-ranged (rule 6), a register is a history, and three of them
  are *"is this safe to delete"* counts where crossing years is the conservative
  direction. The question that decides each one: **is this list "now", or is it
  "ever"?**
- **A list read is not a lookup, and conflating them makes the fix worse than
  the bug.** Four pages found their exam with `listExams().find(e => e.id ===
  examId)`, so session-scoping the list alone would have 404'd every past exam's
  page. A lookup by id needs no year — the id names the row and RLS decides
  whether the caller may have it — so `getExam()` is a `maybeSingle()` by
  primary key and is deliberately *not* scoped.
- **Guard a Server Action's query by reading it, not by calling it.** These call
  `cookies()` from `next/headers`, so a test that imports one throws outside a
  request and never runs its assertion — a check that can never go green is a
  check people learn to ignore. `tests/academics/section-picker.test.ts` reads
  the function body for the filter and separately asserts, against the database,
  that no two classes in one year share a label.
- **And guard the omission, not the pattern.** `tests/academics/session-scope.test.ts`
  runs the corrected sweep in CI and requires every whole-table read of a
  session-scoped table to be named in `CROSS_YEAR_ON_PURPOSE` **with its
  reason** — the `nav-audience` guard's shape applied to rule 2. A new list
  nobody has decided about fails the test; a deliberate one is a line somebody
  wrote on purpose.

## 3. Auth

- Supabase Auth. A trigger on `auth.users` (`handle_new_auth_user`) resolves a
  pending row in `invitations` by email, stamps `tenant_id` + `role` into
  `raw_app_meta_data`, and creates the `user_profiles` row. A signup with no
  matching invitation gets no tenant — RLS then denies everything, which is the
  correct failure mode.
- Roles: `admin`, `teacher`, `student`, `parent`, `accountant`, `librarian`.
  They are per-tenant rows in `roles` (so a tenant can add custom roles later),
  and the role *code* is what RLS policies compare against.
- `user_profiles` links a login to the person/student/staff/guardian record it
  acts as. A young student may have no login at all — that is expected.

### …and until 0205, nobody could become a tenant

Rule 3's last sentence — *"A signup with no matching invitation gets no tenant —
RLS then denies everything, which is the correct failure mode"* — is true about
the data and was, for two hundred migrations, the entire onboarding story. The
only `insert into public.tenants` in the repo was the demo seed, and
`invitations`, which this rule builds signup on, appeared nowhere in `src/`
except the generated types. **An administrator could not invite their own office
staff**, and a school could not exist without somebody running SQL by hand.

> **The tenantless state is not an error to handle. It is the authorisation.**
> Somebody who signed up and matched no invitation is, precisely, somebody about
> to start a school — so `platform_start_school` serves exactly that caller and
> refuses everybody else. One predicate, `current_tenant_id() is not null`, and
> one school per login comes free.

Three things generalise from building it:

- **A JWT minted before a tenant existed does not have one.** The function
  stamps `raw_app_meta_data`, but every RLS policy reads the *token*, so without
  `refreshSession()` the person who just created a school is shown an empty one
  — every query correct, every answer nothing. The function returns
  `refresh_session_required` rather than leaving the caller to know that.
- **A seat limit cannot live in a write function when the write is a plain
  insert.** Rule 4's usual answer — a check under an advisory lock inside
  `transport_assign_student` — works because that function is the only way a bus
  seat is ever made. Students are created by a server action doing a plain
  insert, and **a plain insert through PostgREST routes around any function**, so
  the ceiling is a `BEFORE INSERT` trigger. It is `SECURITY DEFINER` for the
  reason this file already documents: an invoker function counting rows counts
  *the rows the caller can see*, so a teacher admitting a child would be measured
  against their own visible subset of the roll.
- **A plan is data (rule 12) and a subscription is a tenant row (rule 1).**
  `reference.plans` is the fourth catalogue beside permissions, reports and
  checks, outside `public` because a plan belongs to no tenant.
  `public.subscriptions` is readable by every member of the school — a bursar who
  cannot see the ceiling cannot plan for it — and has **no write policy at all**.
  Probed: a member's `update` touches **0 rows**, which is the count rule 6 says
  to assert rather than the error it does not raise.

**And `0205` shipped the same mistake it was fixing, one layer down.** It wrote
`trial_ends_on = current_date + 30` and then nothing anywhere read that date
again — a column recording an intention with no executable half, exactly like
`ends_on` on a bus seat (rule 2) and `fee_structures.frequency` (rule 6).
**A trial that never ends is a free product.** `0207` adds the write half
(`subscription_expire_trials()`, called from `schedule-tick` because a second
timing mechanism is a second place to look when something did not run) and the
critic (`subscription_problems()`, catalogued so it is reachable).

Two things about it worth carrying:

- **What an expired plan does is a product decision, so it is stated rather than
  left in a boolean.** The school keeps everything — nothing deleted, hidden or
  locked — and simply cannot grow: no new children, no new staff, reversible the
  moment somebody pays, with the message saying so. `past_due` is deliberately
  *not* `expired`: a card that failed on Tuesday is a bank, not a decision.
- **The probe reported 303 students against a school with none.** It did
  `reset role` before setting the JWT claims, so `subscription_usage()` ran as
  `postgres`, RLS was bypassed, and it counted every student in the database.
  The design was right; the instrument was not — and it produced a *plausible
  number* rather than an error, which is the whole danger. The `DO`-block rule
  under "measure as the caller" is not only about timings: **be suspicious of a
  number that is plausible for the wrong tenant.**

And the thing it refuses, which matters more than what it builds:

> **A platform-operator console reads across tenants, and that is the one thing
> rule 1 exists to make impossible.** Nothing in `0205` or `0206` creates a role,
> a policy exception or a definer read model that can see two tenants at once.
> When that console is built it gets its own decision, its own schema and its own
> guard — the cheap version is the one that puts a hole in every other rule here.

See `docs/modules/saas.md`.

### …and it was built on exactly those terms

The paragraph above is the specification, and `0209` met it. What made it
possible without touching one policy:

> **An operator has a login and no tenant.** `current_tenant_id()` is null for
> them, so every RLS policy in `public` — all sixty — already refuses them every
> row. An operator is, to the rest of the database, the tenantless caller rule 3
> calls *"the correct failure mode"*.

So nothing was weakened. Probed as a signed-in operator through PostgREST:
`platform_colleges()` returns 2 colleges, and `students`, `people`,
`ledger_entries` and `subscriptions` return **0, 0, 0, 0**. A direct
`select * from platform.operators` is `permission denied for schema platform` —
`revoke all on schema platform` means even an operator reaches the operator
tables through nothing but the definer functions. As a college principal, both
operator functions refuse.

Five things generalise, and the last one is about the guard rather than the
schema:

- **Metadata only, and not by a `where` clause.** Colleges, plans, usage counts,
  health — no student, guardian, invoice or mark is *in the projection*. That is
  what makes the cost of a mistake here **counts** rather than **children**.
  "Is this college alive" is `max(audit_log.created_at)`: the timestamp of the
  last audited change, never the change itself.
- **The refusal says nothing.** The same flat *"This is not available."* to a
  principal, a student and a stranger — a message that distinguished them would
  be a way of asking which addresses are operator accounts. The page carries the
  other half: `listColleges()` returns `College[] | null`, because *you should
  not be here* and *there are no customers yet* are different screens.
- **Log before answering.** `require_operator()` writes the access-log row and
  then the function produces its answer, so a query that errors part-way still
  records that somebody asked. `platform.access_log` is append-only by **revoke**
  (rule 6's stronger shape). The routing check `platform_am_i_an_operator()` is
  deliberately *not* logged — an access log padded with routing is one nobody
  reads.
- **An operator may not also own a college.** `platform_start_school` authorises
  on *"the caller has no tenant"*, and an operator has no tenant, so without a
  second predicate they could found a college and hold both identities at once.
  **Dual identity in an authorisation system is how a boundary quietly stops
  being one.** Refused in a sentence.
- **A guard that a `--` disarms reports on the prose, not the schema.**
  `tests/platform/operator-boundary.test.ts` reads the migrations for four
  properties — no grant into `platform`, no operator check inside a policy, every
  `public.platform_*` function calling `require_operator()`, the access log
  keeping its revoke. Each was verified by planting the violation. The fourth
  passed on a **commented-out** revoke until the check learned to strip comments
  first.

And what it still refuses: **support impersonation**. Entering a college and
seeing what a principal sees needs consent, a time limit and an audit trail the
college itself can read — a migration that argues for itself, never a quiet
`or is_operator()` added to sixty policies.

See `docs/modules/platform.md`.

### A tier is who you are; the matrix is what you may do

Six roles have existed since `0005` and they are genuinely different — measured
on the demo college: `admin` 64 permissions, `accountant` 22, `teacher` 21,
`parent`/`student` 10 each, `librarian` 9. What was missing is one level up:
**which kind of person is this login for.** Every screen reasoned from
`role_permissions` (right for *may they*) and from `roles.code` (a list of six
rather than a shape).

`roles.tier` names three audiences — `student`, `staff`, `principal` — and
migration `0208` is careful about exactly one thing:

> **A tier decides what a person is shown. It never decides what they may do.**

That warning is not ceremony. A tier column beside a permission matrix looks
*exactly* like a shortcut: `tier = 'principal'` is shorter than
`role_has_permission('settings.manage')`, reads as though it means the same
thing, and would replace a per-college decision — editable from `/settings` —
with a hardcoded one. It would also be wrong invisibly, since a college can
grant a teacher `students.manage` any Tuesday and a policy written against the
tier would refuse them while the matrix said yes.

Three things:

- **Grouping is not merging.** `accountant`, `teacher` and `librarian` share the
  `staff` tier and keep 22, 21 and 9 permissions. Merging them would hand every
  professor the fee counter and every librarian payroll — a loss of separation
  of duties dressed up as simplification.
- **The code is deliberately not renamed.** `admin` became the `principal`
  *tier* while `roles.code` stayed `admin`, because sixty RLS policies compare
  that code and renaming it is a security-relevant rewrite to gain a nicer word.
- **The guard runs without a database.**
  `tests/auth/tier-is-not-a-gate.test.ts` scans every migration for the tier
  inside a `create policy`, or compared to a value inside a function, and
  verified by planting a policy that reads `using (tier = 'principal')` — it
  names the file and quotes the offending line, then goes green on revert.

Its one visible use so far is the invitation picker, grouped by tier because
*"who is this login for?"* is the question somebody inviting is answering and
six flat names do not ask it. Deliberately **not** the dashboard: rule 11
already says there is no `if (isAdmin)` there, because `dashboard_summary()`
gates each block on the matrix and names what it withheld, and a tier branch
would be a second answer to a question that already has one.

**A platform operator is not a tier.** It cannot be: every tier is a row in a
tenant's own `roles` table, and somebody who works across colleges belongs to no
tenant. That is its own schema, its own decision and its own guard.

## 4. Authorization is two layers

1. **RLS** — tenant isolation *and* row ownership. Teachers see only students
   in sections they teach; parents only their linked children; students only
   themselves. This is the real boundary.
2. **Permission matrix** (`role_permissions` × `reference.permissions`,
   role × module × ability) — gates menus and buttons. Read it with
   `hasPermission('library.manage')`.

**The UI layer is never the gate.** Hiding a button does not protect data; the
policy does. Every new module needs both.

One refinement, because the reporting kernel depends on it: **the matrix does
real work wherever RLS is deliberately tenant-wide.** RLS on `staff` and
`people` lets any tenant member read them, so "an accountant may not pull the
staff roster" is a rule only `role_permissions` expresses. `report_run` checks
it *inside the function that produces the data*, not in the UI — which is the
distinction that keeps this consistent with the sentence above rather than an
exception to it.

`staff_roster` and `staff_record` are the second instance, and they make the
distinction easy to see in one screen: the roster is gated in SQL — a teacher
reads 15 rows of `staff` through the policy and is **refused** by the function
in a sentence — while `hasPermission("staff.manage")` on the page decides only
whether an *Add staff* button is drawn. A nav entry's `roles` list is the same
kind of thing. **The menu and the boundary must not disagree, and only one of
them is load-bearing.**

#### …and that sentence is a claim about who the product is for

The load-bearing half being right is what makes the other half easy to leave
wrong for a year. Nothing fails, nobody is exposed, and the disagreement is only
visible from a seat nobody signs into.

Read both halves as data — the permission matrix on one side, `nav-config.ts` on
the other — the menu was wrong for a guardian **in both directions at once**:

- **three entries their permissions cannot reach.** Payroll rendered *"My pay —
  what you were paid, month by month"* to somebody the school does not employ;
  `/hr/leave` rendered the staff leave board; `/checks` rendered eight refusals
  and one finding about the school's own fee-head setup.
- **nine their permissions can.** A parent holds `fees.view`,
  `fees_student_balances()` is row-scoped to their own children,
  `/fees/students/[id]` has always been read-only without `fees.collect`, and
  `dashboard_summary()` quotes the total on their home page — measured live,
  ₹26,908.00 owed, two invoices readable. Every fee screen in the product was
  `roles: ["admin", "accountant"]`. **A number with no link is a bill a family
  cannot check**, which is rule 6's *"a correct write path nobody can call is
  not a fix"* arriving on the read side.

All three of the first kind came from an entry with **no `roles` list**, under a
comment explaining why every member of *staff* needs it — `/hr/leave`'s said
*"everybody employed here has leave"*, which is true and is exactly the list
that was missing underneath it. So the guard is on the omission, not on the
lists: `tests/app-shell/nav-audience.test.ts` fails when a role-less entry is
not named in `EVERY_ROLE_ON_PURPOSE` with its reason, and it runs without a
database.

Two corollaries:

- **A count of zero is not by itself the test.** A teacher and a librarian run
  0 of 9 checks on today's matrix and keep that entry, because a school can
  grant a teacher `students.manage` any Tuesday and the page fills in. Nobody
  grants a guardian `staff.manage`. The question is whether the role is a
  *candidate* for the permission, not whether it holds it today.
- **When the menu and the matrix disagree, check which one is wrong.**
  `fees.billing` reached a parent because it was gated on `fees.view`; migration
  `0189`'s rule already said a critic is gated on the permission held by
  somebody who may *act* on it, so `0200` moved it to `fees.collect` and the
  menu entry and the check row were fixed together. Hiding it in the menu alone
  would have left the boundary saying the opposite.

**And the second door was hidden behind a comment that described an intention
nobody had implemented.** Above the Transport nav entry: *"No `roles` filter on
the routes screen: staff see the fleet, and a family reaching it sees only their
own arrangement, which RLS decides rather than the menu."* The list underneath
read `["admin", "teacher", "accountant"]`.

> **A comment that disagrees with its own code is worse than no comment**, because
> it answers the question somebody was about to ask. That one is why nobody
> noticed a family had no transport or hostel screen at all — the seat they are
> billed for monthly was on their phone and nowhere on the web.

`/arrangements` adds no read path and no permission: `transport_for_student` and
`hostel_for_student` have been invoker functions since their modules shipped, and
RLS already scoped them. Probed by creating a parent login in a rolled-back
transaction — **because the demo school has no parent logins at all**, which is
the sharper finding: no family-facing screen in this product had ever been
exercised from the seat it is for. Their own child's seat and bed; **0 rows** for
another child in the same school.

And the part that needed care, because it is a *second reader of the same
history* `0203` already got wrong once — rule 12's **who else does this?**
Verified live: the row reads `status=active, effective_ends_on=2026-03-31` on
2026-09-10, and the page classifies it `not current` and files it under
*Previously*. Two things make that durable:

- **The predicate is in `src/lib/validations/arrangements.ts`, not in the server
  action.** A `"use server"` module may only export async functions, so a rule
  defined there can never be imported by a test — and this is exactly the rule
  that shipped wrong once. `tests/family/arrangements.test.ts` pins it with the
  real production row and needs no database.
- **Dates are compared as ISO strings, never as `Date` objects.** They sort
  lexicographically, so no timezone can move the boundary by a day — the
  `report_day_bounds` instinct, arriving in TypeScript.

See `docs/modules/family.md`.

#### …and the catalogue of reports was never given that treatment

`0200` fixed one **check**. `reference.reports` is the older and larger
catalogue and kept its original gates, so the same question asked of it found
six reports a student or a guardian could run — and four of them are the
school's, not theirs: *every payment that crossed the counter*, *who owes,
largest first*, *pass and fail over a cohort*, *books still out with the fine*.

Every one is `SECURITY INVOKER` over row-ownership RLS, so a family is answered
with **their own rows**. Not a leak, and that is what kept it invisible:

> *"Fee defaulters: 1"* — and the one is your own child.

Demonstrated with the seats swapped rather than assumed: `report_fee_defaulters`
returns **96 rows to an administrator and 0 to a teacher**, same function, same
college, same day. Five gates moved to the permission somebody who may *act*
holds, and the family went **6 reports → 2** — the two that are about them.

Three things generalise:

- **Row-scoping alone does not make a report a family's.** Both halves have to
  hold: it must be scoped by policy **and** be the question the person is
  asking. `attendance.summary` is; `fees.defaulters` is not, and it looked fine
  for two hundred migrations because only the first half was checked.
- **A gate that moves is a default, not a guarantee**, because a permission is a
  per-college decision. So `reference.reports.audience` says who a report is
  written for and `report_audience_problems()` compares that against *the
  tenant's own matrix* — the fourth catalogue-as-data critic. Verified by
  granting `fees.collect` to the Parent role: three findings naming the role and
  the permission, silent again on revert.
- **The empty answer is the same bug wearing the other face.**
  `student_concessions` has no teacher policy at all, so a teacher holding
  `concessions.view` read zero rows and the report said *"nobody in this school
  has a discount."* That one rests on the policies, which were read — the demo
  college has zero awards, so the seat difference is not observable there, and
  the migration says so rather than quoting a number it did not measure.

See `docs/modules/reports.md`.

#### …and the matrix itself had no write path at all

The sentence rule 4 keeps making — *"a school can grant a teacher
`students.manage` any Tuesday"* — was not true of this product. `hasPermission()`
read `role_permissions` on every page; **nothing in the application wrote it**.
The admins-only write policy had been correct and uncalled since `0005`, which
is rule 6's *"a correct write path nobody can call is not a fix"* arriving at
the authorization layer.

`/settings/permissions` is the caller, and `permission_matrix()` is
`dashboard_summary()`'s shape applied to it: one jsonb document rather than
three round trips and a join in TypeScript, bounded by construction because a
college's roles are a handful and the catalogue is 64 rows. INVOKER, and it
shows any member what every role may do — the matrix describes the product, not
anybody's data — while the **write** stays the policy. Probed as a teacher: the
same delete touches **0 rows**.

And the new failure mode a screen creates:

> **`users.manage` draws the screen that grants `users.manage`.** One
> administrator, one afternoon, one cleared checkbox, and the matrix is editable
> only from a database console the college does not have.

Rule 4's usual answer — a check in the write function — cannot work here,
because the screen writes through PostgREST and **a plain delete through
PostgREST routes around any function** (`0205`'s lesson). So it is a `BEFORE
DELETE OR UPDATE` trigger, covering the `allowed = false` update as the same act
in different SQL, refusing in a sentence about the consequence rather than the
rule. The page's `isLastWayBack()` only draws the lock, and being the copy is
exactly why it is the half with a test.

See `docs/modules/permissions.md`.

The test itself now has a name — `role_has_permission(code)` — because it had
been written out by hand in `report_run`, `dashboard_summary` and `checks_run`,
and a fourth copy is where a rule quietly starts to differ from itself. The
three existing copies are deliberately left alone rather than swept up:
replacing a load-bearing authorization check is a probe of that function as
several roles, not a tidy-up, and `checks_run` is the one that already taught
this the expensive way.

### An invoker function over row-ownership RLS lies quietly

The counter-case, and it is the more dangerous one because it never raises.

> A `SECURITY INVOKER` function that derives its answer from a table with
> **row-ownership** RLS does not refuse a narrower caller. It answers them, with
> a smaller number, and **the number is plausible.**

`substitution_gaps` is built on `staff_is_away`, which reads `staff_attendance`
— where a teacher may read their own register row and nobody else's. So to a
teacher every colleague is "not away", every lesson is somebody's ordinary
Tuesday, and the morning roster is empty. Probed both ways rather than assumed:
as an administrator, 4 gaps over 51 register rows spanning the whole staff; as a
teacher, **0 gaps over the same 51 rows spanning exactly one person**.

A permission error is loud. *"No cover needed today"* is quiet, and it is what a
teacher would have been shown every morning.

**And the same function shape run the other way round over-reports, which is
worse.** A critic built on `not exists` — *"active but on no register"* — asks
which rows are **missing**, and under row-ownership RLS absence and invisibility
are the same shape. `student_exit_problems` answered an administrator `ok` and a
teacher **200 findings, every one of them false**, because a teacher may read
only the enrolments of children they teach. An under-report is a missing
sentence; this is an accusation. Neither is detectable from the administrator's
seat, which is why both were found by probing as somebody else.

The permission is **not** a proxy for "can see everything", and the numbers say
so: `students.view` is held by teacher, accountant and librarian, and only the
teacher's RLS is narrow. So a critic of this shape is gated on the permission a
school gives to somebody who may *act* on it — `students.manage` — and the rule
is written on `reference.checks.required_permission` where the next person will
add one. See `docs/modules/checks.md`.

**It happened again, in the module the rule was written next to, and the second
time says what the fix is.** `attendance_coverage` and the `attendance.gaps`
report both compare `sections` — tenant-wide — against `attendance_records`
joined to `enrolments` — row-ownership. Probed as each caller: an administrator
saw 12 sections, **none** at zero percent, and 168 missing registers; a class
teacher saw the same 12 sections with **eleven at 0.0%** and **388** missing
registers, 220 of them fabricated. The coverage function is documented *"worst
covered first: the list is read to find the class nobody has been taking a
register for"*, so it put eleven inventions at the top of the list and buried
the class that genuinely was worst.

> **A `not exists` is only honest when both sides are narrowed by the same
> policy.** Narrow the wide side to the rows the caller could have seen the
> evidence for — never to the rows that happen to *have* evidence, which is the
> thing being measured.

One predicate does it: a section is in scope when the caller can read an active
`enrolment` in it. `enrolments` carries the same policies `attendance_records`
does, and seeing the children is the precondition for "was a register taken for
these children" to be answerable at all. Administrator 12, teacher 1, guardian
1 — and the administrator's 168 is unchanged to the row, which is the check
that the fix removed fabrications and nothing else.

**And the gate is the second half, not the fix.** The report was catalogued on
`attendance.view`, which a guardian holds, so it moved to `attendance.mark` by
the rule above — but a teacher *holds* `attendance.mark`, so moving it alone
would have left them looking at the same 388. A permission check cannot make a
read model stop lying; fix the read model, then address it to the right person.
Migration `0201`, and `docs/modules/attendance.md`.

Three responses, and the wrong one is tempting:

- **Do not widen the policy.** Who is off sick is a fact about them, not about a
  colleague's day.
- **Name what was withheld** — the `dashboard_summary()` answer (rule 11), where
  the caller is entitled to the question but not to every block of it.
- **Or give the narrower caller their own question**, which is right whenever
  theirs is genuinely different. A teacher does not ask *"which classes have
  nobody in front of them"*; they ask *"where do I have to be"*, and
  `substitution_my_covers` answers that from a table they may read in full.

Either way the page must **gate on the permission**, so the empty list is never
shown as if it meant a quiet morning. Showing the same empty screen to both
parties is the worst of the three, and the one nobody reports as a bug.

### RLS cannot restrict columns

A policy decides which **rows** an update may touch. Once a row qualifies,
**every column on it is writable** — and Supabase's default blanket
`grant all … to authenticated` means there is nothing else standing in the way.

So a policy shaped "users may update their own row" is only safe when the user
genuinely owns the whole row. When only some columns should be writable, say so
with a column-level `GRANT` beside the policy:

```sql
revoke update on public.some_table from authenticated, anon;
grant update (the_one_column) on public.some_table to authenticated;
```

This is not theoretical. `notification_deliveries` shipped with a policy letting
recipients mark their own messages read, and a comment claiming `read_at` was
"the only column they could want to change" — until a probe rewrote a delivery's
`body`. Migration `0039` fixed it; the comment had been a hope, not a rule.

#### …and a column grant separates columns, not people

The obvious next step is to reach for that grant every time. It only works in
one shape, and `homework_submissions` is the counter-example that defines the
other.

**A `GRANT` is role-wide.** Every user of this application — student, teacher,
admin alike — is `authenticated`. So a grant narrows what *everybody* may write,
not what one party may write. On `notification_deliveries` that was exactly
right, because nobody except recipients had UPDATE at all. On
`homework_submissions` it is wrong: a student must set `status`, `submitted_at`
and `note`, a teacher must set `marks_obtained` and `feedback`, and
`grant update (status, submitted_at, note)` would break marking in the act of
protecting it.

So:

> When **two roles need different column rights on the same table**, no policy
> and no grant can express it. Give the narrower role a `SECURITY DEFINER`
> function and **no policy at all**; leave the role that owns the whole row on
> RLS.

`homework_submit` and `homework_unsubmit` are that function — narrow, definer,
each setting exactly three columns after checking the caller is the student who
owns the row — while `homework_grade` stays `SECURITY INVOKER`. **The absence of
a student UPDATE policy is the mechanism.** A later migration that tidily "adds
the missing policy" hands every child their own mark sheet, so the absence is
commented at the point where it would be added. See
`docs/modules/homework.md`.

`student_leave_requests` is the definer-function shape's second instance and
reads exactly like the first: a family sets the dates and the reason, a teacher
sets the status and the note, so the narrower party gets `student_leave_cancel`
— definer, one column, an explicit check of who is asking — and **no UPDATE
policy at all**. The absence is commented on the table, because a migration that
tidily "adds the missing update policy" hands every parent the power to approve
their own child's leave.

`certificates` is the column-grant shape's second instance, and two instances
are what make it a pattern rather than a decision. Only an administrator has an
UPDATE policy there, so `grant update (status, cancelled_at, cancelled_by,
cancel_reason)` narrows exactly the right thing: **nobody, administrator
included, can rewrite what a certificate says.** DELETE is revoked outright,
because a cancelled certificate has to keep its serial — a gapless sequence with
a hole in it is a sequence nobody can audit.

#### …and the same sentence is true of SELECT, where it is easier to miss

Everything above is about writes, and the reason the read case hid for 184
migrations is that a policy which over-grants on SELECT still *looks* correct:
nothing fails, and the extra columns simply travel.

> **A policy grants whole rows on the way out too.** A comment naming three
> columns is a claim about a projection, and a projection is not something a
> policy can express.

`public.staff` carried one since migration `0009`: *"Staff directory
(name/designation/department) is not sensitive HR data and is needed by every
role to render things like 'Class teacher: …'."* Probed as a caller whose JWT
says `parent`, both halves of that were false, in opposite directions —
**15 staff rows readable**, `employee_code`, `date_of_joining`, `status` and
`date_of_leaving` among them, joinable to the 276 timetable rows the same
caller can read; and **0 rows of `people`**, so the name it exists to provide
has been a blank on every family's timetable since the module shipped.

The fix is the definer-function shape's third instance, and it is forced rather
than chosen: a column `GRANT` is **role-wide**, and every user of this
application is `authenticated`, so `grant select (id, designation)` would take
the leaving date away from payroll in the act of hiding it from a parent.
`staff_directory()` returns the three columns, the tenant-wide row policy is
dropped, and both halves close in one edit — a parent now sees the teacher's
name and none of the employment record.

Two things to carry:

- **A definer read model must filter by tenant itself, and it is the only kind
  that may.** Rule 11 forbids `where tenant_id =` because invoker + RLS is what
  makes a report unable to cross tenants; inside a definer, no policy runs, so
  that predicate *is* the isolation. Pin it in the isolation suite, in both
  directions **and** against the caller's own row count — a definer that
  returned nothing would pass a one-sided check.
- **Skipping the policy is also 11× faster**, measured: `timetable_for_section`
  went 42.2 ms → 3.7 ms as an administrator and 56.9 → 3.9 ms as a teacher, on
  35 lessons. The cost was `people`'s six permissive policies, not the rows.
  That is a reason to notice this shape, never a reason to reach for a definer
  where an invoker is correct.

### A CHECK cannot reach another table

The same genre of mistake. When a rule depends on a column of a *different*
table — "a lesson may only be scheduled in a period that is not a break" — a
CHECK constraint cannot express it, and the reflex is to reach for a trigger.

Usually there is a declarative answer: materialise the fact on the parent as a
**generated column**, add it to a unique key, and join it into a composite
foreign key on the child.

```sql
alter table public.time_slots
  add column schedulable boolean
  generated always as (kind = 'class' and not is_break) stored;
alter table public.time_slots
  add constraint time_slots_schedulable_key unique (tenant_id, id, schedulable);
-- child carries a constant `true` and points at it:
constraint timetable_entries_slot_fkey
  foreign key (tenant_id, time_slot_id, slot_schedulable)
  references public.time_slots (tenant_id, id, schedulable)
```

The child's column has exactly one legal value, and its only job is to make the
key unsatisfiable for a row that fails the rule. One constraint then enforces
"same tenant" and "a real lesson period" together, with no trigger to keep in
step. Add a plain check ahead of it in the write function if the raw foreign-key
error would be unreadable — for the message, not for the enforcement.

The same trick works for a **value**, not just a flag. `marks` may not exceed its
paper's `max_marks`, so it carries a denormalised copy inside a composite foreign
key to `exam_subjects (tenant_id, id, max_marks)` and checks against that local
column. Use `on update cascade`, which keeps the copy in step *and* refuses to
lower a paper's maximum below a mark already awarded — the cascade rewrites the
child and the CHECK re-evaluates. That refusal is the correct answer, not a side
effect.

#### …and it works for a POLICY, which is how a row becomes immutable

The third use of the same device, and the best one. A policy cannot ask about
another table cheaply either — so carry the parent's **status** on the child,
inside the composite key, and put it in the policy:

```sql
-- payslips carries run_status, held equal to its run's by the key:
constraint payslips_run_fkey
  foreign key (tenant_id, run_id, run_status)
  references public.payroll_runs (tenant_id, id, status)
  on update cascade
-- ...and the write policy simply requires it:
using  (... and run_status = 'draft')
with check (... and run_status = 'draft')
```

Finalising is then **one UPDATE on the parent**. The cascade rewrites every
child, and from that instant the policy matches no row: writes touch nothing,
silently, which is what RLS does. No revoke, no trigger, no
`if status = 'finalised' then raise` scattered through five functions.

Use this when the rule is about **rows** — everybody who may write a draft may
write all of it. When two roles need different **columns** on the same row, this
cannot help; that is the definer-function case above. The distinction is whether
you are separating rows or separating people.

`exam_remarks` is the second use and the clearest one: a class teacher's
sentence on a report card carries `exam_status`, held equal to `exams.status`,
and the write policies require `'draft'`. Publishing an exam is still one UPDATE
on `exams`; from that instant a remark cannot be edited by anybody, and
unpublishing reopens it — which is what makes "fix a typo on a card that already
went home" an audited unpublish/republish pair rather than a quiet edit.

**The device now has five uses, and the carried column has been five things:**

| Carried | Table | Enforces |
|---|---|---|
| a flag | `time_slots.schedulable` | a lesson lands in a real period |
| a value | `marks.max_marks` | a mark cannot exceed its paper |
| a status | `payslips.run_status`, `exam_remarks.exam_status` | the row is immutable once the parent is final |
| an identity | `transport_assignments.route_id` | a child's stop is on the child's own route |
| a term in a comparison | `transport_assignments.route_direction` | a pickup-only route cannot drop anybody |
| a boundary | `transport_assignments.session_ends_on`, `hostel_allocations.session_ends_on` | an arrangement cannot outlive the year it was made for |

**One key can carry two of those at once.** `marks.component_max_marks` is the
newest use and it is not a sixth kind — it is the identity use and the value use
in a single constraint:

```sql
foreign key (tenant_id, exam_subject_id, exam_component_id, component_max_marks)
references public.exam_components (tenant_id, exam_subject_id, id, max_marks)
```

`exam_subject_id` in the key says *this part belongs to this paper*;
`max_marks` says *this local ceiling is the part's own*. One constraint, two
rules, one cascade. `transport_assignments (tenant_id, session_id,
session_starts_on, session_ends_on)` is the same shape with the year's two
dates in it, which is why "a boundary" above is one row of the table and not
two. It also shows how to make the device **optional**: both
columns are nullable together, a MATCH SIMPLE foreign key is skipped entirely
when any of its columns is null, and a `check ((a is null) = (b is null))`
beside it stops one arriving without the other — which is how "this paper is not
split" is representable in the same table as "this is the practical mark".

The last is the newest shape and worth naming: the rule there is
**compatibility, not equality** — a `both` route carries anybody, a one-way
route only its own direction — so the carried column feeds a CHECK
(`route_direction = 'both' or direction = route_direction`) rather than being
compared for equality. The cascade still does the second half of the work:
narrowing a route from `both` to `pickup` while children on it still need
dropping rewrites every assignment, the CHECK re-evaluates, and the route change
is refused. Same shape as refusing to lower a paper's maximum below an awarded
mark.

#### …and where it stops

**The device carries a column from exactly one parent table.** A rule about a
fact two joins away cannot use it, and `hostel_allocations` is the case that
names the boundary: *a boys' house takes only boys* depends on
`people.gender`, one join beyond `students`. Reaching it would mean
denormalising gender onto `students` and keeping it in step — a second copy of a
fact that already has an owner, to enforce a rule a school may want to relax.

So that one is checked in `hostel_allocate`, with a sentence. The rule:

> One table away, use the composite key. Two tables away, use a function check
> and say so — do not manufacture a column to reach it.

The same function-check answer applies to any rule about **how many other rows
exist** — a bus with 40 seats, a room with 4 beds, debits equalling credits. No
constraint sees a second row, so those live in the write function under an
advisory lock, with the numbers in the message.

#### …and the second boundary: it carries a fact that is still true

The first boundary is about distance. This one is about **time**, and it is the
one that looks like the device working right up until a school has been running
for a year.

> The composite-key device ties a child to its parent's **current** state. A row
> that records what was true on a day is not that child. **Freeze the values and
> check them in the write function instead.**

`substitutions` is the case. A cover arrangement wants to say *"Aditi was away,
period 3"* — both facts live on `timetable_entries`, one join away, so the
device seems to fit. It does not, and neither half of it works:

- **with `on update cascade`** — reassigning Monday period 3 to a different
  teacher next term rewrites last October's substitution, so the record now
  names somebody who was not there;
- **without the cascade** — the same reassignment is *refused*, because old rows
  still point at the old teacher. The timetable becomes uneditable in order to
  protect a record of a morning nobody is looking at.

So `absent_staff_id` and `time_slot_id` are plain frozen copies, and
`substitution_arrange` checks them. Note what that buys beyond correctness: the
critic can find *"the timetable changed after this was arranged"*, which is only
detectable **because** the frozen slot and the live lesson are free to disagree.

The distinction is the same one rule 12 draws about report cards and rule 12's
certificates section draws about wording: a constraint keeps two rows *in step*,
which is right for a rule and wrong for a record. Ask whether the child is a
statement about now or a statement about a day that has passed.

### Two rows that must not overlap need an EXCLUSION constraint

A third thing no CHECK can see: a second row. "One approved leave per person per
day", "one salary in force per person per day", "one booking per room per hour"
are all the same shape, and application code that checks first and inserts second
is a race.

```sql
create extension if not exists btree_gist;
alter table public.leave_requests
  add constraint leave_requests_no_overlap
  exclude using gist (
    tenant_id with =, staff_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('pending', 'approved'));
```

Make it **partial** wherever a dead row should stop blocking — a refused leave
request must not prevent re-applying for the same dates. The error code is
`23P01`; translate it into a sentence at the server-action boundary, because
"conflicting key value violates exclusion constraint" is not something to show a
person.

## 5. Identity model — do not collapse these

```
people          biographical facts about a human
  ├── students   a person in the student role (admission number, status)
  ├── guardians  a person in the guardian role
  └── staff      a person employed by the tenant
enrolments      student + section + session, one row per year
guardian_student many-to-many, with relationship type
auth.users      login accounts (optional — many students never get one)
```

This is what keeps alumni, re-admission, sibling linking, and
staff-who-are-also-parents representable. Flattening "student" into "person"
looks simpler for a week and then blocks all four.

## 6. Money is append-only

Payments, discounts, fines and refunds are **immutable ledger entries**.
Corrections are reversing entries, never updates. Receipt numbers are gapless
per-tenant-per-session sequences generated in Postgres. Payment webhooks are
idempotent on the provider's event id.

This is now built: one `ledger_entries` table typed by `entry_type`, with the
sign constrained per type, `UPDATE`/`DELETE` revoked outright (not merely
unmatched by a policy), and `document_sequences` as the gapless counter. See
`docs/modules/fees.md`.

Two consequences worth knowing before you touch this module:

- **A row lock needs the UPDATE privilege.** `select ... for update` on
  `ledger_entries` fails with `permission denied`, because the revoke is what
  makes the table append-only. Serialise on a unique index instead — that is
  what `ledger_entries_reversal_unique` is for.
- **Proving a table is append-only means counting rows, not catching an error.**
  An `UPDATE` that no policy matches **succeeds** under RLS while touching
  nothing, so a test that only asserts an error passes whatever the policy says.
  `enquiry_follow_ups` is the case that made this explicit: 9 rows readable, an
  update touching 0, a delete touching 0. Assert the count.

  **There are two ways to be append-only and they fail differently.** A revoked
  table (`ledger_entries`, `stock_movements`) *raises* `42501: permission
  denied`; a table with no write policy (`enquiry_follow_ups`,
  `notification_deliveries`) silently matches nothing. Prefer the revoke where
  the table is the record of what happened and nobody should ever edit it;
  the absent policy where one role writes through a definer function and the
  rest simply have no way in. Test each for what it actually does.
- **Amounts are signed, positive means "owes more", and the RPCs take positive
  numbers** and do the signing. Never ask a caller for a negative amount.
- **`session_id` on a ledger entry is which year's account it moves;
  `occurred_at` is when the money crossed the counter.** Two questions, one
  row, and conflating them is expensive: `fees_record_payment` stamped every
  receipt with `current_session_id()` and never compared it to the invoice it
  named, so a payment against last year's bill *lowered this year's dues* and
  *could never clear last year's invoice*. Probed: invoice IN-2025-00001,
  receipt RC-2026-00001. The rule is now a foreign key —
  `(tenant_id, invoice_id, session_id)` onto `invoices` — because four writers
  had to remember it and three of them did not.

  Two corollaries. **A receipt is numbered in the year it settles**, so
  RC-2025-00273 taken on a July 2026 morning says what it is. And **a date
  question is answered with dates**: `fees_day_book` also filtered on the
  current session, which would have hidden that receipt from the till it was
  taken at. Every function in the accounts module was already date-ranged and
  needed no change — which is the shape to copy.

  And the third: **a correct write path nobody can call is not a fix.** The
  account page filtered invoices to the current session under a comment reading
  *"last year's settled account is history"* — where the load-bearing word was
  *settled*. It now also asks every other year the same question and shows the
  ones that come back owing, on the account page and on the counter where the
  money is actually taken.

**Library fines are in the ledger** (migration `0026`). Returning a late book
books a `fine` entry against the student's fee account, so an overdue book is
collected on the same screen, with the same receipt, as tuition. Three rules
came out of that and apply to any module that wants to write here:

- **Book the charge when the amount is final.** A daily-accruing debt cannot be
  one immutable row, so the fine is booked at return and the running amount
  before then is an estimate computed on the fly and stored nowhere.
- **Give a module its own narrow way in, not the whole ledger.** Librarians
  have a policy permitting exactly `entry_type = 'fine'` rows that carry a
  `book_issue_id` — which is what lets `library_return_book` stay
  `SECURITY INVOKER` instead of becoming `SECURITY DEFINER`.
- **Make idempotency a unique index on the source row.** One fine per book
  issue (excluding reversals), so a retried return converges instead of
  double-billing.

`book_issues.fine_paid` was dropped: for a student the fee balance answers it,
and a second boolean free to disagree with the ledger is exactly the drift the
ledger exists to prevent. **Staff library fines are a payroll matter, not a fee
receivable** — `members` is a student *or* a staff member, and
`ledger_entries.student_id` is `not null`, so a staff fine cannot go to the fee
ledger. It is collected instead as a deduction line on the next payroll run and
settled by stamping `book_issues.staff_fine_payslip_id` (migration `0065`), or
written off with `library_waive_staff_fine`. This was an open gap until payroll
existed to receive it; see `docs/modules/payroll.md`.

### The same pattern, applied to things that are not money

`stock_movements` is the fee ledger's shape with goods in it, and building it
that way was not decoration — the alternative, an `items.quantity_on_hand`
column kept in step by hand, is exactly the `book_issues.fine_paid` mistake rule
6 already threw out once. **Quantity on hand is a sum, never a column.**

The transferable part is the checklist: signed rows typed by kind, the sign
constrained per kind, positive numbers in at the boundary with the signing done
in the RPC, corrections as opposing rows, `UPDATE`/`DELETE` revoked, and the
total computed by one function everything else calls. See
`docs/modules/inventory.md`.

### The general ledger sits above all of this

`ledger_entries` is a fee *receivable* subledger and `payroll_payments` a
payable settlement record. Neither is the school's books. Migration `0072`
adds those: `accounts` (a typed tree), `journal_vouchers` + `voucher_lines`
(double entry), and `posting_rules` — a rules-as-data map, per rule 12, so
"a fee receipt debits Bank and credits Fee Income" is a row rather than a
release.

Rule 6's instincts carry up unchanged — gapless numbers, immutable once
posted, corrections as reversing entries — and one new one arrives with
double entry:

> **Debits equal credits is a fact about several rows, so it is checked at
> post, not by a CHECK.** A draft may be half-built; posting is the gate. The
> message matters too: `accounts_post_voucher` says *"out by 40.00"*, which is
> the only number that helps somebody staring at a journal that will not post.

The module is also the clearest place in the codebase to see the three
enforcement devices side by side — a CHECK for a one-row rule, a foreign key
onto a generated flag for "a heading cannot take an entry", and a post-time
check for the multi-row rule. See `docs/modules/accounts.md`.

**Posting into the ledger is a sync, not a trigger.** `accounts_sync` walks
unposted source documents, is idempotent on a partial unique index over
`(source_kind, source_id)`, and is bounded per rule 7. A trigger on
`ledger_entries` would couple the modules and run inside the payment
transaction; a sync keeps the subledgers independent and lets a backlog drain
in pages.

### A fee structure is not the only source of an invoice line

`fee_structures` is keyed on `(session, class_level, fee_head)`, and until
Phase 5.2 it was the only thing `fees_generate_invoice` read. Transport broke
that assumption, permanently: **a bus fare depends on the stop a child boards
at, not on their class**, so two children sitting next to each other in the same
class pay different amounts and no row in `fee_structures` can say so.

The fix was not another dimension on `fee_structures` — that would give every
other fee a null column and still be wrong for the next fee that varies by
something else (a hostel room, an optional subject, a music lesson). It was to
demote it from *the* source to *a* source:

```sql
fees_billable_lines(student, as_of, heads)
  -- from fee_structures  : what your class pays
  -- from transport       : what your stop costs
```

Two rules come out of it, and both generalise to the next module that wants to
bill something:

- **One definition of "what would this child be charged", consulted by
  everything.** `fees_generate_invoice` inserts what that function returns and
  `fees_generate_section_invoices` asks it whether there is anything to bill, so
  a preview and an invoice cannot disagree. A second implementation is a second
  answer.
- **Two sources feeding one fee head bills the family twice, and it looks
  plausible.** That is a real migration hazard for any school moving a fee from
  class-based to something-else-based. `transport_billing_conflicts()` names it
  in sentences — the `grading_scheme_problems()` pattern — rather than deleting
  a school's fee structure, because which of the two charges is real is a
  bursar's decision, not a migration's.

A **fourth** source arrived with concessions, and it is the first negative one
— which turned out not to be a source at all:

- **A discount is not a negative invoice line.** `invoice_lines` carries
  `check (amount > 0)` and keeps it: an invoice says what was *charged*, and a
  negative charge is not a thing. What is *owed* is the ledger, which already
  has a `discount` type, already constrains it negative, and is already
  reversible. So `fees_generate_invoice` raises the full charge and then credits
  the concession to `ledger_entries` against that invoice — **no money table
  changed shape**, `fees_student_balances` picked it up with no changes at all,
  and the family sees both halves, which is how a school prints a bill.
- **A concession is an award, not an inferred rule.** Evaluating eligibility at
  billing time — counting siblings, checking whether a parent is on staff —
  changes a family's bill when an elder sibling leaves, and nobody decided that.
  It is granted by a person, on a date, for a **required** reason, and the audit
  log says so. See `docs/modules/concessions.md`.

A third rule arrived with the billing calendar:

- **A recurring charge needs to know which period it is for, or the guard
  against double-billing is a guess.** `fee_structures.frequency` was stored and
  never acted on for seventy migrations, so an invoice run charged every head
  every time and a school billing monthly billed its annual tuition twelve
  times. `fee_instalments` is the missing concept: each period says what it
  `collects` (explicit, never inferred from a sequence number — ten-month years
  and monthly-except-December are both real), and
  `invoices_one_per_instalment` is a partial unique index that makes a second
  issued invoice for one student and period impossible. Partial on `issued` so
  cancelling re-opens the period, and partial on `instalment_id is not null` so
  ad-hoc counter charges are untouched. See `docs/modules/fees.md`.

See `docs/modules/transport.md`.

### Secrets never enter the Next.js app

Payment-gateway credentials live on the Supabase Edge Functions
(`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`), never in
this application and never in a `NEXT_PUBLIC_*` variable. The app creates a
payment *intent*; an Edge Function turns it into a link. That split is the
whole reason the function exists.

A webhook has no JWT, so `current_tenant_id()` is null and no INVOKER function
can serve it. `fees_settle_gateway_payment` is the module's single
`SECURITY DEFINER` function, and is revoked from `public`, `anon` **and**
`authenticated` — nothing holding a JWT may call it. When you add another
callback-driven write, copy that shape: definer, narrow, revoked from people,
and taking its authority from a row this system wrote rather than from the
callback body.

The scheduler needed the same shape and made the boundary of it explicit.
`notify_send_for` takes the tenant as an argument and is revoked from everybody
holding a JWT; `notify_send` is now a thin wrapper doing the admin check — one
body, two doors, because a copy is where the WhatsApp template freeze quietly
stops being applied. But:

> **That split is only safe where the invoker version's protection is a tenant
> or role check, not a row-ownership one.** `notify_send` guards with an
> explicit admin test, so parameterising the tenant is exactly equivalent.
> `transport_assign_student_for` and `hostel_allocate_for` are the second
> instance, parameterising the *session* rather than the tenant so a rollover
> can be prepared in March — safe for the same reason, and needed because a
> function that only ever writes "this year" cannot prepare next one.
> `fees_student_balances` is protected *row by row* through RLS — a parent
> calling it sees their own children — so a definer twin would hand a parent the
> whole school, and an invoker wrapper cannot delegate row ownership to a
> definer helper. Where that is the case, a background job gets a **narrower**
> function answering only its own question, and a test pins the two together.

## 7. Heavy work goes through the jobs table

Bulk SMS/email, imports, and anything unbounded are queued in `jobs` and
consumed by Supabase Edge Functions. **Never inside a Next.js request handler.**
Edge Functions use the service role (bypassing RLS), so they must filter by
`tenant_id` explicitly.

### The test is boundedness, not the category

This rule originally named report generation and promotion runs as queued work.
Both are now built inline, deliberately, and the rule is narrowed to say why
rather than leaving the code quietly contradicting it.

What makes a request handler unsafe is *unbounded* work, not work of a
particular kind:

- **`report_run` is capped** at 1,000 rows by default and 5,000 at most, over
  indexed tenant-scoped tables, and returns the true total alongside so a
  truncated answer says so. That is a normal query.
- **Promotion previews are one indexed query**, and applying is a few hundred
  short transactions whose result is a screen somebody argues with — far more
  useful than a job id. Above a few thousand students that stops being true, and
  the apply step is the half that ports cleanly: it is already row-by-row and
  already idempotent on `(tenant_id, session_id, student_id)`.

- **The notification dispatcher is bounded at 200 deliveries or 40 seconds an
  invocation** and returns how many are left, so a backlog is a button pressed
  twice rather than a request that times out. It runs in an Edge Function
  because that is where the provider secrets are, not because the work is
  unbounded.

So: bound it and say what the bound is, or queue it. What is still genuinely
`jobs` work and is **not built**: PDF rendering, and scheduled reports. Scheduled
*notifications* are built — see below — and **full exports turned out not to be
queued work at all**.

#### …and the cap is on the response, not on the work

Measured, because it qualifies the paragraph above rather than illustrating it:

> **A set-returning function is an optimisation fence.** `select … from
> report_x($1) limit 50` runs `report_x` to **completion** and buffers every row
> before the Limit sees one. `report_run`'s `limit`/`offset` bound what crosses
> the wire, never what Postgres does.

So "capped at 1,000 rows" is not by itself a boundedness argument. It was true
of every report while every report read a table bounded by the size of a school;
it stopped being true the moment one read `audit_log`, which only grows. That
report took **6.2 seconds** to return 50 rows of 24,412 — and removing
`count(*) over ()` changed nothing, which is how the fence was found.

The scan is not the cost: counting those rows with the projection dropped is
**100 ms**, producing them fully is 6.2 s. So the rule for a report over a table
that grows without bound:

- **Keep the projection cheap**, because it runs for every matching row, not
  every returned row.
- **Give it a declared default window** — a visible, overridable parameter
  stated in the report's description, never a silent truncation (rule 13).
- A true `total_count` costs a full pass whatever the page size. That is the
  honest ceiling; say it rather than designing around it twice.

See `docs/performance.md`.

### A long export is the browser's job, not the server's

"Full exports" sat on the unbuilt list since the reporting kernel shipped, and
the obstacle was never the size of the answer. It was **who runs it**:
`report_run` gates on `role_permissions` for `current_role_code()`, so a worker
draining a queue has no role and cannot run a report at all. Every way round
ends in inventing a service identity, which the scheduled-reports note below
already refuses to do quietly.

The way through is to notice that **a person asking for an export is present
while it runs**, which a scheduled report's asker is not:

> The server answers bounded pages as the person who asked; the client
> assembles them. RLS stays the only gate, no service identity is invented, and
> progress and cancellation come free.

So `report_run` gained an offset (migration `0154`) and that is the entire
database change — the same permission check **on every page**, the same 5,000
cap per call, the same `total_count` alongside. Three things this makes
load-bearing:

- **Every read model's `order by` is now part of the contract.** Paging with
  `limit`/`offset` over an unordered query returns an arbitrary slice each time,
  so an export could contain one row twice and miss another. Every catalogue
  function already ended in one; a new report that sorts on a single
  low-cardinality column should add a tiebreak.
- **The ceiling is refused, not applied.** Past 100,000 rows the export declines
  and says the number, because rule 13's lesson holds here too — a spreadsheet
  with the first hundred thousand of three hundred and forty thousand rows looks
  complete.
- **`create or replace` with a new parameter leaves the old function behind.**
  The three-argument `report_run` was dropped rather than kept, because two
  bodies is where the permission check quietly stops being updated in one of
  them; `p_offset` defaults, so every existing caller is unaffected.

### Work that runs on a timer

`schedules` + `schedule_runs` + the `schedule-tick` Edge Function. Four rules,
and the first is the one every scheduler gets wrong:

- **A time of day is a wall clock, not an instant.** A cron expression fires in
  one timezone; two schools on one deployment do not share one. So a schedule
  stores a local `time`, and the runner asks each tenant *"is it half past seven
  where you are?"*. Local time first, instant second — which is also what
  survives daylight saving.
- **An occurrence runs once, at a unique index.** `schedule_runs` is unique on
  `(schedule_id, occurrence_at)` and the run begins with `on conflict do
  nothing`. `occurrence_at` is the instant the schedule was *for*, never the
  instant it ran, so a tick a minute late is still the same occurrence.
  `accounts_sync`'s rule applied to time: make the natural key the thing that
  cannot repeat.
- **Missed work does not catch up, and says so.** The due-check looks back at
  most one day, and each schedule carries its own `grace_minutes` because the
  right answer differs by kind — an absence notice two hours late is worse than
  none, a fee reminder is not. Past its grace the occurrence is written down as
  `missed` rather than skipped silently, or *"why did nothing go out on the 3rd"*
  has no answer.
- **A schedule that runs is not a schedule that works.** A school that switches
  SMS off gets a green *"Ran · 40 matched"* every night while every delivery is
  skipped. The register says what ran; `schedule_problems()` says whether
  anybody heard.

And anything seeded or created **arrives switched off**. A school that installs
this and finds four hundred parents were texted without anybody deciding to has
been badly served, however useful the feature is.

**And a module that sends must ask the module that knows.** The evening absence
notice, on its own, was rude: a family that told the school on Monday their
daughter has chickenpox got a text every evening for a week. `schedule_run` now
consults `student_is_on_leave` before sending, and the run row names the two
reasons a matched child was not written to separately — *on approved leave*
(deliberate) and *no family login* (a gap) — because one number cannot
distinguish them and they call for opposite responses.

**Scheduled reports are the thing this deliberately stops short of**, because:

> A scheduled job has no user, so anything it does must be expressible without
> one.

Sending a message about a row is. Running a catalog report is not — `report_run`
gates on `role_permissions` for `current_role_code()`, and a scheduler has no
role. Making it work means deciding *whose authority* a schedule runs under, and
that is a bigger decision than the module should make quietly. See
`docs/modules/schedules.md`.

## 8. Storage

Supabase Storage, private buckets only, access via signed URLs issued after a
server-side permission check. Buckets: `avatars`, `documents`,
`study-material`, `homework-submissions`. Store the object *path* in the
database (e.g. `people.photo_path`), never a public URL.

Migration `0053` and `src/lib/storage/files.ts` are the built form of this, and
three things about it are load-bearing:

- **Two independent halves, neither sufficient alone.** Storage RLS sees the
  object path and nothing else, so it enforces the one rule a path can carry:
  the first segment is the caller's tenant
  (`public.storage_object_tenant_matches()` — the helper lives in `public`
  because functions cannot be created in `storage`). The **row-level** question
  — is this the student's own submission? — is answered by the server action
  against `public`, before it ever reaches this module. Everything below the
  tenant segment is addressing, not security.
- **The signature is the authorization.** `signedUrlFor` is called only after
  the row has been read back through RLS; if the select returns nothing, no URL
  is issued. Never render a signed link into a page — that signs it before
  anybody asked, which is the same as publishing it. Rebuild every filename
  through `safeFileName()`: a `../` in a name moves the object out from under
  the tenant prefix that describes it.
- **Orphans have a direction.** Upload the object first and insert the row
  second, deleting the object if the insert fails; on delete, remove objects
  *before* the rows, while the paths are still readable. An orphaned object
  costs bytes nobody sees; an orphaned row is a broken download on somebody's
  screen.

Bucket names and limits live in `src/lib/storage/constants.ts`, which has no
server imports, so an upload control can state the limit before a person picks a
40 MB file. `files.ts` imports the server client — making it unimportable from a
client component, which is what keeps uploads server-side — and re-exports the
constants so callers have one import to remember.

## 9. Audit everything

`audit_row_change()` writes old/new row JSON, the actor (`auth.uid()`) and a
timestamp to `audit_log` on every insert/update/delete of a core table. When
you add a table, add its trigger — see migration `0008` and the four triggers
at the end of `0015`.

**A trigger you have to remember is a trigger somebody forgets.** Eighty-seven
of the ninety-three tables in `public` had one, and nothing anywhere would have
said so. `audit_guard_violations()` is rule 9's executable half — the third
guard beside `schema_guard_violations()` and `privilege_guard_violations()` —
and the failure it prevents is specific:

> An audit log with holes in it is worse than no audit log. It answers "who
> changed this" with silence, and **silence reads as "nobody did".**

Four tables are exempt, named in migration `0162`, and the test for adding a
fifth is not "it is noisy":

> A table is exempt when **the row *is* the record** — append-only, written
> once, never edited. Auditing it stores a second copy of a fact that cannot
> change. Everything else is audited, including the boring ones.

`jobs` is the one exemption resting on volume instead, and it is called out as
such rather than blended in, because volume is the argument that eventually
exempts everything.

### An audit log nobody can read is a table, not an audit

24,000 rows, an admin-only policy since `0008`, and not one caller in the
application. Rule 9 got the writing right and stopped there. Migration `0163`
is the read path, and three things about it generalise:

- **The policy on `audit_log` is the strictest in the schema, and must stay
  that way.** It is a copy of every row in every table, so anything that could
  read it broadly is a way around every other policy in the database. Every
  function here is `SECURITY INVOKER`; a definer one would be exactly that hole.
  `audit.view` sits beside the policy — not redundant, because the matrix is
  what lets a school withhold the trail from one administrator without touching
  a policy.
- **`updated_at` comes out of the diff.** Every table carries a `set_updated_at`
  trigger, so it moves on every write — a diff that keeps it reports a change
  for a write that changed nothing and pads every real change with a line nobody
  wants. Observed live: a no-op touch recorded as *"1 field changed:
  updated_at"*, and a genuine template edit as *"body, updated_at"* where the
  only honest answer is *body*. `created_at` is deliberately **not** on that
  list — `created_at` moving is a fact somebody should see.
- **"Nobody was signed in" and "that login is gone" are two different
  unanswerables**, and one blank cell hides the difference. A null `actor_id` is
  a seed, a migration or a background job — never a person. A non-null one with
  no profile *was* a person. `audit_actor_label` returns *System* and *Deleted
  login*; same instinct as `attendance_coverage`, applied to a name.

And the surface splits the way rule 11 says it should: **"what happened to this
row" is not a report** — it has no parameters a person would type and belongs
beside the record, so it is `audit_history` on the page. "What did anybody
change on Tuesday" is a catalog row. See `docs/modules/audit.md`.

## 10. Nobody calls a provider

**Nothing in this codebase may call an email, SMS, WhatsApp or push API
directly.** A module that wants to tell somebody something calls
`notify_send(event_key, subject, body, audience, payload, channels)` and stops
caring how it travels. One table and one dispatcher means a new channel is a
driver, not a migration through twelve modules.

`notifications` is what happened, once; `notification_deliveries` is one row per
recipient per channel. Keep them separate — "did the notice go out" and "did
Ravi's mother's SMS arrive" are different questions and collapsing them makes
the second unanswerable.

**Whether a channel actually sends has three parts, and no constant can carry
the answer.** `supabase/functions/notify-dispatch` now drains the queue, so
liveness is a fact about a deployment and a school rather than about the source
tree:

1. **a driver** — `CHANNELS[].driver` says whether this *build* can send on the
   channel at all. All five have one: in-app, email (Resend), SMS (Twilio),
   push (FCM) and WhatsApp (Meta). The `"none"` state and the dispatcher's
   `unbuilt()` stub stay, for the next channel.
2. **the school's decision** — `notification_channel_settings.is_enabled` and
   `from_address`.
3. **credentials** — `provider_configured`, written by the dispatcher when it
   looks for its API key. Null means *never tried*, which is a different thing
   from *tried and found nothing*; a screen that conflates them tells a school
   its email is broken when nothing has ever run.

`channelState(status)` in `src/lib/validations/notifications.ts` is the single
place those three are combined, every surface offering a channel goes through
it, and the test pins the **shape** of the answer rather than today's values —
a channel with no driver can never claim to send, however it is configured.

This replaces the old rule, which made `CHANNELS[].live` the single source of
that honesty. It was right while the answer was "never, for anybody" and became
a lie the moment a driver shipped: a flag compiled into the bundle cannot know
whether a Supabase secret is set.

**A held channel keeps its queue.** A channel that is off, unconfigured or
unbuilt does not mark its deliveries `skipped` — they stay `queued` and
countable, so connecting a provider in March sends February's reminders.
Dropping them would be tidier and would lose a school's mail.

**One channel does not take a string, and pretending otherwise is how a
WhatsApp integration ships broken.** Outside a 24-hour window opened by the
*recipient* writing first, Meta accepts only templates registered and approved
in advance — a name, a language, positional parameters. A school sending a fee
reminder is always outside that window. So `notification_templates` carries the
*pointer* to Meta's copy and the ordered payload keys that fill it,
`notify_send` freezes both onto the delivery beside the address, and a WhatsApp
delivery with **no registered template is skipped at compose time with a
sentence** rather than queued. A queue that can never drain is worse than an
honest skip, because it looks like progress.

The 24-hour window is deliberately not modelled: using it would mean recording
every inbound message to know when a window opened, which is an inbox — a
second feature with its own webhook and unread state, built so that a fee
reminder could occasionally be free text. Say no to that once, here, rather
than rediscovering it.

**A failure can be permanent, and push is why.** Email and SMS fail transiently
almost always — a timeout, a rate limit — so `notify_record_result` backs off
and gives up after five attempts. A push token is not an address but a
*capability that expires*: once the app is uninstalled the provider answers
`UNREGISTERED` for ever, and retrying five times costs five requests and five
lines of log per message until somebody notices. So a driver may mark a failure
`permanent`, and the delivery fails at once **and the device is revoked in the
same statement** — "the provider says this handset is gone" is one fact, and
recording it against the delivery but not the device would queue another
delivery to the same dead token tomorrow.

**The dispatcher reports before it claims.** `notify_claim_deliveries` refuses
work for a channel whose `provider_configured` is false, and only the dispatcher
can set it, so every run reports what each driver can do before asking for
anything to send. Read the wrong way round that looks like a deadlock; it is
what stops one missing API key becoming a thousand failed deliveries.

`notification_deliveries` has **no INSERT policy at all** — that is what stops a
student inventing a message from the principal — which is why `notify_send` is
`SECURITY DEFINER` with its own admin check. Do not "fix" this by granting
admins INSERT. See `docs/modules/notifications.md`.

### A notice is not a notification

The board is the module built on top of this one, and the line between them is
worth stating because collapsing it fails in both directions:

> **A notice is a document with an audience. A notification is the fact that
> something was announced, once.** Treat a notice as a notification and there is
> no board — nothing to come back to in March to check what the circular said.
> Treat a notification as a notice and every typo correction re-sends four
> hundred SMS.

So publishing a notice calls `notify_send` **exactly once**; editing never does;
and announcing again is its own function with its own audit row, never a boolean
on publish whose meaning depends on what happened before.

Two rules come out of it that generalise:

- **Who may see a document is a policy, not a query.** The audience test lives in
  the RLS policy (`notice_matches_me(audience)`), so a parent cannot read another
  class's circular by asking for it directly — and consequently there is no
  filtering in the read model, none in the page, and no `roles` on the nav entry.
  A menu that guessed at the audience would be a second answer to a question
  Postgres already answers.
- **A failed announcement is not a failed publish.** The board is the point and
  the announcement is a courtesy, so a circular whose audience has no logins
  still goes up — and the reason is *written to a column*, not thrown and not
  swallowed. A caught exception with nowhere to put its message is how a school
  comes to believe four hundred parents were told.

See `docs/modules/notices.md`.


## 11. A report is a catalog row, not a page

**Do not add a screen to answer a question.** `reference.reports` describes each
report's parameters and columns as data, and `/reports` renders any of them
without being edited. A new report is a `SECURITY INVOKER` function taking
`jsonb` and returning `jsonb` rows, plus one row in the catalog.

Three rules for writing one:

- **Never put `where tenant_id =` in a read model.** Invoker + RLS is what makes
  a report unable to cross tenants. A filter written by hand in eight functions
  is a filter the ninth will forget.
- **Wrap the module's own read path where one exists.** Four of the eight ship
  as thin wrappers over `fees_student_balances`, `fees_day_book`,
  `timetable_teacher_load` and `timetable_for_section` — a report that
  recomputes what a module already knows is free to disagree with the screen the
  money is actually taken on.
- **Filter a `timestamptz` with `report_day_bounds()`**, never with a timestamp
  built in Node. Vercel runs in UTC; the school does not.

Reports are bounded (1,000 rows by default, 5,000 at most) with the true total
returned alongside, which is why they run inline without breaking rule 7. A
**full export** is that same call walked in pages by the browser, as the person
who asked — see rule 7. A PDF and a scheduled report remain `jobs` work and are
not built. See `docs/modules/reports.md`.

### …and a critic is a third thing again

Not a report — it takes no parameters and answers *"what is wrong here"* — and
not a dashboard, because it is read when something is wrong rather than glanced
at daily. `reference.checks` + `checks_run()` is the same catalogue-as-data
shape a third time, and the reason it exists is worth stating on its own:

> **A critic is only worth what it costs to reach it.** Eight `problems()`
> functions existed, each surfaced on exactly one screen, so a school learned
> that four hundred parents were getting nothing only by happening to open the
> schedules page.

Two rules for the runner, and both are about not looking clean when you are not:

- **A check that raised has not passed.** Each critic runs in its own block and
  an exception becomes a finding with the message on it. One broken critic
  silently turning a page green is the failure the whole surface invites.
- **A capped list says it is capped**, and never with a bare exact number —
  *"showing the first 200; there are at least this many"*. Rule 13's import
  lesson, arriving on a screen instead of in a spreadsheet.

See `docs/modules/checks.md`.

### …and a dashboard is not a report

The counter-shape, and worth naming because the temptation is to make the home
page eleven catalog rows. A report has parameters, answers one question, and is
looked *up*. A dashboard has none, answers nine at once, and is *glanced at* —
so its whole job is to be **one round trip**, which is the same argument rule 14
makes for `mobile_home()`.

`dashboard_summary()` is that: one `SECURITY INVOKER` function returning one
jsonb document. Rule 7 still decides whether it may run inline, and the answer is
yes because every figure in it is an aggregate — one row crosses the wire however
large the school gets. The old home page made seven queries and pulled *every*
active enrolment across the wire to count them in JavaScript, which is unbounded
work dressed as a bar chart.

Three rules come out of building it, and the first two are rule 11's own:

- **It must not answer a question the module it borrows from would answer
  differently.** Every figure aggregates a module's own read path
  (`fees_student_balances`, `fees_day_book`, `hr_attendance_sheet`) or counts
  the frozen table a module writes (`exam_results`). A dashboard free to
  disagree with the screen the money is taken on is worse than a dashboard
  without the number, because somebody will act on the wrong one.
- **Gate each block on the matrix, inside the function** — the `report_run`
  refinement in rule 4. Invoker + RLS alone makes a dashboard *dishonest* rather
  than unsafe: a teacher may read only their own row of `staff_attendance`, so
  an ungated staff card tells them "1 present, 39 unmarked" about a school where
  forty people were marked in.
- **Name what you withheld.** A card that is simply absent reads as a bug, so
  `withheld` lists the blocks the caller's role may not see and the page turns
  that into a sentence. Absent-and-withheld ("your role does not see fee
  figures") and absent-and-empty ("no exam has been published") are different
  sentences and only the server knows which applies. Consequently there is no
  `if (isAdmin)` on the page; adding one would be a second answer to a question
  that already has one.

**Three states, not a nullable number.** "0% present" and "nobody has taken the
register" look identical on a card and mean opposite things, so a register
resolves to `holiday | not-taken | taken` and the percentage is over what was
*marked*, never over the roll. The same instinct governs money: a collection
rate is **null, not 0**, before anything is billed — a school that has not raised
an invoice has not failed to collect, and an empty progress bar says it has.

**And a branch that describes a restricted caller has to be probed as one.**
Every `withheld` line in the first cut raised `22P02` (`text[] || 'fees'` is
ambiguous and resolves the literal to `text[]`). The function was probed as an
administrator and came back perfect, because an administrator is withheld
nothing — the branch is dead code for the only role anybody tests with.
Migration `0129`. The correction to `0129`'s own comment, in `0131`, is the
smaller companion rule: **write down what was actually checked and how, not what
the ideal check would have been**, because the next person reads the comment and
stops looking. See `docs/modules/dashboard.md`.


## 12. School policy is data, not branches

**Anything a school could reasonably disagree with belongs in a JSONB rules
document, not in an `if`.** Grade bands, grace marks, best-of-N, whether an
additional subject can stand in for a failed one, whether an absence may be
substituted — every one of those is a real school's real policy, and hardcoding
the first customer's version is the single most common way products like this
fail their second.

`grading_schemes.rules` is the pattern. Three rules for extending it, or for the
next module that needs one:

- **Evaluation order is part of the contract.** Grace before pass; substitution
  after grace; best-of after substitution. Write the order down and pin each
  step to an exact number in a test — schools argue about the order, and a
  comment does not survive a refactor.

  **A comment is not enough, and payroll is the proof.** Migration `0059`
  carried this exact order in its header — resolve earnings, prorate, then
  deduct — and the loop underneath collapsed the first two steps into one pass,
  prorating every allowance twice. It paid a gross of 41,620 where the
  arrangement pays 42,909, and each payslip line's own description read exactly
  as a person checking it would expect. Only the arithmetic found it. Pin the
  numbers: `tests/hr/payroll-engine.test.ts` asserts 42,909 *and* asserts not
  41,620.

  **Concessions are the second instance and add one thing.** The order there is:
  percentages against the *original* charge (10% + 50% is 60%, not 55%), each
  capped by its own ceiling, then fixed amounts against what is left, and the
  total never above the charge. `tests/fees/concession-engine.test.ts` asserts
  6,000 *and* asserts not 5,500. What is new is that **the cap has to fall
  somewhere, and where it falls is itself policy**: it takes the
  lowest-`priority` awards to zero rather than shaving all of them
  proportionally, so a statutory RTE seat is honoured before a discretionary
  sibling discount. A rule that only says "cap the total" leaves that unstated
  and every implementation picks differently.
- **A missing key means the conservative reading.** `replaces_absent` defaults
  to false because a school that wants leniency will say so, whereas a school
  that gets it by accident finds out from a parent. An empty `{}` must be a
  coherent configuration, not an error.

  `rank` is the second instance, and the conservative reading there is *do not
  rank at all*: several boards have abolished class position outright, and a
  card that invents one is worse than a card without one. An unrecognised
  `rank.scope` means the same thing — and because a silently-safe default is
  baffling to meet on a printed card, `grading_scheme_problems()` says so.

- **Some derived numbers are facts about a cohort, not about a row, and those
  must be frozen with their denominator.** A rank cannot be recomputed later:
  the cohort has changed. `exam_results` stores `rank_in_cohort` *and*
  `cohort_size`, written in the same statement as the marks. The same reasoning
  caught a subtler one — the attendance line on a report card was computed at
  read time, so a reprint in December disagreed with the card handed out in
  March. Anything printed on a document a person keeps is frozen when the
  document is made. See `docs/modules/report-cards.md`.
- **Criticise the document in Postgres, not in the browser.**
  `grading_scheme_problems()` returns sentences, and lives next to the engine so
  the thing that judges a scheme and the thing that evaluates it cannot drift.
  It is deliberately not a check constraint: a half-finished scheme must be
  savable.

Derived values are computed while they are provisional and **frozen when they
matter** — `exam_results` stores the numbers *and* a `rules_snapshot`, so
editing a scheme two years later cannot change a report card that was already
handed to somebody. See `docs/modules/exams.md`.

### A rules document needs a schema, or nobody knows what is in it

`public.settings` is the oldest instance of this rule — configuration as data,
since migration `0007` — and it is the instance that shows what the rule leaves
out. Seven keys, no description of any of them, and no screen. Two consequences,
one broken and one waiting:

- **`school.profile` was all null and there was no way to fill it in.** That is
  why `0136` had to strip `{{school.city}}` out of the shipped transfer
  certificate: a school could not print its own city on its own leaving
  certificate, and the fix was to delete the city.
- **A default written in five places is five answers.**
  `library.fine_per_day` defaulted to 2.00 in the seed row, in
  `library_return_book`, in the overdue report, in an old function signature and
  in TypeScript. They agreed, so nobody was charged wrongly — the cost is the
  one migration `0101` already paid once for document kinds: changing it means
  finding five copies, and the sixth reader invents its own.

So `reference.settings_catalog` is the `reference.reports` pattern applied to
configuration — key, label, declared shape, **the** default, the permission to
edit it. `setting_value` is the only place a default is applied, `/settings`
renders any key without being edited, and `settings_problems()` says what is not
filled in. Three rules for adding one:

- **Declare it or it does not exist.** `setting_set` refuses a key with no
  catalogue row, which is what makes this a catalogue rather than the bag it
  replaced.
- **Catalogue the shape that exists, do not reshape underneath a live reader.**
  `library.fine_per_day` is stored as `{"amount": 2.00}` rather than a bare
  number, and it is catalogued that way, because five readers already parse it.
- **"Set" and "left at the default" are two states and one value cannot carry
  both** — `attendance_coverage`'s lesson again. A school reading *"fine: 2.00"*
  needs to know whether somebody chose it.

And the one that is a security boundary rather than a nicety:

> **There is no `secret` value type, deliberately.** `settings` is readable by
> **every tenant member** — a parent, a student — which is correct for a fine
> rate and a school address. A credential there would be published to four
> hundred families. Provider keys live on the Edge Functions (rule 6) and
> nowhere else. **If a setting needs to be secret, it is not a setting.**

See `docs/modules/settings.md`.

### A rate hides what was never measured

This codebase says, in several modules, that an attendance percentage is **over
what was marked, never over the calendar** — a register half taken must read as
half taken, not as a school half empty. That is right, and it has a blind spot
which was open from the day the attendance module shipped:

> The rule that stops a rate lying is the same rule that hides the measurement
> nobody took. Those need **two numbers, not one changed one.**

94% over eleven marked days in a forty-day term is not a good month; it is
twenty-nine days nobody wrote down, and no percentage can say so however it is
computed. `attendance_coverage` and the `attendance.gaps` report are the second
number, and every existing percentage was left exactly as it was.

**And one fact gets one definition.** "Is the school open today" had grown three
implementations — `academics_is_teaching_day`, `hr_working_days` and, briefly,
`attendance_calendar` — and two of them disagreed about any holiday outside the
current session, because one filtered by `session_id` and one did not. The date
is the discriminator, not the session: a holiday row already says which year it
belongs to. Migration `0153` makes one of them the definition and the other two
wrappers, verified numerically before and after because payroll prorates on it.
See `docs/modules/attendance.md`.

### A status column is a summary, not a switch

`certificate_issue` set `students.status = 'transferred'` under a comment saying
that issuing a leaving certificate *is* the act of the child leaving. Checked
against the live function bodies, four of the five read paths that decide what a
child is charged and told never consult that column —
`fees_billable_lines`, `transport_fee_lines`, `hostel_fee_lines` and
`schedule_student_audience` — and the section invoice run loops
`enrolments.status` instead. So the flag alone left a child being invoiced, on a
bus, in a hostel bed, and receiving an absence text every evening.

> A status column is a **summary**. The relationships belong to the modules that
> made them, so an ending is **one act that ends them** — not a flag every
> reader has to remember to check. Nine readers would each have to; the tenth is
> the one somebody writes next year.

Three things `student_exit` fixes that generalise:

- **End, do not cancel.** `ends_on = the day they left` keeps the fact that the
  child rode the bus until then; `cancelled` erases it. Same instinct as a
  revoked concession keeping its credits.
- **Set the summary last**, so a failure part-way leaves the child visibly still
  here rather than half-gone.
- **What the act cannot end is a sentence, not a refusal** — an unreturned book,
  an unpaid balance. The certificates rule again: a function that refused would
  be one schools route around.

**A fix that lands in one caller has not landed.** `student_exit` was written
because `certificate_issue` set a flag and stopped — and `promotion_apply`, the
*other* place that turns children into alumni, went on setting the same flag for
another six migrations, fifty children at a time. So the act is now a function
of its own (`student_end_relationships`), both callers use it, and the thing
that makes that safe is that it validates nothing: each caller checks what only
it can know. Ask, when closing a gap: **who else does this?**

…and the second caller is where a per-row helper becomes a per-cohort one.
`student_exit`'s "what could not be ended" note costs **97 ms per child**,
because `where student_id =` outside a set-returning function is an
optimisation fence (rule 7) — fifty graduates is 4.9 seconds, and it scales with
the school rather than the cohort. So `promotion_apply` calls the *act* fifty
times and asks the *question* once, and the sentences live in
`promotion_left_behind`, which the preview screen can also ask of a draft.

**A measurement and a decision are two columns.**
`promotion_decisions.carry_forward` held both, and a run created with the
default rules reported `carried = 0` on a school where 96 families owed
₹10,60,904 — correct, and useless. `outstanding` is what the child owed;
`carry_forward` is what the policy chose to bill. The distinction matters
precisely where the policy is off, because the school least likely to carry fees
forward is the school most likely to forget the money. Same shape as
`attendance_coverage` beside a rate, and as `settings` distinguishing a value
from whether anybody chose it.

And a rule about critics, learned by the critic accusing a correct exit on its
own last day (`ends_on >= today` where the charge rule wants `>=` and the
relationship question wants `>`):

> **A critic that fires on a correctly finished action teaches people to ignore
> it**, which costs more than the check was worth. The bar for a `problems()`
> function is not "could this be wrong" but "is somebody going to have to do
> something about it".

The same question asked about **staff** found a sharper case, true in the demo
data: a terminated teacher still held 19 timetable lessons, and
`substitution_gaps` flagged none of them, because `staff_is_away` reads leave
and the daily register and a departed person is in neither. Three classes had
nobody and the roster said the school was covered. Two rules came out of fixing
it:

- **Do not conflate "not here today" with "nobody teaches this any more."**
  Marking a leaver *away* would have lit the roster up and had the office
  arranging the same emergency every morning until July. An absence wants cover;
  a departure wants a different teacher. They are different problems for
  different people, and one list showing both must say which.
- **Check what your fix makes invisible.** Unassigning those lessons was right —
  a timetable entry's teacher is a statement about *now*, unlike a frozen
  `substitutions.absent_staff_id` — but `substitution_gaps` required a non-null
  teacher, so unassigning alone would have dropped them off the morning list
  entirely: a quieter bug than the one being fixed. The roster learned to see a
  vacant post **first**, and only then was it safe to unassign.

#### …and an ending is not a door that stays shut

The act ends the relationships somebody had. That is the first half, and this
codebase shipped it alone twice.

> **Ending a relationship and refusing to make a new one are two different
> jobs.** A module that does only the first is correct on the day of the exit
> and wrong the morning after.

Five doors were open after a formal exit — four probed live, one found by
reading. A library book issued to a child who had left; the same for staff; a
fee concession awarded to the child whose concessions had just been revoked; a
lesson given to a teacher terminated thirty days ago; and a class to cover
handed to the same person, because `substitution_arrange` never looked at its
substitute. The library one is the sharpest: `student_exit` **counts** a
leaver's unreturned books in order to report them, and left the card that lends
more of them open.

The fixes come in two shapes and the difference is the whole rule:

- **If the relationship exists, ending it belongs in the act** — the library
  membership went into `student_end_relationships` beside the bus seat, as
  `expired` rather than `suspended`, because a suspension is a librarian's
  judgement about behaviour and this is a card that ran out.
- **If it does not exist yet, only a guard on the write can help.** There is
  nothing to end; a refusal is the only mechanism there is.

Two corollaries worth carrying:

- **A filtered dropdown is a convenience; the function is the gate.**
  `substitution_candidates` and the timetable's teacher list had offered only
  active staff since they were written, and both write functions accepted any id
  handed to them directly.
- **Here rule 4's composite key is the wrong tool, deliberately.** Carrying
  `teacher_status` on a timetable entry would make `on update cascade` refuse
  *the status change itself* while a departed teacher still held lessons — so an
  administrator editing a status would meet a constraint error instead of being
  told to unassign. The check is in the write function, and the migration says
  so at the point where somebody would otherwise add the key.

See `docs/modules/student-exit.md`.

### A record of an observation is not a place to write a decision

Approving a child's leave must not stamp `excused` across the register, however
convenient. Two reasons, and the second is the general one:

- it **writes the future** — the register is taken daily, by a person, and a
  child on approved leave who turns up is present;
- it makes `attendance_records` **say something no teacher marked**.

> A table that records what somebody observed may only be written by the act of
> observing. Everything else that wants to know about it — a report card, an
> absence notice, a screen — **reads** it, and reads the other fact alongside.

So leave reaches the register as an overlay the teacher can see, and reaches the
absence notice as a question it asks before sending. A leave approved after the
register was taken does not retrospectively change it, and re-marking is the
school's to do. See `docs/modules/student-leave.md`.

### A document a person keeps is frozen, and its wording is data too

Report cards said the first half of this. Certificates — transfer, bonafide,
character — say both halves, because a leaving certificate is a legal record
rather than a printout and every board prescribes different words for it.

> **Preview computes; issue freezes.** `certificate_preview` may be called a
> hundred times and stores nothing; `certificate_issue` calls it once more
> *server-side*, allocates a gapless serial, renders with it, and writes the
> rendered text down. From that moment the document is a row, and a duplicate
> printed in 2034 reads that row rather than recomputing.

Recomputing is not merely stale — by then the child has left, the enrolment is
over and the class has different children in it, so it would produce a
**plausible document that is not the one the family was given.**

Three rules follow, and the first is the one that feels wrong and is not:

- **A missing value stops the document; it is not smoothed over.** A null leaves
  its `{{placeholder}}` standing, the preview names it, and issuing refuses. A
  certificate reading *"Father's Name: —"* is a document a school has to
  apologise for, and it goes out because nobody noticed. The way to fill it is
  the template's own declared `fields`.
- **…but a policy question is a sentence, not a refusal.** Whether unpaid fees
  withhold a leaving certificate is a real school's real policy and unlawful in
  some states, so the engine says *"4,200.00 is still outstanding"* and a person
  decides — the `grading_scheme_problems()` pattern again.
- **A seeded default may only use values the database is guaranteed to have.**
  The shipped transfer certificate printed `{{school.city}}` and therefore could
  not be issued until an unrelated settings page had been filled in. Everything
  beyond the guaranteed set is the school's to add to its own copy of the
  wording, deliberately — which is what makes it a template rather than a form.
  Migration `0136`.

See `docs/modules/certificates.md`.


## 13. A bulk operation's preview is editable rows, not a report

Anything that changes many records at once — a rollover, a bulk import, a
whole-school invoice run — gets a **dry run that materialises as rows a person
can edit**, and an apply step that writes *what the rows say* rather than
recomputing from the rules.

`promotion_runs` → `promotion_decisions` is the pattern. The reason is specific:
every year the rules get three or four **named children** wrong — one was ill
for the examination, one is transferring in June, one the head has decided to
keep back — and the person who knows that is standing at the screen. A preview
they can only read is a preview they have to override afterwards, one enrolment
at a time, in a different part of the app.

Four things that make it work:

- **Freeze the rules onto the run.** Editing the tenant's policy later must not
  change what a run already decided — same instinct as
  `exam_results.rules_snapshot`.
- **Record that a human intervened.** `is_override` is the difference between
  "the rules decided" and "the head teacher decided", and both belong in the
  audit log.
- **Tie the decision to its target with a check constraint.** A promotion with
  no destination would otherwise apply as a silent no-op and the student would
  vanish from next year.
- **At most one live run per target**, as a partial unique index. Two half-built
  previews of the same operation disagree, and whichever is applied second
  silently wins.

Make the apply idempotent on the natural key so a retry after a timeout
converges. Keep it `SECURITY INVOKER` where the tables it writes already have
policies — reach for a definer function only when a table deliberately has no
INSERT policy at all. See `docs/modules/promotion.md`.

Bulk import is the second instance, and adds three things worth copying:

- **Re-judge every row after any edit, not just the edited one.** Fixing row 4's
  admission number clears row 2 as well, and a *new* duplicate introduced by the
  fix is caught before applying rather than during it.
- **Apply partially and record why.** A row that fails keeps its reason and the
  batch carries on; stopping at the first failure leaves the office with half an
  import and no list of what did not go in.
- **Refuse an oversized input rather than truncating it.** Silently importing
  the first 500 of 900 children is the worst available outcome, because nobody
  notices until April. Bound it, and say the bound out loud. See
  `docs/modules/import.md`.

Renewals (`renewal_runs` → `renewal_decisions`) are the third instance, and the
one that says what an apply step should *write with*:

> **Apply through the module's own write function, not an INSERT.** A renewal
> that inserted rows would be a second implementation of "the route is running,
> the child is enrolled in that year, the bus has a seat, the house takes this
> child, the dates fall inside the year" — five checks free to disagree with the
> five a person gets when arranging one by hand.

Two consequences worth copying:

- **The preview does not check capacity, deliberately.** A seat and a bed are
  rules about *how many other rows exist*, which no query over one row can see
  (rule 4's second boundary). They belong at apply, under the advisory lock the
  write function already takes, with the numbers in the message.
- **Ordering does not need a manual.** A child with no enrolment in the
  receiving year is previewed as `skip`, with *"Not enrolled in 2026-2027, so
  there is nobody to carry"* — so "promote first, then renew" is something the
  rows say rather than something a person has to have been told.

See `docs/modules/renewals.md`.

## 14. A client you cannot redeploy needs a versioned contract

The web app ships with the server. A **phone does not** — somebody is running
last April's build until they reinstall — so anything a mobile client reads is a
published contract rather than an internal shape.

`mobile_bootstrap()`, `mobile_home()` and `mobile_student()` are that contract:
one `jsonb` document each, `SECURITY INVOKER` so RLS decides what goes in, and
assembled in Postgres because a parent's home screen is eleven round trips
otherwise. **There is no second authorization layer** — a phone reads through
the same policies the web app does, and inventing a mobile-only gate would be
inventing a second place to get it wrong.

Four rules, and the first is the one that gets broken:

- **Additive only within a version.** A new key is safe; a renamed or removed
  one is not. Every schema in `src/lib/validations/mobile.ts` is
  `.passthrough()` on purpose — a client compiled in April must keep parsing
  when the server starts sending a field added in September, and removing it
  turns every additive change into a breaking one.
- **A breaking change is a new function** (`mobile_home_v2`), with the old one
  kept until nobody is on it. `min_supported_version` is how a build too old to
  render the document is told to update, and it is never lowered.
- **Bound every list and say the bound in the document**, per rule 7 — ten
  children, twenty homework items, eight results. A family larger than that is
  real; a response larger than that is a bug.
- **Wrap the module's own read path**, per rule 11. A phone that disagreed with
  the screen the money is taken on is worse than a phone with no fee balance.

**"My children" is a relationship, not a visibility.** RLS lets a teacher read
every child they teach; a home screen is not a roster. `mobile_my_students()`
spells the relationship out and returns an empty list for staff, and a test pins
that — "make the admin's home screen show the whole school" is a plausible
mistake nobody would report as a bug.

…and the web app then wrote the same sentence twice more, in two shapes, because
the phone's version was filed under *mobile*. One of the two answered a
**student** with an empty list — it opened `if (!ctx?.guardianId) return []` —
and only the calling page's own `roleCode === "parent"` branch kept that from
showing, which is to say the bug was real and a second branch was hiding it.

> A contract is not the same thing as a definition. `mobile_my_students()` is a
> published contract *over* a definition, and filing the definition inside the
> contract is what made two more of it.

So the relationship is `family_my_students()` and the mobile function is that
with the contract's bound of ten on it (migration `0199`) — the wrapper stays
rather than the function being renamed, because **the bound belongs to the
contract that promised it** and a web screen has no reason to silently drop an
eleventh child. `src/lib/auth/family.ts` is the single TypeScript caller, and
the mobile test pins the two together rather than testing each alone.

The intersection matters wherever this is used to *filter* rather than to list:
`listMyFamilyAccounts()` drives off the relationship and reads balances through
the policy, so a teacher whose own son is in Grade 4 sees one child and not 302.

**A push token is a capability, not an address.** Anyone holding one plus the
provider's key can push a message to that handset that looks like the school's,
so `devices` has policies scoped to `auth.uid()` and **no administrator read
policy at all**; `mobile_device_summary()` returns counts instead. See
`docs/modules/mobile-api.md`.

---

## 15. The locale is a property of a person, and RTL is a requirement

**No `[locale]` route segment.** Every screen is behind a login, nothing is
indexed, and a link sent between two members of staff should open in the
*reader's* language rather than the sender's — so the locale is resolved
server-side, exactly as the tenant and the session are, and `/students` stays
`/students` in every language. The cost is real and stated: no per-locale HTTP
caching by URL. See `docs/modules/i18n.md`.

Resolution order: `user_profiles.locale` → the cookie → `Accept-Language` →
`tenants.default_locale` → `en`. The cookie step is the one that is easy to
leave out: somebody who cannot read the default has no profile yet, so it is the
only place their choice can live on the login page. A **null** profile locale
means *"follow the school"*, which is not the same as having chosen the school's
current language.

`set_my_locale` is `SECURITY DEFINER` for the plain rule-4 reason, not the
column-grant one: `user_profiles` carries only an *administrator* UPDATE policy,
so the other five roles match no policy at all and have no way to write their
own row. A GRANT would have had no policy to narrow.

**English is the source catalogue; every other locale is a `Partial` of it.**
An incomplete translation must be *representable*, because a catalogue that has
to be complete to compile is a catalogue nobody adds a language to. At runtime
the fallback to English is silent — a parent is better served by an English
sentence than by a raw key — so the honesty lives in `coverageProblems()` and in
a per-locale **floor** in `tests/i18n/i18n.test.ts`. Raise a floor when a
translation is finished; **never lower one**, because a dropped key is the only
way it can fail and lowering it is deleting somebody's work and calling it a fix.

**Layout uses logical utilities only** — `ms-`/`me-`, `ps-`/`pe-`,
`text-start`/`text-end`, `border-s`/`border-e`, `start-`/`end-`. Every one is an
exact equivalent of its physical twin in LTR, so writing the physical form is
never *more* correct, only less portable. `dir` goes on `<html>`, never on a
wrapper.

**Keep at least one RTL locale in the list.** Urdu is there so that right-to-left
is exercised rather than declared; RTL that nothing uses is RTL that is broken
and nobody has noticed.

**And an untranslated string in an RTL locale is not "English for now" — it is
broken typography.** Rendered with `dir="rtl"`, the login page's two hardcoded
English sentences put their full stops at the **start** of the line
(`.else that keeps a school running`), because a neutral character at the end of
an LTR run inside an RTL paragraph belongs to the paragraph. Correct bidi, wrong
sentence, and invisible from the default locale. Wrap a Latin token that must
sit inside translated text in `<bdi>`, and check the *screenshot* of the RTL
locale rather than the key count. Icons are the part no codemod can do — an arrow meaning
"back" flips and an arrow meaning "download" does not — so directional lucide
icons are flipped by name in `globals.css` rather than by an `rtl:` variant at
thirty call sites.

**Never hardcode a locale tag in a formatter.** `toLocaleDateString("en-IN")` is
the same class of mistake as hardcoding a grading rule: it works for the first
customer. Go through `src/lib/i18n/format.ts`, which also keeps money in INR —
the rupee is a fact about the money, not about the reader.

That rule was written and then broken 42 times, in 30 files, before anybody
counted: **40 hardcoded `"en-IN"` tags and the rest passing `undefined`**, which
formats in the *browser's* locale rather than the reader's — the same bug with a
quieter tell. All 42 now route through the formatter. Four shapes, and the third
is the one to remember:

- a **client component** destructures the bound formatter (`const { formatDate }
  = useI18n()`), which keeps every existing call site's name and arguments —
  deleting the module-scope helper above it is the whole edit;
- a **server component** takes `await getLocale()` and calls
  `formatDate(value, locale)`;
- **anything built before render takes the formatter as a parameter.** A
  module-scope `ColumnDef[]` has no component for a hook to belong to, so
  `invoiceColumns(formatDate)` is a factory called inside `useMemo`, and
  `selectColumn({ all, row })` takes its labels the same way;
- a **shared component rendered from a Server Component takes the locale as a
  prop** — `useI18n()` would throw there.

**The money formatter was the same bug six times over, under four names** —
`formatMoney` in `fees-display`, `hr` and `inventory`, `formatAmount` in
`accounts`, `formatFare` in `transport` and `hostel`, 91 call sites, each
building `new Intl.NumberFormat("en-IN", …)` with slightly different options.
Measured before deleting them: **all three option sets produce identical
output** for every value tried, which is exactly why nobody noticed there were
six. That is `library.fine_per_day`'s lesson again — copies that agree cost
nothing until the day one of them has to change.

Two things came out of collapsing them into `formatCurrency(value, locale)`:

- **The guards did not agree, and that one was visible.** Three copies checked
  only `null` and `undefined`, so `""` — what an untouched form field submits —
  rendered as **₹0.00** and `"abc"` as **₹NaN**. *No value* and *zero rupees*
  are different facts, the same distinction this file already draws about a
  collection rate being null rather than 0. The single implementation returns
  `—`, which is the stricter of the two behaviours rather than a new one.
- **The rupee does not move; the grouping does.** `₹12,34,567.89` in `en-IN`
  and `hi-IN`, `₹1,234,567.89` in `ur-PK`. That is the whole visible effect,
  and `tests/i18n/money.test.ts` pins it alongside the two-decimal rule.

A wrapper that adds domain meaning keeps its name and gains a `locale`
parameter — `formatColumn` (a dash for zero in a ledger column) and
`formatBalance` (brackets for a negative) survived; deleting a helper that says
something is not the same as deleting a duplicate that says nothing. See
`docs/ui-review.md`.

**And the same sentence decides the module copy, which is the larger half.** The
chrome is translated; behind it are twenty-five modules of English — 238
distinct strings over the twelve screens a guardian can reach. But 238 loose
strings is the wrong shape of the problem:

> **44 `*Label` helpers, in 12 modules, called from 95 places in 57 files.**
> Those are the shared half: `channelLabel` is on nine screens, `periodLabel` on
> seven. One edit reaches every screen that renders that badge, which is not
> true of a heading.

So a label helper **keeps its name and gains a `Translator`** — the formatter
rule with a lookup instead of a computation — imported as a *type*, so a
validations module still drags nothing new into the bundle. Three things:

- **Resolve imports before quoting a number.** A plain grep says 170 call sites;
  three helper *names* mean different things in different modules
  (`statusLabel` in four, `kindLabel` in four, `periodLabel` in two), so the
  grep counts each module's sites against every module's helper. The
  `formatMoney`-under-four-names shape, one layer along. It is **95**.
- **The fallback is the value, not the key.** `createTranslator` returns the key
  for an unknown one, which is right for a missing *translation* and wrong for
  an unknown *value*: `notices.category.staff_only` on a badge is worse than the
  word the database stored. Check membership, then translate.
- **The guard is a floor run backwards.** `tests/i18n/label-helpers.test.ts`
  asserts every converted helper still takes a `Translator`, and that the number
  still hardcoding English may shrink and never grow. A per-locale floor says
  how much of the *catalogue* exists; this says how much of the *interface*
  reaches it — and the only way either can fail is that somebody's work was
  undone.

`/notices` is the first module through it, chosen because rule 10 makes it the
screen a family comes back to in March.

The family batch followed: nine helpers over attendance, student leave, exams,
homework and fees — **34 call sites, 47 keys in three languages** — and it is
the batch that shows why the *second consumer* decides the unit of work. A label
lives on the constant, so a badge helper and the `<Select>` that lists every
value both read it; translating one without the other puts the same value on one
screen in two languages. `optionsFor(values, prefix, t)` is that other half, and
two of its six call sites were **module-scope constants**, which is rule 15's
third shape arriving again: a list built before render has no component for a
hook to belong to.

**And an English frame with a translated word in it is still English.** The
register announced each mark to a screen reader as `` `${name} marked
${statusLabel(status, t)}` ``. The sentence is the unit, not the word.

Measured, because a claim about weight has to be: +0.13 kB on a touched route
(call sites gaining an argument) and **+2 kB on every client route** (the
catalogue itself, ~50 keys × 3 locales) — `/academics` moved the same 2 kB
untouched, and the Server-Component-only routes at 107 kB did not move at all.
That is the bargain `i18n-provider` already states. An earlier draft of the
`fees-display.ts` comment claimed one route was "unchanged"; the build
disproved it, and the comment now carries the real numbers.

**And the third batch found a label that should never have been one.** `WEEKDAYS`
carried `{ label: "Monday", short: "Mon" }` and six more, rendered on the class
routine a family reads. Translating it meant 21 keys in three languages —
*storing what every JavaScript runtime already ships*.

> Never hardcode a locale tag in a formatter, because it works for the first
> customer. **Hardcoding the formatter's output is the same mistake one step
> further along.** `formatWeekday` asks `Intl`; the English array stays as the
> no-ICU fallback and says so.

Two more instances of the same third shape, both caught by a tool rather than by
reading: `describeAudience()` is a plain helper, so `react-hooks/rules-of-hooks`
refused the hook and it takes `t` as a parameter; and a template table mapping
`templates.map((t) => …)` would have compiled `channelLabel(t.channel, t)` — a
row where a translator was wanted. **`t` as a loop variable is a landmine in a
codebase that has just made `t` mean one thing**; rename the row, never the
translator.

**And the batch after that shipped a bug the batch before it introduced.** The
weekday work put `useI18n()` into `week-view.tsx`, which has no `"use client"`
and whose own comment says it is a Server Component. `tsc` passed, `next build`
passed, and `/timetable/me` would have thrown for every teacher and student who
opened their own week.

> **A file with no `"use client"` may not call a hook.** It is the one place the
> compiler cannot help, and the failure is a blank screen rather than a red
> squiggle. `react-hooks/rules-of-hooks` catches a hook in the wrong *function*;
> it does not know which *file* runs on the server.

`tests/i18n/server-components.test.ts` does — every `.tsx` under `src/app` and
`src/components` without the directive, checked for fifteen hook names, and
verified by running it against the commit that shipped the bug, where it names
the file. A Server Component uses `await getT()` and `await getLocale()`.

**The money-and-stores batch found three more collisions and kept all three
apart.** `PAYMENT_METHODS` is four ways to pay a teacher in `hr` and seven ways
to take a fee in `fees-display`; `ATTENDANCE_STATUSES` is five in `hr` (a
teacher can be *on duty*; a child cannot) and four in `attendance`;
`LEAVE_STATUSES` says `rejected` in one and `refused` in the other. Each got its
own key prefix. **The reflex on meeting a third `PAYMENT_METHODS` is to collapse
it**, and a shared `method.cash` would have read correctly on the day it was
written while tying a school's payroll wording to its fee-counter wording for
ever.

**And it is the batch that priced the catalogue.** Built before and after and
diffed across all 83 routes: **56 moved, every one by 1–2 kB**, several of them
routes the batch never touched — because the catalogue is **one 56.9 kB chunk**
pulled into any route that calls `useI18n()` on the client, and 42 keys × 3
languages is that 1–2 kB. `First Load JS shared by all` is 103 kB before and
after, so it is not in the shared bundle. One route moved further: **`/hr`, 156
→ 172 kB**, because the staff register was its *first* client-side i18n consumer
and the whole catalogue arrived at once.

> **Translating one badge is nearly free on a route that already speaks, and
> costs the whole catalogue on a route that does not.** Splitting the catalogue
> per module is a real option not taken here; the day to take it is when a light
> route pays 16 kB for one word.

Two words in that batch turned out not to be labels at all, and both say the
same thing from opposite directions:

- **`.toLowerCase()` on a translated label is an English-only operation.** Two
  sites lowercased one to fit a sentence; Hindi and Urdu have no letter case, so
  the call was a no-op in every locale except the one it was written for, and in
  Turkish it would be wrong. The word above `formatWeekday` applies — do not
  hardcode the *output* of a locale rule either.
- **`short` is a key on a keyboard, not a word on a screen.** The staff register
  marks a class with `P`/`A`/`H`/`L`/`D`, so `optionsFor` translates `label` and
  carries `short` through untouched: a Devanagari `short` has no key on the
  keyboard the school types on. The button row reads the translated list and
  `onKeyDown` deliberately reads the raw constant, commented where somebody
  would otherwise tidy the inconsistency away.

One more thing the same batch settled: `timetable.periodLabel` and
`substitutions.periodLabel` are a **name collision, not a duplicate** — different
arguments, different output — which is exactly what made a grep by name count
each module's sites against both. Only the shared fragment `Period {n}` became a
key; a school's own name for a period ("Assembly") is the school's word and is
not translated.

---

---

## UI work — read this before writing any interface code

1. **Read `design-system/schoolos/MASTER.md` first.** It is the source of
   truth for colour, type, spacing, radius, shadow, and motion.
2. **Then check `design-system/schoolos/pages/<page>.md`.** If it exists, its
   rules override MASTER.md. If not, use MASTER.md exclusively. Pages with
   overrides today: `dashboard`, `student-list`, `fee-collection`,
   `marks-entry`, `attendance`, `login`.
3. Regenerate or add page overrides with the ui-ux-pro-max skill:
   ```bash
   python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" \
     --design-system --persist -p "SchoolOS" --output-dir . --page "<page>"
   ```
4. **Never hardcode a hex value or font name in a component.** Everything goes
   through the CSS variables in `src/app/globals.css` and the Tailwind tokens
   mapped from them (`bg-primary`, `text-muted-foreground`, `border-border`,
   `font-mono`, …).
5. **A string in the catalogue is not a control on the page.** Three keys —
   `app.skipToContent`, `app.theme.toggle`, `app.theme.light/dark/system` —
   were translated into all three languages and rendered **nowhere**, and
   `main#main-content` was the target of a skip link that did not exist. Rule
   6's sentence, arriving in the interface: a correct string nobody renders is
   not a feature. Grep for the caller, not for the key.
6. **Run the skill's pre-delivery checklist against every screen** before
   calling it done. The non-negotiable subset:
   - Real SVG icons only (lucide-react). **Zero emoji as UI.**
   - Light **and** dark mode, both at 4.5:1 text contrast.
   - `prefers-reduced-motion` respected (handled globally in `globals.css`).
   - Visible focus rings; semantic landmarks; labelled controls; error
     summaries linked to their fields; `aria-live` for async results.
   - Every list has a designed empty state, loading skeleton, and error state.
     Never a spinner on a blank page.
   - Tested at 375 / 768 / 1024 / 1440. No horizontal scroll on mobile; wide
     tables scroll inside their own container.
   - Badge/status meaning never relies on colour alone — pair it with text.
   - Long names, URLs and chip groups reflow without clipping at 200% zoom.
   - Destructive actions are confirmed and, where data permits, undoable.

### A conditional render is not a conditional load

Next bundles what is **imported**, not what is rendered, so `{open && <Big/>}`
ships `Big` to everybody and then does not draw it. Three of the six things that
made this app heavy were that mistake — most expensively a 404 kB Recharts
bundle on `/`, the **first page anybody sees after signing in**, which made the
dashboard the heaviest route in the product at 235 kB. It is 117 kB now.

- **Reach for `next/dynamic` for anything behind an interaction** — a dialog, a
  drawer, a chart below the fold. A dialog needs no `loading:` state (it is
  fetched on the click that opens it); a chart needs `ssr: false` and a skeleton
  **the same height as the chart**, or the page jumps when it arrives.
- `ssr: false` is illegal inside a Server Component, so the dynamic import lives
  in a small client module — see `src/components/dashboard/charts.tsx`. The page
  stays a Server Component.
- **A barrel that mixes a Zod schema with a label helper charges every importer
  for Zod** (91 kB, on 53 of 78 routes here). A schema belongs in the browser
  when a form validates against it; a label does not.
  `src/lib/validations/fees-display.ts` is the split, and it has **no imports at
  all** — one `import { z }` and it silently becomes the thing it was extracted
  from.

**Measure before and after, and say the number.** `npm run build` prints First
Load JS per route, `ls -S .next/static/chunks` says what is actually big, and
`.next/app-build-manifest.json` says which routes carry it — which is the
question that matters, because the worst chunk in this app was on exactly one
route. See `docs/performance.md`.

**And on the server, measure as the caller.** A `DO` block runs as `postgres`,
which bypasses RLS, so a timing taken there is for a query nobody will execute.
`checks_run()` measured **19 ms** that way and **849 ms first / ~660 ms after**
as an administrator — 35×, all of it policy evaluation. `concession_problems`
alone cost 845 ms on a school with **zero concessions**: the cost is being
allowed to see rows, not seeing them. Use `set local role authenticated` with
the JWT claims, every time.

**When the cost is policy evaluation, ask the expensive question once — do not
touch the policy.** Both slow critics were `union all`s over the same RLS-heavy
join, paying for it per branch. `with live as materialized (…)`, with each
branch's condition computed as a flag inside the one scan, took
`concession_problems` 845 → **130 ms** and the whole page 659 → **378 ms**
steady. `materialized` is load-bearing: without it the planner inlines the CTE
back into every branch. Rule 1 says the policy is the boundary, so it stays as
it is — and the isolation suite that would prove a policy rewrite safe cannot
run in this sandbox, which settles it.

### Amber is not a hover colour

The generated palette's amber (`--brand-accent`) is for **sparing emphasis** —
an overdue badge, a highlighted stat. shadcn's `--accent` token is a subtle
neutral hover tint and must stay that way. Making every hover amber would wreck
the calm, institutional feel this product is aiming for.

---

## Conventions

- **Server Components by default.** Reach for `"use client"` only when you need
  state, effects, or event handlers.
- **Mutations are Server Actions** returning a discriminated
  `ActionResult<T>` (`{ ok: true, data }` | `{ ok: false, error, fieldErrors }`)
  — see `src/app/(app)/library/actions.ts`. Never throw across the boundary for
  expected validation failures.
- **Validate with Zod at the server boundary**, even when the client already
  validated. The client is a convenience; the server action is the gate.
  Avoid `z.coerce` in form schemas — it splits the input/output types and
  breaks the react-hook-form resolver. Convert in the field instead.
- **Multi-step writes that must be atomic go in a Postgres function**
  (`library_issue_book`, `library_return_book`). supabase-js cannot open a
  transaction, so a sequence of client calls can interleave. Keep these
  `SECURITY INVOKER` so RLS still applies to the caller.
- **Lists use the DataTable primitive** (`src/components/data-table/`) with
  server-side pagination/sort/filter. Whitelist sortable columns server-side —
  never interpolate a client-supplied column name into `.order()`.
- **Forms use the form primitives** (`src/components/forms/`): `TextField` /
  `SelectField` / `TextareaField`, `ErrorSummary`, `useUnsavedChangesGuard`.
- **A list of valid values belongs in one place, and the constraint is usually
  that place.** `fees_next_document_number_for` carried its own copy of which
  document kinds exist, alongside the CHECK on `document_sequences.kind` that
  already said so — so adding a kind failed at runtime, and migration `0073`
  had already worked around it by hand-copying the whole numberer into
  `accounts_next_voucher_number`. Migration `0101` deleted both copies: the
  insert consults the constraint, and a bad kind fails with the constraint's own
  error. Adding a kind is now one ALTER.
- **When a value must be singular, write a scalar subquery, not a one-row CTE.**
  Postgres inlines a `language sql` function into its calling query, and a
  correlated `... limit 1` CTE does not always survive that rewrite.
  `fees_billable_lines` resolved a student's class level that way and was
  correct when called alone — then returned every line three times, with three
  different class levels, under `cross join lateral`. A scalar subquery returns
  one value or null, so there is no join for the planner to widen. Migration
  `0089`.

  **The same construct has a second symptom, and it is quieter.** A `cross join
  lateral` makes its result a **relation**, and a relation is not a constant —
  so the planner cannot push a column of it into a btree bound. A date range
  supplied that way becomes a Join Filter instead of an Index Cond, and a seek
  degrades into a full scan that is still correct. Two reports filtered
  `report_day_bounds()` that way; on the same 62 rows, **42.3 ms / 3,209 buffers
  as a lateral, 5.9 ms / 277 buffers as scalar subqueries** (migration `0168`).
  A wrong number gets reported; a slow query gets blamed on the platform.

- **A scalar function that queries another table is a correlated subquery
  wearing a nicer name.** In a projection it runs per row, and every RLS policy
  on the table it reads runs with it. `audit_actor_label` reads `user_profiles`
  — two permissive policies, each calling `current_tenant_id()` — and cost
  **8.4 ms per row**, 525 ms to name 62 rows containing two distinct people.
  Resolve a set as a set: join once and let the planner hash it. Keep the
  function for the single-actor callers. Migration `0169`.
- Generated DB types live in `src/lib/supabase/database.types.ts`. Regenerate
  after every migration.
- Migrations are numbered and immutable once applied. Add a new one; never edit
  an applied file.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (needs .env.test.local — see .env.example)
```

The integration tests hit a real Supabase project through real RLS policies.
They need two admin logins **in two different tenants**; that is the whole
point of the cross-tenant suite.
