-- ---------------------------------------------------------------------------
-- The guard checks what this codebase can fix, and says what it cannot
-- ---------------------------------------------------------------------------
--
-- `0159` revoked TRUNCATE and its three companions across `public` and
-- `reference` -- both now report zero -- and attempted the same on `storage`,
-- which is Supabase's schema rather than ours. That attempt **silently did
-- nothing**, and the way it failed is worth recording because it is not the way
-- anybody expects:
--
--     revoke truncate on storage.objects from authenticated;
--     -- no error, no warning
--     select has_table_privilege('authenticated','storage.objects','TRUNCATE');
--     -- still true
--
-- A REVOKE only removes grants **made by the role running it**. `postgres` holds
-- `TRUNCATE WITH GRANT OPTION` on `storage.objects`, so the statement is legal
-- and does exactly nothing: the grant to `authenticated` was made by
-- `supabase_storage_admin`, and `postgres` is not a member of it
-- (`pg_has_role('postgres','supabase_storage_admin','MEMBER')` is false).
--
-- So `storage.objects` is truncatable by any signed-in user of this project and
-- there is no statement this repository can run to change that. It is a
-- platform default, not a decision made here.
--
-- WHY THE GUARD NARROWS RATHER THAN STAYING RED
--
-- A permanently failing check is a check people learn to ignore, and the next
-- real violation arrives into a test that was already red. So the guard covers
-- the two schemas this codebase creates tables in and can therefore keep clean.
--
-- The rule that goes with it -- and the reason this is a migration with a
-- header rather than a quiet `where` clause -- is `0131`'s:
--
--   > Write down what was actually checked and how, not what the ideal check
--   > would have been.
--
-- What is not checked, and what to do about it, is in
-- `docs/modules/privileges.md`. Losing `storage.objects` loses the *rows*, not
-- the bytes: the files stay in the bucket and the paths are reconstructible
-- from `people.photo_path`, `notice_files.path` and the other columns that
-- store them -- which is the reason rule 8 says to store the path in the
-- database rather than treating storage as the record.

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
  -- `storage` is deliberately absent. See this migration's header: its grants
  -- were made by a role this project is not a member of, so they are reported
  -- in the docs rather than by a check that could never go green.
  where n.nspname in ('public', 'reference')
    and c.relkind in ('r', 'p')
    and has_table_privilege(r.role_name, c.oid, p.privilege_name)
  order by 1, 2, 3, 4
$$;

comment on function public.privilege_guard_violations() is
  'An empty result is the passing state. Every row is a table in `public` or '
  '`reference` that a signed-in user could truncate, attach a trigger to, or '
  'reference -- none of which any RLS policy can refuse. `storage` is out of '
  'scope because its grants cannot be revoked from this project; see migration '
  '0160 and docs/modules/privileges.md.';
