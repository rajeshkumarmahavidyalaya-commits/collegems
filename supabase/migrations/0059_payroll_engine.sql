-- Phase 2.3, part three -- the engine.
--
-- THE EVALUATION ORDER IS THE CONTRACT
--
-- Rule 12 says to write it down and pin each step to an exact number in a test,
-- because schools argue about the order and a comment does not survive a
-- refactor. For a salary it is:
--
--   1. Resolve earnings, in array order. `fixed` takes its amount; `percent_of`
--      multiplies the already-resolved amount of a code defined EARLIER.
--   2. Prorate earnings for loss of pay: each earning x (paid_days /
--      working_days). Only if the document configures `lop` at all.
--   3. Resolve deductions, in array order, against the PRORATED earnings --
--      provident fund is a percentage of the basic actually paid, not of the
--      basic on paper. Caps apply here.
--   4. Net = prorated gross - deductions.
--   5. Round, last, once.
--
-- Step 3 following step 2 is the step schools disagree about, and it is the one
-- most easily got wrong by computing everything in one pass.
--
-- A MISSING KEY MEANS THE CONSERVATIVE READING
--
-- No `lop` block means no proration, ever. That is the conservative default in
-- the direction that matters: a school that wants to dock unpaid leave will
-- configure it, whereas a school that starts docking people by accident finds
-- out from somebody's bank balance. Same instinct as `replaces_absent`
-- defaulting to false in the grading engine.
--
-- Likewise: no `cap` means uncapped, no `rounding` means exact paise, and a
-- working day with no register entry counts as PRESENT -- never dock somebody
-- because nobody filled in the register.

-- ---------------------------------------------------------------------------
-- Two small repairs to what part one left, and one formatting helper
-- ---------------------------------------------------------------------------

-- `22.0 days` reads wrong on a payslip and `to_char(..., 'FM999990.9')` leaves a
-- trailing dot, while `rtrim(x::text, '0')` turns 20 into 2. Neither is
-- obviously broken until somebody's payslip says they worked 2 days.
create or replace function public.hr_format_days(p_days numeric)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_days is null then '0'
    when p_days = trunc(p_days) then trunc(p_days)::bigint::text
    else to_char(p_days, 'FM999990.0')
  end
$$;

revoke all on function public.hr_format_days(numeric) from public, anon;
grant execute on function public.hr_format_days(numeric) to authenticated;

-- An accountant runs payroll, and `payroll_lop_days` has to know whether a
-- leave day was paid -- which means reading `leave_requests`. Migration 0057
-- gave them `staff_attendance` but not the requests behind it, so the join
-- would have come back empty and every unpaid day would have quietly been
-- treated as paid. A silently generous payroll is still a wrong payroll.
--
-- This belongs in 0057 and is here because 0057 is applied and applied
-- migrations are immutable.
create policy "accountants view leave_requests" on public.leave_requests
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'accountant'
  );

-- ---------------------------------------------------------------------------
-- Criticising the document
-- ---------------------------------------------------------------------------

-- Sentences, not booleans, and in Postgres rather than the browser -- so the
-- thing that judges a structure and the thing that evaluates it cannot drift.
-- Deliberately not a check constraint: a half-finished structure must be
-- savable, exactly like a half-finished grading scheme.
create or replace function public.salary_structure_problems(p_components jsonb)
returns setof text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_list jsonb := coalesce(p_components -> 'components', '[]'::jsonb);
  v_item jsonb;
  v_code text;
  v_seen text[] := array[]::text[];
  v_earnings integer := 0;
  v_index integer := 0;
  v_of text;
  v_lop jsonb := p_components -> 'lop';
begin
  if jsonb_typeof(v_list) <> 'array' then
    return next 'The document has no `components` array, so nothing can be paid.';
    return;
  end if;

  if jsonb_array_length(v_list) = 0 then
    return next 'This structure has no components, so every payslip on it is zero.';
    return;
  end if;

  for v_item in select * from jsonb_array_elements(v_list) loop
    v_index := v_index + 1;
    v_code := v_item ->> 'code';

    if v_code is null or v_code = '' then
      return next format('Component %s has no code, so nothing can refer to it.', v_index);
      continue;
    end if;

    if v_code = any (v_seen) then
      return next format('Two components share the code %s. Only the first will be paid.', v_code);
    end if;

    if coalesce(v_item ->> 'name', '') = '' then
      return next format('%s has no name, so its payslip line would be unlabelled.', v_code);
    end if;

    if (v_item ->> 'kind') is null or (v_item ->> 'kind') not in ('earning', 'deduction') then
      return next format(
        '%s is neither an earning nor a deduction, so it will be ignored.', v_code);
    elsif (v_item ->> 'kind') = 'earning' then
      v_earnings := v_earnings + 1;
    end if;

    case coalesce(v_item ->> 'calc', 'fixed')
      when 'fixed' then
        if (v_item -> 'amount') is null then
          return next format('%s is a fixed amount but does not say how much.', v_code);
        elsif jsonb_typeof(v_item -> 'amount') <> 'number' then
          return next format('%s has an amount that is not a number.', v_code);
        elsif (v_item ->> 'amount')::numeric < 0 then
          return next format('%s is a negative amount. Use a deduction instead.', v_code);
        end if;
      when 'percent_of' then
        v_of := v_item ->> 'of';
        if v_of is null then
          return next format('%s is a percentage but does not say of what.', v_code);
        elsif not (v_of = any (v_seen)) then
          -- Forward references resolve to zero rather than raising: order in
          -- the array IS the evaluation order, and saying so is more useful
          -- than refusing to save.
          return next format(
            '%s is a percentage of %s, which is not defined above it. It will be treated as zero.',
            v_code, v_of);
        end if;
        if (v_item -> 'percent') is null then
          return next format('%s is a percentage but does not say what percentage.', v_code);
        elsif jsonb_typeof(v_item -> 'percent') <> 'number' then
          return next format('%s has a percentage that is not a number.', v_code);
        elsif (v_item ->> 'percent')::numeric > 100 and (v_item ->> 'kind') = 'deduction' then
          return next format(
            '%s deducts %s%% of %s, which is more than the thing it is a share of.',
            v_code, v_item ->> 'percent', v_of);
        end if;
      else
        return next format(
          '%s uses an unknown calculation "%s". Use "fixed" or "percent_of".',
          v_code, v_item ->> 'calc');
    end case;

    v_seen := v_seen || v_code;
  end loop;

  if v_earnings = 0 then
    return next 'This structure has no earnings, so every payslip on it nets to zero or less.';
  end if;

  if v_lop is not null and coalesce(v_lop ->> 'basis', 'working_days')
     not in ('working_days', 'calendar_days') then
    return next format(
      'Loss of pay is measured in "%s", which this system does not know. Use "working_days" or "calendar_days".',
      v_lop ->> 'basis');
  end if;

  return;
end;
$$;

revoke all on function public.salary_structure_problems(jsonb) from public, anon;
grant execute on function public.salary_structure_problems(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The engine
-- ---------------------------------------------------------------------------

-- Pure: no tables, no clock, no tenant. Everything it needs is an argument,
-- which is what lets a test pin the evaluation order to exact numbers without
-- staging a month of attendance first.
create or replace function public.payroll_evaluate(
  p_components jsonb,
  p_overrides jsonb,
  p_working_days numeric,
  p_lop_days numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_list jsonb := coalesce(p_components -> 'components', '[]'::jsonb);
  v_overrides jsonb := coalesce(p_overrides, '{}'::jsonb);
  v_lop jsonb := p_components -> 'lop';
  v_rounding text := p_components ->> 'rounding';

  v_item jsonb;
  v_code text;
  v_kind text;
  v_calc text;
  v_amount numeric;
  v_of text;
  v_basis text;

  -- Resolved amounts by code, in evaluation order. A jsonb object rather than
  -- an array so a `percent_of` lookup is a key access.
  v_resolved jsonb := '{}'::jsonb;
  v_lines jsonb := '[]'::jsonb;

  v_paid_days numeric;
  v_factor numeric := 1;
  v_gross numeric := 0;
  v_deductions numeric := 0;
  v_sort integer := 0;
begin
  p_working_days := coalesce(p_working_days, 0);
  p_lop_days := least(greatest(coalesce(p_lop_days, 0), 0), p_working_days);
  v_paid_days := p_working_days - p_lop_days;

  -- Step 2's factor, decided up front so both passes see the same number.
  -- No `lop` block at all means no proration: never dock silently.
  if v_lop is not null and p_working_days > 0 then
    v_factor := round(v_paid_days / p_working_days, 6);
  end if;

  -- ---- Step 1 and 2: earnings, resolved in array order then prorated -------
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_code := v_item ->> 'code';
    v_kind := v_item ->> 'kind';
    if v_code is null or v_kind <> 'earning' then continue; end if;
    if v_resolved ? v_code then continue; end if;  -- first definition wins

    v_calc := coalesce(v_item ->> 'calc', 'fixed');

    if v_calc = 'percent_of' then
      v_of := v_item ->> 'of';
      -- A forward or unknown reference is zero, not an error. The structure is
      -- criticised by `salary_structure_problems`; refusing to compute here
      -- would mean a half-finished structure could not even be previewed.
      v_amount := round(
        coalesce((v_resolved ->> v_of)::numeric, 0)
          * coalesce((v_item ->> 'percent')::numeric, 0) / 100, 2);
      v_basis := format('%s%% of %s', v_item ->> 'percent', coalesce(v_of, '?'));
    else
      -- The assignment's override wins over the structure's own amount: the
      -- structure is the shape, the assignment is the money.
      v_amount := coalesce(
        (v_overrides ->> v_code)::numeric,
        (v_item ->> 'amount')::numeric,
        0);
      v_basis := 'Fixed';
    end if;

    v_resolved := v_resolved || jsonb_build_object(v_code, v_amount);

    if v_factor < 1 then
      v_amount := round(v_amount * v_factor, 2);
      v_basis := format('%s, prorated for %s of %s days',
        v_basis, public.hr_format_days(v_paid_days), public.hr_format_days(p_working_days));
      -- The prorated figure is what later percentages see.
      v_resolved := v_resolved || jsonb_build_object(v_code, v_amount);
    end if;

    v_sort := v_sort + 1;
    v_gross := v_gross + v_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'name', coalesce(v_item ->> 'name', v_code),
      'kind', 'earning',
      'amount', v_amount,
      'basis', v_basis,
      'sort_order', v_sort
    ));
  end loop;

  -- ---- Step 3: deductions, against the prorated earnings -------------------
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_code := v_item ->> 'code';
    v_kind := v_item ->> 'kind';
    if v_code is null or v_kind <> 'deduction' then continue; end if;
    if v_resolved ? v_code then continue; end if;

    v_calc := coalesce(v_item ->> 'calc', 'fixed');

    if v_calc = 'percent_of' then
      v_of := v_item ->> 'of';
      v_amount := round(
        coalesce((v_resolved ->> v_of)::numeric, 0)
          * coalesce((v_item ->> 'percent')::numeric, 0) / 100, 2);
      v_basis := format('%s%% of %s', v_item ->> 'percent', coalesce(v_of, '?'));
    else
      v_amount := coalesce(
        (v_overrides ->> v_code)::numeric,
        (v_item ->> 'amount')::numeric,
        0);
      v_basis := 'Fixed';
    end if;

    -- A cap is a statutory ceiling (provident fund on the first 15,000 of
    -- basic, say). Absent means uncapped.
    if (v_item -> 'cap') is not null and v_amount > (v_item ->> 'cap')::numeric then
      v_amount := (v_item ->> 'cap')::numeric;
      v_basis := format('%s, capped at %s', v_basis, v_item ->> 'cap');
    end if;

    v_amount := greatest(v_amount, 0);
    v_resolved := v_resolved || jsonb_build_object(v_code, v_amount);

    v_sort := v_sort + 1;
    v_deductions := v_deductions + v_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'name', coalesce(v_item ->> 'name', v_code),
      'kind', 'deduction',
      'amount', v_amount,
      'basis', v_basis,
      'sort_order', v_sort
    ));
  end loop;

  -- ---- Step 5: rounding, last and once ------------------------------------
  if v_rounding = 'nearest_rupee' then
    v_gross := round(v_gross, 0);
    v_deductions := round(v_deductions, 0);
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'working_days', p_working_days,
    'paid_days', v_paid_days,
    'lop_days', p_lop_days,
    'gross_earnings', v_gross,
    'total_deductions', v_deductions,
    -- Net is allowed to be negative. A month with more deductions than
    -- earnings is a real (bad) month, and clamping it to zero would hide it.
    'net_pay', v_gross - v_deductions
  );
end;
$$;

revoke all on function public.payroll_evaluate(jsonb, jsonb, numeric, numeric) from public, anon;
grant execute on function public.payroll_evaluate(jsonb, jsonb, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Loss of pay, read out of the register
-- ---------------------------------------------------------------------------

-- Unpaid days for one person in one month. Two things decide a day:
--
--   * `absent` is a full unpaid day; `half_day` is half of one.
--   * `on_leave` costs nothing UNLESS the leave type is unpaid -- which is the
--     only place `leave_types.is_paid` is read, and the whole reason it exists.
--
-- A working day with NO register row counts as present. That is the
-- conservative reading and it is load-bearing: a school that has not started
-- marking staff attendance must not have its first payroll run dock everybody
-- for the whole month.
create or replace function public.payroll_lop_days(
  p_staff_id uuid,
  p_from date,
  p_to date
)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(sum(
    case
      when sa.status = 'absent' then 1
      when sa.status = 'half_day' then 0.5
      when sa.status = 'on_leave' and not coalesce(lt.is_paid, true) then 1
      else 0
    end
  ), 0)::numeric
  from public.staff_attendance sa
  left join public.leave_requests lr on lr.id = sa.leave_request_id
  left join public.leave_types lt on lt.id = lr.leave_type_id
  where sa.staff_id = p_staff_id
    and sa.attendance_date between p_from and p_to
$$;

revoke all on function public.payroll_lop_days(uuid, date, date) from public, anon;
grant execute on function public.payroll_lop_days(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The preview
-- ---------------------------------------------------------------------------

-- Rule 13: this materialises rows a person can edit. It does not pay anybody.
--
-- SECURITY INVOKER, because every table it writes already has an admin or
-- accountant policy -- the function supplies atomicity, not authority.
create or replace function public.payroll_preview(p_period_month date, p_note text default null)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_month_start date := date_trunc('month', p_period_month)::date;
  v_month_end date := (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
  v_run_id uuid;
  v_staff record;
  v_from date;
  v_working numeric;
  v_lop numeric;
  v_result jsonb;
  v_payslip_id uuid;
  v_line jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'This school has no current academic session';
  end if;

  if exists (
    select 1 from public.payroll_runs r
    where r.tenant_id = v_tenant_id
      and r.period_month = v_month_start
      and r.status = 'finalised'
  ) then
    raise exception 'Payroll for % has already been finalised. Discard it first if it must be redone.',
      to_char(v_month_start, 'FMMonth YYYY');
  end if;

  -- Re-previewing replaces the draft rather than adding a second one. The
  -- partial unique index would refuse the second anyway; doing it here means
  -- the answer is "your preview was refreshed", not a constraint name.
  delete from public.payroll_runs r
  where r.tenant_id = v_tenant_id and r.period_month = v_month_start and r.status = 'draft';

  insert into public.payroll_runs (
    tenant_id, session_id, period_month, status, note, created_by
  )
  values (v_tenant_id, v_session_id, v_month_start, 'draft', p_note, auth.uid())
  returning id into v_run_id;

  for v_staff in
    select
      s.id as staff_id,
      s.date_of_joining,
      a.overrides,
      st.components,
      st.name as structure_name
    from public.staff s
    join public.staff_salary_assignments a
      on a.staff_id = s.id
     and a.effective_from <= v_month_end
     and (a.effective_to is null or a.effective_to >= v_month_start)
    join public.salary_structures st on st.id = a.structure_id
    where s.tenant_id = v_tenant_id
      and s.status = 'active'
    order by s.employee_code
  loop
    -- Somebody who joined on the 12th is not owed the first eleven days, and
    -- that is not loss of pay -- they were not employed. Moving the window is
    -- the honest way to say so; docking them would put it on their payslip as
    -- unpaid leave they never took.
    v_from := greatest(v_month_start, v_staff.date_of_joining);
    if v_from > v_month_end then continue; end if;

    v_working := public.hr_working_days(v_from, v_month_end);
    v_lop := public.payroll_lop_days(v_staff.staff_id, v_from, v_month_end);

    v_result := public.payroll_evaluate(
      v_staff.components, v_staff.overrides, v_working, v_lop);

    insert into public.payslips (
      tenant_id, run_id, staff_id, run_status,
      working_days, paid_days, lop_days,
      gross_earnings, total_deductions, net_pay,
      computed
    )
    values (
      v_tenant_id, v_run_id, v_staff.staff_id, 'draft',
      (v_result ->> 'working_days')::numeric,
      (v_result ->> 'paid_days')::numeric,
      (v_result ->> 'lop_days')::numeric,
      (v_result ->> 'gross_earnings')::numeric,
      (v_result ->> 'total_deductions')::numeric,
      (v_result ->> 'net_pay')::numeric,
      v_result
    )
    returning id into v_payslip_id;

    for v_line in select * from jsonb_array_elements(v_result -> 'lines') loop
      insert into public.payslip_lines (
        tenant_id, payslip_id, payslip_status, code, name, kind, amount, basis, sort_order
      )
      values (
        v_tenant_id, v_payslip_id, 'draft',
        v_line ->> 'code', v_line ->> 'name', v_line ->> 'kind',
        (v_line ->> 'amount')::numeric, v_line ->> 'basis',
        (v_line ->> 'sort_order')::integer
      );
    end loop;
  end loop;

  -- The structures as they stood today, frozen onto the run. Editing one in
  -- April must not change what March paid.
  update public.payroll_runs
  set rules_snapshot = jsonb_build_object(
    'previewed_at', now(),
    'structures', (
      select coalesce(jsonb_object_agg(st.name, st.components), '{}'::jsonb)
      from public.salary_structures st
      where st.tenant_id = v_tenant_id and st.is_active
    )
  )
  where id = v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.payroll_preview(date, text) from public, anon;
grant execute on function public.payroll_preview(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Finalising
-- ---------------------------------------------------------------------------

-- Writes what the rows say, not what the structure said. There is no
-- recomputation here, deliberately: an administrator who corrected somebody's
-- slip and then watched it revert would never trust the screen again.
create or replace function public.payroll_finalise(p_run_id uuid)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.payroll_runs;
  v_count integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_run from public.payroll_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;

  if v_run.id is null then
    raise exception 'That payroll run does not exist';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'This run is already %, so it cannot be finalised again.', v_run.status;
  end if;

  select count(*) into v_count from public.payslips p where p.run_id = p_run_id;
  if v_count = 0 then
    raise exception 'There is nothing to finalise: no member of staff has a salary assignment covering %.',
      to_char(v_run.period_month, 'FMMonth YYYY');
  end if;

  -- One statement, and the composite foreign key does the rest: the cascade
  -- rewrites `payslips.run_status` and then `payslip_lines.payslip_status`, and
  -- from that moment the draft-only policy matches no row. The slips become
  -- immutable without a single revoke or trigger.
  update public.payroll_runs
  set status = 'finalised', finalised_at = now(), finalised_by = auth.uid()
  where id = p_run_id;

  return v_count;
end;
$$;

revoke all on function public.payroll_finalise(uuid) from public, anon;
grant execute on function public.payroll_finalise(uuid) to authenticated;

create or replace function public.payroll_discard(p_run_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_status text;
begin
  select status into v_status from public.payroll_runs
  where id = p_run_id and tenant_id = v_tenant_id;

  if v_status is null then
    raise exception 'That payroll run does not exist';
  end if;
  if v_status = 'finalised' then
    raise exception 'A finalised run is a record of what was paid. It cannot be discarded.';
  end if;

  -- A discarded draft keeps its slips: they are the evidence of what was
  -- proposed and rejected, and the audit log alone would not show the numbers.
  update public.payroll_runs set status = 'discarded' where id = p_run_id;
end;
$$;

revoke all on function public.payroll_discard(uuid) from public, anon;
grant execute on function public.payroll_discard(uuid) to authenticated;

-- Recompute one slip from the structure, discarding an override. The escape
-- hatch for "I edited the wrong row" -- without it, the only way back is to
-- re-preview the whole month and lose every other correction.
create or replace function public.payroll_recompute_payslip(p_payslip_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_slip public.payslips;
  v_month_start date;
  v_month_end date;
  v_from date;
  v_joining date;
  v_components jsonb;
  v_overrides jsonb;
  v_result jsonb;
  v_line jsonb;
begin
  select * into v_slip from public.payslips p
  where p.id = p_payslip_id and p.tenant_id = v_tenant_id;

  if v_slip.id is null then
    raise exception 'That payslip does not exist';
  end if;
  if v_slip.run_status <> 'draft' then
    raise exception 'This payslip has been finalised and cannot be recomputed.';
  end if;

  select r.period_month, (r.period_month + interval '1 month - 1 day')::date
  into v_month_start, v_month_end
  from public.payroll_runs r where r.id = v_slip.run_id;

  select s.date_of_joining into v_joining from public.staff s where s.id = v_slip.staff_id;
  v_from := greatest(v_month_start, v_joining);

  select st.components, a.overrides into v_components, v_overrides
  from public.staff_salary_assignments a
  join public.salary_structures st on st.id = a.structure_id
  where a.staff_id = v_slip.staff_id
    and a.effective_from <= v_month_end
    and (a.effective_to is null or a.effective_to >= v_month_start);

  if v_components is null then
    raise exception 'This person has no salary assignment covering that month.';
  end if;

  v_result := public.payroll_evaluate(
    v_components, v_overrides,
    public.hr_working_days(v_from, v_month_end),
    public.payroll_lop_days(v_slip.staff_id, v_from, v_month_end));

  update public.payslips
  set working_days = (v_result ->> 'working_days')::numeric,
      paid_days = (v_result ->> 'paid_days')::numeric,
      lop_days = (v_result ->> 'lop_days')::numeric,
      gross_earnings = (v_result ->> 'gross_earnings')::numeric,
      total_deductions = (v_result ->> 'total_deductions')::numeric,
      net_pay = (v_result ->> 'net_pay')::numeric,
      computed = v_result,
      is_override = false,
      note = null
  where id = p_payslip_id;

  delete from public.payslip_lines where payslip_id = p_payslip_id;

  for v_line in select * from jsonb_array_elements(v_result -> 'lines') loop
    insert into public.payslip_lines (
      tenant_id, payslip_id, payslip_status, code, name, kind, amount, basis, sort_order
    )
    values (
      v_tenant_id, p_payslip_id, 'draft',
      v_line ->> 'code', v_line ->> 'name', v_line ->> 'kind',
      (v_line ->> 'amount')::numeric, v_line ->> 'basis',
      (v_line ->> 'sort_order')::integer
    );
  end loop;
end;
$$;

revoke all on function public.payroll_recompute_payslip(uuid) from public, anon;
grant execute on function public.payroll_recompute_payslip(uuid) to authenticated;
