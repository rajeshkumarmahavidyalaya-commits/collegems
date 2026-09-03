-- Phase 2.3, part four -- leave decisions, the daily register, and the
-- payroll register the screens read.
--
-- Split from 0059 only because that file had grown past the point where one
-- migration is one idea. Everything here depends on the engine above it.

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------

-- Days in a request. Half days only ever sit at the ends of a range, which is
-- what the two booleans encode -- and why this is arithmetic rather than a
-- per-day loop.
create or replace function public.hr_leave_days(
  p_starts_on date,
  p_ends_on date,
  p_half_start boolean default false,
  p_half_end boolean default false
)
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  select greatest(
    (p_ends_on - p_starts_on + 1)::numeric
      - case when p_half_start then 0.5 else 0 end
      - case when p_half_end then 0.5 else 0 end,
    0.5
  )
$$;

revoke all on function public.hr_leave_days(date, date, boolean, boolean) from public, anon;
grant execute on function public.hr_leave_days(date, date, boolean, boolean) to authenticated;

-- A balance is derived, never stored. The alternative is a second number free
-- to disagree with the requests that produced it, and when they disagree the
-- person arguing is standing in the office holding a payslip.
--
-- `p_staff_id` defaults, inside the function, to the caller's own record -- so
-- a teacher passes nothing and cannot point this at a colleague, and RLS on
-- `leave_requests` decides the rest.
create or replace function public.hr_leave_balance(
  p_staff_id uuid default null,
  p_session_id uuid default null
)
returns table (
  leave_type_id uuid,
  code text,
  name text,
  is_paid boolean,
  annual_quota_days numeric,
  taken_days numeric,
  pending_days numeric,
  remaining_days numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with target as (
    select
      coalesce(
        p_staff_id,
        ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
      ) as staff_id,
      coalesce(
        p_session_id,
        ( select s.id from public.academic_sessions s where s.is_current limit 1 )
      ) as session_id
  )
  select
    lt.id,
    lt.code,
    lt.name,
    lt.is_paid,
    lt.annual_quota_days,
    coalesce(sum(public.hr_leave_days(r.starts_on, r.ends_on, r.half_day_start, r.half_day_end))
      filter (where r.status = 'approved'), 0)::numeric,
    coalesce(sum(public.hr_leave_days(r.starts_on, r.ends_on, r.half_day_start, r.half_day_end))
      filter (where r.status = 'pending'), 0)::numeric,
    -- Null quota means "as much as is approved" -- maternity leave, unpaid
    -- leave -- which is a real policy and different from a quota of zero. It
    -- stays null here rather than becoming a misleading number.
    case
      when lt.annual_quota_days is null then null
      else lt.annual_quota_days
        - coalesce(sum(public.hr_leave_days(r.starts_on, r.ends_on, r.half_day_start, r.half_day_end))
            filter (where r.status = 'approved'), 0)
    end::numeric
  from public.leave_types lt
  cross join target t
  left join public.leave_requests r
    on r.leave_type_id = lt.id
   and r.staff_id = t.staff_id
   and r.session_id = t.session_id
  where lt.is_active
  group by lt.id, lt.code, lt.name, lt.is_paid, lt.annual_quota_days, lt.created_at
  order by lt.created_at
$$;

revoke all on function public.hr_leave_balance(uuid, uuid) from public, anon;
grant execute on function public.hr_leave_balance(uuid, uuid) to authenticated;

-- Approve or refuse, and write the register in the same transaction. Doing the
-- two separately is how a school ends up with approved leave that still shows
-- as absent on the payroll screen -- and it is the payroll screen that decides
-- what somebody is paid.
create or replace function public.hr_decide_leave(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_request public.leave_requests;
  v_marked integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_request from public.leave_requests r
  where r.id = p_request_id and r.tenant_id = v_tenant_id;

  if v_request.id is null then
    raise exception 'That leave request does not exist';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request was already %.', v_request.status;
  end if;

  update public.leave_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = p_note
  where id = p_request_id;

  if not p_approve then
    return 0;
  end if;

  -- Only working days are marked: nobody is on leave on a Sunday, and a
  -- register that says so would make the leave look longer than it was.
  insert into public.staff_attendance (
    tenant_id, session_id, staff_id, attendance_date, status, leave_request_id, marked_by
  )
  select
    v_tenant_id, v_request.session_id, v_request.staff_id, d.day::date,
    'on_leave', p_request_id, auth.uid()
  from generate_series(v_request.starts_on, v_request.ends_on, interval '1 day') as d(day)
  where public.hr_working_days(d.day::date, d.day::date) = 1
  on conflict (tenant_id, staff_id, attendance_date) do update
    set status = 'on_leave',
        leave_request_id = excluded.leave_request_id,
        marked_by = excluded.marked_by;

  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;

revoke all on function public.hr_decide_leave(uuid, boolean, text) from public, anon;
grant execute on function public.hr_decide_leave(uuid, boolean, text) to authenticated;

-- Withdrawing your own request.
--
-- SECURITY DEFINER, and this is the same shape as `homework_submit`: an
-- applicant may set `status` to 'cancelled' but must never set it to
-- 'approved', and both live on the same row. A column grant cannot separate
-- the two parties, because a grant is role-wide and both are `authenticated`.
-- So there is no staff UPDATE policy on `leave_requests` at all, and this
-- narrow function is the only way in.
create or replace function public.hr_cancel_leave(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_staff_id uuid;
  v_request public.leave_requests;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select up.staff_id into v_staff_id
  from public.user_profiles up where up.id = auth.uid();

  if v_staff_id is null then
    raise exception 'Only a member of staff can withdraw a leave request';
  end if;

  select * into v_request from public.leave_requests r
  where r.id = p_request_id and r.tenant_id = v_tenant_id;

  if v_request.id is null or v_request.staff_id <> v_staff_id then
    raise exception 'That leave request is not yours';
  end if;
  if v_request.status = 'approved' and v_request.starts_on <= current_date then
    raise exception 'This leave has already started. Ask the office to amend it.';
  end if;
  if v_request.status in ('rejected', 'cancelled') then
    raise exception 'This request was already %.', v_request.status;
  end if;

  update public.leave_requests set status = 'cancelled' where id = p_request_id;

  -- Take the register back with it, so a withdrawn day does not sit there as
  -- leave nobody took.
  delete from public.staff_attendance
  where leave_request_id = p_request_id and attendance_date >= current_date;
end;
$$;

revoke all on function public.hr_cancel_leave(uuid) from public, anon;
grant execute on function public.hr_cancel_leave(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The daily register
-- ---------------------------------------------------------------------------

-- Everybody employed, with what is already recorded for the day. A person with
-- no row yet comes back with a null status -- "not marked" is a different fact
-- from "present", and collapsing the two is how a register silently fills
-- itself in.
create or replace function public.hr_attendance_sheet(p_date date)
returns table (
  staff_id uuid,
  employee_code text,
  staff_name text,
  designation text,
  department text,
  status text,
  leave_type_name text,
  check_in time,
  check_out time,
  note text,
  is_working_day boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id,
    s.employee_code,
    (p.first_name || ' ' || p.last_name)::text,
    s.designation,
    s.department,
    sa.status,
    lt.name,
    sa.check_in,
    sa.check_out,
    sa.note,
    public.hr_working_days(p_date, p_date) = 1
  from public.staff s
  join public.people p on p.id = s.person_id
  left join public.staff_attendance sa
    on sa.staff_id = s.id and sa.attendance_date = p_date
  left join public.leave_requests lr on lr.id = sa.leave_request_id
  left join public.leave_types lt on lt.id = lr.leave_type_id
  where s.status = 'active' and s.date_of_joining <= p_date
  order by s.employee_code
$$;

revoke all on function public.hr_attendance_sheet(date) from public, anon;
grant execute on function public.hr_attendance_sheet(date) to authenticated;

-- Bulk marking, one transaction. supabase-js cannot open one, so a register of
-- forty people submitted as forty calls can interleave with somebody else's
-- and leave the day half-marked.
create or replace function public.hr_mark_attendance(p_date date, p_entries jsonb)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_entry jsonb;
  v_written integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'This school has no current academic session';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    -- An entry with no status clears the row: "I marked the wrong person" has
    -- to be expressible, and deleting is the only way to get back to
    -- "not marked" from "present".
    if (v_entry ->> 'status') is null then
      delete from public.staff_attendance
      where tenant_id = v_tenant_id
        and staff_id = (v_entry ->> 'staff_id')::uuid
        and attendance_date = p_date
        -- Never delete a row the leave system owns: that would silently
        -- un-approve somebody's leave from the attendance screen.
        and leave_request_id is null;
      continue;
    end if;

    insert into public.staff_attendance (
      tenant_id, session_id, staff_id, attendance_date, status, check_in, check_out, note, marked_by
    )
    values (
      v_tenant_id, v_session_id,
      (v_entry ->> 'staff_id')::uuid,
      p_date,
      v_entry ->> 'status',
      (v_entry ->> 'check_in')::time,
      (v_entry ->> 'check_out')::time,
      v_entry ->> 'note',
      auth.uid()
    )
    on conflict (tenant_id, staff_id, attendance_date) do update
      set status = excluded.status,
          check_in = excluded.check_in,
          check_out = excluded.check_out,
          note = excluded.note,
          marked_by = excluded.marked_by,
          -- Marking somebody present who was on leave detaches the request,
          -- which is correct: the register is the record of what happened.
          leave_request_id = case
            when excluded.status = 'on_leave' then staff_attendance.leave_request_id
            else null
          end;

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

revoke all on function public.hr_mark_attendance(date, jsonb) from public, anon;
grant execute on function public.hr_mark_attendance(date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The payroll register
-- ---------------------------------------------------------------------------

create or replace function public.payroll_register(p_run_id uuid)
returns table (
  payslip_id uuid,
  staff_id uuid,
  employee_code text,
  staff_name text,
  designation text,
  structure_name text,
  working_days numeric,
  paid_days numeric,
  lop_days numeric,
  gross_earnings numeric,
  total_deductions numeric,
  net_pay numeric,
  is_override boolean,
  note text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    ps.id,
    ps.staff_id,
    s.employee_code,
    (p.first_name || ' ' || p.last_name)::text,
    s.designation,
    st.name,
    ps.working_days,
    ps.paid_days,
    ps.lop_days,
    ps.gross_earnings,
    ps.total_deductions,
    ps.net_pay,
    ps.is_override,
    ps.note
  from public.payslips ps
  join public.staff s on s.id = ps.staff_id
  join public.people p on p.id = s.person_id
  join public.payroll_runs r on r.id = ps.run_id
  left join public.staff_salary_assignments a
    on a.staff_id = ps.staff_id
   and a.effective_from <= (r.period_month + interval '1 month - 1 day')::date
   and (a.effective_to is null or a.effective_to >= r.period_month)
  left join public.salary_structures st on st.id = a.structure_id
  where ps.run_id = p_run_id
  order by s.employee_code
$$;

revoke all on function public.payroll_register(uuid) from public, anon;
grant execute on function public.payroll_register(uuid) to authenticated;
