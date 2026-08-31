-- CLAUDE.md rule 1, enforceable from a test: returns every table in
-- `public` that is missing tenant_id or has RLS disabled. An empty result
-- is the passing state. `tenants` is the one documented exception -- it IS
-- the tenant, so its RLS compares `id` rather than `tenant_id`.
--
-- SECURITY DEFINER so it can read the catalog, but it only ever returns
-- table names and two booleans -- never tenant data.
create or replace function public.schema_guard_violations()
returns table (table_name text, has_tenant_id boolean, rls_enabled boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    c.relname::text,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    ),
    c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname <> 'tenants'
    and (
      not c.relrowsecurity
      or not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
      )
    )
$$;

revoke all on function public.schema_guard_violations() from public, anon;
grant execute on function public.schema_guard_violations() to authenticated;
