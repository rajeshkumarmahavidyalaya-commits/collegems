-- 0298: two corrections to 0297, both found by its own probe.
--
-- 1. accounts_record_cash filed its voucher under the year its date falls in,
--    and accounts_next_voucher_number numbered it in the current year: an
--    expense dated 28 Sep 2026 was JV-2025-00277 filed under 2026-2027. The
--    voucher book's other door (createVoucher) files every voucher under the
--    current year, so the two doors disagreed. One definition wins: the
--    current year, as createVoucher does. The ledger's reports are
--    date-ranged, so the date still decides the period (rule 6's note that the
--    accounts module needed no change for exactly this reason). A date no year
--    covers is still refused, because it is almost certainly a typo. Its
--    wrong-account sentence also said "an liability account"; the article now
--    agrees with the word.
--
-- 2. school_calendar skipped every notice without a starts_on -- both of the
--    demo college's notices -- so the board's circulars never reached the
--    calendar. A notice with no start date starts the day it was published.

create or replace function public.accounts_record_cash(
  p_kind text,
  p_account_id uuid,
  p_paid_via_id uuid,
  p_amount numeric,
  p_on date,
  p_narration text
)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_session uuid;
  v_account public.accounts;
  v_via     public.accounts;
  v_id      uuid;
  v_number  text;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if p_kind not in ('expense', 'income') then
    raise exception 'Record an expense or an income.';
  end if;
  if not public.current_role_allows('accounts.post') then
    raise exception 'Recording money in the books needs accounts.post.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'An amount has at most two decimal places.';
  end if;
  if length(btrim(coalesce(p_narration, ''))) < 3 then
    raise exception 'Say what it was for -- the voucher book is read by somebody who was not there.';
  end if;
  p_on := coalesce(p_on, public.mobile_today());

  select * into v_account from public.accounts a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'That account does not exist.';
  end if;
  if v_account.account_type <> p_kind then
    -- "an liability account" is the kind of sentence 0196 is about: the
    -- article agrees with the word, so the word carries it.
    raise exception '% is % account, not an % account.',
      v_account.name,
      case v_account.account_type when 'liability' then 'a liability' else 'an ' || v_account.account_type end,
      p_kind;
  end if;
  if not v_account.is_postable or not v_account.is_active then
    raise exception '% is a heading or is closed, so it cannot take an entry.', v_account.name;
  end if;

  select * into v_via from public.accounts a where a.id = p_paid_via_id;
  if v_via.id is null or v_via.account_type <> 'asset' or not v_via.is_postable or not v_via.is_active then
    raise exception 'Choose the cash or bank account the money % .',
      case when p_kind = 'expense' then 'left from' else 'went into' end;
  end if;

  -- A date no year covers is almost certainly a typo, so it is still refused.
  if public.academics_session_for_date(p_on) is null then
    raise exception 'No academic year covers %. Add it under Academic years first.',
      to_char(p_on, 'FMDD Mon YYYY');
  end if;
  -- Filed like every other voucher (0298): under the current year, where
  -- createVoucher files it and where accounts_next_voucher_number numbers it.
  -- The ledger's own reads are date-ranged, so the date still decides which
  -- period the money lands in.
  v_session := public.current_session_id(v_tenant);

  insert into public.journal_vouchers (
    tenant_id, session_id, voucher_date, narration, status, source_kind, created_by)
  values (v_tenant, v_session, p_on, btrim(p_narration), 'draft', 'manual', auth.uid())
  returning id into v_id;

  -- An expense debits the expense and credits the cash that paid it; an
  -- income debits the cash it arrived in and credits the income.
  insert into public.voucher_lines (
    tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
  values
    (v_tenant, v_id, 'draft',
     case when p_kind = 'expense' then v_account.id else v_via.id end,
     case when p_kind = 'expense' then v_account.account_type else v_via.account_type end,
     p_amount, 0, 1),
    (v_tenant, v_id, 'draft',
     case when p_kind = 'expense' then v_via.id else v_account.id end,
     case when p_kind = 'expense' then v_via.account_type else v_account.account_type end,
     0, p_amount, 2);

  v_number := public.accounts_post_voucher(v_id);
  -- accounts_post_voucher's final UPDATE is policy-governed; a voucher that
  -- stayed a draft must not be reported as posted (rule 6).
  perform 1 from public.journal_vouchers v where v.id = v_id and v.status = 'posted';
  if not found then
    raise exception 'The voucher could not be posted.';
  end if;
  return v_number;
end;
$$;

create or replace function public.school_calendar(p_from date, p_to date)
returns table (
  starts_on date,
  ends_on date,
  kind text,
  title text,
  detail text,
  href text
)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    select least(p_from, p_to) as f,
           least(greatest(p_from, p_to), least(p_from, p_to) + 400) as t
  )
  select * from (
    select h.starts_on, h.ends_on, 'holiday'::text, h.name, h.note, null::text
    from public.holidays h, bounds b
    where h.starts_on <= b.t and h.ends_on >= b.f
    union all
    select x.starts_on, coalesce(x.ends_on, x.starts_on), 'exam', x.name,
           case when x.status = 'draft' then 'Draft' else 'Results published' end,
           '/exams/' || x.id
    from public.exams x, bounds b
    where x.starts_on is not null and x.starts_on <= b.t
      and coalesce(x.ends_on, x.starts_on) >= b.f
    union all
    select i.due_date, i.due_date, 'fee_due', i.name || ' due', null, '/fees/instalments'
    from public.fee_instalments i, bounds b
    where i.is_active and i.due_date between b.f and b.t
    union all
    select coalesce(n.starts_on, (n.published_at at time zone 'Asia/Kolkata')::date),
           coalesce(n.expires_on, n.starts_on, (n.published_at at time zone 'Asia/Kolkata')::date),
           'notice', n.title, null, '/notices/' || n.id
    from public.notices n, bounds b
    where n.status = 'published'
      and coalesce(n.starts_on, (n.published_at at time zone 'Asia/Kolkata')::date) between b.f and b.t
  ) c(starts_on, ends_on, kind, title, detail, href)
  order by c.starts_on, c.kind, c.title
$$;
