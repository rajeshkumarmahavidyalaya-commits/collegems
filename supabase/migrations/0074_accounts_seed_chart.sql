-- Phase 2.2 -- a standard chart of accounts, and the posting map, seeded per
-- tenant.
--
-- The chart is data (rule 12): this is a sensible default an Indian school can
-- start from and then edit -- add heads, split fee income by class, rename the
-- bank -- without a release. The five roots and the handful of system accounts
-- the posting map points at are the only fixed points; everything else is the
-- tenant's to shape.

create or replace function public.accounts_seed_default_chart(p_tenant_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  a_assets uuid; a_current_assets uuid;
  a_liab uuid; a_current_liab uuid;
  a_equity uuid;
  a_income uuid;
  a_expense uuid;
  a_bank uuid; a_fee_income uuid; a_salary_expense uuid;
begin
  -- Skip a tenant that already has a chart, so this is safe to re-run and safe
  -- to call again when a chart already exists.
  if exists (select 1 from public.accounts where tenant_id = p_tenant_id) then
    return;
  end if;

  -- Roots (groups).
  insert into public.accounts (tenant_id, code, name, account_type, is_postable, is_system)
  values (p_tenant_id, '1000', 'Assets', 'asset', false, true) returning id into a_assets;
  insert into public.accounts (tenant_id, code, name, account_type, is_postable, is_system)
  values (p_tenant_id, '2000', 'Liabilities', 'liability', false, true) returning id into a_liab;
  insert into public.accounts (tenant_id, code, name, account_type, is_postable, is_system)
  values (p_tenant_id, '3000', 'Equity', 'equity', false, true) returning id into a_equity;
  insert into public.accounts (tenant_id, code, name, account_type, is_postable, is_system)
  values (p_tenant_id, '4000', 'Income', 'income', false, true) returning id into a_income;
  insert into public.accounts (tenant_id, code, name, account_type, is_postable, is_system)
  values (p_tenant_id, '5000', 'Expenses', 'expense', false, true) returning id into a_expense;

  -- Sub-groups.
  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '1100', 'Current Assets', 'asset', a_assets, false, true) returning id into a_current_assets;
  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '2100', 'Current Liabilities', 'liability', a_liab, false, true) returning id into a_current_liab;

  -- Postable leaves. `is_system` marks the ones the posting map depends on.
  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system) values
    (p_tenant_id, '1110', 'Cash in Hand', 'asset', a_current_assets, true, true),
    (p_tenant_id, '1130', 'Fees Receivable', 'asset', a_current_assets, true, true),
    (p_tenant_id, '2110', 'Salaries Payable', 'liability', a_current_liab, true, true),
    (p_tenant_id, '2120', 'Statutory Dues (PF / PT / TDS)', 'liability', a_current_liab, true, false),
    (p_tenant_id, '3100', 'Capital / Corpus', 'equity', a_equity, true, false),
    (p_tenant_id, '3200', 'Retained Surplus', 'equity', a_equity, true, false),
    (p_tenant_id, '4200', 'Fine Income', 'income', a_income, true, false),
    (p_tenant_id, '4300', 'Other Income', 'income', a_income, true, false),
    (p_tenant_id, '5200', 'Discounts & Concessions', 'expense', a_expense, true, false),
    (p_tenant_id, '5300', 'Bad Debts / Write-offs', 'expense', a_expense, true, false),
    (p_tenant_id, '5400', 'General & Administrative', 'expense', a_expense, true, false);

  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '1120', 'Bank - Current Account', 'asset', a_current_assets, true, true)
  returning id into a_bank;
  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '4100', 'Fee Income', 'income', a_income, true, true)
  returning id into a_fee_income;
  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '5100', 'Salary Expense', 'expense', a_expense, true, true)
  returning id into a_salary_expense;

  -- The posting map. Cash basis: a fee receipt is bank in / fee income up; a
  -- salary payment is salary expense up / bank out. The sync swaps sides for a
  -- refund or a reversal.
  insert into public.posting_rules (tenant_id, event_key, debit_account_id, credit_account_id) values
    (p_tenant_id, 'fee_cash', a_bank, a_fee_income),
    (p_tenant_id, 'salary_cash', a_salary_expense, a_bank);
end;
$$;

revoke all on function public.accounts_seed_default_chart(uuid) from public, anon;
grant execute on function public.accounts_seed_default_chart(uuid) to authenticated;

-- Backfill every existing tenant, because tenants are provisioned by migration
-- in this system rather than by a function -- the same reason the permission
-- rows are backfilled.
do $$
declare v_tenant record;
begin
  for v_tenant in select id from public.tenants loop
    perform public.accounts_seed_default_chart(v_tenant.id);
  end loop;
end $$;
