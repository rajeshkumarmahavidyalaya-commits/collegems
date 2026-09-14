-- 0223 -- Finding the mother who is already here.
--
-- Rule 5 lists sibling linking as one of the four things the identity model
-- exists to keep representable, and `guardian_link` (migration `0221`) is the
-- write half of it. The read half is a search box: *which guardian already in
-- this school is this child's mother?*
--
-- ## Why this is a function rather than a select
--
-- The first draft was PostgREST, and it filtered an embedded table:
--
--   .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`, { referencedTable: "people" })
--
-- **That string is a filter language, and `term` is somebody's typing.** A
-- guardian searched for as `O'Brien, R` closes the `or(` group early and the
-- request is answered with a 400 at best. It is not a way into another
-- tenant's rows -- RLS is unmoved by any of it -- but "the search box breaks on
-- a comma" is a defect a school meets in its first week, and the fix is not to
-- escape more carefully. It is to stop building a query out of text:
-- `p_query` here is a **bound parameter**, and `ilike` sees it as a value.
--
-- Bounded at twenty per rule 7, and ordered -- a search with no `order by`
-- returns an arbitrary twenty of the matches, which is the export lesson
-- arriving in a type-ahead.
--
-- `SECURITY INVOKER`, so the policies on `guardians` and `people` decide what
-- comes back. `people` lost its tenant-wide read policy in migration `0183`
-- ("not sensitive HR data" was a claim about columns, made by a row policy),
-- which is why this projects four columns and not the person.

begin;

create or replace function public.guardian_search(p_query text)
returns table (
  id uuid,
  full_name text,
  phone text,
  occupation text,
  children integer
)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select
    g.id,
    btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
    p.phone,
    g.occupation,
    (select count(*)::integer from public.guardian_student gs where gs.guardian_id = g.id) as children
  from public.guardians g
  join public.people p on p.id = g.person_id
  where length(btrim(coalesce(p_query, ''))) >= 2
    and (
      p.first_name ilike '%' || btrim(p_query) || '%'
      or coalesce(p.last_name, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(p.phone, '') ilike '%' || btrim(p_query) || '%'
    )
  -- Two people can share a name, so the id is the tiebreak: without one the
  -- twenty rows a search returns are an arbitrary twenty of the matches.
  order by full_name, g.id
  limit 20;
$$;

comment on function public.guardian_search(text) is
  'Guardians matching a name or telephone number, for linking a sibling. '
  'INVOKER, so RLS decides; bounded at 20; the search term is a bound '
  'parameter rather than a fragment of a filter string.';

commit;
