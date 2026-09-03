# SchoolOS data model

Everything below exists in the database today unless it sits under
[Roadmap](#roadmap-not-built-yet). The roadmap section matters: the built
schema is shaped to accept it without rewrites, and this is where those
assumptions are written down.

Conventions that hold for every table:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete cascade` — the one
  exception is `tenants` itself
- RLS enabled, with policies reading `current_tenant_id()` from the JWT
- `created_at timestamptz not null default now()`, and `updated_at` maintained
  by the `set_updated_at()` trigger where the row is mutable

---

## Built

### Tenancy

```
tenants ──┬─< academic_sessions        (one is_current per tenant, partial unique index)
          ├─< everything else
```

| Table | Notes |
|---|---|
| `tenants` | `name`, `slug` (unique), `timezone`. No `tenant_id` — it *is* the tenant. Provisioning is a service-role operation; no policy grants writes to `authenticated`. |
| `academic_sessions` | `name` ("2025-2026"), `start_date`, `end_date`, `is_current`. `current_session_id(tenant)` resolves the active one server-side. |

### Identity

```
people ──┬─< students ──< enrolments >── sections
         ├─< guardians ──< guardian_student >── students
         └─< staff ──< sections.class_teacher_staff_id

auth.users ──1:1── user_profiles ──> roles
                        └──> person / student / staff / guardian
```

| Table | Notes |
|---|---|
| `people` | Biographical only: names, DOB, gender, blood group, contact, address, `photo_path` (Storage object path, never a URL). |
| `students` | A person in the student role. `admission_number` unique per tenant — the durable identifier across alumni/re-admission. `status`: active, inactive, alumni, transferred, expelled. |
| `guardians` | A person in the guardian role, plus `occupation`. |
| `guardian_student` | Many-to-many with `relationship` (father/mother/guardian/other), `is_primary`, `can_pickup`. |
| `staff` | A person employed by the tenant. `employee_code` unique per tenant, `designation`, `department`, `status`. |
| `enrolments` | **One row per student per session.** Carries `session_id` directly as well as `section_id`. `status`: active, promoted, repeated, transferred_out, withdrawn. |

Why the split: a person can be a parent *and* a staff member; a student
becomes an alumnus without losing their history; siblings share guardians;
re-admission reuses the same `students` row with a new enrolment. Collapsing
these into one "student" table blocks all of it.

### Academic structure

| Table | Notes |
|---|---|
| `class_levels` | "Grade 1"…"Grade 12", with `sequence` for ordering. Unique per tenant on both name and sequence. |
| `sections` | A class level's section for a given session ("6A"). `capacity`, `class_teacher_staff_id`. Unique on (tenant, class_level, session, name). |
| `subjects` | What is taught. `code` unique per tenant, `kind` (theory/practical), `is_active`. **Not** session-scoped — a subject outlives a year. Deactivated rather than deleted once assigned. |
| `class_rooms` | Name and capacity. Capacity is what the exam seat-plan generator divides by. |
| `time_slots` | **Two** bell schedules, separated by `kind` (class/exam), because exam periods run longer. Unique on (tenant, kind, period_number); `ends_at > starts_at` enforced. |
| `weekends` | One row per weekday, `is_teaching`. **ISO numbering (1 = Monday … 7 = Sunday)**, matching `extract(isodow …)`. A missing row counts as teaching. |
| `holidays` | Session-scoped. A closure is **one row with a date range**, not one row per day. Both ends inclusive. |
| `section_subjects` | Session-scoped. Subject × section × teacher — the join that drives marks entry, homework and the routine. `teacher_staff_id` nullable, so a subject can be on the curriculum before a teacher is chosen. Unique on (tenant, session, section, subject), so re-assigning is an edit. |

`academics_is_teaching_day(date)` answers "is the school open" from the weekday
config **and** the holiday list, in one place — attendance, the routine grid and
any future calendar all need it, and three implementations is three chances to
disagree about a holiday.

See [docs/modules/academics.md](../modules/academics.md).

### AuthZ

| Table | Notes |
|---|---|
| `reference.permissions` | **Global catalog** of `code` / `module` / `ability`. Outside `public` because it is not tenant data. Read-only to clients via GRANTs. |
| `roles` | Per-tenant role rows. `code` is what RLS compares. `is_system` marks the standard six. |
| `role_permissions` | The matrix: (tenant, role, permission_code, allowed). |
| `invitations` | Pending logins: email + role + optional person/student/staff/guardian link + token + expiry. Admin-only visibility. |
| `user_profiles` | One row per `auth.users` id. Links a login to its tenant, role, and underlying record. Created only by `handle_new_auth_user()`. |

### Platform

| Table | Notes |
|---|---|
| `audit_log` | `table_name`, `row_id`, `action`, `old_data`, `new_data`, `actor_id`. Written by trigger; admin-readable; no client writes. |
| `jobs` | `job_type`, `status`, `payload`, `result`, `error`. Queued by the app, consumed by Edge Functions. |
| `settings` | Per-tenant key/value JSONB. |

### Library (the reference module)

```
book_categories ──< books ──< book_issues >── members ──> students | staff
                                  └──> academic_sessions (session_id)
```

| Table | Notes |
|---|---|
| `book_categories` | Name, unique per tenant. |
| `books` | Title, author, ISBN, publisher, edition, shelf, `total_copies`, `available_copies`. Check constraint: `available_copies <= total_copies`. |
| `members` | A student **or** a staff member (check constraint enforces exactly one). `membership_number`, `status`, `max_books`. |
| `book_issues` | Session-scoped. `status` (issued/returned/lost), `due_at`, `returned_at`, `fine_amount`, who issued/returned it. `fine_paid` was **dropped** in `0026` — for a student the fee balance answers it, and a boolean that can disagree with the ledger is drift waiting to happen. |

Two `SECURITY INVOKER` RPCs keep the two-write operations atomic:
`library_issue_book(book, member, due_at)` and `library_return_book(issue)`.

**Fines go to the fees ledger** (migration `0026`). Returning a late book books
a `fine` entry against the student's fee account, linked by
`ledger_entries.book_issue_id`, so an overdue book is collected on the same
screen as tuition. Booked at return, when the amount is final — a daily-accruing
debt cannot be one immutable row, so the running amount before then is an
estimate the UI computes and stores nowhere. The per-day rate lives in
`settings` (`library.fine_per_day`), read by both the function and the UI.

Staff members have no fee account, so their fines stay on `fine_amount` and are
settled outside the fees module. A dedicated policy lets a librarian insert
*only* `entry_type = 'fine'` rows carrying a `book_issue_id`, which is what lets
`library_return_book` stay `SECURITY INVOKER`.

### Students

No new tables — the register is a UI and an atomic write path over the existing
identity model (`people` → `students` → `enrolments`).

Two `SECURITY INVOKER` RPCs, for the same reason the library has them: admitting
a student writes three rows across three tables, and supabase-js cannot open a
transaction.

| Function | Notes |
|---|---|
| `admit_student(person jsonb, admission_number, admission_date, section_id, roll_number)` | Creates the person, the student, and — if a section is given — the enrolment. Resolves `session_id` itself via `current_session_id()`; the client never supplies it. A section is optional: a student can be admitted before placement. |
| `update_student(student_id, person jsonb, …, section_id, roll_number)` | Updates person + student, and **upserts** the enrolment on `(tenant_id, session_id, student_id)` so moving a student between sections edits this year's row instead of creating a second one. |

Both take the person as `jsonb` rather than fifteen positional arguments, so
adding a field to `people` doesn't change the function signature. Both pin
`search_path = public, extensions` — `citext` lives in `extensions`, and a
`public`-only path makes `people.email` fail at runtime (fixed in `0018`).

Students are **never deleted**. `status` (active/inactive/alumni/transferred/
expelled) is how a leaver is recorded, which is what keeps alumni, re-admission
and sibling links working.

---

### Attendance

```
enrolments ──< attendance_records >── academic_sessions (session_id)
                     └──> auth.users (marked_by)
```

| Table | Notes |
|---|---|
| `attendance_records` | Session-scoped. Keyed to **`enrolment_id`**, not `student_id`, so a mid-year section transfer keeps each month's marks with the class the student was actually in. `attendance_date` (a date, not a timestamp), `period` (`not null default 0`, 0 = whole day), `status` (present/absent/late/excused), `note`, `marked_by`. |

The unique index `(tenant_id, enrolment_id, attendance_date, period)` is the
whole idempotency story: a phone that lost signal and replays its queue upserts
onto the same rows instead of double-marking, so no client-generated
idempotency key is needed — the natural key already is one.

`period` is `not null` with 0 meaning whole-day rather than nullable, so the
unique key stays a plain four-column index instead of one over
`coalesce(period, -1)`. Period-wise marking (which needs the timetable tables)
then becomes a data change rather than a migration of the key.

One `SECURITY INVOKER` RPC:

| Function | Notes |
|---|---|
| `mark_attendance(section_id, date, entries jsonb, period default 0)` | Writes a whole register in one upsert and returns the row count. Resolves `session_id` itself, refuses future dates, and filters `entries` to enrolments genuinely in that section and session — so a tampered payload cannot mark another class. |

Teachers may read and write only sections where they are
`class_teacher_staff_id`; students see their own rows, parents their children's.
See [docs/modules/attendance.md](../modules/attendance.md).

---

### Fees

```
fee_heads ──< fee_structures >── class_levels
                   └──> academic_sessions (session_id)

invoices ──< invoice_lines ──> fee_heads
    └──< ledger_entries ──> ledger_entries (reverses_entry_id)

document_sequences   (tenant, session, kind) -> next_value
```

Two halves that must not be confused: **charges** (`invoices` +
`invoice_lines`, what the school billed) and the **ledger** (`ledger_entries`,
every movement against those charges).

```
balance = Σ lines of issued invoices + Σ ledger entries
```

| Table | Notes |
|---|---|
| `fee_heads` | What the school charges for. `code` unique per tenant, `category`, `is_active`. Never deleted once billed — deactivated. |
| `fee_structures` | What one class level pays for one head in one session. Unique on (tenant, session, class level, head). `amount` is per *instalment*; `frequency` describes the cadence, it does not divide the amount. |
| `document_sequences` | A counter row per (tenant, session, kind). See below. |
| `invoices` | Keyed to `student_id` (not `enrolment_id`, unlike attendance): a bill follows the child for the year, so a mid-year section move neither orphans nor duplicates it. `status` is `issued` or `cancelled`; cancelling requires who, when and why. |
| `invoice_lines` | **Append-only.** No `updated_at`, no UPDATE/DELETE policy, privileges revoked. |
| `ledger_entries` | **Append-only.** One table for payments, discounts, fines, refunds and write-offs, typed by `entry_type`. |
| `ledger_entries.book_issue_id` | Set when the fine came from a returned library book. Composite `(tenant_id, book_issue_id)` FK, `on delete set null` on that column alone, so deleting a book cannot erase money history. |
| `payment_intents` | An online payment before it becomes money: student, amount, `provider_order_id`, `payment_url`, `status`, and `ledger_entry_id` once settled. It exists so a webhook can answer "who paid, and how much were they supposed to pay" from a row **this system wrote** rather than from the callback body. |

**One ledger table, not four.** This entry previously sketched separate
`payments` / `discounts` / `fines` / `refunds` tables. Four tables would mean
four sets of policies, four audit triggers, four reversal mechanisms and a
five-way `UNION` to answer "what does this child owe". A single table with a
sign-constrained `entry_type` gives the same guarantees and makes the balance
one `SUM`.

**Sign convention:** `amount` is signed and positive always means *owes more*.
Fines and refunds are positive; payments, discounts and write-offs are
negative. `ledger_entries_sign_chk` enforces this per type and inverts it for a
reversal, so a mis-signed row cannot be inserted. The RPCs take positive
amounts and do the signing.

**Gapless numbering:** a Postgres sequence will not roll back, so a failed
payment would burn a receipt number and leave a hole — which an auditor reads
as a missing receipt. `document_sequences` is an ordinary counter row
incremented inside the caller's transaction, so a rollback returns the number.

**Immutability:** `ledger_entries` and `invoice_lines` have no UPDATE/DELETE
policy *and* have those privileges revoked, so a careless `for all` policy added
later still cannot rewrite history. A correction is a reversing entry pointing
at the row it cancels, unique on `reverses_entry_id`.

**Webhook idempotency:** `(tenant_id, provider, provider_event_id)` is unique;
`fees_record_payment` checks it *before* allocating a receipt number, so a
redelivered event returns the original receipt instead of burning a number.

Eleven `SECURITY INVOKER` functions: `fees_next_document_number`,
`fees_generate_invoice`, `fees_generate_section_invoices`,
`fees_cancel_invoice`, `fees_record_payment`, `fees_record_refund`,
`fees_record_adjustment`, `fees_reverse_entry`, `fees_student_balances`,
`fees_raise_charge` (a one-line invoice at a typed amount, for the counter) and
`fees_day_book` (payments and refunds in a date range, with the day boundaries
taken from `tenants.timezone` rather than from the server's clock).

`fees_student_balances` takes `p_student_ids` as well as `p_section_id`, so the
counter's type-ahead can price a handful of matches through the same arithmetic
that produces every other balance — the identity must never have two
implementations.

Online payments add `fees_create_payment_intent` (INVOKER) and
`fees_settle_gateway_payment` — the module's **only** `SECURITY DEFINER`
function, because a webhook carries no JWT and no invoker function can serve
it. It is narrowed to compensate: it settles an existing intent and nothing
else, takes the amount from that intent rather than its arguments, and is
revoked from `public`, `anon` and `authenticated`, so only the service role
behind the Edge Function reaches it.

Receipt numbering was split for the same reason: `fees_next_document_number_for(
tenant, session, kind)` does the work and `fees_next_document_number(kind)` is a
JWT-resolving wrapper, so the counter and the gateway draw from one counter row.

`fees_queue_invoice_email` writes a `jobs` row of type `invoice_email`, carrying the invoice **lines**, what has been paid against it, the guardian and a
school block — so the eventual sender can produce an itemised bill rather than a
bare total. **Nothing consumes it** — no mail provider is connected, by choice.

`settings['school.profile']` holds the letterhead (address, phone, email, website) that printed invoices carry; `tenants` has only a name.

See [docs/modules/fees.md](../modules/fees.md).

### Promotion

```
promotion_runs        tenant, from_session, to_session, rules jsonb,
                      status (draft|applied|discarded), applied_at/by
  └── promotion_decisions  run x student, decision
                      (promote|repeat|graduate|hold), to_section, reason,
                      is_override, carry_forward, applied_enrolment_id
```

**The preview is editable rows, not a report.** Applying writes what the
decisions say, not what the rules said — because every year the machine gets
three or four named children wrong and the person who knows that is standing at
the screen. `is_override` records which is which.

A check constraint ties the decision to its target — a promotion or repeat must
land somewhere, a graduate or hold must not — so a "promote" with a null section
cannot apply as a silent no-op. A partial unique index allows at most one live
run per session pair.

Applying closes the outgoing enrolment as `promoted` or `repeated` (which is what
makes `enrolments` a history rather than a snapshot), writes the new one
idempotently on `(tenant_id, session_id, student_id)`, marks a graduate
`students.status = 'alumni'`, and raises carried balances as **opening invoices**
in the receiving year rather than copying a number across.

`SECURITY INVOKER`: everything it writes already has an admin policy, so RLS
decides every row and the function only supplies atomicity. Admin-only to read
as well as write — a preview says "this child will repeat" before anybody has
decided it. See [docs/modules/promotion.md](../modules/promotion.md).

### Exams and grading

```
grading_schemes  tenant, name, is_default (partial unique), rules jsonb
exams            tenant, session, name, kind, dates, grading_scheme_id,
                 status (draft|published), published_at
exam_subjects    exam x section x subject, max_marks, pass_marks, weight,
                 is_optional, exam_date, time_slot (kind='exam' via composite FK)
marks            exam_subject x student, marks_obtained (nullable = unmarked),
                 is_absent, max_marks (denormalised, see below)
exam_results     the frozen answer, written once by exams_publish
```

`marks` is raw facts and `exam_results` is the frozen answer; **everything
between them is computed**. Grace, best-of-N, optional-subject substitution, the
aggregate and the grade are all derived on demand while the exam is a draft, and
frozen with a `rules_snapshot` at publish so a reprint matches the original.
Grace is deliberately not a column: it is a rule, not a fact.

**`marks.max_marks` is denormalised and held equal to its paper's by a composite
foreign key**, so the CHECK `marks_obtained <= max_marks` has a local column to
compare against — the generated-column trick from `0040`, generalised from a
boolean to a value. `on update cascade` keeps it in step and refuses to lower a
paper's maximum below a mark already awarded.

`exam_results` has **no INSERT, UPDATE or DELETE policy for anybody**;
`exams_publish` / `exams_unpublish` are SECURITY DEFINER with their own admin
check. Marks are writable by the **subject** teacher
(`section_subjects.teacher_staff_id`) — the finer-grained rule the academic
structure was built to unlock — readable by the class teacher, and visible to
families only once published.

See [docs/modules/exams.md](../modules/exams.md).

### Homework and study material

```
homework              tenant, session, section x subject (composite FK to
                      section_subjects), title, instructions, assigned_on,
                      due_on, max_marks (nullable), collects_submissions,
                      status (draft|published), published_at
homework_submissions  homework x student, status
                      (pending|submitted|graded|returned), submitted_at, note,
                      marks_obtained, max_marks (denormalised, see below),
                      feedback, graded_by, graded_at
homework_files        one table, two parents, exactly one set: homework_id
                      (the question) XOR submission_id (the answer);
                      bucket_id + storage_path, unique together
study_material        tenant, session, nullable section + subject, kind
                      (document|video|link), storage_path XOR external_url,
                      is_published
```

**A submission exists before any file does.** `homework_publish` creates one
`pending` row per actively enrolled student, so "not handed in" is a row rather
than the absence of one — the absence of a row is indistinguishable from a
child who was never set the work. Homework with `collects_submissions = false`
gets no roll at all.

**`homework_submissions` has no student UPDATE policy, deliberately.** A column
grant separates columns, not people: every user here is `authenticated`, so
`grant update (status, submitted_at, note)` would take `marks_obtained` from the
teachers too. `homework_submit` / `homework_unsubmit` are narrow SECURITY
DEFINER functions instead; `homework_grade` stays INVOKER because teachers do
have a policy covering the whole row. This is the case where the `0039` pattern
does **not** apply, and the difference is worth reading before copying either.

`homework_submissions.max_marks` is denormalised inside a composite FK to
`homework (tenant_id, id, max_marks)` with `on update cascade` — the same
device as `marks`, so a mark above the maximum is refused and the maximum
cannot be lowered below one already awarded.

Files are the first real use of rule 8: paths are
`{tenant_id}/{owner_id}/{uuid}-{name}`, storage RLS enforces only the tenant
prefix (`public.storage_object_tenant_matches()`), and the row-level question is
answered by the server action before a signed URL is ever issued.

See [docs/modules/homework.md](../modules/homework.md).

### HR and payroll

```
leave_types              tenant config: code, name, annual_quota_days
                         (null = "as much as is approved"), is_paid
leave_requests           staff x type x date range, half_day_start/end,
                         status (pending|approved|rejected|cancelled)
staff_attendance         staff x date, status
                         (present|absent|half_day|on_leave|on_duty),
                         leave_request_id when a leave day
salary_structures        name + a JSONB `components` document (rule 12)
staff_salary_assignments staff x structure, `overrides` jsonb, effective-dated
payroll_runs             tenant x period_month, status, run_kind
                         (regular|correction), rules_snapshot
  payslips               run x staff, run_status (denormalised), working_days,
                         employed_days, paid_days, totals, is_override, `computed`
    payslip_lines        one per component, with the `basis` in words
payroll_payments         append-only settlement of a finalised payslip; signed,
                         reversing entries, idempotent on the bank reference
```

**A finalised payslip is immutable because no policy matches it.** `payslips`
carries `run_status` inside a composite FK to `payroll_runs (tenant_id, id,
status)` with `on update cascade`, and `payslip_lines` points at `payslips` the
same way. The write policy requires `run_status = 'draft'`, so finalising is one
UPDATE on the run: the cascade rewrites every child and the policy then matches
nothing. No revoke, no trigger. This is the *row* version of the problem
`homework_submissions` solves with a definer function — reach for the function
only when the distinction is between people rather than rows.

**Two overlapping date ranges are refused by GiST exclusion constraints**, on
`leave_requests` (partial on pending/approved, so a refusal does not block
re-applying) and on `staff_salary_assignments` (so "what is this person paid" is
never ambiguous). Neither rule can be a CHECK: neither is decidable from one row.

The engine's evaluation order — resolve earnings, prorate once, then deduct
against the prorated figures — is the contract, and migration `0063` exists
because `0059` collapsed the first two steps and prorated every allowance twice.
`salary_structure_problems()` criticises a document in sentences, next to the
engine, exactly as `grading_scheme_problems()` does.

`hr_working_days()` finally asks `weekends` and `holidays` a question, and is
the denominator of every loss-of-pay calculation.

See [docs/modules/payroll.md](../modules/payroll.md).

### Reporting kernel

```
reference.reports  key PK, name, description, module,
                   required_permission -> reference.permissions(code),
                   function_name, parameters jsonb, columns jsonb, sort_order
```

No new tenant-scoped table: a report is a *view* of a module's own read path.
Outside `public`, like the other reference catalogs, so the schema-guard
invariant stays meaningful.

`report_run(key, params, limit)` looks the report up, checks the caller's
`required_permission` against `role_permissions`, and executes
`public.<function_name>(jsonb)` through `%I`-quoted dynamic SQL — safe because
`reference.reports` has writes revoked from `authenticated` and `anon`, so the
only writer is a migration.

**No read model contains a `where tenant_id =`.** All eight are SECURITY
INVOKER, so RLS decides every row; if isolation depended on each function
remembering, the ninth would forget.

Bounded rather than queued: 1,000 rows by default and 5,000 at most, with
`count(*) over ()` giving the exact total before LIMIT so the caller can say
"showing 1,000 of 3,412". Rule 7's `jobs` path is for the unbounded case — a
full export, a PDF, a scheduled report — none of which are built.

Four of the eight wrap functions that already exist (`fees_student_balances`,
`fees_day_book`, `timetable_teacher_load`, `timetable_for_section`) rather than
recomputing what a module already knows. See
[docs/modules/reports.md](../modules/reports.md).

### Class routine

```
timetable_entries  tenant, session, section, subject, teacher?, room?,
                   time_slot, weekday (ISO 1-7), slot_schedulable (constant true)
```

Three unique constraints carry the whole design: one lesson per class per
period, a teacher in one place at a time, a room holding one class at a time.
The last two are **partial** indexes (`where … is not null`), because a period
with no teacher assigned yet is not a clash with every other unassigned period.

Not exclusion constraints, as this file first sketched: a period is a
`time_slots` row rather than a time range, so two lessons either occupy the same
slot or they do not, and an equality-only exclusion constraint is a unique index
with a GiST index and no `on conflict`.

`time_slots` gains a generated `schedulable` column (`kind = 'class' and not
is_break`) and a `unique (tenant_id, id, schedulable)`. `timetable_entries`
carries a constant `slot_schedulable = true` and points a composite FK at it —
which makes "a real lesson period in my own tenant" one declarative constraint,
where a CHECK could not reach another table.

The curriculum FK
`(tenant_id, session_id, section_id, subject_id) → section_subjects` subsumes
the section and subject keys and adds "this subject is on this class's
curriculum this year". `teacher_staff_id` is denormalised from the assignment on
purpose: the clash index needs it on the row, and a period covered by a
substitute is still that section's lesson.

Written through `timetable_set_entry` (an upsert — a cell holds one lesson) and
`timetable_copy_day` (fills empty periods only, never overwrites). Read through
`timetable_for_section`, `timetable_for_teacher` (defaults to the caller's own
staff record) and `timetable_teacher_load`.

Everyone in the tenant reads it; only admins write. See
[docs/modules/timetable.md](../modules/timetable.md).

### Notifications

```
reference.notification_types  key PK, name, description, default_channels[]
notifications                 tenant, session, event_key, subject, body,
                              payload jsonb, audience jsonb, created_by
  └── notification_deliveries tenant, notification (composite FK),
                              recipient_user_id, channel, address,
                              subject, body, status, attempts,
                              next_attempt_at, last_error, sent_at, read_at
notification_templates        tenant × event_key × channel, {{interpolated}}
notification_preferences      tenant × user × event_key × channel, opt-outs only
```

One message, one row in `notifications`; one row per recipient per channel in
`notification_deliveries`. "Did the announcement go out" and "did Ravi's
mother's SMS arrive" are different questions, and the split is what keeps the
second answerable.

`audience` records **how** recipients were chosen (`all` / `role` / `section` +
`who` / `users`), not who they were — so the log stays meaningful after a
student changes class. `address` freezes the email or phone **as it was at send
time**; a log that re-reads the current address cannot say where a message
actually went.

Preferences store **only opt-outs**. An absent row means "use the catalog
default", which is what lets a school change a default and have it reach
everyone who never expressed a preference.

`reference.notification_types` sits outside `public`, like
`reference.permissions`, so the schema-guard invariant stays meaningful.

Writes go through `notify_send` — the module's one `SECURITY DEFINER` function,
needed because `notification_deliveries` has **no INSERT policy at all**, which
is what stops anyone forging a message from the principal. The dispatcher pair
(`notify_claim_deliveries`, `notify_record_result`) is revoked from
`authenticated` outright: they are for an Edge Function holding the service
role.

**Only `in_app` delivers today.** The other four channels queue real delivery
rows that nothing drains, because no provider is connected. The UI says so
rather than implying a message went out.

Migration `0039` narrows what a recipient may write to `read_at` with a
**column-level GRANT** — RLS cannot restrict columns, and the policy alone let a
recipient rewrite the body of their own delivery. See
[docs/modules/notifications.md](../modules/notifications.md).

### Cross-tenant foreign keys

Foreign key checks are **not** subject to RLS, so `references students(id)`
accepts an id the caller cannot see. Migration `0024` gives `students`,
`invoices` and `enrolments` a `unique (tenant_id, id)` and points
`invoices`, `invoice_lines`, `ledger_entries` and `attendance_records` at those
with composite foreign keys — making "the child's tenant equals the parent's
tenant" a database constraint that holds on every write path, not a check every
function has to remember.

---

## Roadmap (not built yet)

Recorded here so the built schema keeps accepting it. Each of these is
tenant-scoped, and every transactional one is session-scoped.

### Timetable — generation and period-wise attendance
The routine itself is **built** (see *Class routine* under Built). What remains
is automatic generation — constraint solving over teacher availability, subject
period-quotas and room types, which is genuinely hard and worse than nothing if
done badly; the constraints a generator would have to satisfy are already in the
schema, which is the part worth having first. Also unbuilt: wiring
`attendance_records.period` (which has existed since `0019`, defaulting to
`0` = whole day) to the periods that now exist, a substitute-teacher log, a
room-utilisation view, and a printable per-class handout.

### Students — bulk import only
The register itself is **built** (see *Students* under Built). What remains is
bulk admission: Excel/CSV import runs through `jobs`
(`job_type = 'student_import'`), never in a request handler. Needs a staging
table with per-row validation results so the UI can show a dry-run before
committing — and it should call `admit_student()` per row so imported students
go through exactly the same atomic path as hand-entered ones.

### Attendance — period-wise and holidays
The register itself is **built** (see *Attendance* under Built). What remains
needs tables that do not exist yet: period-wise marking waits on the timetable
(`attendance_records.period` is already there, defaulting to 0 = whole day), and
a school-calendar table would let the report say "18 of 22 school days marked"
instead of just counting the days that were.

### Fees — gateway integration and recurring billing
The ledger itself is **built** (see *Fees* under Built). What remains: a
Razorpay/Stripe Edge Function (a thin adapter over `fees_record_payment` with
`p_provider` / `p_provider_event_id` — the idempotency constraint is already
there), recurring instalment generation through `jobs`, whole-school invoicing
through `jobs`, and receipt PDFs.

### Accounts
Chart of accounts, vouchers, and a mapping from the fee ledger into it. This is
also where a **salary payment** belongs: payroll produces a liability, and
`ledger_entries` is a fee *receivable* ledger (`student_id` is `not null`) that
deliberately cannot hold it.

### HR and payroll — the gaps
The module is **built** (see *HR and payroll* under Built), and the four gaps the
first version recorded are now closed (migrations 0065–0070): payslip payments as
an append-only subsidiary record (`payroll_payments`); correction/arrears runs
(`payroll_runs.run_kind`); mid-month leavers prorated (`staff.date_of_leaving`
plus a two-factor engine); and staff library fines collected through payroll and
settled on `book_issues.staff_fine_payslip_id`. What still remains: income tax
(a slab calculation over projected annual income, a different document from
`components`); payslip PDFs and bank advice files, both `jobs` work per rule 7;
an approval chain, so a department head can decide their own team's leave; a
staff CRUD screen to set `date_of_leaving` from (staff are seeded today); and the
chart of accounts (Phase 2.2) that turns a salary payment into a real
double-entry voucher.

### Examination — components, report cards, rank
The exams module and its rules engine are **built** (see *Exams and grading*
under Built). What remains: `exam_components`, so "Theory 80 + Practical 20" is
one paper with two parts rather than two papers with weights; a letterheaded
report-card PDF; class rank (whose tie and optional-subject rules must themselves
be scheme data); re-evaluation and supplementary exams; and wiring
`exam.results_published` into the notification service, which already has the
event key and no caller.

### Promotion — scale, undo, and notifications
The rollover is **built** (see *Promotion* under Built). What remains: moving the
apply step into `jobs` (it is already row-by-row and idempotent, so it is the
half that ports cleanly, and it starts to matter well above a few hundred
students); telling families a child was promoted, which means calling
`notify_send`; assigning roll numbers in the receiving year; and bulk section
rebalancing, since today a student lands in the same-lettered section and
anything else is one override at a time.

### Homework & study material — the gaps
The module is **built** (see *Homework and study material* under Built). What
remains: telling families when homework is set, which needs a batching policy
before it needs a `notify_send` call (eight pieces on a Monday is eight
notifications to every parent); back-filling a submission for a student who
enrols after the homework was set, which is a policy question rather than a
missing trigger; per-question marking and rubrics; and bulk download of a
class's submissions, which is unbounded work and belongs in `jobs`.

### Notifications — drivers only
The service itself is **built** (see *Notifications* under Built). What remains
is a driver per external channel: an Edge Function that calls
`notify_claim_deliveries()`, sends, and calls `notify_record_result()`. No
application code moves when one is added — that is the whole point of the
abstraction. Also unbuilt: scheduled sending, and wiring the existing modules
(`attendance.absent`, `fees.invoice_raised`, `library.book_overdue`) to emit
their events.

### Later modules
Inventory, transport (routes, stops, vehicle assignments), dormitory, front
office (visitors, enquiries, calls). i18n + RTL. Public REST API for mobile
(PostgREST is already there; what is missing is a versioned, documented surface
and per-app keys). The reporting kernel is **built** (see *Reporting kernel*
under Built); what remains there is queued exports through `jobs`, PDF
rendering, saved presets, and charts over the same read models.
