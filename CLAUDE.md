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
ledger exists to prevent. **Staff library fines did not move** — `members` is a
student *or* a staff member, `ledger_entries.student_id` is `not null`, and a
staff fine is a payroll matter, not a fee receivable. Theirs stay on
`fine_amount` and are not collectable through the fees module. That is an open
gap, recorded in `docs/modules/library.md`, not a solved problem.

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

So: bound it and say what the bound is, or queue it. What is still genuinely
`jobs` work and is **not built**: full exports, PDF rendering, scheduled
reports, bulk import, and every external notification channel.

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

**Only `in_app` delivers today.** Email, SMS, WhatsApp and push are real
channels with real preference handling and real delivery rows; they queue, and
nothing drains them, because no provider is connected. That is deliberate. Any
surface offering one of those channels must say so rather than implying a
message went out — `CHANNELS[].live` in
`src/lib/validations/notifications.ts` is the single source of that honesty, and
a test asserts today's value so it cannot drift silently.

`notification_deliveries` has **no INSERT policy at all** — that is what stops a
student inventing a message from the principal — which is why `notify_send` is
`SECURITY DEFINER` with its own admin check. Do not "fix" this by granting
admins INSERT. See `docs/modules/notifications.md`.


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
returned alongside, which is why they run inline without breaking rule 7. The
unbounded cases — a full export, a PDF, a scheduled report — belong in `jobs`
and are not built. See `docs/modules/reports.md`.


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
- **Criticise the document in Postgres, not in the browser.**
  `grading_scheme_problems()` returns sentences, and lives next to the engine so
  the thing that judges a scheme and the thing that evaluates it cannot drift.
  It is deliberately not a check constraint: a half-finished scheme must be
  savable.

Derived values are computed while they are provisional and **frozen when they
matter** — `exam_results` stores the numbers *and* a `rules_snapshot`, so
editing a scheme two years later cannot change a report card that was already
handed to somebody. See `docs/modules/exams.md`.


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
