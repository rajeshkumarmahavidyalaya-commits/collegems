-- 0192 -- Return the library count `staff_exit` was already taking.
--
-- 0191 closed the library membership in both exit paths.
-- `student_end_relationships` returns its count, so the students screen can say
-- so; `staff_exit` counted the same rows into a variable and then built its
-- result object without it. A number computed and discarded is the shape of a
-- fact nobody can act on -- and the one person who needs it is the librarian
-- wondering why a leaver's card stopped working.
--
-- Additive, per rule 14: `closed` is a new key beside `unassigned`, and no
-- existing key moves. There is no staff-exit screen yet; this is what one would
-- read when it is built.

create or replace function public.staff_exit(
  p_staff_id uuid,
  p_reason text,
  p_left_on date default null,
  p_status text default 'terminated'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_on date := coalesce(p_left_on, current_date);
  v_name text;
  v_lessons integer := 0;
  v_sections integer := 0;
  v_subjects integer := 0;
  v_books integer := 0;
  v_library integer := 0;
  v_future_covers integer := 0;
  v_outstanding jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_status not in ('terminated', 'resigned', 'retired', 'inactive') then
    raise exception 'A member of staff leaves as terminated, resigned, retired or inactive -- not "%"', p_status;
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why they are leaving -- it is the only thing a record five years from now will have';
  end if;

  select (p.first_name || ' ' || p.last_name) into v_name
  from public.staff s join public.people p on p.id = s.person_id
  where s.id = p_staff_id;

  if v_name is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;

  -- 1. The timetable. Unassigned, not deleted: the class still happens.
  update public.timetable_entries
  set teacher_staff_id = null
  where teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_lessons = row_count;

  -- 2. Class-teacher duty. A section whose class teacher has left needs one,
  --    and `academics` already treats null as "not yet chosen".
  update public.sections
  set class_teacher_staff_id = null
  where class_teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_sections = row_count;

  -- 3. Subject assignments.
  update public.section_subjects
  set teacher_staff_id = null
  where teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_subjects = row_count;

  -- 4. The library membership, for the same reason it closes for a child:
  --    nothing else stops a book being issued to somebody who has left, and
  --    `library_issue_book` checks `members.status` rather than whether the
  --    person is still here.
  update public.members
  set status = 'expired'
  where staff_id = p_staff_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_library = row_count;

  -- 5. The employment record, last -- so a failure above leaves them visibly
  --    still employed rather than half-gone.
  update public.staff
  set status = p_status,
      date_of_leaving = coalesce(date_of_leaving, v_on)
  where id = p_staff_id and tenant_id = v_tenant_id;

  -- ---- what this cannot end ------------------------------------------------

  select count(*) into v_books
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  where m.staff_id = p_staff_id and bi.status = 'issued';

  if v_books > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'library',
      'message', format(
        '%s still has %s library %s out, and any fine on them is a payroll '
        'deduction rather than a fee -- see the library module.',
        v_name, v_books, case when v_books = 1 then 'book' else 'books' end)
    );
  end if;

  -- Cover they were down to provide after today. Deliberately not cleared:
  -- `substitutions` records what was arranged, and rewriting it would erase a
  -- decision somebody made. Naming it lets the office re-arrange.
  select count(*) into v_future_covers
  from public.substitutions s
  where s.substitute_staff_id = p_staff_id
    and s.on_date > v_on;

  if v_future_covers > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'cover',
      'message', format(
        '%s is down to cover %s %s after %s. Those need re-arranging -- this '
        'has not touched them, because the roster is a record of what was '
        'decided.',
        v_name, v_future_covers,
        case when v_future_covers = 1 then 'class' else 'classes' end,
        to_char(v_on, 'FMDD Mon YYYY'))
    );
  end if;

  if v_lessons > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'timetable',
      'message', format(
        '%s %s now %s nobody teaching %s. They show on the cover list as '
        'unassigned until the timetable is redrawn.',
        v_lessons, case when v_lessons = 1 then 'lesson' else 'lessons' end,
        case when v_lessons = 1 then 'has' else 'have' end,
        case when v_lessons = 1 then 'it' else 'them' end)
    );
  end if;

  return jsonb_build_object(
    'staff_id', p_staff_id,
    'staff', v_name,
    'left_on', v_on,
    'status', p_status,
    'unassigned', jsonb_build_object(
      'lessons', v_lessons,
      'sections', v_sections,
      'subjects', v_subjects
    ),
    'closed', jsonb_build_object('library', v_library),
    'outstanding', v_outstanding
  );
end;
$$;
