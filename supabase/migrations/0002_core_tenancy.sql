-- Tenant registry and academic sessions (the year/term every transactional
-- table is scoped to). `tenants` is the one table deliberately exempt from
-- carrying its own tenant_id -- it IS the tenant. See CLAUDE.md.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.tenants
  for each row execute function public.set_updated_at();

alter table public.tenants enable row level security;

create policy "members can view own tenant" on public.tenants
  for select to authenticated
  using (id = public.current_tenant_id());

-- Tenant provisioning (insert/update/delete) is a privileged, out-of-band
-- operation performed with the service role; no policy grants it to
-- `authenticated`, so RLS denies it by default.

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_sessions_dates_chk check (end_date > start_date)
);

create unique index academic_sessions_tenant_name_uk
  on public.academic_sessions (tenant_id, name);

-- Only one "current" session per tenant.
create unique index academic_sessions_one_current_uk
  on public.academic_sessions (tenant_id)
  where is_current;

create trigger set_updated_at before update on public.academic_sessions
  for each row execute function public.set_updated_at();

alter table public.academic_sessions enable row level security;

create policy "tenant members can view sessions" on public.academic_sessions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "admins manage sessions" on public.academic_sessions
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Server-side resolution of "the current session" for a tenant -- never
-- trust a session_id supplied by the client for this.
create or replace function public.current_session_id(p_tenant_id uuid)
returns uuid
language sql
stable
as $$
  select id from public.academic_sessions
  where tenant_id = p_tenant_id and is_current
  limit 1
$$;
