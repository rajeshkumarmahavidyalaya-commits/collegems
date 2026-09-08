-- ---------------------------------------------------------------------------
-- The report that timed out, and why the index was not the problem
-- ---------------------------------------------------------------------------
--
-- `pg_stat_statements` named it: `report_run` averaging 6.2 seconds, and the
-- audit trail report timing out at sixty. `audit_log` already carries exactly
-- the right index -- `(tenant_id, created_at desc)` -- so the obvious diagnosis
-- was wrong, which is why this was measured rather than guessed.
--
--     Nested Loop
--       Join Filter: ((a.created_at >= b.from_ts) AND (a.created_at < b.to_ts))
--       Rows Removed by Join Filter: 24350
--       ->  Function Scan on report_day_bounds b
--       ->  Materialize
--             ->  Index Scan using audit_log_tenant_idx  (rows=24412)
--                   Index Cond: (tenant_id = ...)
--
-- The date range is a **Join Filter**, not an Index Cond. Sixty-two rows were
-- wanted; 24,412 were read and 24,350 thrown away.
--
--   > A `cross join lateral` makes its result a **relation**, and a relation is
--   > not a constant. The planner cannot push a column of a joined relation
--   > into a btree bound, so the range scan silently degrades to a full scan
--   > plus a filter -- correct, and unboundedly slow.
--
-- Written as scalar subqueries, both bounds become InitPlans -- evaluated once,
-- before the scan -- and land where they belong:
--
--     Index Scan using audit_log_tenant_idx
--       Index Cond: ((tenant_id = (InitPlan 3).col1)
--                    AND (created_at >= (InitPlan 1).col1)
--                    AND (created_at <  (InitPlan 2).col1))
--
--     lateral join       42.3 ms   3,209 buffers
--     scalar subqueries   5.9 ms     277 buffers      -- same 62 rows
--
-- THIS IS RULE `0089` AGAIN, WITH A DIFFERENT SYMPTOM
--
-- CLAUDE.md already says it under Conventions: *"When a value must be singular,
-- write a scalar subquery, not a one-row CTE."* `0089` learned that for
-- **correctness** -- `fees_billable_lines` returned every line three times
-- under `cross join lateral`. This is the same construct costing
-- **performance** instead, and it is the more dangerous half: a wrong number
-- gets reported, a slow query just gets blamed on "the platform".
--
-- Calling `report_day_bounds` twice is deliberate. The timezone logic stays in
-- one function -- what is duplicated is the *call*, and each one is an InitPlan
-- costing a single evaluation. Two cheap InitPlans beat one relation the
-- planner cannot see through.

-- ---------------------------------------------------------------------------
-- The audit trail
-- ---------------------------------------------------------------------------
--
-- Also computed `audit_changed_fields` **twice for every row** -- once for the
-- count and once for the list -- over two whole-row jsonb documents. A lateral
-- is exactly right *here*, because it derives a value from a row that has
-- already been chosen rather than trying to constrain which rows are chosen.
-- Same keyword, opposite job.

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
      public.audit_actor_label(a.actor_id) as actor,
      d.field_count as fields_changed,
      d.field_list as fields,
      a.row_id
    from public.audit_log a
    -- Derived from the row, after it is chosen: one diff instead of two.
    cross join lateral (
      select
        (select count(*)::integer from jsonb_object_keys(changed)) as field_count,
        (select string_agg(k, ', ' order by k) from jsonb_object_keys(changed) k) as field_list
      from public.audit_changed_fields(a.old_data, a.new_data) as changed
    ) d
    -- Scalar subqueries, so the range reaches the index. See the header.
    where a.created_at >= (
      select b.from_ts from public.report_day_bounds(
        coalesce(public.report_param_date(p_params, 'from'), '0001-01-01'::date),
        coalesce(public.report_param_date(p_params, 'to'), '9999-12-31'::date)
      ) b
    )
    and a.created_at < (
      select b.to_ts from public.report_day_bounds(
        coalesce(public.report_param_date(p_params, 'from'), '0001-01-01'::date),
        coalesce(public.report_param_date(p_params, 'to'), '9999-12-31'::date)
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

-- ---------------------------------------------------------------------------
-- The notification log, which had the same shape and would have grown into it
-- ---------------------------------------------------------------------------
--
-- `0044` wrote it the same way. It is fast today only because
-- `notification_deliveries` is small in this tenant; the plan is identical and
-- so is the eventual outcome. Fixed now rather than when somebody reports it.

create or replace function public.report_notification_log(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      d.created_at,
      nt.name as event,
      d.channel,
      coalesce((p.first_name || ' ' || p.last_name), 'Unnamed account') as recipient,
      d.address,
      d.status,
      d.attempts,
      d.last_error,
      d.sent_at,
      (d.read_at is not null) as read
    from public.notification_deliveries d
    join public.notifications n
      on n.tenant_id = d.tenant_id and n.id = d.notification_id
    join reference.notification_types nt on nt.key = n.event_key
    left join public.user_profiles up on up.id = d.recipient_user_id
    left join public.people p on p.id = up.person_id
    where d.created_at >= (
      select b.from_ts from public.report_day_bounds(
        public.report_param_date(p_params, 'from', current_date - 30),
        public.report_param_date(p_params, 'to', current_date)
      ) b
    )
    and d.created_at < (
      select b.to_ts from public.report_day_bounds(
        public.report_param_date(p_params, 'from', current_date - 30),
        public.report_param_date(p_params, 'to', current_date)
      ) b
    )
    and (
      public.report_param_text(p_params, 'status') is null
      or d.status = public.report_param_text(p_params, 'status')
    )
    and (
      public.report_param_text(p_params, 'channel') is null
      or d.channel = public.report_param_text(p_params, 'channel')
    )
    order by d.created_at desc
  ) t
$$;

revoke all on function public.report_notification_log(jsonb) from public, anon;
grant execute on function public.report_notification_log(jsonb) to authenticated;
