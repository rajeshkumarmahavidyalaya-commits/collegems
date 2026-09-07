-- ---------------------------------------------------------------------------
-- A report can be read in pages
-- ---------------------------------------------------------------------------
--
-- Rule 7 has listed "full exports" as unbuilt `jobs` work since the reporting
-- kernel shipped, and the reason was never really the size of the answer -- it
-- was **who runs it**. A queued export has no user: `report_run` gates on
-- `role_permissions` for `current_role_code()`, so a worker draining a queue
-- has no role and cannot run a report at all. Every way round that ends in
-- inventing a service identity, and rule 7's own note on scheduled reports
-- already refuses to do that quietly.
--
-- The way through is to notice that a *person asking for an export is present
-- while it runs*. That is not true of a scheduled report and it changes
-- everything:
--
-- > **A long export is the browser's job, not the server's.** The server
-- > answers bounded pages as the person who asked; the client assembles them.
-- > RLS stays the only gate, no service identity is invented, and progress and
-- > cancellation come free.
--
-- So `report_run` gains an offset. That is the whole database change: the same
-- permission check, the same cap per call, the same `total_count` alongside --
-- a caller can now ask for the second five thousand.
--
-- WHY THE ORDER BY IN EACH READ MODEL IS NOW LOAD-BEARING
--
-- Paging with `limit`/`offset` over an unordered query returns an arbitrary
-- and possibly overlapping slice each time, so an export could contain one row
-- twice and miss another. Every catalogue read model already ends in an
-- `order by` -- they were written to put the useful row first -- so this is a
-- property the codebase has rather than one it needs to acquire. It is now
-- also a requirement, and this comment is where somebody writing the
-- seventeenth report is told so.
--
-- A tie in that ordering is still a tie: two rows with the same sort key may
-- swap between pages. Every read model here sorts on something with a
-- practical tiebreak (a name, a serial, a date plus a class), which is why
-- this is a comment and not an added `, id` on sixteen functions -- but a new
-- report that sorts on a single low-cardinality column should add one.

create or replace function public.report_run(
  p_key text,
  p_params jsonb default '{}'::jsonb,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns table (row_data jsonb, total_count bigint)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_report reference.reports;
  v_limit integer;
  v_offset integer;
begin
  select * into v_report from reference.reports r where r.key = p_key;

  if v_report.key is null then
    raise exception 'Unknown report: %', p_key;
  end if;

  if ( select public.current_tenant_id() ) is null then
    raise exception 'No tenant in session';
  end if;

  -- Unchanged, and still the only authorization here. An export is the same
  -- report run more than once; it is not a second door into it.
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
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query execute format(
    'select t.row_data, count(*) over ()::bigint from public.%I($1) t limit $2 offset $3',
    v_report.function_name
  ) using coalesce(p_params, '{}'::jsonb), v_limit, v_offset;
end;
$$;

revoke all on function public.report_run(text, jsonb, integer, integer) from public, anon;
grant execute on function public.report_run(text, jsonb, integer, integer) to authenticated;

comment on function public.report_run(text, jsonb, integer, integer) is
  'Runs a catalogue report for the caller, checking their role against the '
  'report''s required permission. Capped at 5,000 rows a call and returns the '
  'true total alongside, so a caller can page through a larger answer -- which '
  'is how a full export is done, by the browser, as the person who asked.';

-- ---------------------------------------------------------------------------
-- ...and the three-argument form goes
-- ---------------------------------------------------------------------------
--
-- `create or replace` with a fourth parameter makes a *new* function and leaves
-- the old three-argument one in place -- two bodies, and the second one is
-- where the permission check quietly stops being updated. `p_offset` has a
-- default, so the four-argument function answers a three-argument call
-- unchanged, and every existing caller keeps working without a second copy of
-- the gate.

drop function if exists public.report_run(text, jsonb, integer);
