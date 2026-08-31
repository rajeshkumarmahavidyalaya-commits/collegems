-- SchoolOS foundation: extensions, schemas, JWT/tenant helper functions.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Global, non-tenant reference data (static catalogs) lives outside `public`
-- so the "every public table has tenant_id + RLS" invariant can be tested
-- mechanically without false positives on things like the permission catalog.
create schema if not exists reference;
grant usage on schema reference to authenticated, anon, service_role;

-- Returns the tenant_id embedded in the caller's JWT app_metadata, or null
-- for unauthenticated/service-role callers (service_role bypasses RLS
-- entirely, so this is only ever consulted for `authenticated`).
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

create or replace function public.current_role_code()
returns text
language sql
stable
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role'
$$;

comment on function public.current_tenant_id() is
  'Tenant id from the JWT app_metadata claim. Source of truth for RLS tenant isolation.';
comment on function public.current_role_code() is
  'Role code (admin/teacher/student/parent/accountant/librarian) from JWT app_metadata.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
