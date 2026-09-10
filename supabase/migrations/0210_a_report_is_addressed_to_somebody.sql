-- 0210 — A report is addressed to somebody
--
-- Migration `0200` moved the `fees.billing` **check** off `fees.view` and onto
-- `fees.collect`, and wrote the rule down: *a critic is gated on the permission
-- held by somebody who may act on it*. That rule was applied to
-- `reference.checks` and never to `reference.reports`, which is the older and
-- larger of the two catalogues.
--
-- ## What the matrix actually offers a family
--
-- Measured on the demo college, by joining `reference.reports` to
-- `role_permissions` — 19 reports, and a student or a guardian can run **six**
-- of them:
--
--   attendance.student_leave  leave.view        their own requests
--   attendance.summary        attendance.view   their own child's totals
--   exams.results             exams.view        "worst first" over a cohort
--   fees.collection           fees.view         *every payment that crossed
--                                                the counter, with receipt*
--   fees.defaulters           fees.view         *students who owe, largest
--                                                first*
--   library.overdue           library.view      *books still out, with the
--                                                fine as it stands*
--
-- The first two are a family's own question. The other four are the school's,
-- offered to four hundred families because the permission that gates them is
-- the one a family holds in order to read their own bill, their own result and
-- the library catalogue.
--
-- ## It is not a leak, and that is what makes it quiet
--
-- Read from `pg_policies`: `ledger_entries`, `exam_results` and `book_issues`
-- all carry **row-ownership** policies for `parent` and `student`. Every report
-- here is `SECURITY INVOKER` (rule 11), so a guardian opening *"Fee
-- defaulters"* is answered with their own children and nobody else's.
--
-- That is the shape rule 4 already names twice — `substitution_gaps` answering
-- a teacher *"no cover needed today"*, `attendance_coverage` answering one
-- *"eleven classes at 0.0%"*. A permission error is loud. A **school-wide
-- question answered from a narrow seat** produces a plausible number:
--
-- > *"Fee defaulters: 1."* — and the one is your own child.
--
-- Demonstrated on the same read model with the seats swapped, as
-- `authenticated` with the claims set rather than in a bare `DO` block:
-- `report_fee_defaulters` returns **96 rows to an administrator and 0 to a
-- teacher**, because the teacher's `ledger_entries` policy matches nothing.
-- Same function, same college, same day.
--
-- One thing this migration does **not** claim to have measured: the
-- concessions case. `student_concessions` has no `teacher` policy at all — only
-- finance roles, and each family's own — so a teacher holding
-- `concessions.view` reads zero rows and the report says *"nobody in this
-- school has a discount"*. That follows from the policies, which were read;
-- the demo college has **0 concession awards**, so both seats return 0 and the
-- difference is not observable there. The gate moves on the strength of the
-- policy, and this comment says which half is evidence.
--
-- ## The fix, and the half that is not a fix
--
-- Five gates move to the permission somebody who may *act* holds. But a
-- permission is a per-college decision, editable from `/settings` — so today's
-- move is a default, not a guarantee, and the next college that grants
-- `library.view` to a role it invents is back where this started. Hence a
-- critic: `audience` says who a report is written for, and
-- `report_audience_problems()` says when the matrix disagrees with it.

begin;

-- ---------------------------------------------------------------------------
-- Who is this report written for?
-- ---------------------------------------------------------------------------

-- The default is `staff`, which is the conservative reading (rule 12): a report
-- nobody has thought about is not a family's. Marking one `family` is somebody
-- deciding, in a migration, that a guardian opening it gets a sentence about
-- their own child rather than a sample of the school.
alter table reference.reports
  add column if not exists audience text not null default 'staff';

alter table reference.reports
  drop constraint if exists reports_audience_check;
alter table reference.reports
  add constraint reports_audience_check check (audience in ('staff', 'family'));

comment on column reference.reports.audience is
  'Who this report is written for. `family` means a student or guardian '
  'opening it is answered about themselves and that answer is worth reading; '
  '`staff` means it asks a question about the school, so gating it on a '
  'permission a family holds shows them a one-row sample of it. The critic '
  'report_audience_problems() compares this against the tenant''s own matrix.';

-- ---------------------------------------------------------------------------
-- The two that genuinely belong to a family
-- ---------------------------------------------------------------------------

-- Their own leave requests, and their own child's attendance totals. Both are
-- row-scoped by policy AND are the question the person is asking, which is the
-- pair of conditions that makes a family-facing report honest rather than a
-- sample. `attendance.view` and `leave.view` stay exactly as they were.
update reference.reports set audience = 'family'
where key in ('attendance.summary', 'attendance.student_leave');

-- ---------------------------------------------------------------------------
-- The four that are the school's question, and one more found beside them
-- ---------------------------------------------------------------------------

-- The till. An accountant reconciling the day's cash acts on this; nobody else
-- does. Exactly `0200`'s move, one catalogue along.
update reference.reports set required_permission = 'fees.collect'
where key in ('fees.collection', 'fees.defaulters');

-- "Worst first" over a cohort is a teacher deciding who needs help. A family's
-- version of this report already exists and is better: it is the report card,
-- frozen with its own denominator (rule 12), at /report-card.
update reference.reports set required_permission = 'exams.grade'
where key = 'exams.results';

-- The chase list, with the fine as it stands. The librarian chases the book.
-- A teacher held this through `library.view` — the permission for browsing the
-- catalogue — and got the whole school's overdue list with it.
update reference.reports set required_permission = 'library.issue'
where key = 'library.overdue';

-- Not a family case: this one reached a *teacher*, who reads zero rows because
-- `student_concessions` has no teacher policy. An empty report is not a
-- refusal, and "no concessions in this school" is a sentence somebody could act
-- on wrongly.
update reference.reports set required_permission = 'concessions.manage'
where key = 'fees.concessions';

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------

-- Note on `roles.tier`, because this is the first thing in the schema to read
-- it: the tier is used here to name an **audience**, never to decide an
-- outcome. Nothing is refused, granted or filtered by it — the function
-- produces sentences. `tests/auth/tier-is-not-a-gate.test.ts` guards the
-- distinction that matters (a tier inside a policy, or compared to decide a
-- branch in a write function), and neither happens below.
--
-- SECURITY INVOKER, like every other critic: it reads this tenant's matrix
-- through RLS, so it cannot cross colleges.
create or replace function public.report_audience_problems()
returns table (severity text, message text)
language sql
stable
security invoker
set search_path = 'public', 'extensions'
as $$
  with family_roles as (
    -- The roles a college itself has marked as the family audience. Reading
    -- the tier rather than hardcoding ('student', 'parent') is the point: a
    -- college that renames `parent` to `guardian`, or adds `sibling`, keeps
    -- this working.
    select r.id, r.name
    from public.roles r
    where r.tenant_id = (select public.current_tenant_id())
      and r.tier = 'student'
  ),
  reachable_reports as (
    -- Aggregated per report rather than one finding per role: "Fee defaulters
    -- is open to Student and Parent" is one thing to fix, and two lines saying
    -- it is how a critic teaches people to skim.
    select rep.key,
           rep.name,
           rep.required_permission,
           string_agg(fr.name, ' and ' order by fr.name) as who
    from reference.reports rep
    join public.role_permissions rp
      on rp.permission_code = rep.required_permission
     and rp.allowed
     and rp.tenant_id = (select public.current_tenant_id())
    join family_roles fr on fr.id = rp.role_id
    where rep.audience = 'staff'
    group by rep.key, rep.name, rep.required_permission
  ),
  reachable_checks as (
    -- No check is ever a family's: `/checks` is a screen for somebody who can
    -- repair what it finds, and a college's own fee-head setup is not a
    -- guardian's problem. So this needs no column -- any reach at all is the
    -- finding.
    select c.key,
           c.label,
           c.required_permission,
           string_agg(fr.name, ' and ' order by fr.name) as who
    from reference.checks c
    join public.role_permissions rp
      on rp.permission_code = c.required_permission
     and rp.allowed
     and rp.tenant_id = (select public.current_tenant_id())
    join family_roles fr on fr.id = rp.role_id
    where c.is_active
    group by c.key, c.label, c.required_permission
  )
  select 'warning'::text,
         format(
           '%s asks a question about the college, and %s can run it because '
           'they hold %s. They are answered with their own rows, so it reads '
           'as a sample of the school rather than an answer about them.',
           r.name, r.who, r.required_permission)
  from reachable_reports r

  union all

  select 'warning'::text,
         format(
           '%s is a check for somebody who can repair what it finds, and %s '
           'can run it because they hold %s.',
           c.label, c.who, c.required_permission)
  from reachable_checks c

  order by 2
$$;

comment on function public.report_audience_problems() is
  'Reports and checks whose gate disagrees with who they are written for. '
  'Silent when every staff-audience report is gated on a permission no '
  'family-tier role holds -- which is the state 0210 leaves this college in.';

revoke all on function public.report_audience_problems() from public, anon;
grant execute on function public.report_audience_problems() to authenticated;

-- ---------------------------------------------------------------------------
-- ...surfaced where a critic is read
-- ---------------------------------------------------------------------------

-- Gated on `users.manage`, because the repair is an edit to the permission
-- matrix and that is who makes it. Rule 4's sentence: a critic is gated on the
-- permission held by somebody who may act on it, not on the one that lets you
-- see the problem.
insert into reference.checks (key, label, description, function_name, shape, module, href, required_permission, sort, is_active)
values (
  'reports.audience',
  'Reports addressed to the wrong people',
  'A report that asks a question about the school, gated on a permission a '
  'family holds, is answered with that family''s own rows -- so it reads as a '
  'sample of the college. Silent when every report''s gate matches who it is '
  'written for.',
  'report_audience_problems',
  'severity_message',
  'Settings',
  '/settings/permissions',
  'users.manage',
  95,
  true)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  function_name = excluded.function_name,
  shape = excluded.shape,
  module = excluded.module,
  href = excluded.href,
  required_permission = excluded.required_permission,
  sort = excluded.sort,
  is_active = excluded.is_active;

commit;
