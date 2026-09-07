-- ---------------------------------------------------------------------------
-- Student leave: permissions and the register
-- ---------------------------------------------------------------------------
--
-- The matrix here is unusually interesting, because the four abilities do not
-- line up with seniority:
--
--   * a **parent** and a **student** may `apply` and `view` -- asking is the
--     whole point, and a module a family cannot reach is a module a school ends
--     up running on WhatsApp instead;
--   * a **teacher** may `view` and `decide` but **not** `apply`, because a
--     teacher entering a leave request on a family's behalf and approving it in
--     the same breath is a record with nobody's word behind it;
--   * an **administrator** may do all three, because somebody has to be able to
--     record what a parent said at the gate.
--
-- RLS narrows every one of those to the right rows -- a class teacher decides
-- only for their own section, a guardian applies only for their own children --
-- so the matrix here decides *who may ask the question at all* and the policies
-- decide *about whom*. Rule 4, both layers, doing different work.

insert into reference.permissions (code, module, ability, description) values
  ('leave.view', 'attendance', 'view', 'See student leave requests'),
  ('leave.apply', 'attendance', 'apply', 'Ask for leave on behalf of a student'),
  ('leave.decide', 'attendance', 'decide', 'Approve or refuse student leave')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('leave.view'), ('leave.apply'), ('leave.decide')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('leave.view'), ('leave.decide')) as p(code)
where r.code = 'teacher'
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('leave.view'), ('leave.apply')) as p(code)
where r.code in ('parent', 'student')
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- The register, as a catalog report
-- ---------------------------------------------------------------------------
--
-- Waiting ones first: the list is read to find the requests nobody has decided
-- yet, which is the only part of it that is anybody's job today.

create or replace function public.report_student_leave(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      st.admission_number,
      (p.first_name || ' ' || p.last_name)::text as student,
      (cl.name || ' ' || sec.name)::text as section,
      l.starts_on,
      l.ends_on,
      (l.ends_on - l.starts_on + 1) as days,
      l.kind,
      l.reason,
      l.status,
      l.decision_note
    from public.student_leave_requests l
    join public.students st on st.id = l.student_id
    join public.people p on p.id = st.person_id
    left join public.enrolments en
      on en.student_id = l.student_id and en.session_id = l.session_id and en.status = 'active'
    left join public.sections sec on sec.id = en.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    where (
      -- Overlap, not containment: a request from the 1st to the 10th is part of
      -- "what happened this week" for any week it touches. Asking whether it
      -- *starts* in the range would hide a fortnight's illness from the report
      -- about its second week.
      public.report_param_date(p_params, 'from') is null
      or l.ends_on >= public.report_param_date(p_params, 'from')
    )
    and (
      public.report_param_date(p_params, 'to') is null
      or l.starts_on <= public.report_param_date(p_params, 'to')
    )
    and (
      public.report_param_uuid(p_params, 'section') is null
      or en.section_id = public.report_param_uuid(p_params, 'section')
    )
    and (
      public.report_param_text(p_params, 'status') is null
      or l.status = public.report_param_text(p_params, 'status')
    )
    order by
      case l.status when 'pending' then 0 else 1 end,
      l.starts_on desc
  ) t
$$;

revoke all on function public.report_student_leave(jsonb) from public, anon;
grant execute on function public.report_student_leave(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'attendance.student_leave',
    'Student leave',
    'Leave asked for and decided, waiting ones first. A child on approved leave is still marked absent in the register -- the register is what a teacher observed -- but their family is not texted about it again.',
    'Attendance', 'leave.view', 'report_student_leave',
    '[
      {"name":"from","label":"Covering from","type":"date","required":false},
      {"name":"to","label":"Covering to","type":"date","required":false},
      {"name":"section","label":"Class","type":"section","required":false},
      {"name":"status","label":"Status","type":"select","required":false,
       "options":[
         {"value":"pending","label":"Waiting"},
         {"value":"approved","label":"Approved"},
         {"value":"refused","label":"Refused"},
         {"value":"cancelled","label":"Cancelled"}]}
    ]'::jsonb,
    '[
      {"key":"admission_number","label":"Adm. no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"section","label":"Class","type":"text"},
      {"key":"starts_on","label":"From","type":"date"},
      {"key":"ends_on","label":"To","type":"date"},
      {"key":"days","label":"Days","type":"number","align":"right"},
      {"key":"kind","label":"Kind","type":"badge"},
      {"key":"status","label":"Status","type":"badge"},
      {"key":"reason","label":"Reason","type":"text"},
      {"key":"decision_note","label":"Note","type":"text"}
    ]'::jsonb,
    35
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
