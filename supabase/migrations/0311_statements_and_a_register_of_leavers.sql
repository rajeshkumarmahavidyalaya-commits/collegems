-- 0311: the two statements a school's books exist to produce, and a register
-- of the children who have left.
--
-- `docs/modules/accounts.md` listed "no profit-and-loss or balance-sheet
-- statement" as unbuilt, with the reason that the trial balance is the raw
-- material for both. It is, and the chart already carries what the statements
-- need: every account is typed `asset`, `liability`, `equity`, `income` or
-- `expense`. A school does not make a profit, so the first statement is called
-- what an Indian school's auditor calls it: **Income and Expenditure**.
--
-- Both are catalogue reports (rule 11), INVOKER, and read posted vouchers only,
-- so RLS on `voucher_lines` decides who may see the books exactly as it does
-- for the trial balance. Gated on `accounts.view`.
--
-- ## The balance sheet balances without a year-end close
--
-- No financial-year close is built: income and expense are never rolled into
-- `3200 Retained Surplus`. A balance sheet that listed only assets, liabilities
-- and equity would therefore be out by exactly the unclosed surplus, and a
-- statement that does not balance is one nobody trusts. So it carries that
-- figure as its own line under equity -- "Surplus not yet closed into
-- reserves" -- which is both honest and what makes the two totals agree.
--
-- ## Students who have left
--
-- `docs/modules/student-exit.md`: "`alumni` is a status and nothing reads it --
-- no alumni register, no way to find a leaver's old report cards from a name."
-- 0220 made the leaving date and the reason real columns. This is the register:
-- every child no longer on the roll, when and why they left, the last class
-- they were enrolled in, and a link to their record (where the report cards
-- and certificates are). Gated on `students.view`, as the roster is.

begin;

-- The first day of the year a date falls in, by the dates of the years
-- (0195), falling back to 1 April -- an Indian financial year -- when no
-- academic year covers it.
create or replace function public.accounts_year_start(p_on date)
returns date
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select a.start_date from public.academic_sessions a
      where p_on between a.start_date and a.end_date
      order by a.start_date desc limit 1),
    case when extract(month from p_on) >= 4
         then make_date(extract(year from p_on)::int, 4, 1)
         else make_date(extract(year from p_on)::int - 1, 4, 1) end)
$$;

revoke all on function public.accounts_year_start(date) from public, anon;
grant execute on function public.accounts_year_start(date) to authenticated;

-- ---------------------------------------------------------- income & expenditure --

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
    cross join win
    where v.status = 'posted'
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

revoke all on function public.report_income_expenditure(jsonb) from public, anon;
grant execute on function public.report_income_expenditure(jsonb) to authenticated;

-- ------------------------------------------------------------------ balance sheet --

create or replace function public.report_balance_sheet(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with asof as (
    select public.report_param_date(p_params, 'on', public.mobile_today()) as on_day
  ),
  bal as (
    select acc.id, acc.code, acc.name, acc.account_type,
           sum(case when acc.account_type in ('asset', 'expense') then vl.debit - vl.credit
                    else vl.credit - vl.debit end) as amount
    from public.voucher_lines vl
    join public.journal_vouchers v on v.id = vl.voucher_id
    join public.accounts acc on acc.id = vl.account_id
    cross join asof
    where v.status = 'posted' and v.voucher_date <= asof.on_day
    group by acc.id, acc.code, acc.name, acc.account_type
    having sum(vl.debit - vl.credit) <> 0
  ),
  totals as (
    select
      coalesce(sum(amount) filter (where account_type = 'asset'), 0) as assets,
      coalesce(sum(amount) filter (where account_type = 'liability'), 0) as liabilities,
      coalesce(sum(amount) filter (where account_type = 'equity'), 0) as equity,
      coalesce(sum(amount) filter (where account_type = 'income'), 0)
        - coalesce(sum(amount) filter (where account_type = 'expense'), 0) as unclosed
    from bal
  ),
  lines as (
    select 1 as part, code as sort_key, 'Assets' as section, code, name as account, amount, id as account_id
    from bal where account_type = 'asset'
    union all
    select 2, 'zz', 'Assets', null, 'Total assets', assets, null from totals
    union all
    select 3, code, 'Liabilities', code, name, amount, id from bal where account_type = 'liability'
    union all
    select 4, 'zz', 'Liabilities', null, 'Total liabilities', liabilities, null from totals
    union all
    select 5, code, 'Funds and reserves', code, name, amount, id from bal where account_type = 'equity'
    union all
    -- No year-end close is built, so income less expenditure to date has not
    -- been moved into reserves. It is shown as its own line, which is what
    -- makes the two totals agree.
    select 6, 'zz', 'Funds and reserves', null, 'Surplus not yet closed into reserves', unclosed, null
    from totals where unclosed <> 0
    union all
    select 7, 'zz', 'Funds and reserves', null, 'Total funds and reserves', equity + unclosed, null from totals
    union all
    select 8, 'zz', 'Check', null, 'Total liabilities, funds and reserves', liabilities + equity + unclosed, null
    from totals
  )
  select to_jsonb(l) - 'part' - 'sort_key'
  from lines l
  order by l.part, l.sort_key, l.account
$$;

revoke all on function public.report_balance_sheet(jsonb) from public, anon;
grant execute on function public.report_balance_sheet(jsonb) to authenticated;

-- ------------------------------------------------------------------ the leavers --

create or replace function public.report_student_leavers(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t) - 'sort_on'
  from (
    select
      st.date_of_leaving as left_on,
      (p.first_name || ' ' || p.last_name) as student,
      st.admission_number,
      case st.status
        when 'alumni' then 'Completed'
        when 'transferred' then 'Transferred'
        when 'expelled' then 'Expelled'
        when 'inactive' then 'Inactive'
        else st.status end as status,
      (select cl.name || ' ' || sec.name || ' (' || a.name || ')'
         from public.enrolments e
         join public.sections sec on sec.id = e.section_id
         join public.class_levels cl on cl.id = sec.class_level_id
         join public.academic_sessions a on a.id = e.session_id
        where e.student_id = st.id
        order by a.start_date desc
        limit 1) as last_class,
      st.exit_reason as reason,
      st.admission_date,
      st.id as student_id,
      coalesce(st.date_of_leaving, st.updated_at::date) as sort_on
    from public.students st
    join public.people p on p.id = st.person_id
    where st.status <> 'active'
      and coalesce(st.date_of_leaving, st.updated_at::date)
          >= public.report_param_date(p_params, 'from', date '1900-01-01')
      and (public.report_param_text(p_params, 'status', null) is null
           or st.status = public.report_param_text(p_params, 'status', null))
    order by sort_on desc nulls last, p.first_name, p.last_name, st.id
  ) t
$$;

revoke all on function public.report_student_leavers(jsonb) from public, anon;
grant execute on function public.report_student_leavers(jsonb) to authenticated;

-- ---------------------------------------------------------------------- catalogue --

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values
(
  'accounts.income_expenditure', 'Income and expenditure',
  'What the college earned and spent between two dates, account by account from posted vouchers, with the surplus or deficit. For the year so far, set From to the first day of the academic year. Post the day''s fee receipts and payroll to the ledger first, or they are not in it.',
  'Accounts', 'accounts.view', 'report_income_expenditure',
  '[
     {"name": "from", "type": "date", "label": "From", "required": false},
     {"name": "to", "type": "date", "label": "To", "required": false}
   ]'::jsonb,
  '[
     {"key": "section", "type": "text", "label": "Section"},
     {"key": "code", "type": "text", "label": "Code"},
     {"key": "account", "type": "text", "label": "Account", "href": "/accounts/{account_id}"},
     {"key": "amount", "type": "money", "label": "Amount", "align": "right"}
   ]'::jsonb,
  60, 'staff'
),
(
  'accounts.balance_sheet', 'Balance sheet',
  'What the college owns and owes on a day, from posted vouchers. Until a year-end close is built, income less expenditure to date is shown on its own line under funds and reserves, which is what makes the two sides agree.',
  'Accounts', 'accounts.view', 'report_balance_sheet',
  '[
     {"name": "on", "type": "date", "label": "As on", "required": false}
   ]'::jsonb,
  '[
     {"key": "section", "type": "text", "label": "Section"},
     {"key": "code", "type": "text", "label": "Code"},
     {"key": "account", "type": "text", "label": "Account", "href": "/accounts/{account_id}"},
     {"key": "amount", "type": "money", "label": "Amount", "align": "right"}
   ]'::jsonb,
  61, 'staff'
),
(
  'students.leavers', 'Students who have left',
  'Every child no longer on the roll -- completed, transferred, expelled or inactive -- newest first (clear the date to see everybody): when and why they left, the last class they were in, and their record, where their report cards and certificates are kept.',
  'Students', 'students.view', 'report_student_leavers',
  '[
     {"name": "from", "type": "date", "label": "Left since", "required": false},
     {"name": "status", "type": "select", "label": "Status", "required": false,
      "options": [
        {"value": "alumni", "label": "Completed"},
        {"value": "transferred", "label": "Transferred"},
        {"value": "expelled", "label": "Expelled"},
        {"value": "inactive", "label": "Inactive"}
      ]}
   ]'::jsonb,
  '[
     {"key": "left_on", "type": "date", "label": "Left on"},
     {"key": "student", "type": "text", "label": "Student", "href": "/students/{student_id}"},
     {"key": "admission_number", "type": "text", "label": "Adm. no."},
     {"key": "status", "type": "text", "label": "Status"},
     {"key": "last_class", "type": "text", "label": "Last class"},
     {"key": "reason", "type": "text", "label": "Reason"},
     {"key": "admission_date", "type": "date", "label": "Admitted"}
   ]'::jsonb,
  12, 'staff'
)
on conflict (key) do nothing;

commit;
