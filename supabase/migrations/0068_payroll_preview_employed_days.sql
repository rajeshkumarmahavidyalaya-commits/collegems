-- Phase 2.3 -- the preview, taught the difference between the month and the
-- window.
--
-- Migration 0067 split `payroll_evaluate`'s single factor into two -- employment
-- and absence -- but the preview was still passing the *clamped* window as the
-- working-day denominator, so a leaver's 11 employed days were divided by 11 and
-- came out as a whole month. The engine could now express partial employment;
-- the preview was not telling it about it.
--
-- The fix is to measure two different spans:
--
--   working_days   over the WHOLE month, ignoring joining and leaving. This is
--                  the denominator: a month's salary is a rate for a month.
--   employed_days  over the employment window -- max(month start, joined) to
--                  min(month end, left). This is what the person was actually
--                  there for.
--
-- Loss of pay is then counted within the employment window, because you cannot
-- be absent from days you were not employed for.
--
-- The preview also now stores `employed_days` on the payslip, which the check
-- constraint from 0067 requires and the register reads.

create or replace function public.payroll_preview(
  p_period_month date,
  p_note text default null,
  p_kind text default 'regular'
)
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
  v_emp_from date;
  v_emp_to date;
  v_month_working numeric;
  v_employed numeric;
  v_lop numeric;
  v_result jsonb;
  v_payslip_id uuid;
  v_line jsonb;
  v_sort integer;
  v_fines numeric;
  v_fine_ids uuid[];
  v_deductions numeric;
  v_net numeric;
  v_already numeric;
  v_difference numeric;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_kind not in ('regular', 'correction') then
    raise exception 'A run is either regular or a correction.';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'This school has no current academic session';
  end if;

  if p_kind = 'regular' then
    if exists (
      select 1 from public.payroll_runs r
      where r.tenant_id = v_tenant_id and r.period_month = v_month_start
        and r.status = 'finalised' and r.run_kind = 'regular'
    ) then
      raise exception
        'Payroll for % has already been finalised. Run a correction instead - it pays the difference and leaves the record of what was paid intact.',
        to_char(v_month_start, 'FMMonth YYYY');
    end if;
  else
    if not exists (
      select 1 from public.payroll_runs r
      where r.tenant_id = v_tenant_id and r.period_month = v_month_start
        and r.status = 'finalised' and r.run_kind = 'regular'
    ) then
      raise exception
        'There is nothing to correct: % has not been paid yet.',
        to_char(v_month_start, 'FMMonth YYYY');
    end if;
  end if;

  delete from public.payroll_runs r
  where r.tenant_id = v_tenant_id and r.period_month = v_month_start
    and r.status = 'draft' and r.run_kind = p_kind;

  insert into public.payroll_runs (
    tenant_id, session_id, period_month, status, run_kind, note, created_by
  )
  values (v_tenant_id, v_session_id, v_month_start, 'draft', p_kind, p_note, auth.uid())
  returning id into v_run_id;

  -- The denominator, computed once: working days of the whole month.
  v_month_working := public.hr_working_days(v_month_start, v_month_end);

  for v_staff in
    select
      s.id as staff_id,
      s.date_of_joining,
      s.date_of_leaving,
      a.overrides,
      st.components
    from public.staff s
    join public.staff_salary_assignments a
      on a.staff_id = s.id
     and a.effective_from <= v_month_end
     and (a.effective_to is null or a.effective_to >= v_month_start)
    join public.salary_structures st on st.id = a.structure_id
    where s.tenant_id = v_tenant_id
      and (
        s.status = 'active'
        or (s.date_of_leaving is not null and s.date_of_leaving >= v_month_start)
      )
    order by s.employee_code
  loop
    -- The employment window, bounded at both ends.
    v_emp_from := greatest(v_month_start, v_staff.date_of_joining);
    v_emp_to := least(v_month_end, coalesce(v_staff.date_of_leaving, v_month_end));
    if v_emp_from > v_emp_to then continue; end if;

    v_employed := public.hr_working_days(v_emp_from, v_emp_to);
    v_lop := public.payroll_lop_days(v_staff.staff_id, v_emp_from, v_emp_to);

    -- The whole month is the denominator; the window is what they were here for.
    v_result := public.payroll_evaluate(
      v_staff.components, v_staff.overrides, v_month_working, v_lop, v_employed);

    v_deductions := (v_result ->> 'total_deductions')::numeric;
    v_net := (v_result ->> 'net_pay')::numeric;
    v_fine_ids := array[]::uuid[];
    v_fines := 0;

    if p_kind = 'regular' then
      select coalesce(sum(f.fine_amount), 0), coalesce(array_agg(f.issue_id), array[]::uuid[])
      into v_fines, v_fine_ids
      from public.payroll_staff_library_fines(v_staff.staff_id) f;

      if v_fines > 0 then
        v_deductions := v_deductions + v_fines;
        v_net := v_net - v_fines;
      end if;
    end if;

    if p_kind = 'correction' then
      v_already := public.payroll_paid_for_month(v_staff.staff_id, v_month_start);
      v_difference := round(v_net - v_already, 2);

      if abs(v_difference) < 0.005 then continue; end if;

      insert into public.payslips (
        tenant_id, run_id, staff_id, run_status,
        working_days, employed_days, paid_days, lop_days,
        gross_earnings, total_deductions, net_pay, computed
      )
      values (
        v_tenant_id, v_run_id, v_staff.staff_id, 'draft',
        (v_result ->> 'working_days')::numeric,
        (v_result ->> 'employed_days')::numeric,
        (v_result ->> 'paid_days')::numeric,
        (v_result ->> 'lop_days')::numeric,
        greatest(v_difference, 0), greatest(-v_difference, 0), v_difference,
        v_result || jsonb_build_object(
          'correction', jsonb_build_object(
            'entitlement', v_net, 'already_paid', v_already, 'difference', v_difference
          )
        )
      )
      returning id into v_payslip_id;

      insert into public.payslip_lines (
        tenant_id, payslip_id, payslip_status, code, name, kind, amount, basis, sort_order
      )
      values (
        v_tenant_id, v_payslip_id, 'draft',
        case when v_difference > 0 then 'ARREARS' else 'RECOVERY' end,
        case when v_difference > 0 then 'Arrears' else 'Recovery of overpayment' end,
        case when v_difference > 0 then 'earning' else 'deduction' end,
        abs(v_difference),
        format('Now owed %s, already paid %s',
          to_char(v_net, 'FM999999990.00'), to_char(v_already, 'FM999999990.00')),
        1
      );

      continue;
    end if;

    insert into public.payslips (
      tenant_id, run_id, staff_id, run_status,
      working_days, employed_days, paid_days, lop_days,
      gross_earnings, total_deductions, net_pay, computed
    )
    values (
      v_tenant_id, v_run_id, v_staff.staff_id, 'draft',
      (v_result ->> 'working_days')::numeric,
      (v_result ->> 'employed_days')::numeric,
      (v_result ->> 'paid_days')::numeric,
      (v_result ->> 'lop_days')::numeric,
      (v_result ->> 'gross_earnings')::numeric,
      v_deductions,
      v_net,
      v_result || jsonb_build_object('library_fine_issue_ids', to_jsonb(v_fine_ids))
    )
    returning id into v_payslip_id;

    v_sort := 0;
    for v_line in select * from jsonb_array_elements(v_result -> 'lines') loop
      v_sort := (v_line ->> 'sort_order')::integer;
      insert into public.payslip_lines (
        tenant_id, payslip_id, payslip_status, code, name, kind, amount, basis, sort_order
      )
      values (
        v_tenant_id, v_payslip_id, 'draft',
        v_line ->> 'code', v_line ->> 'name', v_line ->> 'kind',
        (v_line ->> 'amount')::numeric, v_line ->> 'basis', v_sort
      );
    end loop;

    if v_fines > 0 then
      insert into public.payslip_lines (
        tenant_id, payslip_id, payslip_status, code, name, kind, amount, basis, sort_order
      )
      values (
        v_tenant_id, v_payslip_id, 'draft', 'LIBFINE', 'Library fine', 'deduction',
        v_fines,
        format('%s overdue %s', array_length(v_fine_ids, 1),
          case when array_length(v_fine_ids, 1) = 1 then 'book' else 'books' end),
        v_sort + 1
      );
    end if;
  end loop;

  update public.payroll_runs
  set rules_snapshot = jsonb_build_object(
    'previewed_at', now(),
    'kind', p_kind,
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

revoke all on function public.payroll_preview(date, text, text) from public, anon;
grant execute on function public.payroll_preview(date, text, text) to authenticated;

-- `payroll_recompute_payslip` also predates the two-factor engine and the
-- employment window. Rebuilt so a recomputed leaver's slip matches what a fresh
-- preview would produce.
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
  v_emp_from date;
  v_emp_to date;
  v_joining date;
  v_leaving date;
  v_month_working numeric;
  v_employed numeric;
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

  select s.date_of_joining, s.date_of_leaving into v_joining, v_leaving
  from public.staff s where s.id = v_slip.staff_id;

  v_emp_from := greatest(v_month_start, v_joining);
  v_emp_to := least(v_month_end, coalesce(v_leaving, v_month_end));
  v_month_working := public.hr_working_days(v_month_start, v_month_end);
  v_employed := public.hr_working_days(v_emp_from, v_emp_to);

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
    v_components, v_overrides, v_month_working,
    public.payroll_lop_days(v_slip.staff_id, v_emp_from, v_emp_to),
    v_employed);

  update public.payslips
  set working_days = (v_result ->> 'working_days')::numeric,
      employed_days = (v_result ->> 'employed_days')::numeric,
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
