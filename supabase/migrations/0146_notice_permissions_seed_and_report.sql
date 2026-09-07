-- ---------------------------------------------------------------------------
-- Notices: permissions, one worked example, and the reach report
-- ---------------------------------------------------------------------------

insert into reference.permissions (code, module, ability, description) values
  ('notices.view', 'notices', 'view', 'Read the notice board'),
  ('notices.manage', 'notices', 'manage', 'Write, publish and withdraw notices')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('notices.view'), ('notices.manage')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- Everybody reads the board. Which notices they see is RLS's business, not the
-- matrix's -- the audience test is in the policy.
insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'notices.view'
from public.roles r
where r.code in ('teacher', 'student', 'parent', 'accountant', 'librarian')
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- One notice, published, so the board is not an empty screen on day one
-- ---------------------------------------------------------------------------
--
-- Published rather than draft, unlike the seeded schedules -- and the
-- difference is the point. A schedule that arrives switched on would text four
-- hundred parents without anybody deciding to; a notice that arrives on the
-- board is a sentence on a page. `announced_count` is set to 1 so that
-- `notice_publish` does not later announce a seeded row to a real school.

insert into public.notices
  (tenant_id, session_id, title, body, audience, category, is_pinned,
   status, published_at, announced_count)
select
  t.id,
  s.id,
  'Welcome to the notice board',
  'Circulars, event announcements and anything else the whole school should '
  'know go here. A notice stays on the board so it can be read again; '
  'publishing it also sends one message, and editing it afterwards does not '
  'send another.' || chr(10) || chr(10) ||
  'You can see who has read each notice, which is the question a board can '
  'answer and a broadcast cannot.',
  '{"kind": "all"}'::jsonb,
  'general',
  false,
  'published',
  now(),
  1
from public.tenants t
join public.academic_sessions s
  on s.tenant_id = t.id and s.is_current
where not exists (
  select 1 from public.notices n
  where n.tenant_id = t.id and n.title = 'Welcome to the notice board'
);

-- ---------------------------------------------------------------------------
-- Reach, as a catalog report
-- ---------------------------------------------------------------------------
--
-- Rule 11. "Which circulars has nobody read" has parameters, so it is a row in
-- the catalog rather than a second screen. `SECURITY INVOKER`, so a teacher
-- running it sees the notices they can see.

create or replace function public.report_notice_reach(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      n.title,
      n.category,
      n.status,
      n.published_at,
      n.is_pinned,
      n.announced_count,
      (select count(*) from public.notice_reads r where r.notice_id = n.id) as read_by,
      (
        select count(*)
        from public.notify_resolve_audience(n.tenant_id, n.audience)
      ) as audience,
      case
        when (select count(*) from public.notify_resolve_audience(n.tenant_id, n.audience)) = 0
          then null
        else round(
          100.0 * (select count(*) from public.notice_reads r where r.notice_id = n.id)
          / (select count(*) from public.notify_resolve_audience(n.tenant_id, n.audience)), 1)
      end as read_percent,
      n.last_announce_error
    from public.notices n
    where (
      public.report_param_date(p_params, 'from') is null
      or n.published_at >= (public.report_param_date(p_params, 'from'))::timestamptz
    )
    and (
      public.report_param_date(p_params, 'to') is null
      or n.published_at < ((public.report_param_date(p_params, 'to')) + 1)::timestamptz
    )
    and (
      public.report_param_text(p_params, 'category') is null
      or n.category = public.report_param_text(p_params, 'category')
    )
    and (
      public.report_param_text(p_params, 'status') is null
      or n.status = public.report_param_text(p_params, 'status')
    )
    -- Least read first: the list is read to find the circular nobody opened.
    order by read_percent nulls first, n.published_at desc nulls last
  ) t
$$;

revoke all on function public.report_notice_reach(jsonb) from public, anon;
grant execute on function public.report_notice_reach(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'notices.reach',
    'Notice reach',
    'Every notice with how many of the people it was for have opened it, least read first. The question a board can answer and a broadcast cannot.',
    'Notices', 'notices.view', 'report_notice_reach',
    '[
      {"name":"from","label":"Published from","type":"date","required":false},
      {"name":"to","label":"Published to","type":"date","required":false},
      {"name":"category","label":"Kind","type":"select","required":false,
       "options":[
         {"value":"general","label":"General"},
         {"value":"circular","label":"Circular"},
         {"value":"event","label":"Event"},
         {"value":"examination","label":"Examination"},
         {"value":"holiday","label":"Holiday"},
         {"value":"urgent","label":"Urgent"}]},
      {"name":"status","label":"Status","type":"select","required":false,
       "options":[
         {"value":"draft","label":"Draft"},
         {"value":"published","label":"Published"},
         {"value":"withdrawn","label":"Withdrawn"}]}
    ]'::jsonb,
    '[
      {"key":"title","label":"Notice","type":"text"},
      {"key":"category","label":"Kind","type":"badge"},
      {"key":"status","label":"Status","type":"badge"},
      {"key":"published_at","label":"Published","type":"datetime"},
      {"key":"audience","label":"For","type":"number","align":"right"},
      {"key":"read_by","label":"Opened by","type":"number","align":"right"},
      {"key":"read_percent","label":"Opened","type":"percent","align":"right"},
      {"key":"announced_count","label":"Announced","type":"number","align":"right"},
      {"key":"last_announce_error","label":"Announcement problem","type":"text"}
    ]'::jsonb,
    97
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
