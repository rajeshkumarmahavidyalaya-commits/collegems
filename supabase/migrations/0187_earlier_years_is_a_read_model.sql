-- 0187 — What a family still owes for a year that has ended.
--
-- Migration 0186 made an arrears receipt land in the year it settles. This is
-- the question that makes one reachable: **which earlier years is this family
-- still short on?**
--
-- It is a function rather than four queries assembled in TypeScript for two
-- reasons, and the second is the one that matters:
--
--   * it is one round trip on the fee counter, the screen a cashier uses all
--     day, instead of four;
--   * and the arithmetic lives beside `fees_student_balances`, which is the
--     only other place that computes what a family owes. Two implementations
--     of "billed, plus the signed ledger, where positive means owes more" are
--     two answers, and this one would be the answer nobody checks.
--
-- `SECURITY INVOKER`, no `where tenant_id =`: RLS decides which invoices and
-- entries are visible, exactly as it does for the current year (rule 11).
--
-- A year that balances to zero is **not returned**. It really is history, and
-- listing it would bury the one year that is not — the same instinct that keeps
-- `academics_session_problems()` quiet once the arrangements exist.

create or replace function public.fees_earlier_years(p_student_id uuid)
returns table (
  session_id uuid,
  session_name text,
  charged numeric,
  movements numeric,
  balance numeric,
  invoice_count integer
)
language sql
stable
set search_path = public, extensions
as $$
  with current_session as (
    select public.current_session_id(public.current_tenant_id()) as id
  ),
  charges as (
    select i.session_id, sum(l.amount) as charged, count(distinct i.id)::integer as invoices
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    cross join current_session cs
    where i.student_id = p_student_id
      and i.status = 'issued'
      and i.session_id is distinct from cs.id
    group by i.session_id
  ),
  moves as (
    select le.session_id, sum(le.amount) as movements
    from public.ledger_entries le
    cross join current_session cs
    where le.student_id = p_student_id
      and le.session_id is distinct from cs.id
    group by le.session_id
  ),
  years as (
    select
      coalesce(c.session_id, m.session_id) as session_id,
      coalesce(c.charged, 0) as charged,
      coalesce(m.movements, 0) as movements,
      coalesce(c.invoices, 0) as invoices
    from charges c
    full join moves m on m.session_id = c.session_id
  )
  select
    y.session_id,
    s.name,
    y.charged,
    y.movements,
    (y.charged + y.movements) as balance,
    y.invoices
  from years y
  join public.academic_sessions s on s.id = y.session_id
  -- Rounded to paise before the comparison: a balance of 0.004 is settled, and
  -- a screen that showed it would be one nobody could act on.
  where abs(round(y.charged + y.movements, 2)) >= 0.01
  order by s.start_date desc
$$;

revoke all on function public.fees_earlier_years(uuid) from public, anon;
grant execute on function public.fees_earlier_years(uuid) to authenticated;

comment on function public.fees_earlier_years(uuid) is
  'Academic years, other than the current one, in which this student still owes '
  'or is owed something. Same arithmetic as fees_student_balances; a settled '
  'year is not returned (migration 0187).';
