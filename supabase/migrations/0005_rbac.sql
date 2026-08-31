-- Two-layer authorization, per CLAUDE.md:
--   (a) RLS on every table -- tenant isolation + row ownership (this file
--       and 0009) -- is the actual security boundary.
--   (b) role x module x ability permission matrix (this file) -- gates menus
--       and actions in the UI. The UI layer is never the security boundary
--       on its own; it only reads this table to decide what to render/allow.

-- Global, static catalog of possible abilities. Not tenant data -- lives in
-- `reference`, outside the RLS-carrying `public` schema.
create table reference.permissions (
  code text primary key,
  module text not null,
  ability text not null,
  description text not null
);

revoke insert, update, delete on reference.permissions from authenticated, anon;
grant select on reference.permissions to authenticated, anon;

insert into reference.permissions (code, module, ability, description) values
  ('students.view', 'students', 'view', 'View student records'),
  ('students.manage', 'students', 'manage', 'Create/update/deactivate students'),
  ('staff.view', 'staff', 'view', 'View staff directory'),
  ('staff.manage', 'staff', 'manage', 'Create/update staff records'),
  ('guardians.view', 'guardians', 'view', 'View guardian records and student links'),
  ('guardians.manage', 'guardians', 'manage', 'Create/update guardians and student links'),
  ('academics.view', 'academics', 'view', 'View class levels, sections, sessions'),
  ('academics.manage', 'academics', 'manage', 'Manage class levels, sections, sessions'),
  ('library.view', 'library', 'view', 'View catalog and issue records'),
  ('library.manage', 'library', 'manage', 'Manage books and categories'),
  ('library.issue', 'library', 'issue', 'Issue a book to a member'),
  ('library.return', 'library', 'return', 'Process a book return and fines'),
  ('attendance.view', 'attendance', 'view', 'View attendance records'),
  ('attendance.mark', 'attendance', 'mark', 'Mark period/day attendance'),
  ('fees.view', 'fees', 'view', 'View fee ledger and invoices'),
  ('fees.collect', 'fees', 'collect', 'Record a fee payment'),
  ('exams.view', 'exams', 'view', 'View marks and grading configuration'),
  ('exams.grade', 'exams', 'grade', 'Enter marks and apply grading rules'),
  ('homework.view', 'homework', 'view', 'View homework and study material'),
  ('homework.manage', 'homework', 'manage', 'Assign homework and study material'),
  ('reports.view', 'reports', 'view', 'View and export reports'),
  ('users.manage', 'users', 'manage', 'Invite users and assign roles'),
  ('settings.manage', 'settings', 'manage', 'Manage tenant settings');

-- Per-tenant role instances. Seeded with the standard six on tenant
-- creation; tenants may add custom roles later (is_system=false).
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index roles_tenant_idx on public.roles (tenant_id);

alter table public.roles enable row level security;

create policy "tenant members view roles" on public.roles
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "admins manage roles" on public.roles
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_code text not null references reference.permissions(code) on delete cascade,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, role_id, permission_code)
);

create index role_permissions_tenant_idx on public.role_permissions (tenant_id);
create index role_permissions_role_idx on public.role_permissions (tenant_id, role_id);

alter table public.role_permissions enable row level security;

create policy "tenant members view role_permissions" on public.role_permissions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "admins manage role_permissions" on public.role_permissions
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Pending logins: how a brand-new auth.users row learns which tenant/role/
-- person it belongs to (a young student may never get one; see CLAUDE.md).
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email citext not null,
  role_id uuid not null references public.roles(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  guardian_id uuid references public.guardians(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  token uuid not null default gen_random_uuid(),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz
);

create index invitations_tenant_idx on public.invitations (tenant_id);
create index invitations_email_pending_idx on public.invitations (email) where status = 'pending';

alter table public.invitations enable row level security;

create policy "admins manage invitations" on public.invitations
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- One row per login. Links auth.users to a tenant, a role, and the
-- underlying person/student/staff/guardian record it acts as.
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  person_id uuid references public.people(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  guardian_id uuid references public.guardians(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_profiles_tenant_idx on public.user_profiles (tenant_id);
create index user_profiles_staff_idx on public.user_profiles (staff_id) where staff_id is not null;
create index user_profiles_student_idx on public.user_profiles (student_id) where student_id is not null;
create index user_profiles_guardian_idx on public.user_profiles (guardian_id) where guardian_id is not null;

create trigger set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

create policy "self views own profile" on public.user_profiles
  for select to authenticated
  using (id = auth.uid());

create policy "admins view tenant profiles" on public.user_profiles
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

create policy "admins update tenant profiles" on public.user_profiles
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Row creation is reserved for handle_new_auth_user() below (security
-- definer, bypasses RLS) so no INSERT policy is granted to `authenticated`.

comment on table public.user_profiles is
  'One row per auth.users login. Populated by handle_new_auth_user() on signup, never inserted directly by client code.';

-- Fires on every new Supabase Auth user. Resolves a pending invitation by
-- email, stamps tenant_id/role into the JWT app_metadata claim (so RLS
-- helper functions see it on the very next request), and creates the
-- matching user_profiles row.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  role_code text;
begin
  select * into inv
  from public.invitations
  where lower(email) = lower(new.email)
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  if inv.id is null then
    return new;
  end if;

  select code into role_code from public.roles where id = inv.role_id;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', inv.tenant_id, 'role', role_code)
  where id = new.id;

  insert into public.user_profiles (id, tenant_id, role_id, person_id, student_id, staff_id, guardian_id)
  values (new.id, inv.tenant_id, inv.role_id, inv.person_id, inv.student_id, inv.staff_id, inv.guardian_id);

  update public.invitations
  set status = 'accepted', accepted_at = now()
  where id = inv.id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
