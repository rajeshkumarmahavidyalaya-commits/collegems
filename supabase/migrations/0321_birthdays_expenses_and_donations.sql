-- 0321: Student Birthdays, Expenses and Donation -- three of the reference's
-- pages, built on what this database already records.
--
-- ## Birthdays
--
-- student_birthdays(from, to) lists the active students whose birthday falls
-- in a range, soonest first. A birthday is a month and a day, so a range that
-- crosses the new year (25 Dec to 5 Jan) is two ranges, and 29 February falls
-- on 28 February in a year that has none. INVOKER: what the caller may read of
-- students and people is what they are shown, so a family sees their own child.
-- Bounded by the range, which must be shorter than a year.
--
-- ## Expenses and Donation
--
-- accounts_record_cash (0297) already posts an expense or an income as a
-- two-line voucher, gated on accounts.post. The reference records more about
-- each one -- a title, who it was paid to or received from, their invoice
-- number, a note -- and the voucher has only a narration, so those go in
-- cash_entry_details, one row per voucher. accounts_record_cash_entry posts
-- through accounts_record_cash and writes the details in the same
-- transaction, so there is still one way money reaches the books.
-- accounts_cash_entries lists them for the two screens.
--
-- Only accountants and administrators hold accounts.view and accounts.post on
-- the default matrix, so the details are gated on those, like the vouchers.

begin;

-- --------------------------------------------------------------- birthdays --

create or replace function public.student_birthdays(p_from date, p_to date)
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  class_name text,
  section_name text,
  phone text,
  email text,
  date_of_birth date,
  next_birthday date,
  turns integer
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date.';
  end if;
  -- Under a year, so a birthday can fall in the range at most once.
  if p_to >= (p_from + interval '1 year')::date then
    raise exception 'Choose a range shorter than a year.';
  end if;
  v_session := public.current_session_id(v_tenant);

  return query
  with s as (
    select st.id, st.admission_number,
           trim(both ' ' from p.first_name || ' ' || coalesce(p.middle_name || ' ', '') || coalesce(p.last_name, '')) as full_name,
           p.phone, p.email::text as email, p.date_of_birth
    from public.students st
    join public.people p on p.id = st.person_id
    where st.status = 'active' and p.date_of_birth is not null
  ),
  b as (
    -- The birthday in the range's first year and in the next; one of them is
    -- the next occurrence on or after p_from. make_date cannot make 29 Feb in
    -- a common year, so that birthday is kept on 28 Feb there.
    select s.*, y.yr,
           make_date(y.yr, extract(month from s.date_of_birth)::int,
             least(extract(day from s.date_of_birth)::int,
                   extract(day from (make_date(y.yr, extract(month from s.date_of_birth)::int, 1)
                                     + interval '1 month - 1 day'))::int)) as on_day
    from s
    cross join (values (extract(year from p_from)::int), (extract(year from p_from)::int + 1)) as y(yr)
  )
  select b.id, b.admission_number, b.full_name,
         (select cl.name from public.enrolments e
            join public.sections sec on sec.id = e.section_id
            join public.class_levels cl on cl.id = sec.class_level_id
          where e.student_id = b.id and e.session_id = v_session and e.status = 'active' limit 1),
         (select sec.name from public.enrolments e
            join public.sections sec on sec.id = e.section_id
          where e.student_id = b.id and e.session_id = v_session and e.status = 'active' limit 1),
         b.phone, b.email, b.date_of_birth, b.on_day,
         (extract(year from b.on_day) - extract(year from b.date_of_birth))::int
  from b
  where b.on_day between p_from and p_to
  order by b.on_day, b.full_name, b.id;
end;
$$;

comment on function public.student_birthdays(date, date) is
  'Active students whose birthday falls between two dates, soonest first, with the age they turn (0321). INVOKER; under a year.';

revoke all on function public.student_birthdays(date, date) from public, anon;
grant execute on function public.student_birthdays(date, date) to authenticated;

-- ------------------------------------------------------ expenses and donation

create table public.cash_entry_details (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_id uuid not null,
  kind text not null check (kind in ('expense', 'income')),
  title text not null,
  party_name text,
  invoice_number text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_entry_details_title_chk check (length(btrim(title)) between 2 and 160),
  constraint cash_entry_details_party_chk check (party_name is null or length(party_name) <= 160),
  constraint cash_entry_details_invoice_chk check (invoice_number is null or length(invoice_number) <= 60),
  constraint cash_entry_details_note_chk check (note is null or length(note) <= 2000),
  unique (tenant_id, voucher_id),
  constraint cash_entry_details_voucher_fkey
    foreign key (tenant_id, voucher_id)
    references public.journal_vouchers (tenant_id, id) on delete cascade
);

create index cash_entry_details_kind_idx on public.cash_entry_details (tenant_id, kind);
create index cash_entry_details_creator_idx on public.cash_entry_details (created_by);

create trigger set_updated_at before update on public.cash_entry_details
  for each row execute function public.set_updated_at();
create trigger audit_cash_entry_details
  after insert or update or delete on public.cash_entry_details
  for each row execute function public.audit_row_change();

alter table public.cash_entry_details enable row level security;

create policy "accounts view cash_entry_details" on public.cash_entry_details
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.role_has_permission('accounts.view')));

create policy "accounts post cash_entry_details" on public.cash_entry_details
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.role_has_permission('accounts.post')));

-- The voucher is the record and is immutable once posted; so are its details.
-- A correction is a reversing voucher, as everywhere in the books.

create or replace function public.accounts_record_cash_entry(
  p_kind text,
  p_account_id uuid,
  p_paid_via_id uuid,
  p_amount numeric,
  p_on date,
  p_title text,
  p_party_name text default null,
  p_invoice_number text default null,
  p_note text default null
)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_party text := nullif(btrim(coalesce(p_party_name, '')), '');
  v_number text;
  v_voucher uuid;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if length(v_title) < 2 then
    raise exception 'Give it a title.';
  end if;

  -- One way money reaches the books: accounts_record_cash checks the
  -- permission, the accounts, the amount and the date, and posts.
  v_number := public.accounts_record_cash(
    p_kind, p_account_id, p_paid_via_id, p_amount, p_on,
    v_title || coalesce(case when p_kind = 'expense' then ' -- paid to ' else ' -- from ' end || v_party, ''));

  select v.id into v_voucher
  from public.journal_vouchers v
  where v.tenant_id = v_tenant and v.voucher_number = v_number
    and v.session_id = public.current_session_id(v_tenant)
    and v.created_by = auth.uid()
  order by v.created_at desc
  limit 1;
  if v_voucher is null then
    raise exception 'The voucher was posted but could not be found to attach its details.';
  end if;

  insert into public.cash_entry_details (tenant_id, voucher_id, kind, title, party_name, invoice_number, note, created_by)
  values (v_tenant, v_voucher, p_kind, v_title, v_party,
          nullif(btrim(coalesce(p_invoice_number, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''),
          auth.uid());
  -- No row-count branch here: an INSERT whose WITH CHECK fails raises rather
  -- than writing nothing (0257), and accounts_record_cash has already refused
  -- a caller without accounts.post in a sentence.
  return v_number;
end;
$$;

comment on function public.accounts_record_cash_entry(text, uuid, uuid, numeric, date, text, text, text, text) is
  'An expense or a donation with the reference''s details: posts through accounts_record_cash and records title, party, invoice number and note beside the voucher (0321). INVOKER.';

revoke all on function public.accounts_record_cash_entry(text, uuid, uuid, numeric, date, text, text, text, text) from public, anon;
grant execute on function public.accounts_record_cash_entry(text, uuid, uuid, numeric, date, text, text, text, text) to authenticated;

create or replace function public.accounts_cash_entries(p_kind text, p_from date, p_to date)
returns table (
  voucher_id uuid,
  voucher_number text,
  entry_date date,
  title text,
  category text,
  party_name text,
  amount numeric,
  invoice_number text,
  note text,
  status text
)
language sql
stable
set search_path = public, extensions
as $$
  select v.id, v.voucher_number, v.voucher_date, d.title, a.name, d.party_name,
         l.amount, d.invoice_number, d.note, v.status
  from public.cash_entry_details d
  join public.journal_vouchers v on v.id = d.voucher_id
  -- The category is the line on the expense or income account.
  cross join lateral (
    select vl.account_id, greatest(vl.debit, vl.credit) as amount
    from public.voucher_lines vl
    where vl.voucher_id = v.id and vl.account_type = d.kind
    order by vl.sort_order
    limit 1
  ) l
  join public.accounts a on a.id = l.account_id
  where d.kind = p_kind
    and v.voucher_date between coalesce(p_from, date '1900-01-01') and coalesce(p_to, date '2999-12-31')
  order by v.voucher_date desc, v.voucher_number desc
$$;

comment on function public.accounts_cash_entries(text, date, date) is
  'Expenses or donations recorded through accounts_record_cash_entry, newest first, between two dates (0321). INVOKER; the voucher and detail policies decide.';

revoke all on function public.accounts_cash_entries(text, date, date) from public, anon;
grant execute on function public.accounts_cash_entries(text, date, date) to authenticated;

commit;
