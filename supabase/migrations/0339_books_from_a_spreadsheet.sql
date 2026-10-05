-- 0339: Books from a spreadsheet -- the reference's "Add New Books In Bulk".
--
-- A library's catalogue is hundreds of titles, typed once from a register or
-- an old system's export, and the catalogue had only a one-book form. This is
-- the staff importer's shape of rule 13: the file is read and checked in the
-- browser as editable rows, and the apply writes what the rows say.
--
-- Unlike staff, the apply is one function rather than one call per row,
-- because a catalogue is long: 500 sequential round trips from a server action
-- is a request that times out (rule 7). Here it is one call, bounded at 500
-- rows and refused past that, with each row in its own sub-transaction so a
-- row that fails keeps its reason and the rest carry on.
--
-- * SECURITY INVOKER. `books` and `book_categories` admit writes from the
--   librarian and the administrator only, so the policy is the gate exactly
--   as it is for the one-book form; a role without it gets one sentence.
-- * A subject is matched to an existing category by name, ignoring case and
--   surrounding spaces, and created when the college has none of that name.
--   The preview names the new ones before anything is written, so a typo is
--   seen as a new subject rather than discovered later.
-- * Book number uniqueness is the index's (0337); its refusal becomes a
--   sentence naming the number. A book is inserted with every copy on the
--   shelf, as the form does.

begin;

create function public.library_import_books(p_rows jsonb)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_row jsonb;
  v_out jsonb := '[]'::jsonb;
  v_category uuid;
  v_subject text;
  v_qty integer;
  v_id uuid;
  v_count integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There is nothing to import.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count > 500 then
    raise exception 'One import takes at most 500 books and this is %. Split the file.', v_count;
  end if;
  if public.current_role_code() not in ('admin', 'librarian') then
    raise exception 'Adding books is for the library: your role may not add them.'
      using errcode = '42501';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    begin
      if length(btrim(coalesce(v_row ->> 'title', ''))) = 0 then
        raise exception 'The title is missing.' using errcode = '22023';
      end if;
      if length(btrim(coalesce(v_row ->> 'author', ''))) = 0 then
        raise exception 'The author is missing.' using errcode = '22023';
      end if;
      v_qty := coalesce(nullif(btrim(v_row ->> 'quantity'), '')::integer, 1);
      if v_qty < 1 or v_qty > 1000 then
        raise exception 'A quantity is between 1 and 1000, not %.', v_qty using errcode = '22023';
      end if;

      v_category := null;
      v_subject := nullif(btrim(coalesce(v_row ->> 'subject', '')), '');
      if v_subject is not null then
        select c.id into v_category
        from public.book_categories c
        where c.tenant_id = v_tenant and lower(btrim(c.name)) = lower(v_subject)
        limit 1;
        if v_category is null then
          insert into public.book_categories (tenant_id, name)
          values (v_tenant, v_subject)
          returning id into v_category;
        end if;
      end if;

      insert into public.books (
        tenant_id, title, author, category_id, isbn, publisher, edition,
        shelf_location, book_number, price, total_copies, available_copies
      )
      values (
        v_tenant,
        btrim(v_row ->> 'title'),
        btrim(v_row ->> 'author'),
        v_category,
        nullif(btrim(coalesce(v_row ->> 'isbn', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'publisher', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'edition', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'rack', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'book_number', '')), ''),
        nullif(btrim(coalesce(v_row ->> 'price', '')), '')::numeric,
        v_qty,
        v_qty
      )
      returning id into v_id;

      v_out := v_out || jsonb_build_object(
        'line', v_row -> 'line', 'ok', true, 'id', v_id, 'title', btrim(v_row ->> 'title'));
    exception
      when unique_violation then
        v_out := v_out || jsonb_build_object(
          'line', v_row -> 'line', 'ok', false, 'title', v_row ->> 'title',
          'error', format('Book number %s is already used by another book.', btrim(v_row ->> 'book_number')));
      when invalid_text_representation then
        v_out := v_out || jsonb_build_object(
          'line', v_row -> 'line', 'ok', false, 'title', v_row ->> 'title',
          'error', 'A price or quantity here is not a number.');
      when check_violation then
        v_out := v_out || jsonb_build_object(
          'line', v_row -> 'line', 'ok', false, 'title', v_row ->> 'title',
          'error', 'A value here is out of range: a price cannot be negative and a book number is at most 50 characters.');
      when others then
        v_out := v_out || jsonb_build_object(
          'line', v_row -> 'line', 'ok', false, 'title', v_row ->> 'title', 'error', sqlerrm);
    end;
  end loop;

  return v_out;
end;
$$;

comment on function public.library_import_books(jsonb) is
  'Adds up to 500 books from checked spreadsheet rows (title, author, subject, book_number, isbn, rack, price, quantity, publisher, edition, line), each in its own sub-transaction, and returns one outcome per row. A subject matches a category by name, ignoring case, or creates it. INVOKER: the books and book_categories policies are the gate (0339).';

commit;
