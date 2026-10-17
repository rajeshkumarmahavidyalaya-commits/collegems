-- 0357: the year on screen is asked once per query, not once per row.
--
-- current_session_id() was a one-statement SQL function, which Postgres
-- inlines into the calling query and evaluates once. 0355 made it call
-- viewing_session_id(), a PL/pgSQL function, which cannot be inlined, so in
-- queries that ask for the year inside a correlated subquery it ran per row:
-- the students page's module_cards took 1,727 ms on its first call in the
-- Annex, and a page load hit the 8 s statement timeout.
--
-- Both are plain SQL again. The header is compared as text, so a malformed
-- value matches no year rather than raising, which is what the PL/pgSQL
-- version's exception handler was for. Each lookup is a scalar subquery, so
-- once inlined it becomes an InitPlan and runs once per query.

begin;

create or replace function public.viewing_session_id(p_tenant_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.academic_sessions s
  where s.tenant_id = p_tenant_id
    and s.id::text = lower(nullif(current_setting('request.headers', true), '')::json ->> 'x-schoolos-year')
$$;

create or replace function public.current_session_id(p_tenant_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select public.viewing_session_id(p_tenant_id)),
    (select id from public.academic_sessions where tenant_id = p_tenant_id and is_current limit 1)
  )
$$;

commit;
