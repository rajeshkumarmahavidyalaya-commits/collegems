-- ---------------------------------------------------------------------------
-- Schedules: permissions, three switched-off starters, and the register
-- ---------------------------------------------------------------------------
--
-- **The seeded schedules arrive switched off**, and that is the whole point of
-- seeding them. A school that installs this and finds four hundred parents were
-- texted at half past seven without anybody deciding to has been badly served,
-- however useful the feature is. So the rows exist -- with sensible times, days
-- and grace windows a school can look at and argue with -- and somebody has to
-- turn each one on.
--
-- The grace windows differ on purpose, and the differences are the module's
-- argument in miniature:
--
--   * **Absence, 120 minutes.** A parent told at nine in the evening that their
--     child was absent has had the child at home since four. Late is worse than
--     never.
--   * **Fees, a full day.** A reminder is a reminder whenever it lands.
--   * **Overdue books, a full day.** Likewise.

insert into reference.permissions (code, module, ability, description) values
  ('schedules.view', 'schedules', 'view', 'See what runs automatically and what it did'),
  ('schedules.manage', 'schedules', 'manage', 'Create, edit and switch automatic messages on and off')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('schedules.view'), ('schedules.manage')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'schedules.view'
from public.roles r
where r.code = 'accountant'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- Three starters, switched off
-- ---------------------------------------------------------------------------

insert into public.schedules
  (tenant_id, kind, name, params, run_at, weekdays, grace_minutes, channels, is_enabled)
select
  t.id, 'attendance.absentees', 'Evening absence notice',
  '{}'::jsonb,
  time '19:30',
  array[1, 2, 3, 4, 5, 6]::smallint[],
  120,
  null,
  false
from public.tenants t
on conflict (tenant_id, name) do nothing;

insert into public.schedules
  (tenant_id, kind, name, params, run_at, day_of_month, grace_minutes, channels, is_enabled)
select
  t.id, 'fees.due_reminder', 'Monthly fee reminder',
  jsonb_build_object('min_amount', 1),
  time '10:00',
  5,
  1440,
  null,
  false
from public.tenants t
on conflict (tenant_id, name) do nothing;

insert into public.schedules
  (tenant_id, kind, name, params, run_at, weekdays, grace_minutes, channels, is_enabled)
select
  t.id, 'library.overdue', 'Weekly overdue book reminder',
  jsonb_build_object('min_days_over', 1),
  time '16:00',
  array[1]::smallint[],
  1440,
  null,
  false
from public.tenants t
on conflict (tenant_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- The register, as a catalog report
-- ---------------------------------------------------------------------------
--
-- Rule 11 once more. "What went out automatically last month, and did any of it
-- fail" has parameters, so it is a row rather than a second screen -- the
-- schedules page shows the last few runs beside each schedule; this answers the
-- question across all of them over a range.

create or replace function public.report_schedule_runs(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      s.name as schedule,
      s.kind,
      r.occurrence_at,
      r.status,
      r.matched,
      r.notified,
      -- Minutes between the occurrence and the run actually starting. The
      -- number a person wants when asking why a message landed at nine.
      case
        when r.started_at is null then null
        else (extract(epoch from (r.started_at - r.occurrence_at)) / 60)::integer
      end as minutes_late,
      r.note
    from public.schedule_runs r
    join public.schedules s on s.id = r.schedule_id
    where (
      public.report_param_date(p_params, 'from') is null
      or r.occurrence_at >= (public.report_param_date(p_params, 'from'))::timestamptz
    )
    and (
      public.report_param_date(p_params, 'to') is null
      or r.occurrence_at < ((public.report_param_date(p_params, 'to')) + 1)::timestamptz
    )
    and (
      public.report_param_text(p_params, 'status') is null
      or r.status = public.report_param_text(p_params, 'status')
    )
    order by r.occurrence_at desc
  ) t
$$;

revoke all on function public.report_schedule_runs(jsonb) from public, anon;
grant execute on function public.report_schedule_runs(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'schedules.runs',
    'Automatic message log',
    'Every occurrence of every schedule: what it matched, how many people it told, how late it was, and why it did not run when it did not.',
    'Schedules', 'schedules.view', 'report_schedule_runs',
    '[
      {"name":"from","label":"From","type":"date","required":false},
      {"name":"to","label":"To","type":"date","required":false},
      {"name":"status","label":"Outcome","type":"select","required":false,
       "options":[
         {"value":"done","label":"Ran"},
         {"value":"missed","label":"Missed"},
         {"value":"failed","label":"Failed"},
         {"value":"running","label":"Still running"}]}
    ]'::jsonb,
    '[
      {"key":"schedule","label":"Schedule","type":"text"},
      {"key":"kind","label":"Kind","type":"badge"},
      {"key":"occurrence_at","label":"Due at","type":"datetime"},
      {"key":"status","label":"Outcome","type":"badge"},
      {"key":"matched","label":"Matched","type":"number","align":"right"},
      {"key":"notified","label":"Told","type":"number","align":"right"},
      {"key":"minutes_late","label":"Minutes late","type":"number","align":"right"},
      {"key":"note","label":"Note","type":"text"}
    ]'::jsonb,
    96
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
