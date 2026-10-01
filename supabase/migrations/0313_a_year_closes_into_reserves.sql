-- 0313: a financial year closes into reserves, and can be reopened.
--
-- `docs/modules/accounts.md`: "No financial-year close. Nothing rolls income
-- and expense into retained surplus at year end, so a multi-year trial balance
-- accumulates. `3200 Retained Surplus` is seeded for when it does." 0311's
-- balance sheet works around it with a "surplus not yet closed" line; this is
-- the close itself.
--
-- ## What a close is
--
-- One posted journal voucher, dated the last day of the year, that brings
-- every income and expense account's balance to that date back to zero and
-- puts the difference -- the year's surplus or deficit -- into Retained
-- Surplus. Rule 6's instincts hold: it is an ordinary voucher, gapless-
-- numbered, immutable once posted, and corrected only by reversing it.
--
-- ## Three things it refuses, each in a sentence
--
--   * a close on or before a close that is already in force -- the years are
--     closed in order, or the later close would have carried income it did
--     not see;
--   * a year with nothing to close;
--   * a college whose chart has no postable equity account coded 3200.
--
-- ## Reopening
--
-- `accounts_reopen_year` reverses the close **on the same date**, so the
-- year's books read exactly as before. `report_income_expenditure` leaves out
-- both a close and its reversal: a close is not income or spending, and a
-- statement for the year that included it would show a surplus of zero.

begin;

alter table public.journal_vouchers drop constraint journal_vouchers_source_kind_check;
alter table public.journal_vouchers add constraint journal_vouchers_source_kind_check
  check (source_kind in ('manual', 'fee_ledger', 'payroll_payment', 'reversal', 'year_close'));

-- Is this voucher a close, or the reversal of one? One definition, read by the
-- close, the reopen and the income statement.
create or replace function public.accounts_is_year_close(p_voucher_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.journal_vouchers v
    left join public.journal_vouchers o on o.id = v.reverses_voucher_id
    where v.id = p_voucher_id
      and (v.source_kind = 'year_close' or o.source_kind = 'year_close'))
$$;

revoke all on function public.accounts_is_year_close(uuid) from public, anon;
grant execute on function public.accounts_is_year_close(uuid) to authenticated;

create or replace function public.accounts_close_year(p_to date)
returns jsonb
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_reserve public.accounts;
  v_session uuid;
  v_id      uuid;
  v_number  text;
  v_surplus numeric(14, 2);
  v_lines   integer;
  v_later   date;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.current_role_allows('accounts.manage') then
    raise exception 'Closing a year needs accounts.manage.';
  end if;
  if p_to is null then
    raise exception 'Say which day the year ends on.';
  end if;

  -- One close at a time per college: two tabs closing the same year would
  -- each see nothing closed and both post.
  perform pg_advisory_xact_lock(hashtext('accounts_close_year:' || v_tenant::text));

  select max(v.voucher_date) into v_later
  from public.journal_vouchers v
  where v.tenant_id = v_tenant and v.status = 'posted' and v.source_kind = 'year_close'
    and not exists (select 1 from public.journal_vouchers r where r.reverses_voucher_id = v.id);
  if v_later is not null and v_later >= p_to then
    raise exception 'The books are already closed to %. Reopen that year first if % needs closing again.',
      to_char(v_later, 'FMDD Mon YYYY'), to_char(p_to, 'FMDD Mon YYYY');
  end if;

  select * into v_reserve from public.accounts a
  where a.tenant_id = v_tenant and a.code = '3200';
  if v_reserve.id is null or v_reserve.account_type <> 'equity'
     or not v_reserve.is_postable or not v_reserve.is_active then
    raise exception 'A year closes into Retained Surplus, account 3200, and this chart has no postable equity account with that code. Add it under Accounts first.';
  end if;

  v_session := coalesce(public.academics_session_for_date(p_to), public.current_session_id(v_tenant));

  insert into public.journal_vouchers (
    tenant_id, session_id, voucher_date, narration, status, source_kind, created_by)
  values (v_tenant, v_session, p_to,
          'Year-end close to ' || to_char(p_to, 'FMDD Mon YYYY')
            || ': income and expenditure into Retained Surplus',
          'draft', 'year_close', auth.uid())
  returning id into v_id;

  -- Each income and expense account's balance to the day, reversed.
  with bal as (
    select vl.account_id, acc.account_type, sum(vl.debit - vl.credit) as net
    from public.voucher_lines vl
    join public.journal_vouchers v on v.id = vl.voucher_id
    join public.accounts acc on acc.id = vl.account_id
    where v.tenant_id = v_tenant and v.status = 'posted' and v.voucher_date <= p_to
      and acc.account_type in ('income', 'expense')
    group by vl.account_id, acc.account_type
    having sum(vl.debit - vl.credit) <> 0
  )
  insert into public.voucher_lines (
    tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, narration, sort_order)
  select v_tenant, v_id, 'draft', b.account_id, b.account_type,
         greatest(-b.net, 0), greatest(b.net, 0), 'Closed into Retained Surplus',
         row_number() over (order by b.account_type, b.account_id)
  from bal b;
  get diagnostics v_lines = row_count;

  if v_lines = 0 then
    raise exception 'Nothing to close: no income or expense has been posted up to %.',
      to_char(p_to, 'FMDD Mon YYYY');
  end if;

  -- Debits minus credits so far is minus the surplus: a surplus is credited
  -- to reserves, a deficit debited.
  select coalesce(sum(credit - debit), 0) into v_surplus
  from public.voucher_lines where voucher_id = v_id;
  v_surplus := -v_surplus;

  if v_surplus <> 0 then
    insert into public.voucher_lines (
      tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, narration, sort_order)
    values (v_tenant, v_id, 'draft', v_reserve.id, v_reserve.account_type,
            greatest(-v_surplus, 0), greatest(v_surplus, 0),
            case when v_surplus > 0 then 'Surplus for the year' else 'Deficit for the year' end,
            v_lines + 1);
  end if;

  v_number := public.accounts_post_voucher(v_id);
  perform 1 from public.journal_vouchers v where v.id = v_id and v.status = 'posted';
  if not found then
    raise exception 'The closing voucher could not be posted.';
  end if;

  return jsonb_build_object('voucher_id', v_id, 'voucher_number', v_number,
                            'closed_to', p_to, 'surplus', v_surplus);
end;
$$;

revoke all on function public.accounts_close_year(date) from public, anon;
grant execute on function public.accounts_close_year(date) to authenticated;

create or replace function public.accounts_reopen_year(p_voucher_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_close  public.journal_vouchers;
  v_new    uuid;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.current_role_allows('accounts.manage') then
    raise exception 'Reopening a year needs accounts.manage.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the year is being reopened -- an auditor will ask.';
  end if;

  select * into v_close from public.journal_vouchers v
  where v.id = p_voucher_id and v.tenant_id = v_tenant;
  if v_close.id is null or v_close.source_kind <> 'year_close' then
    raise exception 'That is not a year-end close.';
  end if;
  if exists (
    select 1 from public.journal_vouchers v
    where v.tenant_id = v_tenant and v.status = 'posted' and v.source_kind = 'year_close'
      and v.voucher_date > v_close.voucher_date
      and not exists (select 1 from public.journal_vouchers r where r.reverses_voucher_id = v.id))
  then
    raise exception 'A later year is closed. Reopen that one first.';
  end if;

  -- Reversed on the close's own date, so the year reads exactly as before.
  v_new := public.accounts_reverse_voucher(
    p_voucher_id, v_close.voucher_date,
    'Reopened ' || to_char(v_close.voucher_date, 'FMDD Mon YYYY') || ': ' || btrim(p_reason));
  return v_new;
end;
$$;

revoke all on function public.accounts_reopen_year(uuid, text) from public, anon;
grant execute on function public.accounts_reopen_year(uuid, text) to authenticated;

-- The closes a college has made, newest first, and whether each still stands.
create or replace function public.accounts_year_closes()
returns table (voucher_id uuid, voucher_number text, closed_to date, surplus numeric,
               reopened boolean, posted_at timestamptz)
language sql
stable
set search_path = public, extensions
as $$
  select v.id, v.voucher_number, v.voucher_date,
         coalesce((select sum(vl.credit - vl.debit) from public.voucher_lines vl
                   join public.accounts a on a.id = vl.account_id
                   where vl.voucher_id = v.id and a.account_type = 'equity'), 0),
         exists (select 1 from public.journal_vouchers r where r.reverses_voucher_id = v.id),
         v.posted_at
  from public.journal_vouchers v
  where v.source_kind = 'year_close' and v.status = 'posted'
  order by v.voucher_date desc, v.id
$$;

revoke all on function public.accounts_year_closes() from public, anon;
grant execute on function public.accounts_year_closes() to authenticated;

-- The income statement leaves a close and its reversal out: neither is
-- income or spending, and the year's statement must still show the year.
create or replace function public.report_income_expenditure(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with win as (
    select
      public.report_param_date(p_params, 'from',
        public.accounts_year_start(public.mobile_today())) as from_on,
      public.report_param_date(p_params, 'to', public.mobile_today()) as to_on
  ),
  moved as (
    select acc.id, acc.code, acc.name, acc.account_type,
           sum(case when acc.account_type = 'income' then vl.credit - vl.debit
                    else vl.debit - vl.credit end) as amount
    from public.voucher_lines vl
    join public.journal_vouchers v on v.id = vl.voucher_id
    join public.accounts acc on acc.id = vl.account_id
    left join public.journal_vouchers o on o.id = v.reverses_voucher_id
    cross join win
    where v.status = 'posted'
      and v.source_kind <> 'year_close'
      and coalesce(o.source_kind, '') <> 'year_close'
      and acc.account_type in ('income', 'expense')
      and v.voucher_date between win.from_on and win.to_on
    group by acc.id, acc.code, acc.name, acc.account_type
    having sum(vl.debit - vl.credit) <> 0
  ),
  totals as (
    select coalesce(sum(amount) filter (where account_type = 'income'), 0) as income,
           coalesce(sum(amount) filter (where account_type = 'expense'), 0) as expense
    from moved
  ),
  lines as (
    select 1 as part, code as sort_key, 'Income' as section, code, name as account, amount, id as account_id
    from moved where account_type = 'income'
    union all
    select 2, 'zz', 'Income', null, 'Total income', income, null from totals
    union all
    select 3, code, 'Expenditure', code, name, amount, id from moved where account_type = 'expense'
    union all
    select 4, 'zz', 'Expenditure', null, 'Total expenditure', expense, null from totals
    union all
    select 5, 'zz', 'Result', null,
           case when income >= expense then 'Surplus for the period' else 'Deficit for the period' end,
           abs(income - expense), null
    from totals
  )
  select to_jsonb(l) - 'part' - 'sort_key'
  from lines l
  order by l.part, l.sort_key, l.account
$$;

commit;
