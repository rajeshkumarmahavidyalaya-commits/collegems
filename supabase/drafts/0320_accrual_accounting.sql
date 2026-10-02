-- 0320: accrual accounting.
--
-- The second of the three gaps docs/modules/accounts.md listed (0319 has
-- cost centres, 0321 bank reconciliation).
--
-- ## Accrual accounting
--
-- The books have been on a cash basis, deliberately (accounts.md): only fee
-- receipts and salary payments post. Accrual recognises a fee when it is
-- billed and a receipt as settling a debt:
--
--   invoice issued        Dr Fees Receivable       Cr Fee Income
--   invoice cancelled     Dr Fee Income            Cr Fees Receivable
--   payment               Dr Bank                  Cr Fees Receivable
--   refund                Dr Fees Receivable       Cr Bank
--   discount              Dr Discounts             Cr Fees Receivable
--   write-off             Dr Bad Debts             Cr Fees Receivable
--   fine                  Dr Fees Receivable       Cr Fine Income
--   sale                  Dr Fees Receivable       Cr Other Income
--
-- Each is a posting rule (rule 12: a row, not a release), seeded by account
-- code. A ledger entry's sign decides the side, so a reversal of any of them
-- posts the mirror image with no extra rule.
--
-- **Switching is a dated decision, not a flag.** A setting that flipped the
-- basis would leave the books half one and half the other: every fee billed
-- before the switch was never recognised, so the first receipt against it
-- would drive the receivable negative. `accounts_switch_to_accrual(from)`
-- therefore posts one opening voucher -- what families owed on the eve of the
-- switch, Dr Fees Receivable, Cr Retained Surplus, because it is income of
-- earlier periods that the cash basis had not yet counted -- and records the
-- date in `accounting_basis`. From that date `accounts_sync` posts the accrual
-- way; before it, the cash way, so a backlog straddling the date drains
-- correctly. It refuses a date on or before a fee receipt already posted on a
-- cash basis, because that receipt is in Fee Income and would be counted
-- again; the message names the first date that works.
--
-- It can be undone only while nothing has been posted under it.
--
-- Salaries stay on a cash basis. Payroll has no "salary owed" document to
-- post from until a run is paid, which is a separate piece of work.

begin;

-- ------------------------------------------------------------------- accrual --

alter table public.journal_vouchers drop constraint journal_vouchers_source_kind_check;
alter table public.journal_vouchers add constraint journal_vouchers_source_kind_check
  check (source_kind = any (array['manual', 'fee_ledger', 'payroll_payment', 'reversal', 'year_close',
                                  'fee_invoice', 'fee_invoice_cancel', 'basis_change']));

create table public.accounting_basis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  accrual_from date not null,
  opening_receivable numeric(14, 2) not null,
  voucher_id uuid,
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_basis_one_per_college unique (tenant_id),
  constraint accounting_basis_voucher_fkey
    foreign key (tenant_id, voucher_id) references public.journal_vouchers (tenant_id, id)
);

comment on table public.accounting_basis is
  'The day a college moved its books from a cash to an accrual basis, and the opening receivable posted that day (0320). No row: cash basis.';

create trigger set_updated_at before update on public.accounting_basis
  for each row execute function public.set_updated_at();
create trigger audit_accounting_basis after insert or update or delete on public.accounting_basis
  for each row execute function public.audit_row_change();

alter table public.accounting_basis enable row level security;

create policy "finance roles view accounting_basis" on public.accounting_basis
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = any (array['admin', 'accountant']));

-- Written only through the switch and its undo, which post the opening
-- voucher in the same transaction; the policies admit the people who may.
create policy "finance roles decide accounting_basis" on public.accounting_basis
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_role_code()) = any (array['admin', 'accountant'])
              and public.role_has_permission('accounts.manage'));

create policy "finance roles undo accounting_basis" on public.accounting_basis
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = any (array['admin', 'accountant'])
         and public.role_has_permission('accounts.manage'));

-- One two-line voucher, drafted and posted. Internal to the sync and the
-- switch; INVOKER, so every line still goes through the policies.
create or replace function public.accounts_post_pair(
  p_session uuid, p_on date, p_narration text, p_source_kind text, p_source_id uuid,
  p_debit uuid, p_credit uuid, p_amount numeric)
returns uuid
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
begin
  insert into public.journal_vouchers (
    tenant_id, session_id, voucher_date, narration, status, source_kind, source_id, created_by)
  values (v_tenant, p_session, p_on, p_narration, 'draft', p_source_kind, p_source_id, auth.uid())
  returning id into v_id;

  insert into public.voucher_lines (tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
  select v_tenant, v_id, 'draft', a.id, a.account_type, p_amount, 0, 1 from public.accounts a where a.id = p_debit;
  insert into public.voucher_lines (tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
  select v_tenant, v_id, 'draft', a.id, a.account_type, 0, p_amount, 2 from public.accounts a where a.id = p_credit;

  perform public.accounts_post_voucher(v_id);
  return v_id;
end;
$function$;

revoke all on function public.accounts_post_pair(uuid, date, text, text, uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.accounts_post_pair(uuid, date, text, text, uuid, uuid, uuid, numeric) to authenticated;

-- What families owed at the start of a day: every invoice issued before it
-- (and not cancelled before it) plus every ledger entry before it.
create or replace function public.accounts_receivable_before(p_on date)
returns numeric
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  select coalesce((
      select sum(il.amount)
      from public.invoices i
      join public.invoice_lines il on il.invoice_id = i.id
      where i.issue_date < p_on
        and (i.status = 'issued' or i.cancelled_at::date >= p_on)), 0)
    + coalesce((
      select sum(le.amount)
      from public.ledger_entries le
      where le.occurred_at::date < p_on), 0)
$function$;

revoke all on function public.accounts_receivable_before(date) from public, anon;
grant execute on function public.accounts_receivable_before(date) to authenticated;

create or replace function public.accounts_switch_to_accrual(p_from date)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_last date;
  v_open numeric(14, 2);
  v_recv uuid;
  v_reserves uuid;
  v_voucher uuid;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college first.' using errcode = '42501';
  end if;
  if not public.role_has_permission('accounts.manage') then
    raise exception 'Changing how the books recognise fees needs accounts.manage.' using errcode = '42501';
  end if;
  if p_from is null then
    raise exception 'Choose the day the books start counting fees when they are billed.';
  end if;
  if exists (select 1 from public.accounting_basis b where b.tenant_id = v_tenant) then
    raise exception 'The books are already on an accrual basis.';
  end if;
  if public.academics_session_for_date(p_from) is null then
    raise exception 'No academic year covers %. Add it under Academic years first.', to_char(p_from, 'FMDD Mon YYYY');
  end if;

  -- A receipt already posted as Fee Income on or after the date would be
  -- counted again when its invoice is recognised.
  select max(v.voucher_date) into v_last
  from public.journal_vouchers v
  where v.tenant_id = v_tenant and v.source_kind = 'fee_ledger' and v.status = 'posted'
    and not exists (select 1 from public.journal_vouchers r where r.reverses_voucher_id = v.id);
  if v_last is not null and v_last >= p_from then
    raise exception 'Fee receipts up to % are already in the books on a cash basis. Start on % or later.',
      to_char(v_last, 'FMDD Mon YYYY'), to_char(v_last + 1, 'FMDD Mon YYYY');
  end if;

  select debit_account_id into v_recv from public.posting_rules
  where tenant_id = v_tenant and event_key = 'fee_invoice' and is_active;
  select id into v_reserves from public.accounts
  where tenant_id = v_tenant and code = '3200' and is_postable and is_active;
  if v_recv is null then
    raise exception 'There is no posting rule for fee_invoice (Fees Receivable / Fee Income). Add it under Accounts, Posting rules.';
  end if;
  if v_reserves is null then
    raise exception 'The chart has no account 3200 (Retained Surplus) to take the fees earned before %.', to_char(p_from, 'FMDD Mon YYYY');
  end if;

  v_open := public.accounts_receivable_before(p_from);

  if v_open <> 0 then
    v_voucher := public.accounts_post_pair(
      public.current_session_id(v_tenant), p_from,
      format('Fees owed on %s, brought into the books on moving to an accrual basis', to_char(p_from - 1, 'FMDD Mon YYYY')),
      'basis_change', null,
      case when v_open > 0 then v_recv else v_reserves end,
      case when v_open > 0 then v_reserves else v_recv end,
      abs(v_open));
  end if;

  insert into public.accounting_basis (tenant_id, accrual_from, opening_receivable, voucher_id, decided_by)
  values (v_tenant, p_from, v_open, v_voucher, auth.uid());

  return jsonb_build_object('accrual_from', p_from, 'opening_receivable', v_open, 'voucher_id', v_voucher);
end;
$function$;

revoke all on function public.accounts_switch_to_accrual(date) from public, anon;
grant execute on function public.accounts_switch_to_accrual(date) to authenticated;

create or replace function public.accounts_undo_accrual()
returns void
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_basis public.accounting_basis;
  v_n integer;
begin
  if not public.role_has_permission('accounts.manage') then
    raise exception 'Changing how the books recognise fees needs accounts.manage.' using errcode = '42501';
  end if;
  select * into v_basis from public.accounting_basis b where b.tenant_id = v_tenant;
  if v_basis.id is null then
    raise exception 'The books are on a cash basis already.';
  end if;

  select count(*) into v_n
  from public.journal_vouchers v
  where v.tenant_id = v_tenant and v.status = 'posted'
    and (v.source_kind in ('fee_invoice', 'fee_invoice_cancel')
         or (v.source_kind = 'fee_ledger' and v.voucher_date >= v_basis.accrual_from));
  if v_n > 0 then
    raise exception '% fee % already been posted on the accrual basis, so it can no longer be undone. Reverse them first if this was a mistake.',
      v_n, case when v_n = 1 then 'voucher has' else 'vouchers have' end;
  end if;

  if v_basis.voucher_id is not null then
    perform public.accounts_reverse_voucher(v_basis.voucher_id, v_basis.accrual_from,
      'Moving back to a cash basis');
  end if;

  delete from public.accounting_basis b where b.id = v_basis.id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'The change could not be undone.';
  end if;
end;
$function$;

revoke all on function public.accounts_undo_accrual() from public, anon;
grant execute on function public.accounts_undo_accrual() to authenticated;

-- The sync, on both bases. Same signature, so its grants and the job that
-- calls it (0242) are unchanged.
create or replace function public.accounts_sync(p_limit integer default 200)
returns table(created integer, remaining integer)
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_fee_debit uuid; v_fee_credit uuid;
  v_sal_debit uuid; v_sal_credit uuid;
  v_from date;
  v_recv uuid; v_fee_income uuid;
  v_rule record;
  v_other uuid;
  v_rec record;
  v_voucher_id uuid;
  v_cash numeric(14, 2);
  v_dr uuid; v_cr uuid;
  v_created integer := 0;
  v_budget integer := greatest(coalesce(p_limit, 200), 1);
begin
  if v_tenant_id is null then raise exception 'No tenant in session'; end if;

  select debit_account_id, credit_account_id into v_fee_debit, v_fee_credit
  from public.posting_rules where tenant_id = v_tenant_id and event_key = 'fee_cash' and is_active;
  select debit_account_id, credit_account_id into v_sal_debit, v_sal_credit
  from public.posting_rules where tenant_id = v_tenant_id and event_key = 'salary_cash' and is_active;

  if v_fee_debit is null or v_sal_debit is null then
    raise exception 'The chart of accounts is not set up yet: no posting rule for fee_cash or salary_cash.';
  end if;

  select b.accrual_from into v_from from public.accounting_basis b where b.tenant_id = v_tenant_id;

  if v_from is not null then
    select debit_account_id, credit_account_id into v_recv, v_fee_income
    from public.posting_rules where tenant_id = v_tenant_id and event_key = 'fee_invoice' and is_active;
    if v_recv is null then
      raise exception 'The books are on an accrual basis and there is no posting rule for fee_invoice.';
    end if;
  end if;

  -- Cash basis: receipts and refunds before the switch (or all of them).
  for v_rec in
    select le.id, le.session_id, le.occurred_at::date as on_date, (-le.amount) as cash_in,
           le.entry_type, le.receipt_number
    from public.ledger_entries le
    where le.tenant_id = v_tenant_id
      and le.entry_type in ('payment', 'refund')
      and (v_from is null or le.occurred_at::date < v_from)
      and not exists (
        select 1 from public.journal_vouchers jv
        where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_ledger'
          and jv.source_id = le.id and jv.status <> 'void'
      )
    order by le.occurred_at
    limit v_budget
  loop
    v_cash := abs(v_rec.cash_in);
    if v_rec.cash_in >= 0 then v_dr := v_fee_debit; v_cr := v_fee_credit;
    else v_dr := v_fee_credit; v_cr := v_fee_debit; end if;
    perform public.accounts_post_pair(v_rec.session_id, v_rec.on_date,
      coalesce('Fee ' || v_rec.entry_type || ' ' || v_rec.receipt_number, 'Fee ' || v_rec.entry_type),
      'fee_ledger', v_rec.id, v_dr, v_cr, v_cash);
    v_created := v_created + 1;
    v_budget := v_budget - 1;
  end loop;

  if v_from is not null then
    -- Invoices billed on or after the switch.
    for v_rec in
      select i.id, i.session_id, i.issue_date, i.invoice_number,
             (select sum(il.amount) from public.invoice_lines il where il.invoice_id = i.id) as total
      from public.invoices i
      where i.tenant_id = v_tenant_id and i.issue_date >= v_from
        and not exists (
          select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_invoice'
            and jv.source_id = i.id and jv.status <> 'void')
      order by i.issue_date, i.invoice_number, i.id
      limit greatest(v_budget, 0)
    loop
      exit when v_budget <= 0;
      if coalesce(v_rec.total, 0) > 0 then
        perform public.accounts_post_pair(v_rec.session_id, v_rec.issue_date,
          'Fees billed ' || coalesce(v_rec.invoice_number, ''), 'fee_invoice', v_rec.id,
          v_recv, v_fee_income, v_rec.total);
        v_created := v_created + 1;
        v_budget := v_budget - 1;
      end if;
    end loop;

    -- Invoices cancelled on or after the switch: each was in the receivable,
    -- by the opening voucher or by its own fee_invoice voucher.
    for v_rec in
      select i.id, i.session_id, i.cancelled_at::date as on_date, i.invoice_number,
             (select sum(il.amount) from public.invoice_lines il where il.invoice_id = i.id) as total
      from public.invoices i
      where i.tenant_id = v_tenant_id and i.status = 'cancelled'
        and i.cancelled_at::date >= v_from
        and not exists (
          select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_invoice_cancel'
            and jv.source_id = i.id and jv.status <> 'void')
      order by i.cancelled_at, i.id
      limit greatest(v_budget, 0)
    loop
      exit when v_budget <= 0;
      if coalesce(v_rec.total, 0) > 0 then
        perform public.accounts_post_pair(v_rec.session_id, v_rec.on_date,
          'Invoice cancelled ' || coalesce(v_rec.invoice_number, ''), 'fee_invoice_cancel', v_rec.id,
          v_fee_income, v_recv, v_rec.total);
        v_created := v_created + 1;
        v_budget := v_budget - 1;
      end if;
    end loop;

    -- Every ledger entry on or after the switch. The entry's sign decides the
    -- side: positive raises what is owed (Dr Receivable), negative lowers it.
    for v_rec in
      select le.id, le.session_id, le.occurred_at::date as on_date, le.amount,
             le.entry_type, le.receipt_number
      from public.ledger_entries le
      where le.tenant_id = v_tenant_id
        and le.occurred_at::date >= v_from
        and not exists (
          select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_ledger'
            and jv.source_id = le.id and jv.status <> 'void')
      order by le.occurred_at, le.id
      limit greatest(v_budget, 0)
    loop
      exit when v_budget <= 0;
      select r.debit_account_id, r.credit_account_id into v_rule
      from public.posting_rules r
      where r.tenant_id = v_tenant_id and r.is_active
        and r.event_key = case v_rec.entry_type
                            when 'payment' then 'fee_receipt'
                            when 'refund' then 'fee_receipt'
                            else 'fee_' || v_rec.entry_type end;
      if v_rule.debit_account_id is null then
        raise exception 'There is no posting rule for % on the accrual basis. Add it under Accounts, Posting rules.',
          case v_rec.entry_type when 'payment' then 'fee_receipt' when 'refund' then 'fee_receipt'
               else 'fee_' || v_rec.entry_type end;
      end if;
      if v_rule.debit_account_id = v_recv then v_other := v_rule.credit_account_id;
      elsif v_rule.credit_account_id = v_recv then v_other := v_rule.debit_account_id;
      else
        raise exception 'The posting rule for % must have Fees Receivable on one side.', v_rec.entry_type;
      end if;

      if v_rec.amount > 0 then v_dr := v_recv; v_cr := v_other;
      else v_dr := v_other; v_cr := v_recv; end if;
      perform public.accounts_post_pair(v_rec.session_id, v_rec.on_date,
        coalesce('Fee ' || v_rec.entry_type || ' ' || v_rec.receipt_number, 'Fee ' || v_rec.entry_type),
        'fee_ledger', v_rec.id, v_dr, v_cr, abs(v_rec.amount));
      v_created := v_created + 1;
      v_budget := v_budget - 1;
    end loop;
  end if;

  -- Salaries: cash basis on both.
  for v_rec in
    select pp.id, r.session_id, pp.paid_on as on_date, pp.amount as cash_out
    from public.payroll_payments pp
    join public.payslips ps on ps.id = pp.payslip_id
    join public.payroll_runs r on r.id = ps.run_id
    where pp.tenant_id = v_tenant_id
      and not exists (
        select 1 from public.journal_vouchers jv
        where jv.tenant_id = v_tenant_id and jv.source_kind = 'payroll_payment'
          and jv.source_id = pp.id and jv.status <> 'void'
      )
    order by pp.created_at
    limit greatest(v_budget, 0)
  loop
    exit when v_budget <= 0;
    v_cash := abs(v_rec.cash_out);
    if v_cash = 0 then continue; end if;
    if v_rec.cash_out >= 0 then v_dr := v_sal_debit; v_cr := v_sal_credit;
    else v_dr := v_sal_credit; v_cr := v_sal_debit; end if;
    perform public.accounts_post_pair(v_rec.session_id, v_rec.on_date, 'Salary payment',
      'payroll_payment', v_rec.id, v_dr, v_cr, v_cash);
    v_created := v_created + 1;
    v_budget := v_budget - 1;
  end loop;

  select
    (select count(*) from public.ledger_entries le
      where le.tenant_id = v_tenant_id
        and (case when v_from is null or le.occurred_at::date < v_from
                  then le.entry_type in ('payment', 'refund') else true end)
        and not exists (select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_ledger'
            and jv.source_id = le.id and jv.status <> 'void'))
    +
    (select count(*) from public.invoices i
      where v_from is not null and i.tenant_id = v_tenant_id and i.issue_date >= v_from
        and exists (select 1 from public.invoice_lines il where il.invoice_id = i.id)
        and not exists (select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_invoice'
            and jv.source_id = i.id and jv.status <> 'void'))
    +
    (select count(*) from public.invoices i
      where v_from is not null and i.tenant_id = v_tenant_id and i.status = 'cancelled'
        and i.cancelled_at::date >= v_from
        and exists (select 1 from public.invoice_lines il where il.invoice_id = i.id)
        and not exists (select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_invoice_cancel'
            and jv.source_id = i.id and jv.status <> 'void'))
    +
    (select count(*) from public.payroll_payments pp
      where pp.tenant_id = v_tenant_id and pp.amount <> 0
        and not exists (select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'payroll_payment'
            and jv.source_id = pp.id and jv.status <> 'void'))
  into remaining;

  created := v_created;
  return next;
end;
$function$;

commit;
