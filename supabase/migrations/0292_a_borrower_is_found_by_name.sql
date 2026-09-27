-- 0292: a borrower is found by name.
--
-- The library's issue dialog listed members with
--   .from("members") ... .order("membership_number").limit(20)
-- and searched only `membership_number ilike`. It was opened with an empty
-- term, so a librarian saw the first twenty cards of a roll of three hundred,
-- and anybody else could be reached only by typing their card number from
-- memory. This is the "a bound nobody has reached is not a bound somebody
-- decided" defect from 0259/0261, one module along: nobody chose twenty.
--
-- `library_member_search` is `student_search`'s shape: INVOKER, so the member
-- and people policies decide what the caller may see; the term is a bound
-- parameter, never a fragment of a filter string; it needs two characters;
-- it is bounded and totally ordered, the id breaking ties between two people
-- with one name.
--
-- It matches the card number, the person's names, and the number the school
-- already knows them by -- an admission number for a child, an employee code
-- for staff -- because that is what is written on the book slip.

create or replace function public.library_member_search(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  membership_number text,
  full_name text,
  kind text,
  reference text,
  max_books integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    m.id,
    m.membership_number,
    btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
    case when m.student_id is not null then 'student' else 'staff' end,
    coalesce(st.admission_number, sf.employee_code),
    m.max_books
  from public.members m
  left join public.students st on st.id = m.student_id
  left join public.staff sf on sf.id = m.staff_id
  join public.people p on p.id = coalesce(st.person_id, sf.person_id)
  where m.status = 'active'
    and length(btrim(coalesce(p_query, ''))) >= 2
    and (
      m.membership_number ilike '%' || btrim(p_query) || '%'
      or p.first_name ilike '%' || btrim(p_query) || '%'
      or coalesce(p.last_name, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(st.admission_number, sf.employee_code, '') ilike '%' || btrim(p_query) || '%'
    )
  order by full_name, m.id
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

comment on function public.library_member_search(text, integer) is
  'Active library members matching a card number, a name, or an admission number / employee code, for the issue dialog (0292). INVOKER, so the policies decide; the term is a bound parameter; bounded and totally ordered.';

revoke all on function public.library_member_search(text, integer) from public, anon;
grant execute on function public.library_member_search(text, integer) to authenticated;
