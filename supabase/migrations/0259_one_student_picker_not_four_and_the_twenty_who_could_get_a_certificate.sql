-- 0259 -- The other five filter strings, and the picker that could reach
--         twenty of three hundred and three.
--
-- `0223` replaced one `.or("first_name.ilike.%" + term + "%")` with a bound
-- parameter and wrote down why; `0258` did three more, in the command palette.
-- Five sites were left, and reading them together says they are **one** finding
-- rather than five:
--
--   fees/actions.ts         searchStudentsForCounter
--   transport/actions.ts    searchStudentsForTransport     <- byte-identical
--   hostel/actions.ts       searchStudentsForHostel        <- to each other
--   certificates/actions.ts searchStudents                 <- different, and worse
--   library/actions.ts      listBooks
--
-- **Four of them are "find a student by admission number or name", written four
-- times.** `formatMoney` under four names, one layer along -- and rule 6's
-- sentence about billing applies unchanged: *one definition, consulted by
-- everything.* Three of the four also made **two** round trips to answer one
-- keystroke, because `students.admission_number` and `people.first_name` live
-- on different tables and PostgREST was asked twice.
--
-- ## The fourth was not a copy, and it is the one that cost something
--
-- `certificates.searchStudents` had a **different** filter string -- one that
-- reaches an embedded table from a top-level `or` -- and **nothing in the
-- application ever passed it a term.** The issue screen calls
-- `searchStudents("")`, so the branch was unreachable; what shipped instead was
-- the fallback underneath it:
--
--   .order("admission_number").limit(20)
--
-- rendered into a flat `<Select>`. **Twenty of this college's 303 students
-- could be issued a certificate**, in admission-number order, and the other 283
-- were not in the list at all. The comment twenty lines below it explains that
-- the *staff* picker deliberately takes no term because "a college's staff is
-- bounded by the size of a college, so the whole list fits in a `<Select>`" --
-- true of 15 people and false of 303, in a paragraph naming the very defect
-- above it.
--
-- > **A search parameter no caller passes is not a search.** It reads like one
-- > in the signature and like a bounded list on the screen, and only counting
-- > the rows tells them apart.
--
-- ## The library one is a list, not a picker, so it is shaped differently
--
-- `listBooks` pages, sorts and counts. `fees_student_balances` already
-- establishes the idiom for that here -- PostgREST applies `.order()`,
-- `.range()` and `count: exact` to a set-returning function exactly as it does
-- to a table -- so `library_books` takes the two filters and the whitelisted
-- sort column stays in TypeScript where it already is.
--
-- A set-returning function is an optimisation fence (rule 7), so this runs to
-- completion for every matching row before the range is applied. That is not a
-- change: `count: "exact"` already paid for a full pass. The bound is the size
-- of a college library, and it is stated rather than assumed.
--
-- ## What none of these do
--
-- No `where tenant_id =` anywhere (rule 11), and all three are
-- `SECURITY INVOKER`, so `students`' row-ownership policies still decide: a
-- class teacher searching the counter finds the children they teach and nobody
-- else. The term is a **bound parameter**; `ilike` sees a value.

begin;

create or replace function public.student_search(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  admission_number text,
  full_name text,
  status text
)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select
    s.id,
    s.admission_number,
    btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
    s.status
  from public.students s
  join public.people p on p.id = s.person_id
  where length(btrim(coalesce(p_query, ''))) >= 2
    and (
      s.admission_number ilike '%' || btrim(p_query) || '%'
      or p.first_name ilike '%' || btrim(p_query) || '%'
      or coalesce(p.last_name, '') ilike '%' || btrim(p_query) || '%'
    )
  -- Two children can share a name, so the id is the tiebreak: a search with no
  -- total order returns an arbitrary twenty of the matches, and they change
  -- between keystrokes that did not change the term.
  order by full_name, s.id
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

comment on function public.student_search(text, integer) is
  'Students matching an admission number or a name, for a picker. INVOKER, so '
  'row-ownership RLS decides -- a class teacher finds the children they teach. '
  'One round trip rather than two, bounded, totally ordered, and the term is a '
  'bound parameter rather than a fragment of a filter string. Four modules '
  'consulted their own copy of this question before migration 0259.';

create or replace function public.library_books(
  p_query text default null,
  p_category_id uuid default null
)
returns table (
  id uuid,
  title text,
  author text,
  isbn text,
  publisher text,
  shelf_location text,
  total_copies integer,
  available_copies integer,
  category_name text
)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select
    b.id,
    b.title,
    b.author,
    b.isbn,
    b.publisher,
    b.shelf_location,
    b.total_copies,
    b.available_copies,
    c.name as category_name
  from public.books b
  left join public.book_categories c on c.id = b.category_id
  where (p_category_id is null or b.category_id = p_category_id)
    and (
      length(btrim(coalesce(p_query, ''))) = 0
      or b.title ilike '%' || btrim(p_query) || '%'
      or b.author ilike '%' || btrim(p_query) || '%'
      or coalesce(b.isbn, '') ilike '%' || btrim(p_query) || '%'
    );
$$;

comment on function public.library_books(text, uuid) is
  'The book list with its two filters applied, for the catalogue screen. '
  'INVOKER; unordered on purpose -- PostgREST applies the caller''s '
  'whitelisted .order() and .range() on top, as it does for '
  'fees_student_balances. A blank term means no term, not a term that matches '
  'nothing.';

commit;
