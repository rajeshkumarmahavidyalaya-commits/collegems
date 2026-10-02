-- 0319: cost centres.
--
-- ## Cost centres
--
-- A school that runs a hostel and a bus service wants to know whether each
-- pays for itself. That is a second dimension on a voucher line, not more
-- accounts: "Fee Income - Hostel" and "Fee Income - Transport" multiply every
-- income and expense account by every activity. So `cost_centres` is a short
-- list the college keeps, and `voucher_lines.cost_centre_id` tags an income or
-- expense line with one. A CHECK keeps it off balance-sheet lines -- a bank
-- balance does not belong to the hostel. Optional everywhere: an untagged
-- line is "not assigned" in the report, never refused.
--
-- `accounts_reverse_voucher` copies the tag, or a reversal would leave the
-- hostel's figures with half a correction: a new column on a table is the
-- write, the read and every copier (rule 6, 0265).

begin;

-- -------------------------------------------------------------- cost centres --

create table public.cost_centres (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9._-]{1,20}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_centres_code_key unique (tenant_id, code),
  constraint cost_centres_tenant_id_key unique (tenant_id, id)
);

comment on table public.cost_centres is
  'An activity the college wants its own income and expenditure for -- the hostel, transport, the canteen (0319). A tag on voucher lines, not a set of accounts.';

create trigger set_updated_at before update on public.cost_centres
  for each row execute function public.set_updated_at();
create trigger audit_cost_centres after insert or update or delete on public.cost_centres
  for each row execute function public.audit_row_change();

alter table public.cost_centres enable row level security;

create policy "finance roles manage cost_centres" on public.cost_centres
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = any (array['admin', 'accountant']))
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_role_code()) = any (array['admin', 'accountant']));

alter table public.voucher_lines
  add column cost_centre_id uuid;

alter table public.voucher_lines
  add constraint voucher_lines_cost_centre_fkey
    foreign key (tenant_id, cost_centre_id)
    references public.cost_centres (tenant_id, id) on delete restrict;

alter table public.voucher_lines
  add constraint voucher_lines_cost_centre_chk
    check (cost_centre_id is null or account_type in ('income', 'expense'));

create index voucher_lines_cost_centre_idx
  on public.voucher_lines (tenant_id, cost_centre_id) where cost_centre_id is not null;

comment on column public.voucher_lines.cost_centre_id is
  'Which activity this income or expense belongs to, if the college tracks it (0319). Never on an asset, liability or equity line.';

-- A reversal carries the tag with it (same signature as before, so grants are kept).
create or replace function public.accounts_reverse_voucher(p_voucher_id uuid, p_date date default null::date, p_narration text default null::text)
returns uuid
language plpgsql
set search_path to 'public', 'extensions'
as $function$
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

  insert into public.voucher_lines (
    tenant_id, voucher_id, voucher_status, account_id, account_type,
    debit, credit, narration, sort_order, cost_centre_id
  )
  select
    v_tenant_id, v_new_id, 'draft', account_id, account_type,
    credit, debit, narration, sort_order, cost_centre_id
  from public.voucher_lines where voucher_id = p_voucher_id;

  perform public.accounts_post_voucher(v_new_id);
  return v_new_id;
end;
$function$;

-- accounts_record_cash gains the tag. A new trailing parameter would make a
-- second overload and every six-argument call ambiguous, so the old one is
-- dropped and its grants restated.
drop function public.accounts_record_cash(text, uuid, uuid, numeric, date, text);

create function public.accounts_record_cash(
  p_kind text, p_account_id uuid, p_paid_via_id uuid, p_amount numeric, p_on date,
  p_narration text, p_cost_centre_id uuid default null)
returns text
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_session uuid;
  v_account public.accounts;
  v_via     public.accounts;
  v_centre  public.cost_centres;
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

  if p_cost_centre_id is not null then
    select * into v_centre from public.cost_centres c where c.id = p_cost_centre_id;
    if v_centre.id is null then
      raise exception 'That cost centre does not exist.';
    end if;
    if not v_centre.is_active then
      raise exception '% is switched off as a cost centre.', v_centre.name;
    end if;
  end if;

  if public.academics_session_for_date(p_on) is null then
    raise exception 'No academic year covers %. Add it under Academic years first.',
      to_char(p_on, 'FMDD Mon YYYY');
  end if;
  v_session := public.current_session_id(v_tenant);

  insert into public.journal_vouchers (
    tenant_id, session_id, voucher_date, narration, status, source_kind, created_by)
  values (v_tenant, v_session, p_on, btrim(p_narration), 'draft', 'manual', auth.uid())
  returning id into v_id;

  -- The tag goes on the income or expense line only (the CHECK refuses it on
  -- the cash side, and the bank's balance is nobody's activity).
  insert into public.voucher_lines (
    tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order, cost_centre_id)
  values
    (v_tenant, v_id, 'draft',
     case when p_kind = 'expense' then v_account.id else v_via.id end,
     case when p_kind = 'expense' then v_account.account_type else v_via.account_type end,
     p_amount, 0, 1,
     case when p_kind = 'expense' then p_cost_centre_id end),
    (v_tenant, v_id, 'draft',
     case when p_kind = 'expense' then v_via.id else v_account.id end,
     case when p_kind = 'expense' then v_via.account_type else v_account.account_type end,
     0, p_amount, 2,
     case when p_kind = 'income' then p_cost_centre_id end);

  v_number := public.accounts_post_voucher(v_id);
  perform 1 from public.journal_vouchers v where v.id = v_id and v.status = 'posted';
  if not found then
    raise exception 'The voucher could not be posted.';
  end if;
  return v_number;
end;
$function$;

revoke all on function public.accounts_record_cash(text, uuid, uuid, numeric, date, text, uuid) from public, anon;
grant execute on function public.accounts_record_cash(text, uuid, uuid, numeric, date, text, uuid) to authenticated;

-- The report: per cost centre, between two dates, from posted vouchers. A
-- year-end close and its reversal move every income and expense balance to
-- reserves and back, so they are left out exactly as the income statement
-- leaves them out (0313).
create or replace function public.report_cost_centres(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with win as (
    select public.report_param_date(p_params, 'from',
             public.accounts_year_start(public.mobile_today())) as from_on,
           public.report_param_date(p_params, 'to', public.mobile_today()) as to_on
  ),
  moved as (
    select l.cost_centre_id,
           sum(case when l.account_type = 'income' then l.credit - l.debit else 0 end) as income,
           sum(case when l.account_type = 'expense' then l.debit - l.credit else 0 end) as expenditure
    from public.voucher_lines l
    join public.journal_vouchers v on v.id = l.voucher_id
    left join public.journal_vouchers o on o.id = v.reverses_voucher_id
    where v.status = 'posted'
      and v.voucher_date between (select from_on from win) and (select to_on from win)
      and l.account_type in ('income', 'expense')
      and v.source_kind <> 'year_close'
      and coalesce(o.source_kind, '') <> 'year_close'
    group by l.cost_centre_id
  )
  select jsonb_build_object(
           'cost_centre', coalesce(c.code || ' ' || c.name, 'Not assigned'),
           'income', coalesce(m.income, 0),
           'expenditure', coalesce(m.expenditure, 0),
           'surplus', coalesce(m.income, 0) - coalesce(m.expenditure, 0))
  from moved m
  left join public.cost_centres c on c.id = m.cost_centre_id
  order by (c.id is null), c.code, c.id
$$;

revoke all on function public.report_cost_centres(jsonb) from public, anon;
grant execute on function public.report_cost_centres(jsonb) to authenticated;

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values (
  'accounts.cost_centres', 'Income and expenditure by cost centre',
  'For each activity the college tracks (Accounts, Cost centres), what it earned and spent between two dates from posted vouchers, and whether it paid for itself. Lines nobody tagged are "Not assigned". The year-end close is left out.',
  'Accounts', 'accounts.view', 'report_cost_centres',
  '[
     {"name": "from", "type": "date", "label": "From", "required": false},
     {"name": "to", "type": "date", "label": "To", "required": false}
   ]'::jsonb,
  '[
     {"key": "cost_centre", "type": "text", "label": "Cost centre"},
     {"key": "income", "type": "money", "label": "Income", "align": "right"},
     {"key": "expenditure", "type": "money", "label": "Expenditure", "align": "right"},
     {"key": "surplus", "type": "money", "label": "Surplus", "align": "right"}
   ]'::jsonb,
  62, 'staff'
)
on conflict (key) do nothing;

commit;
