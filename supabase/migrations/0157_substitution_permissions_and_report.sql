-- ---------------------------------------------------------------------------
-- Substitutions: permissions, and the record of who actually stood in
-- ---------------------------------------------------------------------------
--
-- Two abilities, and the split is the same one the leave module made: seeing
-- the roster is not the same as writing it.
--
--   * `substitutions.view` -- a **teacher** needs this, because the roster is a
--     thing that happens *to* them. Finding out at 9:05 that you are covering
--     Grade 6 in period 3 is how a paper roster fails, and RLS on
--     `timetable_entries` already lets a teacher read the timetable, so there
--     is nothing here to hide.
--   * `substitutions.manage` -- an **administrator** only. Arranging cover is
--     spending somebody else's free period; a teacher assigning themselves out
--     of a duty, or a colleague into one, is not a decision the person holding
--     the timetable would accept.
--
-- Note what is *not* here: no `substitutions.decide`, because there is nothing
-- to consent to. Cover is directed, not requested -- and pretending otherwise
-- would mean a class with nobody in front of it while an approval sits unread.

insert into reference.permissions (code, module, ability, description) values
  ('substitutions.view', 'timetable', 'view', 'See the cover roster'),
  ('substitutions.manage', 'timetable', 'manage', 'Arrange and clear cover')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('substitutions.view'), ('substitutions.manage')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'substitutions.view'
from public.roles r
where r.code = 'teacher'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- The record, as a catalog report
-- ---------------------------------------------------------------------------
--
-- `substitution_gaps` answers "what about this morning"; this answers "how much
-- cover did we do last term, and who carried it". They are different questions
-- and the second one is the one that settles an argument in a staff meeting --
-- so it counts covers *per person*, including the ones nobody was given.
--
-- Every column is read off the substitution row rather than the live lesson.
-- That is deliberate and it is migration 0155's whole point: `absent_staff_id`
-- and `time_slot_id` are frozen at arrangement, so a timetable edited in
-- February cannot rewrite what November's roster said.

create or replace function public.report_substitutions(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      s.on_date,
      ts.period_number,
      coalesce(cl.name || ' ' || sec.name, '--')::text as section,
      coalesce(sub.name, '--')::text as subject,
      (ap.first_name || ' ' || ap.last_name)::text as absent_teacher,
      coalesce((sp.first_name || ' ' || sp.last_name), 'Nobody -- merged or supervised')::text
        as substitute,
      s.note
    from public.substitutions s
    join public.time_slots ts on ts.id = s.time_slot_id
    join public.staff ast on ast.id = s.absent_staff_id
    join public.people ap on ap.id = ast.person_id
    left join public.staff sst on sst.id = s.substitute_staff_id
    left join public.people sp on sp.id = sst.person_id
    -- The lesson is joined for its labels only, and it may since have been
    -- deleted. A cover that happened is still a cover that happened, so this is
    -- a left join and the labels fall back to a dash.
    left join public.timetable_entries e on e.id = s.timetable_entry_id
    left join public.sections sec on sec.id = e.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    left join public.subjects sub on sub.id = e.subject_id
    where (
      public.report_param_date(p_params, 'from') is null
      or s.on_date >= public.report_param_date(p_params, 'from')
    )
    and (
      public.report_param_date(p_params, 'to') is null
      or s.on_date <= public.report_param_date(p_params, 'to')
    )
    and (
      public.report_param_uuid(p_params, 'staff') is null
      -- Either side of the arrangement: "show me Priya's term" means both the
      -- days she was away and the days she covered for somebody else.
      or s.absent_staff_id = public.report_param_uuid(p_params, 'staff')
      or s.substitute_staff_id = public.report_param_uuid(p_params, 'staff')
    )
    -- Rule 7: paging with limit/offset over an unordered query returns an
    -- arbitrary slice, so the tiebreak down to the period is part of the
    -- contract, not a nicety.
    order by s.on_date desc, ts.period_number, section
  ) t
$$;

revoke all on function public.report_substitutions(jsonb) from public, anon;
grant execute on function public.report_substitutions(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'timetable.substitutions',
    'Cover arranged',
    'Every lesson somebody stood in for, read off the arrangement rather than the live timetable -- so a routine edited later cannot rewrite what happened. A blank substitute means the class was merged or supervised, which is a decision, not a gap.',
    'Timetable', 'substitutions.view', 'report_substitutions',
    '[
      {"name":"from","label":"Covering from","type":"date","required":false},
      {"name":"to","label":"Covering to","type":"date","required":false},
      {"name":"staff","label":"Teacher (away or covering)","type":"staff","required":false}
    ]'::jsonb,
    '[
      {"key":"on_date","label":"Date","type":"date"},
      {"key":"period_number","label":"Period","type":"number","align":"right"},
      {"key":"section","label":"Class","type":"text"},
      {"key":"subject","label":"Subject","type":"text"},
      {"key":"absent_teacher","label":"Away","type":"text"},
      {"key":"substitute","label":"Covered by","type":"text"},
      {"key":"note","label":"Note","type":"text"}
    ]'::jsonb,
    71
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
