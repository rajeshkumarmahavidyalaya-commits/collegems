-- 0258 -- The search box on every screen, and the two things it got wrong.
--
-- `CommandPalette` is mounted in the app shell, so it is on all 94 pages and it
-- is the one control every role uses. Two defects, and they are the same defect
-- twice: **a fix that landed in one consumer and not in the other.**
--
-- ## 1. The menu was filtered and the palette was not
--
-- `navForRole(roleCode)` exists, the sidebar calls it, and
-- `tests/app-shell/nav-audience.test.ts` guards the `roles` lists it reads.
-- The palette imports `NAV_GROUPS` **raw**. Counted over the 54 entries:
--
--   role         sidebar   palette
--   admin             51        54
--   teacher           26        54
--   accountant        33        54
--   librarian         16        54
--   parent            10        54
--   student           10        54
--
-- So a guardian pressing Ctrl-K is offered *Payroll*, *Fee counter*, *Voucher
-- book*, *Delivery log* and *What each role may do* -- including the three
-- entries this file's rule 4 section describes fixing for exactly that seat.
-- The guard passed throughout, because it reads the **list** and the palette
-- reads the same list without the filter:
--
-- > **A guard on a list is not a guard on its consumers.** `nav-audience`
-- > asks whether somebody decided who an entry is for; it cannot ask whether
-- > every renderer honoured the decision.
--
-- That half is TypeScript. This migration is the other half.
--
-- ## 2. Three more filter strings built out of somebody's typing
--
-- Migration `0223` replaced one `.or("first_name.ilike.%" + term + "%")` with a
-- bound parameter and wrote down why. It fixed **one of nine**. Three of the
-- remaining eight are in this one action, which also made **five round trips**
-- to answer one keystroke:
--
--   .or(`first_name.ilike.${like},last_name.ilike.${like}`, { referencedTable: "people" })   -- students
--   .or(`employee_code.ilike.${like},designation.ilike.${like}`)                             -- staff
--   .or(`title.ilike.${like},author.ilike.${like}`)                                          -- books
--
-- Measured on this college: 0 of 303 people and 0 of 21 books carry a comma or
-- an apostrophe today, so nothing is broken *here* -- the defect is in what the
-- code accepts, not in today's rows, and a library whose catalogue has no
-- `Gödel, Escher, Bach` in it is a young library.
--
-- `SECURITY INVOKER`, so the policies decide the audience and the palette needs
-- no audience logic of its own. Probed shapes, from the policy list: a parent
-- reads their own children through `parents view own children`, **no** rows of
-- `staff` (there is no parent SELECT policy on it), and the whole book
-- catalogue through `tenant members view books`. That is the right answer and
-- nothing in the palette had to know it.
--
-- ## What it deliberately does not return
--
-- **No subtitle, and no href.** *"Admission #123"* is a sentence and belongs in
-- the catalogue rule 15 built for sentences; a path is a routing fact that the
-- renderer owns (rule 11's `columns[].href` decided the same thing from the
-- other direction). So this returns the **value** -- an admission number, a
-- designation, an author -- and the words are assembled in TypeScript where a
-- translator can reach them.

begin;

create or replace function public.global_search(p_query text, p_limit integer default 5)
returns table (
  kind text,
  id uuid,
  title text,
  reference text
)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  with hits as (
    (
      select
        'student'::text as kind,
        s.id,
        btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as title,
        s.admission_number as reference,
        1 as bucket
      from public.students s
      join public.people p on p.id = s.person_id
      where length(btrim(coalesce(p_query, ''))) >= 2
        and (
          s.admission_number ilike '%' || btrim(p_query) || '%'
          or p.first_name ilike '%' || btrim(p_query) || '%'
          or coalesce(p.last_name, '') ilike '%' || btrim(p_query) || '%'
        )
      -- Two children can share a name, so the id is the tiebreak: without one
      -- the five rows a type-ahead returns are an arbitrary five of the
      -- matches, and they change between keystrokes that did not change.
      order by title, s.id
      limit greatest(1, least(coalesce(p_limit, 5), 20))
    )
    union all
    (
      select
        'staff'::text as kind,
        st.id,
        btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as title,
        st.designation as reference,
        2 as bucket
      from public.staff st
      join public.people p on p.id = st.person_id
      where length(btrim(coalesce(p_query, ''))) >= 2
        and (
          st.employee_code ilike '%' || btrim(p_query) || '%'
          or st.designation ilike '%' || btrim(p_query) || '%'
          or p.first_name ilike '%' || btrim(p_query) || '%'
          or coalesce(p.last_name, '') ilike '%' || btrim(p_query) || '%'
        )
      order by title, st.id
      limit greatest(1, least(coalesce(p_limit, 5), 20))
    )
    union all
    (
      select
        'book'::text as kind,
        b.id,
        b.title,
        b.author as reference,
        3 as bucket
      from public.books b
      where length(btrim(coalesce(p_query, ''))) >= 2
        and (
          b.title ilike '%' || btrim(p_query) || '%'
          or b.author ilike '%' || btrim(p_query) || '%'
          or coalesce(b.isbn, '') ilike '%' || btrim(p_query) || '%'
        )
      order by b.title, b.id
      limit greatest(1, least(coalesce(p_limit, 5), 20))
    )
  )
  select h.kind, h.id, h.title, h.reference
  from hits h
  order by h.bucket, h.title, h.id;
$$;

comment on function public.global_search(text, integer) is
  'Students, staff and books matching one term, for the command palette. '
  'INVOKER, so RLS decides the audience -- a guardian gets their own children '
  'and no staff. One round trip rather than five, bounded per kind, and the '
  'term is a bound parameter rather than a fragment of a filter string. '
  'Returns values, not sentences: the subtitle and the path are the '
  'renderer''s, so both stay translatable and routable in TypeScript.';

commit;
