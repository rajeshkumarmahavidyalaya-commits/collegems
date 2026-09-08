-- ---------------------------------------------------------------------------
-- The bound that rule 7 promises is on the response, not on the work
-- ---------------------------------------------------------------------------
--
-- `0168` and `0169` took the audit report from timing out to 190 ms **for a
-- filtered query**. Unfiltered it is still 6.2 seconds, and measuring why found
-- something that belongs in the contract rather than in this one report:
--
--     select t.row_data, count(*) over () from report_audit_trail($1) limit 50
--       -> Function Scan ... rows=24412       6,767 ms
--     select t.row_data            from report_audit_trail($1) limit 50
--       -> Function Scan ... rows=24412       6,168 ms
--
-- Removing the window function changed nothing, which rules out the obvious
-- suspect. The cause is one level down:
--
--   > **A set-returning function is an optimisation fence.** `select ... from
--   > report_x($1) limit 50` runs `report_x` to completion and buffers every
--   > row before the Limit sees one. The kernel's `limit`/`offset` bound the
--   > **response**, never the **work**.
--
-- Rule 7 says reports may run inline because they are capped at 1,000 rows.
-- That cap is applied *after* the report function has produced everything
-- matching. For a report over a table that only grows, that is unbounded work
-- in a request handler -- which is the thing rule 7 exists to forbid.
--
-- The scan itself is not the problem. Counting the same 24,412 rows with the
-- projection dropped takes **100 ms**; producing them fully takes 6.2 seconds.
-- The cost is entirely per-row projection, so the only real fix is to produce
-- fewer rows.
--
-- WHAT THIS MIGRATION DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- It gives the report a **declared default window** of seven days. Not a
-- truncation -- rule 13 is explicit that silently returning the first N of M is
-- the worst available outcome -- but a default *parameter*, visible in the same
-- form as every other filter, overridable, and stated in the report's own
-- description. "What changed recently" is the question somebody actually brings
-- to an audit trail; "everything since the school opened" is a question they
-- should have to ask for.
--
-- It does **not** rewrite the reporting kernel to push `limit` inside every
-- report function. That would change the contract every catalog function is
-- written against, for one report that needed it -- and the honest ceiling is
-- unchanged either way, because a true `total_count` requires a full pass
-- whatever the page size. The constraint is now written down in
-- `docs/performance.md` and CLAUDE.md so the next report over an
-- ever-growing table is designed with it in view rather than discovering it.
--
-- One caveat recorded because it is the sort of thing that misleads later: in
-- the demo tenant the whole log was seeded in a single burst on 31 August, so
-- seven days covers 21,576 of the 24,412 rows and this default buys little
-- *there*. In a school where the log accumulates a few hundred rows a day it
-- buys everything. Tuning a default to make one seeded dataset look fast would
-- be measuring the fixture rather than the product.

create or replace function public.report_audit_trail(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      a.created_at as changed_at,
      a.table_name,
      a.action,
      case
        when a.actor_id is null then 'System'
        else coalesce(pe.first_name || ' ' || pe.last_name, 'Deleted login')
      end as actor,
      d.field_count as fields_changed,
      d.field_list as fields,
      a.row_id
    from public.audit_log a
    left join public.user_profiles up on up.id = a.actor_id
    left join public.people pe on pe.id = up.person_id
    cross join lateral (
      select
        (select count(*)::integer from jsonb_object_keys(changed)) as field_count,
        (select string_agg(k, ', ' order by k) from jsonb_object_keys(changed) k) as field_list
      from public.audit_changed_fields(a.old_data, a.new_data) as changed
    ) d
    -- Scalar subqueries so the range reaches the index (0168), and a declared
    -- seven-day default so the common question is a seek rather than a scan.
    where a.created_at >= (
      select b.from_ts from public.report_day_bounds(
        public.report_param_date(p_params, 'from', current_date - 7),
        public.report_param_date(p_params, 'to', current_date)
      ) b
    )
    and a.created_at < (
      select b.to_ts from public.report_day_bounds(
        public.report_param_date(p_params, 'from', current_date - 7),
        public.report_param_date(p_params, 'to', current_date)
      ) b
    )
    and (
      public.report_param_text(p_params, 'table') is null
      or a.table_name = public.report_param_text(p_params, 'table')
    )
    and (
      public.report_param_text(p_params, 'action') is null
      or a.action = public.report_param_text(p_params, 'action')
    )
    and (
      public.report_param_uuid(p_params, 'actor') is null
      or a.actor_id = public.report_param_uuid(p_params, 'actor')
    )
    order by a.created_at desc, a.id desc
  ) t
$$;

revoke all on function public.report_audit_trail(jsonb) from public, anon;
grant execute on function public.report_audit_trail(jsonb) to authenticated;

update reference.reports
set description =
  'Every insert, update and delete on every audited table, newest first. '
  'Covers the last seven days unless you widen the dates -- an audit trail over '
  'a school''s whole history is a slow question and should be an explicit one. '
  '"System" in the actor column means nobody was signed in (a seed, a migration '
  'or a background job), which is a different thing from a login that has since '
  'been deleted. An update with no fields changed is a write that touched only '
  '`updated_at`.'
where key = 'settings.audit_trail';
