-- Phase 2.3 -- a bug in the engine 0059 shipped, found by doing the arithmetic
-- by hand.
--
-- WHAT WAS WRONG
--
-- 0059 resolved each earning and prorated it inside the same loop, writing the
-- prorated figure back into the resolution map so later components could refer
-- to it. That is right for a deduction -- provident fund really is a percentage
-- of the basic actually paid -- and wrong for an earning, because a `percent_of`
-- earning then read an already-reduced base AND was reduced again on its own
-- account.
--
-- With basic 30,000, DA 12%, HRA 40%, conveyance 1,600 and two unpaid days in
-- twenty-two, it produced a gross of 41,620 where the arrangement it describes
-- pays 42,909. Every allowance was docked at roughly double the rate the
-- contract says, and nothing in the payslip showed it: each line's `basis` read
-- "12% of BASIC, prorated for 20 of 22 days", which is exactly what a person
-- checking it would expect to see.
--
-- The stated evaluation order was never wrong -- resolve, then prorate, then
-- deduct. The implementation collapsed steps 1 and 2 into one pass, and that is
-- the whole defect. Which is the argument for writing the order down and
-- pinning it to exact numbers rather than trusting a loop to embody it:
-- `tests/hr/payroll-engine.test.ts` now asserts 42,909 and would have caught it.
--
-- THE FIX
--
-- Three passes, one per step of the contract:
--
--   A. resolve every earning at its FULL value, `percent_of` reading full
--      values (so DA is 12% of the basic on paper);
--   B. prorate each resolved earning once, and publish the prorated figures as
--      what later components see;
--   C. deductions, against those prorated figures.
--
-- Only pass B writes the proration, and it writes it exactly once per
-- component. Nothing else about the function changes.

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

  -- Pass A's answers: every earning at its full, undocked value. This is what
  -- a `percent_of` earning reads, so an allowance is a share of the salary on
  -- paper rather than of somebody else's already-reduced share.
  v_full jsonb := '{}'::jsonb;
  -- Pass B's answers, and what deductions read.
  v_resolved jsonb := '{}'::jsonb;
  -- The earnings in the order they were declared, so pass B can walk them
  -- without re-deciding anything pass A decided.
  v_order jsonb := '[]'::jsonb;

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

  -- No `lop` block at all means no proration, ever. The conservative default
  -- in the direction that matters: a school that wants to dock unpaid leave
  -- will configure it, whereas one that starts docking people by accident
  -- finds out from somebody's bank balance.
  if v_lop is not null and p_working_days > 0 then
    v_factor := round(v_paid_days / p_working_days, 6);
  end if;

  -- ---- Pass A: resolve earnings at full value, in array order --------------
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_code := v_item ->> 'code';
    v_kind := v_item ->> 'kind';
    if v_code is null or v_kind <> 'earning' then continue; end if;
    if v_full ? v_code then continue; end if;  -- first definition wins

    v_calc := coalesce(v_item ->> 'calc', 'fixed');

    if v_calc = 'percent_of' then
      v_of := v_item ->> 'of';
      -- A forward or unknown reference is zero, not an error: order in the
      -- array IS the evaluation order, `salary_structure_problems` says so in
      -- a sentence, and a half-finished structure must still be previewable.
      v_amount := round(
        coalesce((v_full ->> v_of)::numeric, 0)
          * coalesce((v_item ->> 'percent')::numeric, 0) / 100, 2);
      v_basis := format('%s%% of %s', v_item ->> 'percent', coalesce(v_of, '?'));
    else
      -- The assignment's override beats the structure's own amount: the
      -- structure is the shape, the assignment is the money.
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
      v_basis := format('%s, prorated for %s of %s days',
        v_basis, public.hr_format_days(v_paid_days), public.hr_format_days(p_working_days));
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

    -- A cap is a statutory ceiling -- provident fund on the first 15,000 of
    -- basic, say. Absent means uncapped.
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
