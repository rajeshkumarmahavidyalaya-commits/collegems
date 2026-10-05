-- 0337: The facts the reference's lists show, where this schema did not hold them.
--
-- Matching the remaining list pages to the reference (docs/reference-ui.md)
-- found three columns that were not a matter of layout, because nothing stored
-- them:
--
--   * Books: "Book Number" and "Price". A library's book number (its accession
--     number) is how a copy is found on the shelf and in the register, so it is
--     unique in a college when given; it stays optional, because a college
--     moving from paper may not have numbered its stock. A price is what the
--     book cost, never negative, and null means not recorded rather than free.
--   * Exams: "Exam Center", where the papers are sat. It is printed on the
--     admit card, which is the one place a candidate reads it.
--
-- The catalogue read gains both book columns and searches the book number too,
-- since that is what a librarian holding a copy types. `library_books` (0259)
-- returns a fixed TABLE, and a return type cannot be changed by `create or
-- replace`. The drop was held by the tooling this migration was applied
-- through and never reached the database, so the read is a new function,
-- `library_catalogue`, both callers moved to it, and `library_books` is left
-- with no caller and a comment saying so, for a later migration to drop. Both
-- are SECURITY INVOKER: RLS remains the gate.

begin;

alter table public.books
  add column book_number text,
  add column price numeric(12, 2);

alter table public.books
  add constraint books_price_check check (price is null or price >= 0),
  add constraint books_book_number_check check (book_number is null or length(btrim(book_number)) between 1 and 50);

create unique index books_book_number_key
  on public.books (tenant_id, book_number)
  where book_number is not null;

alter table public.exams
  add column centre text;

alter table public.exams
  add constraint exams_centre_check check (centre is null or length(btrim(centre)) between 1 and 200);

create function public.library_catalogue(p_query text default null, p_category_id uuid default null)
returns table(
  id uuid, title text, author text, isbn text, publisher text, shelf_location text,
  total_copies integer, available_copies integer, category_name text, book_number text, price numeric
)
language sql
stable
set search_path = public, extensions
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
    c.name as category_name,
    b.book_number,
    b.price
  from public.books b
  left join public.book_categories c on c.id = b.category_id
  where (p_category_id is null or b.category_id = p_category_id)
    and (
      length(btrim(coalesce(p_query, ''))) = 0
      or b.title ilike '%' || btrim(p_query) || '%'
      or b.author ilike '%' || btrim(p_query) || '%'
      or coalesce(b.isbn, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(b.book_number, '') ilike '%' || btrim(p_query) || '%'
    );
$$;

comment on function public.library_catalogue(text, uuid) is
  'The book list with its two filters applied, for the catalogue screen and the issue picker. INVOKER; unordered on purpose -- PostgREST applies the caller''s whitelisted .order() and .range() on top. A blank term means no term. Searches title, author, ISBN and book number. Replaces library_books (0259), whose return type could not carry the two new columns; that one has no caller since 0337 and is to be dropped.';

comment on function public.library_books(text, uuid) is
  'Superseded by library_catalogue (0337) and called by nothing; kept only until a migration can drop it. Do not add a caller.';

commit;
