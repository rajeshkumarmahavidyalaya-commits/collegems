-- Phase 2.3 -- one message that gave advice this system refuses to take.
--
-- `payroll_preview` told an administrator that a finalised month could be
-- redone by discarding it first. `payroll_discard` then refuses, correctly: a
-- finalised run is the record of what was paid, and destroying it to redo the
-- month is exactly the drift the append-only instinct in rule 6 exists to
-- prevent.
--
-- So the sentence was wrong, not the behaviour. A message that sends somebody
-- down a path ending in a second refusal is worse than a blunt one, because
-- they now believe the system is broken rather than that they are asking for
-- something it deliberately will not do.
--
-- What a school actually needs here -- a correction or arrears run against an
-- already-paid month -- is not built. Saying that plainly is the honest
-- version; see `docs/modules/payroll.md`.

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
    raise exception
      'Payroll for % was finalised on %. A finalised run is the record of what was paid and cannot be replaced.',
      to_char(v_month_start, 'FMMonth YYYY'),
      to_char((select r.finalised_at from public.payroll_runs r
               where r.tenant_id = v_tenant_id and r.period_month = v_month_start
                 and r.status = 'finalised'), 'FMDD FMMon YYYY');
  end if;

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
      st.components
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
