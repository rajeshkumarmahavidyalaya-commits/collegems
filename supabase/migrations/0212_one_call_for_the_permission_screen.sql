-- 0212 — One call for the permission screen
--
-- Rule 4 opens with *"Authorization is two layers"*, and the second of them —
-- the permission matrix — has been read from the application since migration
-- `0005` and **written by nothing**. `hasPermission()` reads it, every nav
-- entry and every button consults it, and there was no screen, no server
-- action and no RPC that could change a single row of it.
--
-- So the sentence rule 4 keeps making about a college — *"a school can grant a
-- teacher `students.manage` any Tuesday"* — was not true of this product. It
-- was true of somebody with a `psql` session.
--
-- ## Why a document rather than three queries
--
-- The grid is six roles by sixty-four permissions. Assembled in the browser it
-- is three round trips and a join written in TypeScript; assembled here it is
-- one row on the wire, and the join is the planner's. That is
-- `dashboard_summary()`'s argument, and it applies for the same reason: the
-- screen has no parameters, answers several questions at once, and is glanced
-- at rather than looked up.
--
-- Bounded by construction, so rule 7 is satisfied without a cap: the roles are
-- a college's own handful and the catalogue is a fixed 64 rows. Neither grows
-- with the size of the school.
--
-- ## SECURITY INVOKER, and what that means here
--
-- `role_permissions` is readable by **every** member of a college — that is the
-- policy `hasPermission()` has always relied on, since a teacher has to be able
-- to read their own row of it. So this function shows any signed-in member what
-- every role may do, and that is not a leak: the matrix is a description of the
-- product, not of anybody's data.
--
-- The **write** is a different question and is answered where it always was:
-- `admins manage role_permissions` (migration `0005`) is the policy, so the
-- screen's server action needs no permission check of its own to be safe. A
-- teacher pressing the same button writes **0 rows** — the count rule 6 says to
-- assert rather than the error it does not raise.

begin;

create or replace function public.permission_matrix()
returns jsonb
language sql
stable
security invoker
set search_path = 'public', 'extensions'
as $$
  select jsonb_build_object(
    'roles', (
      select coalesce(jsonb_agg(
               jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'tier', r.tier)
               order by
                 -- Staff first, because the person editing this is almost
                 -- always deciding what the office and the teaching staff may
                 -- do. `principal` last: it holds everything, and a column of
                 -- sixty-four ticks is not what anybody came to read.
                 case r.tier when 'staff' then 0 when 'student' then 1 else 2 end,
                 r.name), '[]'::jsonb)
      from public.roles r
      where r.tenant_id = (select public.current_tenant_id())
    ),
    'modules', (
      select coalesce(jsonb_agg(m.doc order by m.module), '[]'::jsonb)
      from (
        select p.module,
               jsonb_build_object(
                 'module', p.module,
                 'permissions', jsonb_agg(
                   jsonb_build_object(
                     'code', p.code,
                     'ability', p.ability,
                     'description', p.description)
                   order by p.ability, p.code)) as doc
        from reference.permissions p
        group by p.module
      ) m
    ),
    'granted', (
      -- One object keyed by role id, so the grid looks a cell up rather than
      -- scanning a list of a few hundred pairs per checkbox.
      select coalesce(jsonb_object_agg(g.role_id, g.codes), '{}'::jsonb)
      from (
        select rp.role_id::text as role_id, jsonb_agg(rp.permission_code order by rp.permission_code) as codes
        from public.role_permissions rp
        where rp.tenant_id = (select public.current_tenant_id())
          and rp.allowed
        group by rp.role_id
      ) g
    ),
    -- Named in the document rather than recomputed on the page: the screen has
    -- to draw this one checkbox differently (the last one cannot be cleared),
    -- and a second implementation of "which permission is load-bearing" is a
    -- second answer. The trigger in `0211` is the enforcement; this is the
    -- label.
    'keystone_permission', 'users.manage'
  );
$$;

comment on function public.permission_matrix() is
  'The whole permission screen in one document: this college''s roles with '
  'their tiers, the permission catalogue grouped by module, and which codes '
  'each role holds. INVOKER -- role_permissions is readable by every member, '
  'and the write is gated by the admins-only policy on that table, not here.';

revoke all on function public.permission_matrix() from public, anon;
grant execute on function public.permission_matrix() to authenticated;

commit;
