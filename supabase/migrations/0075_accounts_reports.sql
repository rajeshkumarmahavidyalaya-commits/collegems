-- Phase 2.2 -- the three things an accountant asks the ledger.
--
-- All SECURITY INVOKER, so RLS answers "may this person see the books" -- the
-- voucher-line policies already restrict them to finance roles, and a report
-- that recomputed a `where tenant_id =` by hand would be the ninth place to
-- forget it (rule 11).

-- The chart, every account, with its rolled-up balance. A group's balance is
-- the sum of its descendants'; a leaf's is its own postings. Presented in the
-- account's natural direction (debit for assets and expenses, credit for the
-- rest), because "Bank 40,000" should read positive when there is money in it.
create or replace function public.accounts_chart_balances(p_as_of date default null)
returns table (
  id uuid,
  code text,
  name text,
  account_type text,
  parent_id uuid,
  is_postable boolean,
  is_active boolean,
  depth integer,
  balance numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with recursive
  posted as (
    select vl.account_id, (vl.debit - vl.credit) as rawnet
    from public.voucher_lines vl
    join public.journal_vouchers v on v.id = vl.voucher_id
    where v.status = 'posted'
      and (p_as_of is null or v.voucher_date <= p_as_of)
  ),
  leaf as (
    select account_id, sum(rawnet) as rawnet from posted group by account_id
  ),
  -- (account, ancestor) closure: each account, then its parent, grandparent...
  anc as (
    select a.id as account_id, a.id as anc_id from public.accounts a
    union all
    select anc.account_id, acc.parent_id
    from anc join public.accounts acc on acc.id = anc.anc_id
    where acc.parent_id is not null
  ),
  rolled as (
    select acc.id as anc_id, coalesce(sum(l.rawnet), 0) as rawnet
    from public.accounts acc
    left join anc on anc.anc_id = acc.id
    left join leaf l on l.account_id = anc.account_id
    group by acc.id
  ),
  depths as (
    select id, 0 as depth, parent_id from public.accounts where parent_id is null
    union all
    select a.id, d.depth + 1, a.parent_id
    from public.accounts a join depths d on a.parent_id = d.id
  )
  select
    acc.id, acc.code, acc.name, acc.account_type, acc.parent_id,
    acc.is_postable, acc.is_active, d.depth,
    case when acc.account_type in ('asset', 'expense') then r.rawnet else -r.rawnet end
  from public.accounts acc
  join rolled r on r.anc_id = acc.id
  join depths d on d.id = acc.id
  order by acc.code
$$;

revoke all on function public.accounts_chart_balances(date) from public, anon;
grant execute on function public.accounts_chart_balances(date) to authenticated;

-- The trial balance: every postable account with a balance, split into the
-- debit and credit columns. The two columns are equal by construction --
-- because every posted voucher balanced -- which is the whole point of showing
-- it: a school can hand this to an auditor and the totals prove the books tie.
create or replace function public.accounts_trial_balance(p_as_of date default null)
returns table (
  account_id uuid,
  code text,
  name text,
  account_type text,
  debit numeric,
  credit numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select
    acc.id, acc.code, acc.name, acc.account_type,
    greatest(sum(vl.debit - vl.credit), 0) as debit,
    greatest(sum(vl.credit - vl.debit), 0) as credit
  from public.accounts acc
  join public.voucher_lines vl on vl.account_id = acc.id
  join public.journal_vouchers v on v.id = vl.voucher_id
  where v.status = 'posted'
    and (p_as_of is null or v.voucher_date <= p_as_of)
  group by acc.id, acc.code, acc.name, acc.account_type
  having sum(vl.debit - vl.credit) <> 0
  order by acc.code
$$;

revoke all on function public.accounts_trial_balance(date) from public, anon;
grant execute on function public.accounts_trial_balance(date) to authenticated;

-- One account's statement: every line that hit it, with a running balance. The
-- opening balance folds everything before the window into one number, so the
-- statement reads like a passbook.
create or replace function public.accounts_ledger(
  p_account_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  voucher_id uuid,
  voucher_number text,
  voucher_date date,
  narration text,
  line_narration text,
  debit numeric,
  credit numeric,
  running_balance numeric,
  is_opening boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with acct as (
    select account_type from public.accounts where id = p_account_id
  ),
  movements as (
    select
      v.id as voucher_id, v.voucher_number, v.voucher_date,
      v.narration, vl.narration as line_narration,
      vl.debit, vl.credit, vl.created_at, vl.sort_order,
      (vl.debit - vl.credit) as rawnet
    from public.voucher_lines vl
    join public.journal_vouchers v on v.id = vl.voucher_id
    where vl.account_id = p_account_id and v.status = 'posted'
  ),
  opening as (
    select coalesce(sum(rawnet), 0) as raw
    from movements where p_from is not null and voucher_date < p_from
  ),
  windowed as (
    select * from movements
    where (p_from is null or voucher_date >= p_from)
      and (p_to is null or voucher_date <= p_to)
  ),
  sign as (
    select case when (select account_type from acct) in ('asset', 'expense') then 1 else -1 end as s
  )
  -- Aliased explicitly: after a UNION, ORDER BY can only see the first
  -- branch's output labels.
  select
    null::uuid as voucher_id, null::text as voucher_number, p_from as voucher_date,
    'Opening balance'::text as narration, null::text as line_narration,
    0::numeric as debit, 0::numeric as credit,
    ((select raw from opening) * (select s from sign)) as running_balance,
    true as is_opening
  where p_from is not null and (select raw from opening) <> 0
  union all
  select
    w.voucher_id, w.voucher_number, w.voucher_date, w.narration, w.line_narration,
    w.debit, w.credit,
    ((select raw from opening) + sum(w.rawnet) over (
      order by w.voucher_date, w.created_at, w.sort_order
      rows between unbounded preceding and current row
    )) * (select s from sign),
    false
  from windowed w
  order by voucher_date nulls first, voucher_number nulls first
$$;

revoke all on function public.accounts_ledger(uuid, date, date) from public, anon;
grant execute on function public.accounts_ledger(uuid, date, date) to authenticated;
