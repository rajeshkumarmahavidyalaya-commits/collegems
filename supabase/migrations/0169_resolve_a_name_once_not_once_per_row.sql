-- ---------------------------------------------------------------------------
-- 520 ms to name sixty-two people, two of whom are the same person
-- ---------------------------------------------------------------------------
--
-- `0168` put the date range back on the index and the audit report went from
-- 2,260 ms to 647 ms. Measuring again rather than declaring victory found where
-- the rest of it was: the same index scan, the same 62 rows, with and without
-- one column.
--
--     select a.id                                     ->   0.65 ms
--     select a.id, public.audit_actor_label(a.actor_id) -> 525 ms
--
-- **8.4 ms per row to look up a name.** `audit_actor_label` is a scalar
-- function with a correlated subquery over `user_profiles` join `people`, and
-- `user_profiles` carries two permissive SELECT policies, each calling
-- `current_tenant_id()` and `current_role_code()`. All of that runs **once per
-- audit row** -- 62 times, to resolve two distinct actors.
--
--   > A scalar function that queries another table is a correlated subquery
--   > wearing a nicer name. In a projection it runs per row, and every RLS
--   > policy on the table it reads runs with it. **Resolve a set as a set:**
--   > join once and let the planner hash it.
--
-- The function stays -- it is exactly right for `settings_effective()`, which
-- calls it seven times over seven rows, and for anything naming a single actor.
-- What changes is that the two places iterating over *many* rows stop using it.
--
-- The semantics are preserved deliberately, including the distinction 0163 was
-- written for: a null `actor_id` is `System` (nobody was signed in), and an
-- `actor_id` with no readable profile is `Deleted login` (somebody was). A left
-- join reproduces both, and collapsing them would undo the point of the column.
--
-- Note what is *not* done here: the `multiple_permissive_policies` on
-- `user_profiles` are left alone. They cost something only because they were
-- being evaluated per row, and this stops that. Rewriting 78 tables' policies
-- to satisfy a linter -- policies being the actual security boundary, per rule
-- 1 -- is a large risk for a cost that measurement says is now gone.

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
    -- Joined, not called per row. See this migration's header.
    left join public.user_profiles up on up.id = a.actor_id
    left join public.people pe on pe.id = up.person_id
    cross join lateral (
      select
        (select count(*)::integer from jsonb_object_keys(changed)) as field_count,
        (select string_agg(k, ', ' order by k) from jsonb_object_keys(changed) k) as field_list
      from public.audit_changed_fields(a.old_data, a.new_data) as changed
    ) d
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

-- The record's own history: capped at 200 rows, so it was never as slow -- but
-- it is the same shape and gets the same treatment, because "it is bounded" is
-- how a 200-row page ends up costing 1.7 seconds.

create or replace function public.audit_history(
  p_table_name text,
  p_row_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  action text,
  actor_id uuid,
  actor text,
  changed_at timestamptz,
  changed_fields jsonb,
  field_count integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.id,
    a.action,
    a.actor_id,
    case
      when a.actor_id is null then 'System'
      else coalesce(pe.first_name || ' ' || pe.last_name, 'Deleted login')
    end,
    a.created_at,
    d.changed,
    (select count(*)::integer from jsonb_object_keys(d.changed))
  from public.audit_log a
  left join public.user_profiles up on up.id = a.actor_id
  left join public.people pe on pe.id = up.person_id
  cross join lateral (
    select public.audit_changed_fields(a.old_data, a.new_data) as changed
  ) d
  where a.table_name = p_table_name
    and a.row_id = p_row_id
  order by a.created_at desc, a.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

revoke all on function public.audit_history(text, uuid, integer) from public, anon;
grant execute on function public.audit_history(text, uuid, integer) to authenticated;

comment on function public.audit_actor_label(uuid) is
  '"System" means there was no signed-in user; "Deleted login" means there was '
  'one and the account is gone. For ONE actor -- it queries `user_profiles`, so '
  'in a projection over many rows it is a correlated subquery run per row, and '
  'costs 8.4 ms each. Over a row set, join instead; see migration 0169.';
