-- 0338: The Books Issued search reads every issue, not the page on screen.
--
-- listIssues paged `book_issues` and then filtered the 25 rows it had read by
-- the search term in TypeScript, so a title on page 2 could not be found from
-- page 1, and the count beside the list stayed the unfiltered total. Found
-- while matching the list to the reference (0337, docs/audit-2026-10.md).
--
-- `library_issues_matching` is the search, as a set of `book_issues` rows. It
-- returns the table's own row type so PostgREST can embed `books` and
-- `members` on it and apply the status filter, the order and the range on
-- top, exactly as on the table: the screen's select is unchanged. The term is
-- a bound parameter (0223: a search box is not a filter string).
--
-- It matches the book's title, author and book number, the card number, and
-- the borrower's admission number, employee code and name. SECURITY INVOKER:
-- every table it reads answers through the caller's own policies, so it can
-- only find issues the caller could already list. A blank term means no term.

begin;

create function public.library_issues_matching(p_query text default null)
returns setof public.book_issues
language sql
stable
set search_path = public, extensions
as $$
  select bi.*
  from public.book_issues bi
  where length(btrim(coalesce(p_query, ''))) = 0
     or exists (
       select 1
       from public.books b
       where b.id = bi.book_id
         and (
           b.title ilike '%' || btrim(p_query) || '%'
           or b.author ilike '%' || btrim(p_query) || '%'
           or coalesce(b.book_number, '') ilike '%' || btrim(p_query) || '%'
         )
     )
     or exists (
       select 1
       from public.members m
       left join public.students s on s.id = m.student_id
       left join public.staff st on st.id = m.staff_id
       left join public.people p on p.id = coalesce(s.person_id, st.person_id)
       where m.id = bi.member_id
         and (
           m.membership_number ilike '%' || btrim(p_query) || '%'
           or coalesce(s.admission_number, '') ilike '%' || btrim(p_query) || '%'
           or coalesce(st.employee_code, '') ilike '%' || btrim(p_query) || '%'
           or coalesce(p.first_name || ' ' || p.last_name, '') ilike '%' || btrim(p_query) || '%'
         )
     );
$$;

comment on function public.library_issues_matching(text) is
  'Book issues whose book (title, author, book number) or borrower (card number, admission number, employee code, name) matches the term; every issue for a blank term. INVOKER and unordered on purpose: the Books Issued screen embeds books and members, filters the status, orders and pages on top, as on the table itself (0338).';

commit;
