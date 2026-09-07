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

**One key can carry two of those at once.** `marks.component_max_marks` is the
newest use and it is not a sixth kind — it is the identity use and the value use
in a single constraint:

```sql
foreign key (tenant_id, exam_subject_id, exam_component_id, component_max_marks)
references public.exam_components (tenant_id, exam_subject_id, id, max_marks)
```

`exam_subject_id` in the key says *this part belongs to this paper*;
`max_marks` says *this local ceiling is the part's own*. One constraint, two
rules, one cascade. It also shows how to make the device **optional**: both
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
and nobody has noticed. Icons are the part no codemod can do — an arrow meaning
"back" flips and an arrow meaning "download" does not — so directional lucide
icons are flipped by name in `globals.css` rather than by an `rtl:` variant at
thirty call sites.

**Never hardcode a locale tag in a formatter.** `toLocaleDateString("en-IN")` is
the same class of mistake as hardcoding a grading rule: it works for the first
customer. Go through `src/lib/i18n/format.ts`, which also keeps money in INR —
the rupee is a fact about the money, not about the reader.

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
5. **Run the skill's pre-delivery checklist against every screen** before
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
