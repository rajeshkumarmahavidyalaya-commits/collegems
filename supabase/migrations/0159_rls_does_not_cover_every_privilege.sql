-- ---------------------------------------------------------------------------
-- RLS does not cover every privilege, and TRUNCATE is the one that matters
-- ---------------------------------------------------------------------------
--
-- Rule 1 says isolation is enforced by Postgres and a missing `where tenant_id`
-- is a performance bug rather than a security hole. That is true of every
-- statement a policy can see. **TRUNCATE is not one of them.**
--
-- > Row security policies do not apply to TRUNCATE. The privilege is the only
-- > check there is.
--
-- And Supabase's default `grant all on tables to anon, authenticated` includes
-- it. Probed on a scratch table with RLS on and a policy reading
-- `for select using (false)` -- a caller who may not read a single row:
--
--     set local role authenticated;
--     set local request.jwt.claims = '{... "role":"parent" ...}';
--     select count(*) from public._truncate_probe;  -- 0 rows visible
--     truncate public._truncate_probe;              -- succeeded
--     -- as postgres, afterwards:                      0 rows left of 1
--
-- Every one of the 184 tables in `public` was in that state, `audit_log` and
-- `ledger_entries` among them. The append-only revokes rule 6 is so careful
-- about stop an UPDATE and a DELETE and never mentioned the statement that
-- empties the table in one line.
--
-- WHAT IS REVOKED, AND WHY THESE FOUR
--
-- A policy gates SELECT, INSERT, UPDATE and DELETE. It gates nothing else. So
-- the line drawn here is exactly that: `authenticated` and `anon` keep the four
-- privileges RLS can see and lose the four it cannot.
--
--   TRUNCATE    empties a table whatever the policies say -- the finding above
--   TRIGGER     attaches a function to somebody else's table
--   REFERENCES  points a foreign key at it, which is a lock on its rows and a
--               probe for which values exist
--   MAINTAIN    (PG17) VACUUM / ANALYZE / REINDEX / REFRESH MATERIALIZED VIEW
--
-- None of the four is used by this application: every migration runs as
-- `postgres`, and nothing in the app or the Edge Functions truncates anything.
-- `service_role` keeps them, deliberately -- it bypasses RLS by design, and a
-- leaked service key is already total compromise, so narrowing it here would
-- buy nothing and might break a platform task.

revoke truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;

revoke truncate, references, trigger, maintain
  on all tables in schema reference from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ...and the next table must not arrive with them back
-- ---------------------------------------------------------------------------
--
-- The grant that put them there is a DEFAULT PRIVILEGE, so revoking on today's
-- tables fixes today only. There are **two** default-ACL entries for `public`
-- in a Supabase project -- one owned by `postgres`, one by `supabase_admin` --
-- and a table created by either granter inherits that granter's defaults. Both
-- are amended; the second is wrapped because a project's `postgres` is not
-- always a member of `supabase_admin`, and a migration that cannot be applied
-- is worse than one that reports what it could not do.

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;
alter default privileges for role postgres in schema reference
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke truncate, references, trigger, maintain on tables from anon, authenticated';
exception when insufficient_privilege then
  raise notice 'supabase_admin default privileges left alone: %', sqlerrm;
end
$$;

-- Storage is Supabase's schema, not ours, and `storage.objects` is owned by
-- `supabase_storage_admin`. Truncating it would delete every file record in the
-- project, so it is worth attempting -- but it is attempted rather than
-- asserted, and `privilege_guard_violations()` below reports the outcome rather
-- than this migration deciding it.
do $$
begin
  execute 'revoke truncate, references, trigger, maintain '
       || 'on all tables in schema storage from anon, authenticated';
exception when insufficient_privilege then
  raise notice 'storage grants left alone: %', sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- audit_log is the record of what happened
-- ---------------------------------------------------------------------------
--
-- It had a SELECT policy for administrators and no write policy, which under
-- RLS means a write matches nothing and touches nothing -- the "absent policy"
-- half of rule 6's pair. That is the weaker half, and this is the table where
-- the stronger one belongs: nobody holding a JWT should be able to write here
-- at all, so the privilege goes rather than being merely unmatched.
--
-- `audit_row_change()` is `SECURITY DEFINER` and owned by `postgres`, which
-- also owns the table, so the trigger keeps writing exactly as before. That is
-- the whole reason it was written as a definer function.

revoke insert, update, delete on public.audit_log from anon, authenticated;

comment on table public.audit_log is
  'Append-only by revoke, not by absent policy: `authenticated` holds no write '
  'privilege at all. Written only by `audit_row_change()`, which is SECURITY '
  'DEFINER and owned by the table''s owner. Read by administrators of the '
  'tenant, through RLS.';

-- ---------------------------------------------------------------------------
-- The guard, so this cannot come back quietly
-- ---------------------------------------------------------------------------
--
-- Rule 1's `schema_guard_violations()` asks whether a table has the right
-- *shape*. This asks whether it has the right *grants*, and it is deliberately
-- a second function rather than a third column on the first: they are two
-- questions, they fail for different reasons, and widening the first one's
-- return type would break every caller of it.
--
-- `has_table_privilege` rather than `information_schema.role_table_grants`,
-- because the former follows role membership and the latter does not: a
-- privilege reachable through a granted role is still a privilege.

create or replace function public.privilege_guard_violations()
returns table (schema_name text, table_name text, grantee text, privilege text)
language sql
stable
security definer
set search_path = public
as $$
  select n.nspname::text, c.relname::text, r.role_name, p.privilege_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN'))
    as p(privilege_name)
  where n.nspname in ('public', 'reference', 'storage')
    and c.relkind in ('r', 'p')
    and has_table_privilege(r.role_name, c.oid, p.privilege_name)
  order by 1, 2, 3, 4
$$;

revoke all on function public.privilege_guard_violations() from public, anon;
grant execute on function public.privilege_guard_violations() to authenticated;

comment on function public.privilege_guard_violations() is
  'An empty result is the passing state. Every row is a table a signed-in user '
  'could truncate, or attach a trigger to, or reference -- none of which any '
  'RLS policy can refuse. See migration 0159.';
