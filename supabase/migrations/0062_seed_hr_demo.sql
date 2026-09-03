-- Phase 2.3, part six -- demo data.
--
-- Seeded inside the current session (2025-26), because that is where every
-- other module's demo data lives and a payroll screen showing an empty January
-- teaches nothing. Deterministic: the absences are a modulo of the employee
-- code and the day, not `random()`, so the numbers a test pins stay pinned.

do $$
declare
  v_tenant_id uuid;
  v_session_id uuid;
  v_teaching uuid;
  v_support uuid;
  v_cl uuid;
  v_sl uuid;
  v_lwp uuid;
begin
  select id into v_tenant_id from public.tenants where name = 'Rajesh Kumar Mahavidyalaya';
  if v_tenant_id is null then return; end if;

  select id into v_session_id from public.academic_sessions
  where tenant_id = v_tenant_id and is_current;

  -- ---- Leave types --------------------------------------------------------
  insert into public.leave_types (tenant_id, code, name, annual_quota_days, is_paid, allows_half_day)
  values
    (v_tenant_id, 'CL', 'Casual leave', 12, true, true),
    (v_tenant_id, 'SL', 'Sick leave', 10, true, true),
    (v_tenant_id, 'EL', 'Earned leave', 15, true, false),
    -- A null quota is "as much as is approved", which is a real policy and
    -- different from a quota of zero. This is also the only type that reaches
    -- a payslip, because it is the only unpaid one.
    (v_tenant_id, 'LWP', 'Leave without pay', null, false, true)
  on conflict (tenant_id, code) do nothing;

  select id into v_cl from public.leave_types where tenant_id = v_tenant_id and code = 'CL';
  select id into v_sl from public.leave_types where tenant_id = v_tenant_id and code = 'SL';
  select id into v_lwp from public.leave_types where tenant_id = v_tenant_id and code = 'LWP';

  -- ---- Salary structures --------------------------------------------------
  insert into public.salary_structures (tenant_id, name, description, components)
  values (
    v_tenant_id,
    'Teaching staff',
    'Basic with DA and HRA as percentages of it, provident fund capped at the statutory ceiling, and unpaid days docked pro rata.',
    jsonb_build_object(
      'components', jsonb_build_array(
        jsonb_build_object('code','BASIC','name','Basic pay','kind','earning','calc','fixed','amount',25000),
        jsonb_build_object('code','DA','name','Dearness allowance','kind','earning','calc','percent_of','of','BASIC','percent',12),
        jsonb_build_object('code','HRA','name','House rent allowance','kind','earning','calc','percent_of','of','BASIC','percent',40),
        jsonb_build_object('code','CONV','name','Conveyance','kind','earning','calc','fixed','amount',1600),
        jsonb_build_object('code','PF','name','Provident fund','kind','deduction','calc','percent_of','of','BASIC','percent',12,'cap',1800),
        jsonb_build_object('code','PT','name','Professional tax','kind','deduction','calc','fixed','amount',200)
      ),
      'lop', jsonb_build_object('basis','working_days','half_day_counts',0.5),
      'rounding', 'nearest_rupee'
    )
  )
  on conflict (tenant_id, name) do nothing;

  -- Deliberately has NO `lop` block, and the description says why. It is here
  -- so the demo shows the conservative default doing its job: a monthly-rated
  -- employee is not docked for a day off, and the absence of a key is what
  -- says so.
  insert into public.salary_structures (tenant_id, name, description, components)
  values (
    v_tenant_id,
    'Support staff (monthly rated)',
    'A flat monthly salary. No loss-of-pay block, so an absence does not reduce the payslip -- which is the point: this is a monthly rate, not a daily one.',
    jsonb_build_object(
      'components', jsonb_build_array(
        jsonb_build_object('code','BASIC','name','Basic pay','kind','earning','calc','fixed','amount',22000),
        jsonb_build_object('code','DA','name','Dearness allowance','kind','earning','calc','percent_of','of','BASIC','percent',10),
        jsonb_build_object('code','PT','name','Professional tax','kind','deduction','calc','fixed','amount',200)
      ),
      'rounding', 'nearest_rupee'
    )
  )
  on conflict (tenant_id, name) do nothing;

  select id into v_teaching from public.salary_structures
  where tenant_id = v_tenant_id and name = 'Teaching staff';
  select id into v_support from public.salary_structures
  where tenant_id = v_tenant_id and name = 'Support staff (monthly rated)';

  -- ---- Who is on what -----------------------------------------------------
  -- The structure is the shape; the assignment is the money. Seven designations
  -- on two structures, with the basic overridden per person.
  insert into public.staff_salary_assignments (
    tenant_id, staff_id, structure_id, overrides, effective_from
  )
  select
    v_tenant_id,
    s.id,
    case when s.designation in ('Accountant', 'Librarian') then v_support else v_teaching end,
    jsonb_build_object('BASIC', case s.designation
      when 'Principal / System Administrator' then 75000
      when 'PGT' then 42000
      when 'TGT' then 34000
      when 'Subject Teacher' then 30000
      when 'Primary Teacher' then 26000
      when 'Accountant' then 28000
      when 'Librarian' then 24000
      else 25000
    end),
    greatest(s.date_of_joining, date '2025-04-01')
  from public.staff s
  where s.tenant_id = v_tenant_id and s.status = 'active'
  on conflict do nothing;

  -- ---- Leave requests -----------------------------------------------------
  insert into public.leave_requests (
    tenant_id, session_id, staff_id, leave_type_id, starts_on, ends_on,
    reason, status, decided_at, decision_note
  )
  select v_tenant_id, v_session_id, s.id, v_cl, date '2026-01-08', date '2026-01-09',
         'Family function', 'approved', timestamptz '2026-01-05 10:00+05:30', 'Approved.'
  from public.staff s where s.tenant_id = v_tenant_id and s.employee_code = 'EMP-004';

  insert into public.leave_requests (
    tenant_id, session_id, staff_id, leave_type_id, starts_on, ends_on,
    reason, status, decided_at, decision_note
  )
  select v_tenant_id, v_session_id, s.id, v_sl, date '2026-02-10', date '2026-02-12',
         'Viral fever', 'approved', timestamptz '2026-02-10 08:15+05:30', 'Get well soon.'
  from public.staff s where s.tenant_id = v_tenant_id and s.employee_code = 'EMP-007';

  -- The one that costs money. Everything else here is paid leave, and a demo in
  -- which no payslip is ever reduced would not show the engine working.
  insert into public.leave_requests (
    tenant_id, session_id, staff_id, leave_type_id, starts_on, ends_on,
    reason, status, decided_at, decision_note
  )
  select v_tenant_id, v_session_id, s.id, v_lwp, date '2026-02-16', date '2026-02-18',
         'Personal work out of station', 'approved', timestamptz '2026-02-13 16:00+05:30',
         'Approved as leave without pay -- casual leave for the year is exhausted.'
  from public.staff s where s.tenant_id = v_tenant_id and s.employee_code = 'EMP-011';

  insert into public.leave_requests (
    tenant_id, session_id, staff_id, leave_type_id, starts_on, ends_on,
    half_day_start, reason, status
  )
  select v_tenant_id, v_session_id, s.id, v_cl, date '2026-03-16', date '2026-03-16',
         true, 'Bank work', 'pending'
  from public.staff s where s.tenant_id = v_tenant_id and s.employee_code = 'EMP-009';

  -- ---- The register -------------------------------------------------------
  -- January and February 2026, working days only. Deterministic: the last digit
  -- of the employee code and the day of the month decide the exceptions, so the
  -- totals a test asserts do not move between seeds.
  insert into public.staff_attendance (
    tenant_id, session_id, staff_id, attendance_date, status
  )
  select
    v_tenant_id, v_session_id, s.id, d.day::date,
    case
      when (right(s.employee_code, 2)::integer + extract(day from d.day)::integer) % 37 = 0
        then 'absent'
      when (right(s.employee_code, 2)::integer + extract(day from d.day)::integer) % 29 = 0
        then 'half_day'
      when (right(s.employee_code, 2)::integer + extract(day from d.day)::integer) % 31 = 0
        then 'on_duty'
      else 'present'
    end
  from public.staff s
  cross join generate_series(date '2026-01-01', date '2026-02-28', interval '1 day') as d(day)
  where s.tenant_id = v_tenant_id
    and s.status = 'active'
    and public.hr_working_days(d.day::date, d.day::date) = 1
  on conflict (tenant_id, staff_id, attendance_date) do nothing;

  -- Approved leave overwrites whatever the pattern put there, and carries the
  -- request id -- which is what stops the register and the leave ledger
  -- disagreeing about the same day.
  update public.staff_attendance sa
  set status = 'on_leave', leave_request_id = r.id
  from public.leave_requests r
  where r.tenant_id = v_tenant_id
    and r.status = 'approved'
    and sa.tenant_id = v_tenant_id
    and sa.staff_id = r.staff_id
    and sa.attendance_date between r.starts_on and r.ends_on;
end;
$$;
