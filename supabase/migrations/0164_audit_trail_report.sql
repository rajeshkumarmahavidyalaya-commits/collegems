-- ---------------------------------------------------------------------------
-- Browsing the log: a catalog row, and a permission that is not just RLS again
-- ---------------------------------------------------------------------------
--
-- `audit_history` answers "what happened to *this* row", asked from the row.
-- The other question -- "what did anybody change on Tuesday" -- has parameters
-- a person types and no natural home beside a record, which is rule 11's exact
-- description of a report. So it is a catalog row and there is no new screen.
--
-- THE PERMISSION IS NOT REDUNDANT WITH THE POLICY
--
-- `audit_log`'s RLS already restricts it to administrators, so `audit.view`
-- looks like the same check twice. It is not, and the reason is rule 4's own:
-- the matrix is what lets a school **take the audit trail away from a
-- particular administrator** without touching a policy -- a bursar-admin who
-- runs fee collection but should not be reading the head teacher's edits.
-- Policies express what the schema believes; the matrix expresses what this
-- school decided. Only `admin` gets it seeded, and no other role is offered it,
-- because a non-admin cannot read the table however the matrix is edited.

insert into reference.permissions (code, module, ability, description) values
  ('audit.view', 'settings', 'view', 'Read the audit trail')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'audit.view'
from public.roles r
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- The report
-- ---------------------------------------------------------------------------
--
-- `table` is a plain text parameter rather than a select, and that is a
-- deliberate shrug: a select would carry all 89 audited table names, which is
-- not a list anybody scans, and a curated shortlist would be somebody's guess
-- at which tables matter. The two filters people actually reach for are the
-- date and the person, and neither needs it.
--
-- The `order by` ends in `id` on purpose -- rule 7. Many rows share a
-- `created_at` to the microsecond when one statement writes several, and an
-- export paged over `limit`/`offset` with an unstable order repeats one row and
-- drops another.

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
      (
        select count(*)::integer
        from jsonb_object_keys(public.audit_changed_fields(a.old_data, a.new_data))
      ) as fields_changed,
      (
        select string_agg(k, ', ' order by k)
        from jsonb_object_keys(public.audit_changed_fields(a.old_data, a.new_data)) k
      ) as fields,
      a.row_id
    from public.audit_log a
    -- Rule 11: a `timestamptz` is filtered with `report_day_bounds`, never with
    -- a timestamp built in Node. Vercel runs in UTC and the school does not, so
    -- "changed on the 3rd" has to mean the school's 3rd. Half-open at the top,
    -- which is why the upper bound is `<`.
    cross join lateral public.report_day_bounds(
      coalesce(public.report_param_date(p_params, 'from'), '0001-01-01'::date),
      coalesce(public.report_param_date(p_params, 'to'), '9999-12-31'::date)
    ) b
    where a.created_at >= b.from_ts
      and a.created_at < b.to_ts
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

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'settings.audit_trail',
    'Audit trail',
    'Every insert, update and delete on every audited table, newest first. "System" in the actor column means nobody was signed in -- a seed, a migration or a background job -- which is a different thing from a login that has since been deleted. An update with no fields changed is a write that touched only `updated_at`.',
    'Settings', 'audit.view', 'report_audit_trail',
    '[
      {"name":"from","label":"Changed from","type":"date","required":false},
      {"name":"to","label":"Changed to","type":"date","required":false},
      {"name":"actor","label":"Changed by","type":"staff","required":false},
      {"name":"action","label":"What happened","type":"select","required":false,
       "options":[
         {"value":"insert","label":"Created"},
         {"value":"update","label":"Edited"},
         {"value":"delete","label":"Deleted"}]},
      {"name":"table","label":"Table (exact name, optional)","type":"text","required":false}
    ]'::jsonb,
    '[
      {"key":"changed_at","label":"When","type":"datetime"},
      {"key":"actor","label":"Who","type":"text"},
      {"key":"action","label":"What","type":"badge"},
      {"key":"table_name","label":"Table","type":"text"},
      {"key":"fields_changed","label":"Fields","type":"number","align":"right"},
      {"key":"fields","label":"Changed","type":"text"},
      {"key":"row_id","label":"Row","type":"text"}
    ]'::jsonb,
    98
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  module = excluded.module,
  required_permission = excluded.required_permission,
  function_name = excluded.function_name,
  parameters = excluded.parameters,
  columns = excluded.columns,
  sort_order = excluded.sort_order;
