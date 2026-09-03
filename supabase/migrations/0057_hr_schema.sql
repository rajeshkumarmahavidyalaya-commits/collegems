-- Phase 2.3, part one -- staff attendance and leave.
--
-- The module payroll stands on. Two things are worth stating before the tables,
-- because both are decisions rather than defaults.
--
-- WHY STAFF ATTENDANCE IS NOT KEYED THE WAY STUDENT ATTENDANCE IS
--
-- `attendance_records` keys on `enrolments`, because a student's attendance
-- belongs to their place in a section for a given year. Staff have no
-- equivalent: employment is continuous, and a teacher who changes department in
-- March is the same employee on both sides of it. So this keys on `staff`
-- directly, and carries `session_id` per rule 2 so a year's register is one
-- indexed range rather than a join.
--
-- WHY A LEAVE BALANCE IS NOT A COLUMN
--
-- It is derived, always, from the approved requests -- exactly the reasoning
-- that keeps a running library fine out of the database. A stored balance is a
-- second number free to disagree with the requests that produced it, and when
-- they disagree the person arguing is standing in the office holding a payslip.

-- ---------------------------------------------------------------------------
-- The school calendar, finally answerable
-- ---------------------------------------------------------------------------

-- `weekends` and `holidays` have existed since the academic structure landed
-- and nothing has ever asked them a question. Payroll has to: "how many working
-- days were there in March" is the denominator of every loss-of-pay
-- calculation, and counting calendar days instead is how a school ends up
-- docking somebody for a Sunday.
--
-- SECURITY INVOKER, so a caller only counts holidays their own tenant can see.
create or replace function public.hr_working_days(p_from date, p_to date)
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') as d(day)
  where not exists (
    select 1 from public.weekends w
    where w.weekday = extract(isodow from d.day)::integer
      and not w.is_teaching
  )
  and not exists (
    select 1 from public.holidays h
    where d.day::date between h.starts_on and h.ends_on
  )
$$;

revoke all on function public.hr_working_days(date, date) from public, anon;
grant execute on function public.hr_working_days(date, date) to authenticated;

comment on function public.hr_working_days(date, date) is
  'School working days in a closed date range, per the tenant''s weekend and holiday configuration. Invoker, so RLS decides which holidays count.';

-- ---------------------------------------------------------------------------
-- Leave types
-- ---------------------------------------------------------------------------

-- Tenant configuration, not a hardcoded enum: "casual, sick, earned" is one
-- school's list. Another has half-pay leave, or maternity leave with a
-- different quota, or no quotas at all.
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  -- Null means "as much as is approved" -- a real policy for maternity or
  -- unpaid leave, and different from a quota of zero.
  annual_quota_days numeric(5, 1) check (annual_quota_days is null or annual_quota_days >= 0),
  -- The column payroll actually reads. Unpaid leave is the only kind that
  -- reaches a payslip, and it reaches it as loss of pay.
  is_paid boolean not null default true,
  allows_half_day boolean not null default true,
  requires_approval boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, code),
  constraint leave_types_code_chk check (code ~ '^[A-Z0-9_]{2,12}$')
);

alter table public.leave_types add constraint leave_types_tenant_id_key unique (tenant_id, id);

create index leave_types_tenant_idx on public.leave_types (tenant_id);

create trigger set_updated_at before update on public.leave_types
  for each row execute function public.set_updated_at();
create trigger audit_leave_types
  after insert or update or delete on public.leave_types
  for each row execute function public.audit_row_change();

alter table public.leave_types enable row level security;

create policy "admins manage leave_types" on public.leave_types
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- Everybody employed here reads the list: you cannot apply for a kind of leave
-- you cannot see the name of.
create policy "tenant members view leave_types" on public.leave_types
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

-- ---------------------------------------------------------------------------
-- Leave requests
-- ---------------------------------------------------------------------------

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  staff_id uuid not null,
  leave_type_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  -- Half days are only ever at the ends of a range: nobody takes the afternoon
  -- off in the middle of a week of leave. Two booleans express that exactly,
  -- and a fractional day count cannot.
  half_day_start boolean not null default false,
  half_day_end boolean not null default false,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leave_requests_range_chk check (ends_on >= starts_on),
  -- A one-day request cannot be half at both ends; that is a whole day off with
  -- extra steps, and allowing it would make the day count zero.
  constraint leave_requests_half_day_chk check (
    starts_on < ends_on or not (half_day_start and half_day_end)
  ),
  constraint leave_requests_decided_chk check (
    (status in ('approved', 'rejected')) = (decided_at is not null)
  ),

  constraint leave_requests_staff_fkey
    foreign key (tenant_id, staff_id)
    references public.staff (tenant_id, id) on delete cascade,
  constraint leave_requests_type_fkey
    foreign key (tenant_id, leave_type_id)
    references public.leave_types (tenant_id, id) on delete restrict
);

alter table public.leave_requests
  add constraint leave_requests_tenant_id_key unique (tenant_id, id);

create index leave_requests_tenant_idx on public.leave_requests (tenant_id);
create index leave_requests_staff_idx
  on public.leave_requests (tenant_id, staff_id, starts_on desc);
create index leave_requests_session_idx on public.leave_requests (session_id);
create index leave_requests_pending_idx
  on public.leave_requests (tenant_id, starts_on)
  where status = 'pending';

-- One approved leave per person per day. A partial exclusion constraint rather
-- than a check, because the rule is about two rows and no CHECK can see a
-- second row. Rejected and cancelled requests are excluded, so re-applying
-- after a refusal is not blocked by the refusal.
create extension if not exists btree_gist;
alter table public.leave_requests
  add constraint leave_requests_no_overlap
  exclude using gist (
    tenant_id with =,
    staff_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('pending', 'approved'));

create trigger set_updated_at before update on public.leave_requests
  for each row execute function public.set_updated_at();
create trigger audit_leave_requests
  after insert or update or delete on public.leave_requests
  for each row execute function public.audit_row_change();

alter table public.leave_requests enable row level security;

create policy "admins manage leave_requests" on public.leave_requests
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- A member of staff reads their own leave, whatever their role. This is the
-- first policy in the codebase keyed on `user_profiles.staff_id` for the
-- *subject* of the row rather than for a class they teach.
create policy "staff view own leave_requests" on public.leave_requests
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

-- ...and may raise one, but only for themselves and only as `pending`. There is
-- deliberately no staff UPDATE policy: approving your own leave is the whole
-- risk, and the columns that carry a decision (`status`, `decided_by`,
-- `decided_at`) sit on the same row as the ones an applicant may edit. A column
-- grant cannot separate those two parties -- it is role-wide, and both are
-- `authenticated` -- so withdrawal goes through `hr_cancel_leave` instead.
create policy "staff raise own leave_requests" on public.leave_requests
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and status = 'pending'
    and decided_at is null
    and staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

-- ---------------------------------------------------------------------------
-- Staff attendance
-- ---------------------------------------------------------------------------

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  staff_id uuid not null,
  attendance_date date not null,
  -- `on_duty` is not a synonym for `present`: a teacher at a district sports
  -- meet is out of the building and fully paid, and a register that cannot say
  -- so gets them marked absent by whoever is covering the front desk.
  status text not null check (status in ('present', 'absent', 'half_day', 'on_leave', 'on_duty')),
  -- Set when the day was covered by an approved request, so the register and
  -- the leave ledger cannot drift into disagreeing about the same day.
  leave_request_id uuid,
  check_in time,
  check_out time,
  note text,
  marked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_attendance_times_chk check (
    check_in is null or check_out is null or check_out > check_in
  ),
  -- Only a leave day may name a leave request. The reverse is not required: a
  -- leave day marked before the request was filed is a real Monday morning.
  constraint staff_attendance_leave_chk check (
    leave_request_id is null or status = 'on_leave'
  ),

  constraint staff_attendance_staff_fkey
    foreign key (tenant_id, staff_id)
    references public.staff (tenant_id, id) on delete cascade,
  constraint staff_attendance_leave_fkey
    foreign key (tenant_id, leave_request_id)
    references public.leave_requests (tenant_id, id) on delete set null (leave_request_id)
);

-- One record per person per day, which is what makes marking idempotent: a
-- re-submitted register upserts onto the same row instead of double-marking.
create unique index staff_attendance_unique_mark
  on public.staff_attendance (tenant_id, staff_id, attendance_date);

create index staff_attendance_tenant_idx on public.staff_attendance (tenant_id);
create index staff_attendance_date_idx
  on public.staff_attendance (tenant_id, session_id, attendance_date);
create index staff_attendance_session_idx on public.staff_attendance (session_id);
-- The index payroll runs on: everything that is not a plain working day.
create index staff_attendance_exceptions_idx
  on public.staff_attendance (tenant_id, staff_id, attendance_date)
  where status in ('absent', 'half_day', 'on_leave');

create trigger set_updated_at before update on public.staff_attendance
  for each row execute function public.set_updated_at();
create trigger audit_staff_attendance
  after insert or update or delete on public.staff_attendance
  for each row execute function public.audit_row_change();

alter table public.staff_attendance enable row level security;

create policy "admins manage staff_attendance" on public.staff_attendance
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- An accountant reads the register because they run payroll from it, and
-- cannot write it, because the person who decides who was absent must not be
-- the person who decides what that costs them.
create policy "accountants view staff_attendance" on public.staff_attendance
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'accountant'
  );

create policy "staff view own staff_attendance" on public.staff_attendance
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );
