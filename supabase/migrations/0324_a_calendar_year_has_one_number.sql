-- 0324: a year that is one calendar year is named with one number.
--
-- `college_create` (0323, from 0205) names a new college's first year
-- `YYYY-YYYY` from its start and end. With the default -- the calendar year --
-- both are the same year, and a college added from School Management on
-- 3 Oct 2026 was shown working in "2026-2026" on every screen. A year that
-- starts and ends in one calendar year is named by that year alone; April to
-- March is still "2026-2027". Only the name changes, and only for colleges
-- founded from now on: an existing year is renamed on the Academic years
-- screen, which is the school's decision.

begin;

create or replace function public.college_create(
  p_school_name text,
  p_slug text,
  p_timezone text,
  p_session_name text,
  p_session_start date,
  p_session_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid; v_session uuid; v_admin_role uuid;
  v_slug text := lower(trim(p_slug));
  v_name text := trim(p_school_name);
  v_start date := coalesce(p_session_start, date_trunc('year', current_date)::date);
  v_end date;
begin
  if v_name is null or v_name = '' then
    raise exception 'A school needs a name.' using errcode = 'check_violation';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'The address may use lower-case letters, numbers and hyphens only, and must be at least three characters.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'The address %.schoolos.app is already taken.', v_slug using errcode = 'unique_violation';
  end if;
  v_end := coalesce(p_session_end, (v_start + interval '1 year' - interval '1 day')::date);
  insert into public.tenants (name, slug, timezone)
  values (v_name, v_slug, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata')) returning id into v_tenant;
  insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
  values (v_tenant, coalesce(nullif(trim(p_session_name), ''),
    case when to_char(v_start,'YYYY') = to_char(v_end,'YYYY') then to_char(v_start,'YYYY')
         else to_char(v_start,'YYYY')||'-'||to_char(v_end,'YYYY') end), v_start, v_end, true)
  returning id into v_session;
  insert into public.roles (tenant_id, code, name, tier) values
    (v_tenant,'admin','Administrator','principal'), (v_tenant,'teacher','Teacher','staff'),
    (v_tenant,'student','Student','student'), (v_tenant,'parent','Parent','student'),
    (v_tenant,'accountant','Accountant','staff'), (v_tenant,'librarian','Librarian','staff');
  select id into v_admin_role from public.roles where tenant_id = v_tenant and code = 'admin';
  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, v_admin_role, code from reference.permissions;
  -- Everybody else starts from the catalogue (0269), never from a list here.
  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, d.permission_code
  from public.roles r
  join reference.role_permission_defaults d on d.role_code = r.code
  where r.tenant_id = v_tenant;
  insert into public.subscriptions (tenant_id, plan_code, status, trial_ends_on)
  values (v_tenant, 'trial', 'trialing', (current_date + 30));
  return jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'session_id', v_session,
    'admin_role_id', v_admin_role, 'trial_ends_on', current_date + 30);
end;
$$;

commit;
