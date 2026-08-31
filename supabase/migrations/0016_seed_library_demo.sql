-- Demo library catalog + memberships + a handful of issues/returns so the
-- library UI is never designed against an empty database.

do $$
declare
  v_tenant_id uuid;
  v_session_id uuid;
  v_cat_fiction uuid;
  v_cat_science uuid;
  v_cat_reference uuid;
  v_cat_biography uuid;
  book_id uuid;
  member_id uuid;
  issue_id uuid;
  i int;
  student_row record;
  titles text[][] := array[
    array['Fiction','Wings of Fire','A.P.J. Abdul Kalam','Universities Press','1'],
    array['Fiction','The Discovery of India','Jawaharlal Nehru','Penguin','2'],
    array['Fiction','Malgudi Days','R.K. Narayan','Penguin','3'],
    array['Fiction','The White Tiger','Aravind Adiga','HarperCollins','1'],
    array['Science','A Brief History of Time','Stephen Hawking','Bantam','10'],
    array['Science','The Elegant Universe','Brian Greene','Vintage','2'],
    array['Science','Cosmos','Carl Sagan','Ballantine','1'],
    array['Reference','Oxford English Dictionary','Oxford','Oxford Press','12'],
    array['Reference','Atlas of the World','National Geographic','NatGeo','24'],
    array['Biography','Wings of Fire: An Autobiography','A.P.J. Abdul Kalam','Universities Press','1'],
    array['Biography','Long Walk to Freedom','Nelson Mandela','Little Brown','1'],
    array['Fiction','Five Point Someone','Chetan Bhagat','Rupa','1'],
    array['Science','Sapiens','Yuval Noah Harari','Vintage','1'],
    array['Reference','World Almanac 2025','World Almanac Books','WAB','2025'],
    array['Fiction','The Guide','R.K. Narayan','Penguin','2'],
    array['Science','Silent Spring','Rachel Carson','Mariner','1'],
    array['Biography','Steve Jobs','Walter Isaacson','Simon & Schuster','1'],
    array['Fiction','Train to Pakistan','Khushwant Singh','Penguin','1'],
    array['Reference','Encyclopaedia of India','Britannica','Britannica','5'],
    array['Science','The Selfish Gene','Richard Dawkins','Oxford Press','40']
  ];
  t text[];
begin
  select id into v_tenant_id from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  select id into v_session_id from public.academic_sessions where tenant_id = v_tenant_id and is_current;

  insert into public.book_categories (tenant_id, name) values (v_tenant_id, 'Fiction') returning id into v_cat_fiction;
  insert into public.book_categories (tenant_id, name) values (v_tenant_id, 'Science') returning id into v_cat_science;
  insert into public.book_categories (tenant_id, name) values (v_tenant_id, 'Reference') returning id into v_cat_reference;
  insert into public.book_categories (tenant_id, name) values (v_tenant_id, 'Biography') returning id into v_cat_biography;

  foreach t slice 1 in array titles loop
    insert into public.books (tenant_id, category_id, title, author, publisher, edition, total_copies, available_copies, shelf_location)
    values (
      v_tenant_id,
      case t[1]
        when 'Fiction' then v_cat_fiction
        when 'Science' then v_cat_science
        when 'Reference' then v_cat_reference
        else v_cat_biography
      end,
      t[2], t[3], t[4], t[5],
      3 + (length(t[2]) % 4),
      3 + (length(t[2]) % 4),
      t[1] || '-' || lpad((1 + (length(t[3]) % 20))::text, 2, '0')
    );
  end loop;

  -- Membership for every staff member (librarian-issued default cap).
  insert into public.members (tenant_id, staff_id, membership_number, max_books)
  select v_tenant_id, s.id, 'LIB-STF-' || lpad(row_number() over (order by s.employee_code)::text, 3, '0'), 5
  from public.staff s
  where s.tenant_id = v_tenant_id;

  -- Membership for a subset of students (first 60 by admission number).
  insert into public.members (tenant_id, student_id, membership_number, max_books)
  select v_tenant_id, st.id, 'LIB-STU-' || lpad(row_number() over (order by st.admission_number)::text, 4, '0'), 2
  from public.students st
  where st.tenant_id = v_tenant_id
  order by st.admission_number
  limit 60;

  -- A handful of currently-issued and returned/overdue books for demo texture.
  for i in 1..25 loop
    select m.id into member_id from public.members m
    where m.tenant_id = v_tenant_id
    order by m.membership_number
    offset (i - 1) limit 1;

    select b.id into book_id from public.books b
    where b.tenant_id = v_tenant_id and b.available_copies > 0
    order by b.title
    offset ((i - 1) % 20) limit 1;

    continue when member_id is null or book_id is null;

    begin
      if i % 5 = 0 then
        -- Overdue: issued 20 days ago, due 6 days ago, still outstanding.
        update public.books set available_copies = available_copies - 1 where id = book_id;
        insert into public.book_issues (tenant_id, session_id, book_id, member_id, status, issued_at, due_at)
        values (v_tenant_id, v_session_id, book_id, member_id, 'issued', now() - interval '20 days', current_date - 6);
      elsif i % 3 = 0 then
        -- Returned late, with a fine already applied.
        insert into public.book_issues (tenant_id, session_id, book_id, member_id, status, issued_at, due_at, returned_at, fine_amount)
        values (v_tenant_id, v_session_id, book_id, member_id, 'returned', now() - interval '30 days', current_date - 16, now() - interval '12 days', 8.00);
      else
        -- Currently issued, not yet due.
        update public.books set available_copies = available_copies - 1 where id = book_id;
        insert into public.book_issues (tenant_id, session_id, book_id, member_id, status, issued_at, due_at)
        values (v_tenant_id, v_session_id, book_id, member_id, 'issued', now() - interval '3 days', current_date + 11);
      end if;
    exception when unique_violation then
      -- Same member already has an open issue for this book; skip.
      null;
    end;
  end loop;
end;
$$;
