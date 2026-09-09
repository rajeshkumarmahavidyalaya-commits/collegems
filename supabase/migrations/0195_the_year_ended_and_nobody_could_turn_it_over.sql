-- 0195 -- The year ended in March and the school is still filing into it.
--
-- `current_session_id()` reads `academic_sessions.is_current` -- a flag. Rule 2
-- says every transactional table carries `session_id`, and rule 12 says a
-- status column is a summary rather than a switch. This is the case where both
-- meet something worse: **the flag is a decision, and no screen in this product
-- can make it.**
--
-- There is no `/academics/sessions`. Nothing in `src/app` writes
-- `academic_sessions` at all -- `promotion` reads the list, `getUserContext`
-- reads the current one, and that is every reference in the application. A
-- school cannot create next year and cannot switch to it.
--
-- Measured on the demo school, on 9 September 2026, with 2025-2026 (1 Apr 2025
-- -- 31 Mar 2026) still flagged current:
--
--   | table              | dated outside their own session |
--   |--------------------|---------------------------------|
--   | attendance_records | 6,000 of 6,000                  |
--   | ledger_entries     |   323 of 323                    |
--   | invoices           |   317 of 317                    |
--   | journal_vouchers   |   274 of 274                    |
--   | homework           |    32 of 32                     |
--   | book_issues        |    25 of 26                     |
--   | stock_movements    |    14 of 14                     |
--   | visitors           |     4 of 4                      |
--   | exams              |     2 of 2                      |
--   | certificates       |     1 of 1                      |
--
-- And the control, which is what makes this a finding rather than a coincidence:
-- `staff_attendance` (765 rows) and `leave_requests` (4) are **clean**. Those
-- are the ones the seed dated with a fixed date inside the year; every table
-- above was dated `current_date - n`. That is exactly what the application
-- does: it dates a row today and stamps it with whichever session holds the
-- flag. The moment the flag is stale, every row is filed in the wrong year --
-- invisible to every report of the year it belongs to, and counted in the year
-- it does not.
--
-- Probed rather than reasoned: `mark_attendance` accepted today's date (five
-- months after the year ended) and also accepted `2024-06-10`, writing 1 row
-- each time, with no error either way.
--
-- ---------------------------------------------------------------------------
-- What this migration does, and the one thing it deliberately does not
--
-- 1. **Sessions may not overlap.** Rule 4's exclusion constraint, and it is
--    load-bearing rather than tidy: the critic below wants to say *"these rows
--    belong to 2026-2027"*, and that sentence only has a meaning if a date
--    falls in at most one year.
-- 2. **A school can turn the year over** -- create, correct and activate a
--    session -- so the critic has a remedy. A check with no way to go green is
--    a check people learn to ignore (rule 1).
-- 3. **A critic names what is filed wrongly**, per table, with the year it
--    should have been in.
--
-- What it does **not** do is repair the 6,000 rows, and the reason is worth
-- writing down because it is not squeamishness:
--
--   > Re-stamping a register row's `session_id` would file it in 2026-2027
--   > while `attendance_records.enrolment_id` still points at a **2025-2026**
--   > enrolment. The row would be consistent with the calendar and inconsistent
--   > with the child's place in the school.
--
-- The register was taken in August 2026 against last year's enrolments because
-- nobody promoted the school into this year. The repair for that is a
-- promotion run, which is a decision with named children in it (rule 13) --
-- not something a migration may do on a school's behalf. So the critic reports
-- and a person acts, which is the `transport_billing_conflicts` answer to the
-- same shape of question.

create extension if not exists btree_gist;

-- Two years that overlap make "which year is this date in" unanswerable, and
-- `current_session_id()` itself ambiguous -- it is a `limit 1` over a flag.
alter table public.academic_sessions
  add constraint academic_sessions_no_overlap
  exclude using gist (
    tenant_id with =,
    daterange(start_date, end_date, '[]') with &&
  );

comment on constraint academic_sessions_no_overlap on public.academic_sessions is
  'Academic years may not overlap. Not tidiness: `academics_session_for_date` '
  'and the filing critic both answer "which year does this date belong to", '
  'and that question needs exactly one answer.';


-- Which year a date falls in, for the whole codebase. `current_session_id` is
-- "which year is the school working in", which is a decision; this is "which
-- year is this date in", which is arithmetic. Conflating them is the bug above.
create or replace function public.academics_session_for_date(p_on date)
returns uuid
language sql
stable
set search_path = public, extensions
as $$
  select s.id
  from public.academic_sessions s
  where p_on between s.start_date and s.end_date
  limit 1
$$;

comment on function public.academics_session_for_date(date) is
  'The academic year containing a date, or null. SECURITY INVOKER, so RLS '
  'scopes it to the caller''s tenant and there is no tenant filter here '
  '(rule 11). Distinct from current_session_id(), which answers a different '
  'question: which year the school has decided it is working in.';

revoke all on function public.academics_session_for_date(date) from public, anon;
grant execute on function public.academics_session_for_date(date) to authenticated;


-- ---------------------------------------------------------------------------
-- Turning the year over.
--
-- All `SECURITY INVOKER`: `admins manage sessions` is the enforcement, and the
-- permission check is here for the message, per the conventions.

create or replace function public.academics_sessions()
returns table (
  id uuid,
  name text,
  start_date date,
  end_date date,
  is_current boolean,
  has_started boolean,
  has_ended boolean,
  enrolments integer,
  sections integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id, s.name, s.start_date, s.end_date, s.is_current,
    (current_date >= s.start_date),
    (current_date > s.end_date),
    ( select count(*)::integer from public.enrolments e
      where e.session_id = s.id and e.status = 'active' ),
    ( select count(*)::integer from public.sections sec where sec.session_id = s.id )
  from public.academic_sessions s
  order by s.start_date desc
$$;

revoke all on function public.academics_sessions() from public, anon;
grant execute on function public.academics_sessions() to authenticated;


create or replace function public.academics_session_create(
  p_name text,
  p_start_date date,
  p_end_date date,
  p_make_current boolean default false
)
returns public.academic_sessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row public.academic_sessions;
  v_clash text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('academics.manage') then
    raise exception 'Your role cannot create an academic year';
  end if;

  if coalesce(length(trim(p_name)), 0) = 0 then
    raise exception 'An academic year needs a name -- 2026-2027, or whatever this school calls it';
  end if;

  if p_end_date <= p_start_date then
    raise exception 'A year has to end after it starts';
  end if;

  begin
    insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
    values (v_tenant_id, trim(p_name), p_start_date, p_end_date, false)
    returning * into v_row;
  exception
    when exclusion_violation then
      -- `23P01` reads "conflicting key value violates exclusion constraint",
      -- which is not something to show a person (rule 4).
      select s.name || ' (' || to_char(s.start_date, 'FMDD Mon YYYY') || ' to '
             || to_char(s.end_date, 'FMDD Mon YYYY') || ')'
      into v_clash
      from public.academic_sessions s
      where daterange(s.start_date, s.end_date, '[]')
            && daterange(p_start_date, p_end_date, '[]')
      limit 1;

      raise exception 'Those dates overlap %. Two years cannot share a day, or no row can say which year it is in.', v_clash;
    when unique_violation then
      raise exception 'This school already has a year called %', trim(p_name);
  end;

  if v_row.id is null then
    raise exception 'You may not create an academic year';
  end if;

  if p_make_current then
    v_row := public.academics_session_activate(v_row.id);
  end if;

  return v_row;
end;
$$;

revoke all on function public.academics_session_create(text, date, date, boolean) from public, anon;
grant execute on function public.academics_session_create(text, date, date, boolean) to authenticated;


create or replace function public.academics_session_activate(p_session_id uuid)
returns public.academic_sessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row public.academic_sessions;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('academics.manage') then
    raise exception 'Your role cannot change the current academic year';
  end if;

  -- Two statements, not one. `academic_sessions_one_current_uk` is a partial
  -- unique index, and a single `set is_current = (id = $1)` can trip it
  -- mid-statement as btree entries are written. Clearing first is not a race:
  -- both statements are in this function's transaction.
  update public.academic_sessions
  set is_current = false
  where tenant_id = v_tenant_id and is_current and id <> p_session_id;

  update public.academic_sessions
  set is_current = true
  where tenant_id = v_tenant_id and id = p_session_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No such academic year, or you may not change it';
  end if;

  return v_row;
end;
$$;

revoke all on function public.academics_session_activate(uuid) from public, anon;
grant execute on function public.academics_session_activate(uuid) to authenticated;


create or replace function public.academics_session_update(
  p_session_id uuid,
  p_name text,
  p_start_date date,
  p_end_date date
)
returns public.academic_sessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row public.academic_sessions;
  v_clash text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('academics.manage') then
    raise exception 'Your role cannot change an academic year';
  end if;

  if p_end_date <= p_start_date then
    raise exception 'A year has to end after it starts';
  end if;

  begin
    -- Moving a year's dates rewrites every child that carries them —
    -- `transport_assignments` and `hostel_allocations` hold
    -- `session_starts_on`/`session_ends_on` inside a composite foreign key with
    -- `on update cascade` (migration 0178). Their `effective_ends_on`
    -- regenerates and their exclusion constraints re-check, so shortening a
    -- year under a bus seat that would then overlap next year's is **refused**.
    -- That refusal is the device working, not a bug — the same shape as
    -- refusing to lower a paper's maximum below a mark already awarded.
    update public.academic_sessions
    set name = trim(p_name), start_date = p_start_date, end_date = p_end_date
    where tenant_id = v_tenant_id and id = p_session_id
    returning * into v_row;
  exception
    when exclusion_violation then
      select s.name into v_clash
      from public.academic_sessions s
      where s.id <> p_session_id
        and daterange(s.start_date, s.end_date, '[]')
            && daterange(p_start_date, p_end_date, '[]')
      limit 1;

      if v_clash is not null then
        raise exception 'Those dates overlap %. Two years cannot share a day.', v_clash;
      end if;

      raise exception 'Those dates cannot be used: an arrangement made for this year -- a bus seat or a hostel bed -- would fall outside it, or would run into the next year.';
    when unique_violation then
      raise exception 'This school already has a year called %', trim(p_name);
  end;

  if v_row.id is null then
    raise exception 'No such academic year, or you may not change it';
  end if;

  return v_row;
end;
$$;

revoke all on function public.academics_session_update(uuid, text, date, date) from public, anon;
grant execute on function public.academics_session_update(uuid, text, date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- The critic.
--
-- `academics_session_problems` already says "the current year has run out".
-- This is the consequence of nobody having acted on that, and it is a separate
-- catalogue row because the remedy is different: that one sends you to a
-- rollover, this one to the year list, and a critic whose message and whose
-- link disagree is one people stop following.
--
-- One `materialized` CTE per table rather than a scalar function per row: the
-- cost of a critic is policy evaluation, not rows (see `docs/performance.md`),
-- so each table is scanned exactly once and the years are joined in.

create or replace function public.academics_filing_problems()
returns table (severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with years as materialized (
    select id, name, start_date, end_date from public.academic_sessions
  ),
  misfiled as (
    select 'register rows'::text as what, r.session_id, r.attendance_date as on_date
    from public.attendance_records r join years y on y.id = r.session_id
    where r.attendance_date < y.start_date or r.attendance_date > y.end_date
    union all
    select 'staff register rows', a.session_id, a.attendance_date
    from public.staff_attendance a join years y on y.id = a.session_id
    where a.attendance_date < y.start_date or a.attendance_date > y.end_date
    union all
    select 'invoices', i.session_id, i.issue_date
    from public.invoices i join years y on y.id = i.session_id
    where i.issue_date < y.start_date or i.issue_date > y.end_date
    union all
    select 'ledger entries', l.session_id, l.occurred_at::date
    from public.ledger_entries l join years y on y.id = l.session_id
    where l.occurred_at::date < y.start_date or l.occurred_at::date > y.end_date
    union all
    select 'journal vouchers', v.session_id, v.voucher_date
    from public.journal_vouchers v join years y on y.id = v.session_id
    where v.voucher_date < y.start_date or v.voucher_date > y.end_date
    union all
    select 'homework', h.session_id, h.assigned_on
    from public.homework h join years y on y.id = h.session_id
    where h.assigned_on < y.start_date or h.assigned_on > y.end_date
    union all
    select 'book issues', b.session_id, b.issued_at::date
    from public.book_issues b join years y on y.id = b.session_id
    where b.issued_at::date < y.start_date or b.issued_at::date > y.end_date
    union all
    select 'stock movements', m.session_id, m.happened_on
    from public.stock_movements m join years y on y.id = m.session_id
    where m.happened_on < y.start_date or m.happened_on > y.end_date
    union all
    select 'exams', e.session_id, e.starts_on
    from public.exams e join years y on y.id = e.session_id
    where e.starts_on < y.start_date or e.ends_on > y.end_date
    union all
    select 'certificates', c.session_id, c.issued_on
    from public.certificates c join years y on y.id = c.session_id
    where c.issued_on < y.start_date or c.issued_on > y.end_date
  ),
  grouped as (
    select
      m.what,
      y.name as filed_under,
      y.end_date as filed_year_ends,
      count(*) as rows_wrong,
      min(m.on_date) as earliest,
      max(m.on_date) as latest
    from misfiled m
    join years y on y.id = m.session_id
    group by m.what, y.name, y.end_date
  )
  select
    'warning'::text,
    format(
      '%s %s %s dated between %s and %s but filed under %s, which ended on %s.%s',
      g.rows_wrong,
      g.what,
      case when g.rows_wrong = 1 then 'is' else 'are' end,
      to_char(g.earliest, 'FMDD Mon YYYY'),
      to_char(g.latest, 'FMDD Mon YYYY'),
      g.filed_under,
      to_char(g.filed_year_ends, 'FMDD Mon YYYY'),
      coalesce(
        ' They belong to ' || ( select y2.name from years y2
                                where g.earliest between y2.start_date and y2.end_date ) || '.',
        ' No year covers those dates.')
    )::text
  from grouped g

  union all

  -- The cause, said once, and only while it is still true. Everything above is
  -- what happened; this is why it keeps happening.
  select
    'warning'::text,
    format(
      'Rows are dated today and stamped with whichever year is current, and %s is current though it ended on %s. %s covers today -- make it current under Academics → Years.',
      cur.name, to_char(cur.end_date, 'FMDD Mon YYYY'), today.name
    )::text
  from public.academic_sessions cur
  join years today on current_date between today.start_date and today.end_date
  where cur.is_current
    and current_date > cur.end_date
    and today.id <> cur.id

  order by 2
$$;

comment on function public.academics_filing_problems() is
  'Rows dated outside the academic year they are stamped with. SECURITY '
  'INVOKER, so a caller sees only their own tenant''s -- and the catalogue '
  'gates it on academics.manage, because this is a critic somebody has to act '
  'on rather than one everybody should read.';

revoke all on function public.academics_filing_problems() from public, anon;
grant execute on function public.academics_filing_problems() to authenticated;

insert into reference.checks
  (key, label, description, function_name, shape, module, href, required_permission, sort, is_active)
values (
  'academics.filing',
  'Rows filed in the wrong year',
  'A register row, an invoice or a receipt dated outside the academic year it is stamped with -- invisible to every report of the year it belongs to, and counted in the year it does not.',
  'academics_filing_problems',
  'severity_message',
  'Academics',
  '/academics/sessions',
  -- `academics.manage`, not a view permission: this critic asks a person to
  -- create a year and move the flag, and rule 4's lesson is that a critic goes
  -- to whoever may act on it rather than to everybody who may read the module.
  'academics.manage',
  15,
  true
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  function_name = excluded.function_name,
  shape = excluded.shape,
  module = excluded.module,
  href = excluded.href,
  required_permission = excluded.required_permission,
  sort = excluded.sort,
  is_active = excluded.is_active;
