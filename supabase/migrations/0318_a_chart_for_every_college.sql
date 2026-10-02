-- 0318: a chart of accounts for every new college.
--
-- `docs/modules/accounts.md` listed three things as not built: cost centres
-- (0319), accrual (0320) and bank reconciliation (0321). Reading the module
-- to build them found a fourth, and it comes first because the rest stand on
-- it.
--
-- ## A college founded after 0074 had no chart of accounts
--
-- `accounts_seed_default_chart` was run once, by 0074, over the colleges that
-- existed that day. `platform_start_school` never calls it. So a college that
-- signed up afterwards opens /accounts on an empty tree, and `accounts_sync`
-- refuses with "The chart of accounts is not set up yet" -- for ever, because
-- nothing in the product can set it up. CLAUDE.md's sentence about
-- certificate templates (0300): *a default seeded by a migration is a default
-- for yesterday's colleges.* An AFTER INSERT trigger on `tenants` seeds it now,
-- and every existing college without a chart is seeded below.
--
-- The seeded chart also gains the six accrual posting rules 0320 reads, so a
-- college founded from today has them; existing colleges get them below.

begin;

-- ----------------------------------------------- a chart for every college --

create or replace function public.accounts_seed_default_chart(p_tenant_id uuid)
returns void
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  a_assets uuid; a_current_assets uuid;
  a_liab uuid; a_current_liab uuid;
  a_equity uuid;
  a_income uuid;
  a_expense uuid;
  a_bank uuid; a_fee_income uuid; a_salary_expense uuid;
begin
  if exists (select 1 from public.accounts where tenant_id = p_tenant_id) then
    return;
  end if;

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

  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '1100', 'Current Assets', 'asset', a_assets, false, true) returning id into a_current_assets;
  insert into public.accounts (tenant_id, code, name, account_type, parent_id, is_postable, is_system)
  values (p_tenant_id, '2100', 'Current Liabilities', 'liability', a_liab, false, true) returning id into a_current_liab;

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

  insert into public.posting_rules (tenant_id, event_key, debit_account_id, credit_account_id) values
    (p_tenant_id, 'fee_cash', a_bank, a_fee_income),
    (p_tenant_id, 'salary_cash', a_salary_expense, a_bank);

  perform public.accounts_seed_accrual_rules(p_tenant_id);
end;
$function$;

-- The accrual rules, by account code, for a college whose chart has the
-- seeded codes. A college that renumbered its chart is left alone and told by
-- accounts_sync which rule is missing.
create or replace function public.accounts_seed_accrual_rules(p_tenant_id uuid)
returns void
language sql
set search_path to 'public', 'extensions'
as $function$
  insert into public.posting_rules (tenant_id, event_key, debit_account_id, credit_account_id)
  select p_tenant_id, r.event_key, d.id, c.id
  from (values
    ('fee_invoice',   '1130', '4100'),
    ('fee_receipt',   '1120', '1130'),
    ('fee_discount',  '5200', '1130'),
    ('fee_write_off', '5300', '1130'),
    ('fee_fine',      '1130', '4200'),
    ('fee_sale',      '1130', '4300')
  ) as r(event_key, dr, cr)
  join public.accounts d on d.tenant_id = p_tenant_id and d.code = r.dr and d.is_postable
  join public.accounts c on c.tenant_id = p_tenant_id and c.code = r.cr and c.is_postable
  on conflict (tenant_id, event_key) do nothing
$function$;

revoke all on function public.accounts_seed_accrual_rules(uuid) from public, anon;
grant execute on function public.accounts_seed_accrual_rules(uuid) to authenticated;

create or replace function public.tenants_seed_chart()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.accounts_seed_default_chart(new.id);
  return new;
end;
$$;

revoke all on function public.tenants_seed_chart() from public, anon, authenticated;

create trigger tenants_seed_chart
  after insert on public.tenants
  for each row execute function public.tenants_seed_chart();

do $$
declare t record;
begin
  for t in select id from public.tenants loop
    perform public.accounts_seed_default_chart(t.id);
    perform public.accounts_seed_accrual_rules(t.id);
  end loop;
end $$;

commit;
