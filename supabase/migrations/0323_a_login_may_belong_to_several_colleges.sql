-- 0323: a login may belong to several colleges, and the first page picks one.
--
-- The reference opens on a School Management dashboard: a card per school,
-- the current one highlighted, and choosing a card makes it the school the
-- rest of the product works in. Until now a login had exactly one college --
-- `user_profiles.id` is the auth user, and the tenant and role live in the
-- token -- and `platform_start_school` refused anybody who already had one
-- ("one school per login comes free", rule 3). This changes that rule,
-- deliberately, and keeps the one that matters:
--
-- > **A token carries one college at a time.** Every policy still reads the
-- > tenant from the JWT, so a person who belongs to two colleges sees exactly
-- > one of them on every request. Switching is a write and a token refresh,
-- > never a wider read.
--
-- ## Shape
--
-- * `school_memberships` is the record of every college a login belongs to:
--   one row per (college, login), carrying what `user_profiles` carries -- the
--   role and the person, student, staff or guardian record it acts as there.
-- * `user_profiles` stays one row per login and is the ACTIVE membership.
--   None of the 94 policies and 56 functions that read it changes. A trigger
--   keeps the active membership in step with every existing writer of the
--   profile (sign-up, start a school, the team screen, the leaver trigger),
--   so there is no second place anybody has to remember.
-- * `school_switch(college)` copies a membership into the profile and the
--   token's `app_metadata`. It refuses a college the caller does not belong
--   to, or was switched off in, with one sentence.
-- * `my_schools()` lists the caller's own colleges for the picker: names and
--   contact details, the caller's role there, and -- only where the caller
--   administers that college -- how many classes and administrators it has.
--   It is a definer filtered by `auth.uid()`, the one read model that crosses
--   tenants, and it projects metadata only: no student, guardian, invoice or
--   mark is in it (0209's rule for the operator console, applied here).
-- * `school_add(...)` is the reference's "Add New School": an administrator
--   of their current college founds another and becomes its administrator.
--   It and `platform_start_school` share `college_create`, so there is one
--   definition of what a new college is given.
--
-- ## The team screen of a college the person is not in today
--
-- A college's administrators must still see and control a member who is
-- currently working in another college -- otherwise a leaver could switch
-- back in. So `team_logins`, `logins_that_can_manage_users` and the leaver
-- trigger read memberships, and two new doors replace the old ones:
--
-- * `team_set_access` switches a membership off. If the person belongs to
--   another active college, their login is NOT banned -- that would lock them
--   out of a college that did not decide it -- and if this college was their
--   active one, their profile moves to the other. Only a person with no other
--   active college gets 0289's full close (ban, sessions ended).
-- * `team_set_role` changes the role of a membership, through 0289's
--   `login_set_role` when it is the active one.
--
-- `login_set_access` and `login_set_role` are revoked from JWT roles: called
-- directly they act on the profile alone and would ban a person everywhere.
-- An access token already issued stays valid until it expires, the limit
-- 0289 already states.
--
-- Operators still belong to no college (0209): they cannot switch into, add
-- or own one.

begin;

-- ---------------------------------------------------------------- the table

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  person_id uuid references public.people(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  guardian_id uuid references public.guardians(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index school_memberships_user_idx on public.school_memberships (user_id);

create trigger set_updated_at before update on public.school_memberships
  for each row execute function public.set_updated_at();
create trigger audit_school_memberships
  after insert or update or delete on public.school_memberships
  for each row execute function public.audit_row_change();

alter table public.school_memberships enable row level security;

-- Read only. Every write is a definer below: the sync trigger, the switch,
-- the team doors and `school_add`. A member may read their own row here; the
-- list of their other colleges is `my_schools()`, because a policy can only
-- see the college in the token.
create policy "members view own membership" on public.school_memberships
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and user_id = (select auth.uid()));

create policy "user managers view tenant memberships" on public.school_memberships
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.role_has_permission('users.manage')));

comment on table public.school_memberships is
  'Every college a login belongs to, with its role and record there (0323). user_profiles is the active one; school_switch moves between them.';

-- --------------------------------------------- the profile keeps its membership

create or replace function public.user_profiles_keep_membership()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.school_memberships
    (tenant_id, user_id, role_id, person_id, student_id, staff_id, guardian_id, is_active)
  values
    (new.tenant_id, new.id, new.role_id, new.person_id, new.student_id, new.staff_id, new.guardian_id, new.is_active)
  on conflict (tenant_id, user_id) do update
    set role_id = excluded.role_id,
        person_id = excluded.person_id,
        student_id = excluded.student_id,
        staff_id = excluded.staff_id,
        guardian_id = excluded.guardian_id,
        is_active = excluded.is_active
    where (school_memberships.role_id, school_memberships.person_id, school_memberships.student_id,
           school_memberships.staff_id, school_memberships.guardian_id, school_memberships.is_active)
          is distinct from
          (excluded.role_id, excluded.person_id, excluded.student_id,
           excluded.staff_id, excluded.guardian_id, excluded.is_active);
  return null;
end;
$$;

revoke all on function public.user_profiles_keep_membership() from public, anon, authenticated;

create trigger user_profiles_keep_membership
  after insert or update of tenant_id, role_id, person_id, student_id, staff_id, guardian_id, is_active
  on public.user_profiles
  for each row execute function public.user_profiles_keep_membership();

insert into public.school_memberships
  (tenant_id, user_id, role_id, person_id, student_id, staff_id, guardian_id, is_active)
select up.tenant_id, up.id, up.role_id, up.person_id, up.student_id, up.staff_id, up.guardian_id, up.is_active
from public.user_profiles up
on conflict (tenant_id, user_id) do nothing;

-- --------------------------------------------------- making one membership active

create or replace function public.membership_activate_profile(p_user uuid, p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.school_memberships;
  v_code text;
  v_rows integer;
begin
  select * into m from public.school_memberships where user_id = p_user and tenant_id = p_tenant;
  if m.id is null then
    raise exception 'That login does not belong to that college.';
  end if;
  select r.code into v_code from public.roles r where r.id = m.role_id and r.tenant_id = p_tenant;
  if v_code is null then
    raise exception 'That membership has no role in its own college.';
  end if;

  update public.user_profiles
  set tenant_id = m.tenant_id, role_id = m.role_id, person_id = m.person_id,
      student_id = m.student_id, staff_id = m.staff_id, guardian_id = m.guardian_id,
      is_active = m.is_active
  where id = p_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'That login has no profile to switch.';
  end if;

  -- Every policy reads the tenant and role from the token: this is what the
  -- next token will carry.
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', p_tenant, 'role', v_code)
  where id = p_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'That login does not exist.';
  end if;
end;
$$;

revoke all on function public.membership_activate_profile(uuid, uuid) from public, anon, authenticated;

comment on function public.membership_activate_profile(uuid, uuid) is
  'Copy a membership into user_profiles and the token metadata (0323). Revoked from every JWT role; callers check authority first.';

-- ------------------------------------------------------------ leaving one college

create or replace function public.membership_leave(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_other uuid;
begin
  select m.tenant_id into v_other
  from public.school_memberships m
  where m.user_id = p_user and m.tenant_id <> p_tenant and m.is_active
  order by m.updated_at desc
  limit 1;

  if v_other is null then
    -- Nowhere else to be: 0289's full close (profile, ban, sessions).
    perform public.login_close(p_tenant, p_user, false);
    update public.school_memberships set is_active = false
    where tenant_id = p_tenant and user_id = p_user;
    return;
  end if;

  -- They belong to another college that did not decide this: no ban.
  update public.school_memberships set is_active = false
  where tenant_id = p_tenant and user_id = p_user;
  if exists (select 1 from public.user_profiles where id = p_user and tenant_id = p_tenant) then
    -- This was their active college. Their next token is the other one's.
    perform public.membership_activate_profile(p_user, v_other);
  end if;
end;
$$;

revoke all on function public.membership_leave(uuid, uuid) from public, anon, authenticated;

comment on function public.membership_leave(uuid, uuid) is
  'Switch a login off in one college (0323): with another active college, deactivate this membership and move the profile if needed; with none, 0289''s full close. Revoked from every JWT role.';

-- --------------------------------------------------- the team screen, over memberships

create or replace function public.logins_that_can_manage_users(p_tenant uuid, p_excluding uuid)
returns bigint
language sql
stable
security definer
set search_path = public, extensions
as $$
  select count(*)
  from public.school_memberships m
  join public.role_permissions rp on rp.role_id = m.role_id and rp.tenant_id = m.tenant_id
  where m.tenant_id = p_tenant
    and m.is_active
    and m.user_id is distinct from p_excluding
    and rp.permission_code = 'users.manage'
    and rp.allowed
$$;

revoke all on function public.logins_that_can_manage_users(uuid, uuid) from public, anon, authenticated;

create or replace function public.team_logins()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role_id uuid,
  role_name text,
  role_subject text,
  record_kind text,
  is_active boolean,
  last_sign_in_at timestamptz,
  is_you boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot see who can sign in.';
  end if;

  return query
  select
    m.user_id,
    au.email::text,
    coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), au.email)::text,
    r.id,
    r.name,
    r.subject,
    case
      when m.staff_id is not null then 'staff'
      when m.guardian_id is not null then 'guardian'
      when m.student_id is not null then 'student'
      else 'none'
    end,
    m.is_active and (au.banned_until is null or au.banned_until < now()),
    au.last_sign_in_at,
    m.user_id = auth.uid()
  from public.school_memberships m
  join auth.users au on au.id = m.user_id
  join public.roles r on r.id = m.role_id
  left join public.people p on p.id = m.person_id
  where m.tenant_id = v_tenant
  order by (m.is_active) desc, r.name, 3;
end;
$$;

comment on function public.team_logins() is
  'Who can sign in to this college, including members working in another college today (0289, 0323). Definer because the email is in auth.users; gated on users.manage; tenant filtered by hand.';

create or replace function public.team_set_access(p_user_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot change who can sign in.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot switch off your own login. Ask another administrator.';
  end if;

  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), au.email)
  into v_name
  from public.school_memberships m
  join auth.users au on au.id = m.user_id
  left join public.people p on p.id = m.person_id
  where m.user_id = p_user_id and m.tenant_id = v_tenant;

  if v_name is null then
    raise exception 'That login does not belong to this college.';
  end if;

  if not p_active then
    if public.logins_that_can_manage_users(v_tenant, p_user_id) = 0 then
      raise exception
        '% is the only login that can manage who signs in. Give that to somebody else first, or nobody could ever change it again.',
        v_name;
    end if;
    perform public.membership_leave(v_tenant, p_user_id);
  else
    update public.school_memberships set is_active = true
    where tenant_id = v_tenant and user_id = p_user_id;
    -- If they can sign in nowhere today -- banned, or their active profile
    -- sits on a membership another college closed -- this college becomes
    -- their active one and the ban lifts. Otherwise they are working in
    -- another college and simply may switch back.
    if exists (select 1 from auth.users au where au.id = p_user_id
               and au.banned_until is not null and au.banned_until > now())
       or not exists (select 1 from public.user_profiles up
                      join public.school_memberships m on m.user_id = up.id and m.tenant_id = up.tenant_id
                      where up.id = p_user_id and m.is_active) then
      perform public.membership_activate_profile(p_user_id, v_tenant);
      perform public.login_close(v_tenant, p_user_id, true);
    end if;
  end if;

  return jsonb_build_object('name', v_name, 'active', p_active);
end;
$$;

comment on function public.team_set_access(uuid, boolean) is
  'Switch a login off or on in this college (0323). Gated on users.manage; never the caller; never the last login that can manage users; never bans somebody who belongs to another active college.';

create or replace function public.team_set_role(p_user_id uuid, p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  m public.school_memberships;
  v_role public.roles;
  v_name text;
  v_keeps_manage boolean;
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot change what a login is for.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role. Ask another administrator.';
  end if;

  -- Working here today: 0289's door, which also updates the token.
  if exists (select 1 from public.user_profiles where id = p_user_id and tenant_id = v_tenant) then
    return public.login_set_role(p_user_id, p_role_id);
  end if;

  select * into m from public.school_memberships where user_id = p_user_id and tenant_id = v_tenant;
  if m.id is null then
    raise exception 'That login does not belong to this college.';
  end if;
  select * into v_role from public.roles where id = p_role_id and tenant_id = v_tenant;
  if v_role.id is null then
    raise exception 'That role does not exist in this college.';
  end if;

  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This login')
  into v_name from public.people p where p.id = m.person_id;
  v_name := coalesce(v_name, 'This login');

  if (v_role.subject = 'staff' and m.staff_id is null)
     or (v_role.subject = 'guardian' and m.guardian_id is null)
     or (v_role.subject = 'student' and m.student_id is null) then
    raise exception
      '% cannot become %: that role is for somebody who is a % here, and this login is not linked to one.',
      v_name, v_role.name,
      case v_role.subject when 'staff' then 'member of staff' when 'guardian' then 'parent or guardian' else 'student' end;
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role_id and rp.permission_code = 'users.manage' and rp.allowed
  ) into v_keeps_manage;

  if not v_keeps_manage and m.is_active
     and public.logins_that_can_manage_users(v_tenant, p_user_id) = 0 then
    raise exception
      '% is the only login that can manage who signs in, and % cannot. Give that to somebody else first.',
      v_name, v_role.name;
  end if;

  -- Working in another college today: the role applies when they switch here.
  update public.school_memberships set role_id = p_role_id where id = m.id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The role could not be changed.';
  end if;

  return jsonb_build_object('name', v_name, 'role', v_role.name);
end;
$$;

comment on function public.team_set_role(uuid, uuid) is
  'Change what a login is for in this college (0323), whether or not it is working here today. Gated on users.manage; never the caller; never away from the last login that can manage users.';

revoke all on function public.team_set_access(uuid, boolean) from public, anon;
grant execute on function public.team_set_access(uuid, boolean) to authenticated;
revoke all on function public.team_set_role(uuid, uuid) from public, anon;
grant execute on function public.team_set_role(uuid, uuid) to authenticated;

-- Called directly these act on the profile alone and would ban somebody in
-- every college. The team doors above call them where they are right.
revoke all on function public.login_set_access(uuid, boolean) from public, anon, authenticated;
revoke all on function public.login_set_role(uuid, uuid) from public, anon, authenticated;

-- A leaver's membership closes with them, through the one mechanism.
create or replace function public.staff_leaving_closes_logins()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  u record;
begin
  if old.status = 'active' and new.status <> 'active' then
    for u in
      select m.user_id from public.school_memberships m
      where m.tenant_id = new.tenant_id and m.staff_id = new.id and m.is_active
    loop
      if public.logins_that_can_manage_users(new.tenant_id, u.user_id) = 0 then
        raise notice 'Kept the login of the last person who can manage logins open.';
      else
        perform public.membership_leave(new.tenant_id, u.user_id);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.staff_leaving_closes_logins() from public, anon, authenticated;

-- ------------------------------------------------------------------ the picker

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
  -- Filtered by the caller's own id: these are their colleges and nobody
  -- else's. Metadata only -- names, contact lines, their role -- and the two
  -- counts only where they administer the college.
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
  order by t.name, t.id
$$;

comment on function public.my_schools() is
  'The caller''s own colleges for the School Management dashboard (0323): name, contact lines, role, status, and class and admin counts where they administer it. Definer filtered by auth.uid(); metadata only.';

revoke all on function public.my_schools() from public, anon;
grant execute on function public.my_schools() to authenticated;

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
  -- One sentence for "not yours" and "switched off": both mean you cannot go there.
  if m.id is null or not m.is_active then
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

comment on function public.school_switch(uuid) is
  'Make one of the caller''s colleges the active one (0323): profile and token metadata, then the caller refreshes the session. Refuses a college they do not belong to or were switched off in.';

revoke all on function public.school_switch(uuid) from public, anon;
grant execute on function public.school_switch(uuid) to authenticated;

-- ---------------------------------------------------------- founding a college

-- What every new college is given, in one place. 0269's body, moved here
-- unchanged so `platform_start_school` and `school_add` cannot disagree.
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
  values (v_tenant, coalesce(nullif(trim(p_session_name), ''), to_char(v_start,'YYYY')||'-'||to_char(v_end,'YYYY')), v_start, v_end, true)
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

revoke all on function public.college_create(text, text, text, text, date, date) from public, anon, authenticated;

comment on function public.college_create(text, text, text, text, date, date) is
  'Found a college: tenant, first year, six roles, the default matrix, a 30-day trial (0323, from 0269). Revoked from every JWT role; platform_start_school and school_add check who is asking.';

create or replace function public.platform_start_school(
  p_school_name text,
  p_slug text,
  p_timezone text default 'Asia/Kolkata',
  p_session_name text default null,
  p_session_start date default null,
  p_session_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_new jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if public.current_tenant_id() is not null then
    raise exception 'This login already belongs to a school. Add another from School Management.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from platform.operators o where o.user_id = v_uid) then
    raise exception 'This login runs the platform and cannot own a college on it. Use a separate account.'
      using errcode = 'insufficient_privilege';
  end if;
  v_new := public.college_create(p_school_name, p_slug, p_timezone, p_session_name, p_session_start, p_session_end);
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb)
    || jsonb_build_object('tenant_id', (v_new ->> 'tenant_id')::uuid, 'role','admin')
  where id = v_uid;
  insert into public.user_profiles (id, tenant_id, role_id)
  values (v_uid, (v_new ->> 'tenant_id')::uuid, (v_new ->> 'admin_role_id')::uuid)
  on conflict (id) do update set tenant_id = excluded.tenant_id, role_id = excluded.role_id;
  return jsonb_build_object('tenant_id', v_new -> 'tenant_id', 'slug', v_new -> 'slug',
    'session_id', v_new -> 'session_id', 'trial_ends_on', v_new -> 'trial_ends_on',
    'refresh_session_required', true);
end;
$$;

-- The reference's "Add New School": an administrator of the college they are
-- in founds another and becomes its administrator. They stay where they are;
-- the new college is a card on the dashboard to switch to.
create or replace function public.school_add(
  p_school_name text,
  p_slug text,
  p_timezone text default 'Asia/Kolkata',
  p_session_name text default null,
  p_session_start date default null,
  p_session_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_new jsonb;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if public.current_tenant_id() is null then
    raise exception 'Start your first school from the sign-up page.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from platform.operators o where o.user_id = v_uid) then
    raise exception 'This login runs the platform and cannot own a college on it.' using errcode = 'insufficient_privilege';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Adding a school is for the administrator who manages logins here (users.manage).'
      using errcode = 'insufficient_privilege';
  end if;
  -- A bound somebody decided, said out loud: ten colleges per login.
  select count(*) into v_count from public.school_memberships where user_id = v_uid;
  if v_count >= 10 then
    raise exception 'This login already belongs to % schools, the most one login may hold.', v_count
      using errcode = 'check_violation';
  end if;

  v_new := public.college_create(p_school_name, p_slug, p_timezone, p_session_name, p_session_start, p_session_end);

  insert into public.school_memberships (tenant_id, user_id, role_id, is_active)
  values ((v_new ->> 'tenant_id')::uuid, v_uid, (v_new ->> 'admin_role_id')::uuid, true);

  return jsonb_build_object('tenant_id', v_new -> 'tenant_id', 'slug', v_new -> 'slug',
    'trial_ends_on', v_new -> 'trial_ends_on');
end;
$$;

comment on function public.school_add(text, text, text, text, date, date) is
  'Add New School (0323): an administrator holding users.manage founds another college through college_create and becomes its administrator. At most ten colleges per login; never an operator.';

revoke all on function public.school_add(text, text, text, text, date, date) from public, anon;
grant execute on function public.school_add(text, text, text, text, date, date) to authenticated;

commit;
