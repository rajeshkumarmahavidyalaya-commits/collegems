-- ---------------------------------------------------------------------------
-- Correcting 0159's header: 93 tables, not 184
-- ---------------------------------------------------------------------------
--
-- Comment-only, and it exists for the same reason `0131` exists: the next
-- person reads the header and stops looking, so a number in one has to be
-- right.
--
-- `0159` says "all 184 tables in `public`" and repeats it in
-- `docs/modules/privileges.md` and in CLAUDE.md. **`public` has 93 tables.**
-- 184 was the row count of
--
--     select count(*) from information_schema.role_table_grants
--     where table_schema = 'public' and privilege_type = 'TRUNCATE'
--       and grantee in ('anon', 'authenticated');
--
-- which yields one row per table **per grantee** -- 92 tables times the two
-- roles, plus one table created between the two counts. A grant count read as
-- a table count, and it overstated the surface by a factor of two.
--
-- WHAT IS UNCHANGED
--
-- The finding itself, entirely. Every table in `public` did carry TRUNCATE for
-- `anon` and `authenticated`; a caller acting as `parent`, denied even SELECT
-- by policy, did empty a table; and the revoke closed it. Only the size of the
-- sentence was wrong, and it was wrong in the direction that makes a finding
-- sound worse than it is -- which is the direction that costs the next reader's
-- trust in the rest of the header.
--
-- The lesson generalises past this one number:
--
--   > `information_schema.role_table_grants` has one row per
--   > (table, grantee, privilege). Counting it answers "how many grants", never
--   > "how many tables". Use `count(distinct table_name)`, or count `pg_class`.
--
-- Migrations are immutable once applied, so `0159` keeps its wrong number and
-- this file carries the right one. `docs/modules/privileges.md` and CLAUDE.md
-- are corrected in place, because they are read as current rather than as
-- history.

comment on function public.privilege_guard_violations() is
  'An empty result is the passing state. Every row is a table in `public` or '
  '`reference` that a signed-in user could truncate, attach a trigger to, or '
  'reference -- none of which any RLS policy can refuse. `storage` is out of '
  'scope because its grants cannot be revoked from this project; see migration '
  '0160. Migration 0159''s header says 184 tables; the true figure is 93 -- see '
  'migration 0161.';
