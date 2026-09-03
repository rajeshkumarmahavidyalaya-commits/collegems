-- Phase 2.3 -- a second engine bug, found the same way as the first: by doing
-- the arithmetic on the output.
--
-- WHAT WAS WRONG
--
-- `date_of_leaving` (migration 0065) narrowed the payroll window correctly:
-- somebody leaving on 13 March showed 11 working days instead of 26. And they
-- were still paid 47,200 — the whole month.
--
-- The reason is that `payroll_evaluate` had exactly one factor,
-- `paid_days / working_days`, and the caller passed the *window's* working days
-- as the denominator. For a leaver that is 11 over 11, which is 1. The window
-- moved and the money did not.
--
-- The mistake is conceptual, not arithmetic: **absence and employment are two
-- different reasons to pay less, and only one of them is loss of pay.**
--
--   employment factor  employed working days over the MONTH's working days.
--                      Always applies. A monthly salary is a rate for a month,
--                      and somebody employed for eleven days of it is owed
--                      eleven days of it. This has nothing to do with the `lop`
--                      block, and applying it to a structure that has no `lop`
--                      block is correct — a monthly-rated caretaker who leaves
--                      on the 13th is still not owed the 20th.
--
--   absence factor     payable days over EMPLOYED days. Applies only when the
--                      document configures `lop`, which stays the conservative
--                      default it always was.
--
-- The combined factor is their product. Collapsing them into one number is what
-- made a leaver's final payslip wrong, and would also have made an unpaid day
-- inside a partial month wrong in the other direction.
--
-- The payslip now carries all four numbers, because a person reading it needs
-- to see which is which: 26 working days in the month, 11 of them employed,
-- 1 unpaid, 10 paid.

alter table public.payslips
  add column employed_days numeric(5, 1);

-- Backfilled equal to `working_days`, which is what every existing row means:
-- those runs predate leaving dates, so everybody was employed for the whole
-- window.
update public.payslips set employed_days = working_days where employed_days is null;

alter table public.payslips
  alter column employed_days set not null,
  alter column employed_days set default 0;

-- `paid_days` is now days actually paid *within* the employment window, so the
-- old check comparing it to the month is replaced by one that says what is
-- really true: you cannot be employed for more of the month than the month has,
-- and you cannot be paid for more days than you were employed.
alter table public.payslips drop constraint payslips_days_chk;

alter table public.payslips
  add constraint payslips_days_chk check (
    working_days >= 0
    and employed_days >= 0
    and paid_days >= 0
    and lop_days >= 0
    and employed_days <= working_days + 0.001
    and paid_days + lop_days <= employed_days + 0.001
  );

comment on column public.payslips.employed_days is
  'Working days of the month this person was actually employed. Less than working_days for somebody who joined or left mid-month. Not the same as loss of pay: they were not employed, and calling it unpaid leave would be a lie in their own record.';

-- ---------------------------------------------------------------------------
-- The engine, with the two factors separated
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: adding a defaulted parameter creates a second
-- overload and makes every four-argument call ambiguous.
drop function if exists public.payroll_evaluate(jsonb, jsonb, numeric, numeric);

create or replace function public.payroll_evaluate(
  p_components jsonb,
  p_overrides jsonb,
  p_working_days numeric,
  p_lop_days numeric,
  -- Null means "employed for the whole month", which is the ordinary case and
  -- keeps every existing call site meaning what it meant.
  p_employed_days numeric default null
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

  v_full jsonb := '{}'::jsonb;
  v_resolved jsonb := '{}'::jsonb;
  v_order jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;

  v_employed numeric;
  v_paid_days numeric;
  v_employment_factor numeric := 1;
  v_absence_factor numeric := 1;
  v_factor numeric := 1;
  v_gross numeric := 0;
  v_deductions numeric := 0;
  v_sort integer := 0;
begin
  p_working_days := coalesce(p_working_days, 0);
  v_employed := least(greatest(coalesce(p_employed_days, p_working_days), 0), p_working_days);
  p_lop_days := least(greatest(coalesce(p_lop_days, 0), 0), v_employed);
  v_paid_days := v_employed - p_lop_days;

  -- Always. A month's salary is a rate for a month.
  if p_working_days > 0 then
    v_employment_factor := round(v_employed / p_working_days, 6);
  end if;

  -- Only when the document says to dock absence — the conservative default,
  -- unchanged: a school that wants to dock unpaid leave configures it, whereas
  -- one that starts docking by accident finds out from somebody's bank balance.
  if v_lop is not null and v_employed > 0 then
    v_absence_factor := round(v_paid_days / v_employed, 6);
  end if;

  v_factor := round(v_employment_factor * v_absence_factor, 6);

  -- ---- Pass A: resolve earnings at full value, in array order --------------
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_code := v_item ->> 'code';
    v_kind := v_item ->> 'kind';
    if v_code is null or v_kind <> 'earning' then continue; end if;
    if v_full ? v_code then continue; end if;

    v_calc := coalesce(v_item ->> 'calc', 'fixed');

    if v_calc = 'percent_of' then
      v_of := v_item ->> 'of';
      v_amount := round(
        coalesce((v_full ->> v_of)::numeric, 0)
          * coalesce((v_item ->> 'percent')::numeric, 0) / 100, 2);
      v_basis := format('%s%% of %s', v_item ->> 'percent', coalesce(v_of, '?'));
    else
      v_amount := coalesce(
        (v_overrides ->> v_code)::numeric,
        (v_item ->> 'amount')::numeric,
        0);
      v_basis := 'Fixed';
    end if;

    v_full := v_full || jsonb_build_object(v_code, v_amount);
    v_order := v_order || jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'name', coalesce(v_item ->> 'name', v_code),
      'basis', v_basis
    ));
  end loop;

  -- ---- Pass B: prorate each earning exactly once ---------------------------
  for v_item in select * from jsonb_array_elements(v_order) loop
    v_code := v_item ->> 'code';
    v_basis := v_item ->> 'basis';
    v_amount := (v_full ->> v_code)::numeric;

    if v_factor < 1 then
      v_amount := round(v_amount * v_factor, 2);
      -- Say which reduction this was, because "you were not here" and "you were
      -- not employed" are different sentences to read on a payslip.
      if v_employment_factor < 1 and v_absence_factor < 1 then
        v_basis := format('%s, prorated for %s of %s days employed and %s paid',
          v_basis, public.hr_format_days(v_employed),
          public.hr_format_days(p_working_days), public.hr_format_days(v_paid_days));
      elsif v_employment_factor < 1 then
        v_basis := format('%s, prorated for %s of %s days employed',
          v_basis, public.hr_format_days(v_employed), public.hr_format_days(p_working_days));
      else
        v_basis := format('%s, prorated for %s of %s days',
          v_basis, public.hr_format_days(v_paid_days), public.hr_format_days(p_working_days));
      end if;
    end if;

    v_resolved := v_resolved || jsonb_build_object(v_code, v_amount);

    v_sort := v_sort + 1;
    v_gross := v_gross + v_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'code', v_code,
      'name', v_item ->> 'name',
      'kind', 'earning',
      'amount', v_amount,
      'basis', v_basis,
      'sort_order', v_sort
    ));
  end loop;

  -- ---- Pass C: deductions, against the prorated earnings -------------------
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

  if v_rounding = 'nearest_rupee' then
    v_gross := round(v_gross, 0);
    v_deductions := round(v_deductions, 0);
  end if;

  return jsonb_build_object(
    'lines', v_lines,
    'working_days', p_working_days,
    'employed_days', v_employed,
    'paid_days', v_paid_days,
    'lop_days', p_lop_days,
    'gross_earnings', v_gross,
    'total_deductions', v_deductions,
    'net_pay', v_gross - v_deductions
  );
end;
$$;

revoke all on function public.payroll_evaluate(jsonb, jsonb, numeric, numeric, numeric) from public, anon;
grant execute on function public.payroll_evaluate(jsonb, jsonb, numeric, numeric, numeric) to authenticated;
