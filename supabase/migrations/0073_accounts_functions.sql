-- Phase 2.2 -- posting, reversal, and the sync from the subledgers.
--
-- THE BALANCE RULE LIVES AT POST, NOT IN A CHECK
--
-- "Debits equal credits" is a fact about all of a voucher's lines at once, and
-- no CHECK can see more than one row. It could be a deferred constraint trigger;
-- it is a post-time check instead, for the same reason library writes are: the
-- gate is the moment of posting, a draft is allowed to be half-built, and the
-- error a person needs ("out by 40.00") is one a trigger cannot phrase as well.

create or replace function public.accounts_next_voucher_number()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_value bigint;
  v_year text;
begin
  if v_tenant_id is null then raise exception 'No tenant in session'; end if;
  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then raise exception 'No current academic session'; end if;

  insert into public.document_sequences (tenant_id, session_id, kind, prefix)
  values (v_tenant_id, v_session_id, 'voucher', 'JV')
  on conflict (tenant_id, session_id, kind) do nothing;

  update public.document_sequences
     set next_value = next_value + 1
   where tenant_id = v_tenant_id and session_id = v_session_id and kind = 'voucher'
  returning next_value - 1 into v_value;

  select to_char(start_date, 'YYYY') into v_year
  from public.academic_sessions where id = v_session_id;

  return 'JV-' || v_year || '-' || lpad(v_value::text, 5, '0');
end;
$$;

revoke all on function public.accounts_next_voucher_number() from public, anon;
grant execute on function public.accounts_next_voucher_number() to authenticated;

-- Post a draft: balance it, number it, freeze it. The composite key does the
-- freezing -- setting status to 'posted' cascades onto every line's
-- voucher_status, and the draft-only line policy then matches nothing.
create or replace function public.accounts_post_voucher(p_voucher_id uuid)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_voucher public.journal_vouchers;
  v_debit numeric(14, 2);
  v_credit numeric(14, 2);
  v_count integer;
  v_number text;
begin
  if v_tenant_id is null then raise exception 'No tenant in session'; end if;

  select * into v_voucher from public.journal_vouchers v
  where v.id = p_voucher_id and v.tenant_id = v_tenant_id;

  if v_voucher.id is null then raise exception 'That voucher does not exist'; end if;
  if v_voucher.status <> 'draft' then
    raise exception 'This voucher is already %, so it cannot be posted again.', v_voucher.status;
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  into v_count, v_debit, v_credit
  from public.voucher_lines where voucher_id = p_voucher_id;

  if v_count < 2 then
    raise exception 'A voucher needs at least two lines to balance.';
  end if;
  if v_debit <> v_credit then
    raise exception 'This voucher does not balance: debits % , credits % (out by %).',
      to_char(v_debit, 'FM999999990.00'), to_char(v_credit, 'FM999999990.00'),
      to_char(abs(v_debit - v_credit), 'FM999999990.00');
  end if;
  if v_debit = 0 then
    raise exception 'A voucher of zero moves nothing.';
  end if;

  v_number := public.accounts_next_voucher_number();

  update public.journal_vouchers
  set status = 'posted', voucher_number = v_number,
      posted_at = now(), posted_by = auth.uid()
  where id = p_voucher_id;

  return v_number;
end;
$$;

revoke all on function public.accounts_post_voucher(uuid) from public, anon;
grant execute on function public.accounts_post_voucher(uuid) to authenticated;

-- Discard a draft. A posted voucher can never be deleted -- it is reversed.
create or replace function public.accounts_delete_draft(p_voucher_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_status text;
begin
  select status into v_status from public.journal_vouchers
  where id = p_voucher_id and tenant_id = v_tenant_id;
  if v_status is null then raise exception 'That voucher does not exist'; end if;
  if v_status <> 'draft' then
    raise exception 'A posted voucher is a permanent record. Reverse it instead of deleting.';
  end if;
  delete from public.journal_vouchers where id = p_voucher_id;
end;
$$;

revoke all on function public.accounts_delete_draft(uuid) from public, anon;
grant execute on function public.accounts_delete_draft(uuid) to authenticated;

-- Reverse a posted voucher with a mirror-image posted voucher. The original
-- stays exactly as it was -- that is the point of a reversal over an edit.
create or replace function public.accounts_reverse_voucher(
  p_voucher_id uuid,
  p_date date default null,
  p_narration text default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_voucher public.journal_vouchers;
  v_new_id uuid;
begin
  if v_tenant_id is null then raise exception 'No tenant in session'; end if;

  select * into v_voucher from public.journal_vouchers v
  where v.id = p_voucher_id and v.tenant_id = v_tenant_id;

  if v_voucher.id is null then raise exception 'That voucher does not exist'; end if;
  if v_voucher.status <> 'posted' then
    raise exception 'Only a posted voucher can be reversed.';
  end if;
  if exists (select 1 from public.journal_vouchers r where r.reverses_voucher_id = p_voucher_id) then
    raise exception 'This voucher has already been reversed.';
  end if;

  insert into public.journal_vouchers (
    tenant_id, session_id, voucher_date, narration, status,
    source_kind, reverses_voucher_id, created_by
  )
  values (
    v_tenant_id, v_voucher.session_id, coalesce(p_date, current_date),
    coalesce(p_narration, 'Reversal of ' || v_voucher.voucher_number), 'draft',
    'reversal', p_voucher_id, auth.uid()
  )
  returning id into v_new_id;

  -- Debit becomes credit and vice versa.
  insert into public.voucher_lines (
    tenant_id, voucher_id, voucher_status, account_id, account_type,
    debit, credit, narration, sort_order
  )
  select
    v_tenant_id, v_new_id, 'draft', account_id, account_type,
    credit, debit, narration, sort_order
  from public.voucher_lines where voucher_id = p_voucher_id;

  perform public.accounts_post_voucher(v_new_id);
  return v_new_id;
end;
$$;

revoke all on function public.accounts_reverse_voucher(uuid, date, text) from public, anon;
grant execute on function public.accounts_reverse_voucher(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The sync from the subledgers -- the "mapping from the fee ledger into it"
-- ---------------------------------------------------------------------------
--
-- Cash basis, deliberately and documented: income and expense are recognised
-- when cash moves. So only the cash events post -- fee payments and refunds,
-- salary payments and their reversals -- and the fee subledger's memo entries
-- (discount, fine, write-off) stay in the subledger. Accrual (posting invoices
-- as receivables) is a future refinement; the receivable account exists for it.
--
-- Bounded per rule 7: it posts at most p_limit documents per call and returns
-- how many remain, so a large first-run backlog drains in pages rather than
-- one unbounded transaction.
create or replace function public.accounts_sync(p_limit integer default 200)
returns table (created integer, remaining integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_fee_debit uuid; v_fee_credit uuid;
  v_sal_debit uuid; v_sal_credit uuid;
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

  -- Fee cash events. cash_in = -amount (amount is signed "owes more"), so a
  -- payment (amount<0) is money in and a refund (amount>0) money out.
  for v_rec in
    select le.id, le.session_id, le.occurred_at::date as on_date, (-le.amount) as cash_in,
           le.entry_type, le.receipt_number
    from public.ledger_entries le
    where le.tenant_id = v_tenant_id
      and le.entry_type in ('payment', 'refund')
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

    insert into public.journal_vouchers (
      tenant_id, session_id, voucher_date, narration, status, source_kind, source_id, created_by
    )
    values (
      v_tenant_id, v_rec.session_id, v_rec.on_date,
      coalesce('Fee ' || v_rec.entry_type || ' ' || v_rec.receipt_number, 'Fee ' || v_rec.entry_type),
      'draft', 'fee_ledger', v_rec.id, auth.uid()
    )
    returning id into v_voucher_id;

    insert into public.voucher_lines (tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
    select v_tenant_id, v_voucher_id, 'draft', v_dr, a.account_type, v_cash, 0, 1
    from public.accounts a where a.id = v_dr;
    insert into public.voucher_lines (tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
    select v_tenant_id, v_voucher_id, 'draft', v_cr, a.account_type, 0, v_cash, 2
    from public.accounts a where a.id = v_cr;

    perform public.accounts_post_voucher(v_voucher_id);
    v_created := v_created + 1;
    v_budget := v_budget - 1;
  end loop;

  -- Salary payments. cash_out = amount (positive means paid out).
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

    insert into public.journal_vouchers (
      tenant_id, session_id, voucher_date, narration, status, source_kind, source_id, created_by
    )
    values (
      v_tenant_id, v_rec.session_id, v_rec.on_date,
      'Salary payment', 'draft', 'payroll_payment', v_rec.id, auth.uid()
    )
    returning id into v_voucher_id;

    insert into public.voucher_lines (tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
    select v_tenant_id, v_voucher_id, 'draft', v_dr, a.account_type, v_cash, 0, 1
    from public.accounts a where a.id = v_dr;
    insert into public.voucher_lines (tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
    select v_tenant_id, v_voucher_id, 'draft', v_cr, a.account_type, 0, v_cash, 2
    from public.accounts a where a.id = v_cr;

    perform public.accounts_post_voucher(v_voucher_id);
    v_created := v_created + 1;
    v_budget := v_budget - 1;
  end loop;

  -- What still waits, so the caller knows whether to run again.
  select
    (select count(*) from public.ledger_entries le
      where le.tenant_id = v_tenant_id and le.entry_type in ('payment', 'refund')
        and not exists (select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'fee_ledger'
            and jv.source_id = le.id and jv.status <> 'void'))
    +
    (select count(*) from public.payroll_payments pp
      where pp.tenant_id = v_tenant_id
        and not exists (select 1 from public.journal_vouchers jv
          where jv.tenant_id = v_tenant_id and jv.source_kind = 'payroll_payment'
            and jv.source_id = pp.id and jv.status <> 'void'))
  into remaining;

  created := v_created;
  return next;
end;
$$;

revoke all on function public.accounts_sync(integer) from public, anon;
grant execute on function public.accounts_sync(integer) to authenticated;
