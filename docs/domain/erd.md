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
| `book_issues` | Session-scoped. `status` (issued/returned/lost), `due_at`, `returned_at`, `fine_amount`, who issued/returned it. |

Two `SECURITY INVOKER` RPCs keep the two-write operations atomic:
`library_issue_book(book, member, due_at)` and `library_return_book(issue)`.

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

## Roadmap (not built yet)

Recorded here so the built schema keeps accepting it. Each of these is
tenant-scoped, and every transactional one is session-scoped.

### Academics & timetable
`subjects`, `section_subjects` (subject × section × teacher), `periods`,
`timetable_entries` (section, subject, teacher, weekday, period, room).
Clash detection = exclusion constraints on (teacher, weekday, period, session)
and (room, weekday, period, session). `sections.class_teacher_staff_id` already
exists; subject-teacher assignment is what unlocks a finer-grained RLS rule
than today's "class teacher sees their section".

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

### Fees ledger
`fee_heads`, `fee_structures` (per class level × session), `invoices`,
`invoice_lines`, and an **append-only** `payments` / `discounts` / `fines` /
`refunds` ledger. Corrections are reversing entries. `receipt_sequences`
(tenant, session, next_value) generates gapless receipt numbers in Postgres.
Razorpay/Stripe webhooks are idempotent on the provider event id — store it
with a unique constraint. See CLAUDE.md rule 6.

### Accounts
Chart of accounts, vouchers, and a mapping from the fee ledger into it.

### Examination + configurable grading engine
`exams`, `exam_components` (weighted), `marks`, and a **rules engine** rather
than hardcoded logic: `grading_schemes` holding weighted components, best-of-N,
optional-subject handling, and grace-mark rules as data (JSONB), evaluated in
Postgres. Getting this wrong — hardcoding one school's rules — is the single
most common way school ERPs fail their second customer.

### Promotion
A dry-run that produces a preview (who promotes, repeats, graduates) before
writing next-session `enrolments`, plus fee carry-forward of outstanding
balances. Runs through `jobs`.

### Homework & study material
`homework`, `homework_submissions`, `study_material` — files in the
`homework-submissions` / `study-material` buckets, paths in the DB.

### Notifications
A driver abstraction: `notification_templates`, `notifications`, and
`notification_deliveries` with a `channel` (in-app / email / SMS / push /
WhatsApp). Sending goes through `jobs`.

### Later modules
Inventory, transport (routes, stops, vehicle assignments), dormitory, front
office (visitors, enquiries, calls). Reporting kernel over a set of read
models. i18n + RTL. Public REST API for mobile (PostgREST is already there;
what is missing is a versioned, documented surface and per-app keys).
