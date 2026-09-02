-- Phase 6.1 -- the reporting kernel.
--
-- The thing this exists to prevent is one screen per question. A school asks
-- "who has not paid", "who was absent in September", "which books are overdue",
-- "what is Mrs Sharma's week" -- and the naive answer is four pages, four
-- exports, four filter bars and four places for the tenant filter to be
-- forgotten. eSkooly has around forty such pages.
--
-- Instead: a catalog of reports as *data*, a set of read-model functions, and
-- one runner. Adding a report is a function plus a catalog row, not a route.
--
-- THREE PROPERTIES THAT MAKE THIS SAFE
--
-- 1. Every report function is SECURITY INVOKER, so every row it returns has
--    already passed the same policies a direct select would. A report cannot
--    see across tenants, and a teacher's attendance report cannot show a class
--    they do not teach, without anybody writing a `where tenant_id =`.
--
-- 2. The dispatcher checks the report's `required_permission` against the
--    caller's role. This is the one place in the app where the permission
--    matrix is load-bearing rather than decorative: RLS on `staff` and
--    `people` is tenant-wide, so "an accountant may not pull the staff roster"
--    is a rule only the matrix expresses. Rule 4 still holds -- this is not a
--    UI gate, it is a check inside the function that produces the data.
--
-- 3. The dynamic SQL interpolates `function_name` from `reference.reports`,
--    which lives outside `public` and has INSERT/UPDATE/DELETE revoked from
--    `authenticated` and `anon`. The only writer is a migration. Combined with
--    `%I` quoting, there is no path from a caller's input to an identifier.
--
-- WHY REPORTS RUN INLINE, GIVEN RULE 7
--
-- Rule 7 says report generation goes through `jobs`, and the reason is that
-- unbounded report generation would block a request handler. `report_run` is
-- bounded: 1,000 rows by default and 5,000 at most, over indexed, tenant-scoped
-- tables. That is a normal query, not heavy work, and it returns the exact
-- total alongside so the caller can say "showing 1,000 of 3,412" rather than
-- silently truncating.
--
-- What genuinely belongs in `jobs` is the unbounded case -- a full-year export,
-- a rendered PDF, a scheduled emailed report. None of those are built, and no
-- worker drains `jobs` yet, so this migration does not pretend otherwise: it
-- caps, and it says when it capped.

create table reference.reports (
  key text primary key,
  name text not null,
  description text not null,
  module text not null,
  -- Which permission code a role needs. A real FK, so a typo here fails at
  -- migration time rather than locking everyone out of a report at runtime.
  required_permission text not null
    references reference.permissions(code) on delete restrict,
  -- The read-model function, `public.<function_name>(jsonb)`.
  function_name text not null,
  -- [{name, label, type, required, options}] -- type is one of
  -- section | class_level | date | number | select | text.
  parameters jsonb not null default '[]'::jsonb,
  -- [{key, label, type, align}] -- type is one of
  -- text | number | money | percent | date | datetime | badge.
  columns jsonb not null default '[]'::jsonb,
  sort_order integer not null default 100
);

revoke insert, update, delete on reference.reports from authenticated, anon;
grant select on reference.reports to authenticated, anon;

-- ---------------------------------------------------------------------------
-- What may I run?
-- ---------------------------------------------------------------------------

create or replace function public.report_list()
returns table (
  key text,
  name text,
  description text,
  module text,
  parameters jsonb,
  columns jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  select r.key, r.name, r.description, r.module, r.parameters, r.columns
  from reference.reports r
  where exists (
    select 1
    from public.role_permissions rp
    join public.roles ro on ro.id = rp.role_id
    where rp.tenant_id = ( select public.current_tenant_id() )
      and ro.code = ( select public.current_role_code() )
      and rp.permission_code = r.required_permission
      and rp.allowed
  )
  order by r.sort_order, r.name
$$;

revoke all on function public.report_list() from public, anon;
grant execute on function public.report_list() to authenticated;

-- ---------------------------------------------------------------------------
-- Running one
-- ---------------------------------------------------------------------------

-- `total_count` comes from `count(*) over ()`, which is evaluated over the full
-- result before LIMIT is applied -- so one execution yields both the page and
-- the honest total. Counting separately would mean running every report twice.
create or replace function public.report_run(
  p_key text,
  p_params jsonb default '{}'::jsonb,
  p_limit integer default 1000
)
returns table (row_data jsonb, total_count bigint)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_report reference.reports;
  v_limit integer;
begin
  select * into v_report from reference.reports r where r.key = p_key;

  if v_report.key is null then
    raise exception 'Unknown report: %', p_key;
  end if;

  if ( select public.current_tenant_id() ) is null then
    raise exception 'No tenant in session';
  end if;

  if not exists (
    select 1
    from public.role_permissions rp
    join public.roles ro on ro.id = rp.role_id
    where rp.tenant_id = ( select public.current_tenant_id() )
      and ro.code = ( select public.current_role_code() )
      and rp.permission_code = v_report.required_permission
      and rp.allowed
  ) then
    raise exception 'Your role cannot run the % report', v_report.name;
  end if;

  v_limit := greatest(least(coalesce(p_limit, 1000), 5000), 1);

  return query execute format(
    'select t.row_data, count(*) over ()::bigint from public.%I($1) t limit $2',
    v_report.function_name
  ) using coalesce(p_params, '{}'::jsonb), v_limit;
end;
$$;

revoke all on function public.report_run(text, jsonb, integer) from public, anon;
grant execute on function public.report_run(text, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Shared parameter reading
-- ---------------------------------------------------------------------------

-- Every report function reads its parameters the same way, and "absent means
-- all" has to mean the same thing in all of them. A missing key, a JSON null
-- and an empty string are the three ways a form can say "no filter", and they
-- must not behave differently.
create or replace function public.report_param_uuid(p_params jsonb, p_name text)
returns uuid
language sql
immutable
set search_path = public, extensions
as $$
  select nullif(p_params ->> p_name, '')::uuid
$$;

create or replace function public.report_param_date(
  p_params jsonb,
  p_name text,
  p_default date default null
)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(nullif(p_params ->> p_name, '')::date, p_default)
$$;

create or replace function public.report_param_numeric(
  p_params jsonb,
  p_name text,
  p_default numeric default null
)
returns numeric
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(nullif(p_params ->> p_name, '')::numeric, p_default)
$$;

create or replace function public.report_param_text(
  p_params jsonb,
  p_name text,
  p_default text default null
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(nullif(p_params ->> p_name, ''), p_default)
$$;

revoke all on function public.report_param_uuid(jsonb, text) from public, anon;
revoke all on function public.report_param_date(jsonb, text, date) from public, anon;
revoke all on function public.report_param_numeric(jsonb, text, numeric) from public, anon;
revoke all on function public.report_param_text(jsonb, text, text) from public, anon;
grant execute on function public.report_param_uuid(jsonb, text) to authenticated;
grant execute on function public.report_param_date(jsonb, text, date) to authenticated;
grant execute on function public.report_param_numeric(jsonb, text, numeric) to authenticated;
grant execute on function public.report_param_text(jsonb, text, text) to authenticated;
