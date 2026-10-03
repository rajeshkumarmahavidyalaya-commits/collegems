-- 0325: choosing a college is for the super admin.
--
-- 0323 let any login that belonged to several colleges see and switch between
-- them. The product owner's rule (3 Oct 2026): the School Management picker is
-- the super admin's, as in the reference, where only the super admin sees the
-- card per school. Here the super admin is the administrator who manages
-- logins, i.e. whose role holds users.manage in that college -- the same seat
-- that may add a school (school_add).
--
-- * my_schools lists only the colleges the caller administers, so for
--   anybody else the picker is empty and the page says so.
-- * school_switch refuses a college where the caller's role does not hold
--   users.manage, with the same one sentence as every other refusal.
--
-- A teacher, accountant, librarian, parent or student works in the college
-- their login is in and never sees the picker. Membership changes made by the
-- team screen (team_set_access moving somebody off a college they were
-- switched off in) are untouched: that is the college's decision, not a
-- choice the member makes.

begin;

create or replace function public.my_schools()
returns table (
  tenant_id uuid,
  name text,
  slug text,
  phone text,
  email text,
  address text,
  role_name text,
  is_admin boolean,
  is_active boolean,
  plan_status text,
  is_current boolean,
  class_count integer,
  admin_count integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Filtered by the caller's own id, and to the colleges they administer:
  -- choosing a college is the super admin's (0325). Metadata only.
  select
    t.id,
    t.name,
    t.slug,
    nullif(btrim(s.value ->> 'phone'), ''),
    nullif(btrim(s.value ->> 'email'), ''),
    nullif(concat_ws(', ',
      nullif(btrim(s.value ->> 'address_line1'), ''),
      nullif(btrim(s.value ->> 'address_line2'), ''),
      nullif(btrim(s.value ->> 'city'), ''),
      nullif(btrim(s.value ->> 'state'), ''),
      nullif(btrim(s.value ->> 'postal_code'), '')), ''),
    r.name,
    a.admin,
    m.is_active,
    (select sub.status from public.subscriptions sub where sub.tenant_id = t.id order by sub.created_at desc limit 1),
    t.id = public.current_tenant_id(),
    case when a.admin and m.is_active then
      (select count(*) from public.class_levels cl where cl.tenant_id = t.id)::integer end,
    case when a.admin and m.is_active then
      public.logins_that_can_manage_users(t.id, null)::integer end
  from public.school_memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles r on r.id = m.role_id and r.tenant_id = m.tenant_id
  left join public.settings s on s.tenant_id = t.id and s.key = 'school.profile'
  cross join lateral (
    select exists (
      select 1 from public.role_permissions rp
      where rp.role_id = m.role_id and rp.tenant_id = m.tenant_id
        and rp.permission_code = 'users.manage' and rp.allowed
    ) as admin
  ) a
  where m.user_id = auth.uid()
    and a.admin
  order by t.name, t.id
$$;

create or replace function public.school_switch(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  m public.school_memberships;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from platform.operators o where o.user_id = v_uid) then
    raise exception 'This login runs the platform and belongs to no college.' using errcode = 'insufficient_privilege';
  end if;

  select * into m from public.school_memberships where user_id = v_uid and tenant_id = p_tenant_id;
  -- Choosing a college is the super admin's (0325): the membership must be
  -- active and its role must hold users.manage in that college. One sentence
  -- for every refusal.
  if m.id is null or not m.is_active or not exists (
       select 1 from public.role_permissions rp
       where rp.role_id = m.role_id and rp.tenant_id = m.tenant_id
         and rp.permission_code = 'users.manage' and rp.allowed) then
    raise exception 'You cannot open that school with this login.' using errcode = 'insufficient_privilege';
  end if;

  if p_tenant_id is not distinct from public.current_tenant_id() then
    return jsonb_build_object('tenant_id', p_tenant_id, 'refresh_session_required', false);
  end if;

  perform public.membership_activate_profile(v_uid, p_tenant_id);

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'name', (select t.name from public.tenants t where t.id = p_tenant_id),
    'refresh_session_required', true);
end;
$$;

commit;
