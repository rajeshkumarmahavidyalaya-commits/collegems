-- Phase 2.3, part eight -- the engine changes the four fixes need.
--
-- `payroll_preview` and `payroll_register` change signature, so both are
-- dropped and recreated: adding a defaulted parameter to an existing function
-- creates a second overload and makes every two-argument call ambiguous.

-- ---------------------------------------------------------------------------
-- Staff library fines, as an amount payroll can ask for
-- ---------------------------------------------------------------------------

-- Outstanding fines for one member of staff: charged, not yet collected on a
-- payslip, not waived. `SECURITY INVOKER`, so a caller only sees fines their
-- own tenant can see.
create or replace function public.payroll_staff_library_fines(p_staff_id uuid)
returns table (issue_id uuid, fine_amount numeric)
language sql
stable
set search_path = public, extensions
as $$
  select bi.id, bi.fine_amount
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  where m.staff_id = p_staff_id
    and bi.fine_amount > 0
    and bi.staff_fine_payslip_id is null
    and bi.staff_fine_waived_at is null
  order by bi.returned_at nulls last, bi.id
$$;

revoke all on function public.payroll_staff_library_fines(uuid) from public, anon;
grant execute on function public.payroll_staff_library_fines(uuid) to authenticated;

-- Writing off a staff fine. A waiver is a decision somebody made, so it records
-- who and when rather than simply zeroing the amount -- the amount is what was
-- owed, and erasing it loses the fact that a book came back three weeks late.
create or replace function public.library_waive_staff_fine(p_issue_id uuid, p_note text default null)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_issue public.book_issues;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_issue from public.book_issues bi
  where bi.id = p_issue_id and bi.tenant_id = v_tenant_id;

  if v_issue.id is null then
    raise exception 'That issue does not exist';
  end if;
  if v_issue.fine_amount <= 0 then
    raise exception 'There is no fine on this issue to waive.';
  end if;
  if v_issue.staff_fine_payslip_id is not null then
    raise exception 'This fine has already been collected on a payslip. Reverse that instead.';
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = v_issue.member_id and m.staff_id is not null
  ) then
    raise exception 'This is a student fine. It is settled through the fee ledger, not here.';
  end if;

  update public.book_issues
  set staff_fine_waived_at = now(), staff_fine_waived_by = auth.uid()
  where id = p_issue_id;
end;
$$;

revoke all on function public.library_waive_staff_fine(uuid, text) from public, anon;
grant execute on function public.library_waive_staff_fine(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What a month has already paid
-- ---------------------------------------------------------------------------

-- The sum of every FINALISED run for a month, per person. A correction run
-- pays the difference between what is now owed and this.
create or replace function public.payroll_paid_for_month(p_staff_id uuid, p_period_month date)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(sum(ps.net_pay), 0)::numeric
  from public.payslips ps
  join public.payroll_runs r on r.id = ps.run_id
  where ps.staff_id = p_staff_id
    and r.period_month = p_period_month
    and r.status = 'finalised'
$$;

revoke all on function public.payroll_paid_for_month(uuid, date) from public, anon;
grant execute on function public.payroll_paid_for_month(uuid, date) to authenticated;

-- What has actually left the bank against one payslip, reversals netted off.
create or replace function public.payroll_payslip_paid(p_payslip_id uuid)
returns numeric
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(sum(amount), 0)::numeric
  from public.payroll_payments
  where payslip_id = p_payslip_id
$$;

revoke all on function public.payroll_payslip_paid(uuid) from public, anon;
grant execute on function public.payroll_payslip_paid(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording a payment
-- ---------------------------------------------------------------------------

create or replace function public.payroll_record_payment(
  p_payslip_id uuid,
  p_amount numeric,
  p_method text default 'bank_transfer',
  p_reference text default null,
  p_paid_on date default null,
  p_note text default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_slip public.payslips;
  v_already numeric;
  v_payment_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- Positive numbers only, and the function does the signing. Same rule as the
  -- fee ledger: never ask a person at a counter for a negative amount.
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment must be a positive amount.';
  end if;

  select * into v_slip from public.payslips ps
  where ps.id = p_payslip_id and ps.tenant_id = v_tenant_id;

  if v_slip.id is null then
    raise exception 'That payslip does not exist';
  end if;
  if v_slip.run_status <> 'finalised' then
    raise exception 'This payslip is still a draft. Finalise the run before paying it.';
  end if;
  if v_slip.net_pay <= 0 then
    raise exception 'This payslip nets to % and so has nothing to pay out.', v_slip.net_pay;
  end if;

  v_already := public.payroll_payslip_paid(p_payslip_id);

  -- Overpaying is refused rather than allowed and reconciled later: the number
  -- on the payslip is the number that was agreed, and a bank transfer for more
  -- than it is a mistake somebody wants to know about before it leaves.
  if v_already + p_amount > v_slip.net_pay + 0.005 then
    raise exception
      'That would pay % against a payslip of %, of which % is already paid.',
      to_char(p_amount, 'FM999999990.00'),
      to_char(v_slip.net_pay, 'FM999999990.00'),
      to_char(v_already, 'FM999999990.00');
  end if;

  insert into public.payroll_payments (
    tenant_id, payslip_id, payslip_status, amount, paid_on, method, reference, note, recorded_by
  )
  values (
    v_tenant_id, p_payslip_id, 'finalised', p_amount,
    coalesce(p_paid_on, current_date), p_method, nullif(p_reference, ''), p_note, auth.uid()
  )
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.payroll_record_payment(uuid, numeric, text, text, date, text) from public, anon;
grant execute on function public.payroll_record_payment(uuid, numeric, text, text, date, text) to authenticated;

-- A correction is a reversing entry, never an update. The unique index on
-- `reverses_payment_id` is what makes a retried reversal converge instead of
-- undoing the payment twice.
create or replace function public.payroll_reverse_payment(p_payment_id uuid, p_note text default null)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_payment public.payroll_payments;
  v_reversal_id uuid;
begin
  select * into v_payment from public.payroll_payments p
  where p.id = p_payment_id and p.tenant_id = v_tenant_id;

  if v_payment.id is null then
    raise exception 'That payment does not exist';
  end if;
  if v_payment.reverses_payment_id is not null then
    raise exception 'That is itself a reversal. Record a fresh payment instead.';
  end if;

  insert into public.payroll_payments (
    tenant_id, payslip_id, payslip_status, amount, paid_on, method,
    reference, note, reverses_payment_id, recorded_by
  )
  values (
    v_tenant_id, v_payment.payslip_id, 'finalised', -v_payment.amount,
    current_date, v_payment.method, v_payment.reference,
    coalesce(p_note, 'Reversal'), p_payment_id, auth.uid()
  )
  returning id into v_reversal_id;

  return v_reversal_id;
end;
$$;

revoke all on function public.payroll_reverse_payment(uuid, text) from public, anon;
grant execute on function public.payroll_reverse_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The preview, rewritten
-- ---------------------------------------------------------------------------

drop function if exists public.payroll_preview(date, text);

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
  v_from date;
  v_to date;
  v_working numeric;
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
        'Payroll for % has already been finalised. Run a correction instead — it pays the difference and leaves the record of what was paid intact.',
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

  -- Re-previewing replaces the draft of the same kind rather than adding a
  -- second one.
  delete from public.payroll_runs r
  where r.tenant_id = v_tenant_id and r.period_month = v_month_start
    and r.status = 'draft' and r.run_kind = p_kind;

  insert into public.payroll_runs (
    tenant_id, session_id, period_month, status, run_kind, note, created_by
  )
  values (v_tenant_id, v_session_id, v_month_start, 'draft', p_kind, p_note, auth.uid())
  returning id into v_run_id;

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
      -- A leaver is still owed the month they worked. Filtering on
      -- `status = 'active'` alone made somebody marked `terminated` vanish from
      -- payroll entirely, including from their own final month -- which is the
      -- bug `date_of_leaving` exists to fix.
      and (
        s.status = 'active'
        or (s.date_of_leaving is not null and s.date_of_leaving >= v_month_start)
      )
    order by s.employee_code
  loop
    -- The window is bounded at both ends now. Somebody who joined on the 12th
    -- is not owed the first eleven days, and somebody who left on the 20th is
    -- not owed the last ten. Neither is loss of pay: they were not employed,
    -- and calling it unpaid leave would be a lie in their own record.
    v_from := greatest(v_month_start, v_staff.date_of_joining);
    v_to := least(v_month_end, coalesce(v_staff.date_of_leaving, v_month_end));
    if v_from > v_to then continue; end if;

    v_working := public.hr_working_days(v_from, v_to);
    v_lop := public.payroll_lop_days(v_staff.staff_id, v_from, v_to);

    v_result := public.payroll_evaluate(
      v_staff.components, v_staff.overrides, v_working, v_lop);

    v_deductions := (v_result ->> 'total_deductions')::numeric;
    v_net := (v_result ->> 'net_pay')::numeric;
    v_fine_ids := array[]::uuid[];
    v_fines := 0;

    -- Staff library fines, collected here because there is nowhere else for
    -- them to go: `ledger_entries.student_id` is `not null`, so a staff fine
    -- cannot be a fee receivable. Only on a regular run -- a correction pays a
    -- difference, and folding a fresh charge into it would make the two
    -- indistinguishable.
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

      -- A correction lists only the people it affects. Fifteen rows of zero
      -- would bury the three that matter.
      if abs(v_difference) < 0.005 then continue; end if;

      insert into public.payslips (
        tenant_id, run_id, staff_id, run_status,
        working_days, paid_days, lop_days,
        -- The adjustment, split by sign so the CHECKs still hold: owed more is
        -- an earning, overpaid is a recovery.
        gross_earnings, total_deductions, net_pay,
        computed
      )
      values (
        v_tenant_id, v_run_id, v_staff.staff_id, 'draft',
        (v_result ->> 'working_days')::numeric,
        (v_result ->> 'paid_days')::numeric,
        (v_result ->> 'lop_days')::numeric,
        greatest(v_difference, 0), greatest(-v_difference, 0), v_difference,
        v_result || jsonb_build_object(
          'correction', jsonb_build_object(
            'entitlement', v_net,
            'already_paid', v_already,
            'difference', v_difference
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
      v_deductions,
      v_net,
      -- The issue ids are recorded on the payslip at PREVIEW time, so
      -- finalising settles exactly the fines this slip charged for. A fine
      -- raised between preview and finalise lands on next month instead of
      -- being silently swept in.
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

-- ---------------------------------------------------------------------------
-- Finalising, which now also settles the fines it charged for
-- ---------------------------------------------------------------------------

create or replace function public.payroll_finalise(p_run_id uuid)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.payroll_runs;
  v_count integer;
  v_slip record;
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
    raise exception 'There is nothing to finalise: %',
      case when v_run.run_kind = 'correction'
        then 'every payslip for that month already matches what is owed.'
        else format('no member of staff has a salary assignment covering %s.',
                    to_char(v_run.period_month, 'FMMonth YYYY'))
      end;
  end if;

  -- Settle exactly the fines each payslip charged for, named at preview time.
  -- Doing it here rather than at preview means a discarded draft leaves the
  -- fines outstanding, which is correct: nothing was collected.
  for v_slip in
    select p.id, p.computed -> 'library_fine_issue_ids' as fine_ids
    from public.payslips p
    where p.run_id = p_run_id
      and jsonb_array_length(coalesce(p.computed -> 'library_fine_issue_ids', '[]'::jsonb)) > 0
  loop
    update public.book_issues bi
    set staff_fine_payslip_id = v_slip.id
    where bi.tenant_id = v_tenant_id
      and bi.id in (select (jsonb_array_elements_text(v_slip.fine_ids))::uuid)
      and bi.staff_fine_payslip_id is null
      and bi.staff_fine_waived_at is null;
  end loop;

  -- One statement, and the composite foreign key does the rest: the cascade
  -- rewrites `payslips.run_status` and then `payslip_lines.payslip_status`, and
  -- from that moment the draft-only policy matches no row.
  update public.payroll_runs
  set status = 'finalised', finalised_at = now(), finalised_by = auth.uid()
  where id = p_run_id;

  return v_count;
end;
$$;

revoke all on function public.payroll_finalise(uuid) from public, anon;
grant execute on function public.payroll_finalise(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The register, with what has actually been paid
-- ---------------------------------------------------------------------------

drop function if exists public.payroll_register(uuid);

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
  note text,
  amount_paid numeric,
  has_left boolean
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
    ps.note,
    public.payroll_payslip_paid(ps.id),
    (s.date_of_leaving is not null and s.date_of_leaving <= (r.period_month + interval '1 month - 1 day')::date)
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

-- ---------------------------------------------------------------------------
-- The register, and who is on it
-- ---------------------------------------------------------------------------

-- Somebody who has left stops appearing on the day after their last day, rather
-- than the moment an administrator remembers to change their status.
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
  where s.date_of_joining <= p_date
    and (s.date_of_leaving is null or s.date_of_leaving >= p_date)
    and (s.status = 'active' or s.date_of_leaving is not null)
  order by s.employee_code
$$;

revoke all on function public.hr_attendance_sheet(date) from public, anon;
grant execute on function public.hr_attendance_sheet(date) to authenticated;
