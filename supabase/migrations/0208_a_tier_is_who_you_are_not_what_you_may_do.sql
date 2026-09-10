-- 0208 — A tier is who you are, not what you may do
--
-- Six roles have existed since migration `0005` and they are genuinely
-- different — measured on the demo college:
--
--     admin       64 permissions   settings, payroll, audit, users, everything
--     accountant  22               fees.collect, accounts, payroll
--     teacher     21               attendance.mark, exams.grade
--     parent      10               their own children
--     student     10               their own record
--     librarian    9               library.issue, library.return
--
-- What was missing is one level up: **which kind of person is this login for.**
-- A principal, a professor and a student are three different audiences, and the
-- product had no way to say so — every screen reasoned from `role_permissions`,
-- which is right for *may they*, and from `roles.code`, which is a list of six
-- rather than a shape.
--
-- So `roles.tier` names the audience, and this migration is careful about
-- exactly one thing:
--
-- > **A tier decides what a person is shown. It never decides what they may do.**
-- > Rule 4 already says the UI layer is never the gate — this adds a column that
-- > looks *exactly* like a gate, sitting next to a permission matrix, and the
-- > only thing keeping it honest is that nothing reads it for authorization.
--
-- That is why a librarian and an accountant share the `staff` tier while
-- holding different permissions, and why merging them was refused: a teacher
-- who inherited the fee counter, or a librarian who inherited payroll, would be
-- a real loss of separation of duties dressed up as simplification.
--
-- The three tiers:
--
--   `student`    — the people the college exists for, and their families.
--   `staff`      — professors, teachers, librarians, accountants. Employed here,
--                  each with their own narrow set of abilities.
--   `principal`  — the college's own superuser. Manages settings, users, the
--                  permission matrix itself. One school's ceiling, not the
--                  platform's: a principal sees their own college and no other,
--                  and rule 1 is what guarantees it.
--
-- A **platform operator**, who works across colleges, is deliberately not a tier
-- here. It cannot be: every tier below is a row in a tenant's own `roles` table,
-- and somebody who belongs to no tenant cannot be one of them. That is its own
-- migration, its own schema and its own guard.

begin;

-- The vocabulary lives in the constraint, per this codebase's convention: a
-- list of valid values belongs in one place, and the constraint is usually that
-- place. Adding a fourth tier is then one ALTER rather than a hunt.
alter table public.roles
  add column if not exists tier text not null default 'staff'
    check (tier in ('student', 'staff', 'principal'));

comment on column public.roles.tier is
  'Which audience this role is for: student (and families), staff (professors, '
  'librarians, accountants), principal (the college''s own superuser). '
  'PRESENTATION ONLY -- it decides landing pages, menus and how a login is '
  'described. It must never appear in a policy, a permission check or a write '
  'function: rule 4 says the matrix and RLS are the gate, and a column that '
  'looks like a gate beside them is exactly the one somebody will reach for.';

-- Backfill the six that exist. `admin` becomes `principal` because that is what
-- it has always been in practice -- the person who holds all 64 permissions --
-- and the *code* is deliberately left alone: every RLS policy in the schema
-- compares `roles.code`, and renaming it would be a security-relevant rewrite
-- of sixty policies to gain a nicer word.
update public.roles set tier = 'principal' where code = 'admin';
update public.roles set tier = 'student'   where code in ('student', 'parent');
update public.roles set tier = 'staff'     where code in ('teacher', 'librarian', 'accountant');

-- A college adding its own role (rule 3 promises it can) gets `staff` unless it
-- says otherwise, which is the conservative reading: a new role is far more
-- likely to be a bursar's assistant than a second principal.

-- ---------------------------------------------------------------------------
-- Provisioning has to know about it too
-- ---------------------------------------------------------------------------

-- `platform_start_school` creates the six roles for every new college. Without
-- this it would create them all at the default `staff`, and a brand-new
-- college's principal would be filed as a professor -- the "a fix that lands in
-- one caller has not landed" rule, arriving before anybody could hit it.
create or replace function public.platform_start_school(
  p_school_name text, p_slug text, p_timezone text default 'Asia/Kolkata',
  p_session_name text default null, p_session_start date default null, p_session_end date default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid; v_session uuid; v_admin_role uuid;
  v_slug text := lower(trim(p_slug));
  v_name text := trim(p_school_name);
  v_start date := coalesce(p_session_start, date_trunc('year', current_date)::date);
  v_end date;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if public.current_tenant_id() is not null then
    raise exception 'This login already belongs to a school.' using errcode = 'insufficient_privilege';
  end if;
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
  values (v_name, v_slug, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'))
  returning id into v_tenant;

  insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
  values (v_tenant, coalesce(nullif(trim(p_session_name), ''), to_char(v_start, 'YYYY') || '-' || to_char(v_end, 'YYYY')), v_start, v_end, true)
  returning id into v_session;

  -- The six of rule 3, each with the tier it has always been in practice.
  insert into public.roles (tenant_id, code, name, tier) values
    (v_tenant, 'admin', 'Administrator', 'principal'),
    (v_tenant, 'teacher', 'Teacher', 'staff'),
    (v_tenant, 'student', 'Student', 'student'),
    (v_tenant, 'parent', 'Parent', 'student'),
    (v_tenant, 'accountant', 'Accountant', 'staff'),
    (v_tenant, 'librarian', 'Librarian', 'staff');

  select id into v_admin_role from public.roles where tenant_id = v_tenant and code = 'admin';

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, v_admin_role, code from reference.permissions;

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'teacher'
    and p.code in ('students.view','guardians.view','academics.view','attendance.view','attendance.mark','exams.view','exams.grade','homework.view','homework.manage','library.view','reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'accountant'
    and p.code in ('students.view','fees.view','fees.collect','reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'librarian'
    and p.code in ('students.view','library.view','library.manage','library.issue','library.return','reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code in ('student','parent')
    and p.code in ('homework.view','library.view','exams.view','attendance.view','fees.view');

  insert into public.subscriptions (tenant_id, plan_code, status, trial_ends_on)
  values (v_tenant, 'trial', 'trialing', (current_date + 30));

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('tenant_id', v_tenant, 'role', 'admin')
  where id = v_uid;

  insert into public.user_profiles (id, tenant_id, role_id)
  values (v_uid, v_tenant, v_admin_role)
  on conflict (id) do update set tenant_id = excluded.tenant_id, role_id = excluded.role_id;

  return jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'session_id', v_session,
    'trial_ends_on', current_date + 30, 'refresh_session_required', true);
end;
$$;

revoke all on function public.platform_start_school(text, text, text, text, date, date) from public, anon;
grant execute on function public.platform_start_school(text, text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The tier of the person asking
-- ---------------------------------------------------------------------------

-- Beside `current_role_code()`, and STABLE for the same reason: read once per
-- statement rather than per row.
--
-- Note what it is NOT used for. There is no `tier_has_permission()`, and there
-- must not be: `role_has_permission(code)` already answers "may they", and a
-- second answer to that question is how a rule starts to differ from itself.
create or replace function public.current_role_tier()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select r.tier
  from public.user_profiles up
  join public.roles r on r.id = up.role_id
  where up.id = (select auth.uid());
$$;

comment on function public.current_role_tier() is
  'Which audience the signed-in login belongs to: student, staff or principal. '
  'For deciding what to SHOW. Never for deciding what is allowed -- that is '
  'role_has_permission() and RLS, and this function appearing in a policy would '
  'be a bug rather than a shortcut.';

revoke all on function public.current_role_tier() from public, anon;
grant execute on function public.current_role_tier() to authenticated;

commit;
