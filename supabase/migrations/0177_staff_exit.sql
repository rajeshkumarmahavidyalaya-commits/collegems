-- ---------------------------------------------------------------------------
-- Leaving, for the other half of the identity model
-- ---------------------------------------------------------------------------
--
-- `student_exit` (migration `0174`) with staff in it, and the same rule:
--
--   > A status column is a **summary**. The relationships belong to the modules
--   > that made them, so an ending is one act that ends them.
--
-- The relationships are different, and one of them cannot be *ended* at all.
-- A departing teacher's lessons do not stop existing -- Grade 4 still has
-- English on Monday -- so this **unassigns** them rather than deleting them,
-- and `0176` is what makes an unassigned lesson visible instead of silently
-- dropping it off the morning list.
--
-- WHY UNASSIGN RATHER THAN LEAVE THE NAME THERE
--
-- Migration `0155`'s distinction. A `timetable_entries.teacher_staff_id` is a
-- statement about **now** -- who teaches this -- so it must not go on naming
-- somebody who has left. A `substitutions.absent_staff_id` is a statement about
-- **a day that has passed**, so it is frozen and untouched. Same schema, two
-- kinds of column, and the exit treats them oppositely on purpose.
--
-- Payroll needs nothing from this: `payroll_preview` and `hr_attendance_sheet`
-- already read `date_of_leaving`, from the payroll-gaps work. What this adds is
-- everything the timetable knew and nobody had told.

-- ---------------------------------------------------------------------------
-- Terminated is not the only way to leave
-- ---------------------------------------------------------------------------
--
-- `staff_status_check` allowed `active`, `inactive`, `terminated`. A retirement
-- and a dismissal are not the same fact -- they read differently on a
-- reference, and in several jurisdictions they are treated differently in law
-- -- so recording both as "terminated" loses something a school cannot
-- reconstruct.
--
-- The CHECK stays the enforcement, per the conventions: the guard inside
-- `staff_exit` exists "for the message, not for the enforcement", because
-- *new row violates check constraint "staff_status_check"* is not a sentence
-- to show somebody recording a colleague's retirement.

alter table public.staff drop constraint staff_status_check;
alter table public.staff add constraint staff_status_check
  check (status in ('active', 'inactive', 'terminated', 'resigned', 'retired'));

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

  -- 4. The employment record, last -- so a failure above leaves them visibly
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
    'outstanding', v_outstanding
  );
end;
$$;

revoke all on function public.staff_exit(uuid, text, date, text) from public, anon;
grant execute on function public.staff_exit(uuid, text, date, text) to authenticated;

comment on function public.staff_exit(uuid, text, date, text) is
  'Unassigns the timetable, class-teacher duty and subject assignments, then '
  'closes the employment. Reports what it cannot end -- library books, future '
  'cover, lessons now with nobody. Idempotent. See migration 0177.';

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------
--
-- The one that matters is the first, because it is **true in this database
-- today**: one terminated member of staff, 19 lessons, 2 sections, 6 subject
-- assignments, and nothing anywhere said so.

create or replace function public.staff_exit_problems()
returns table (staff_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id,
    'error'::text,
    format(
      '%s %s is marked %s but still %s. Those classes have nobody, and the '
      'cover roster cannot see it because a departed teacher is not "away".',
      p.first_name, p.last_name, s.status,
      array_to_string(array_remove(array[
        case when (select count(*) from public.timetable_entries te
                   where te.teacher_staff_id = s.id) > 0
             then format('teaches %s lessons',
                  (select count(*) from public.timetable_entries te
                   where te.teacher_staff_id = s.id)) end,
        case when (select count(*) from public.sections se
                   where se.class_teacher_staff_id = s.id) > 0
             then format('leads %s sections',
                  (select count(*) from public.sections se
                   where se.class_teacher_staff_id = s.id)) end,
        case when (select count(*) from public.section_subjects ss
                   where ss.teacher_staff_id = s.id) > 0
             then format('holds %s subject assignments',
                  (select count(*) from public.section_subjects ss
                   where ss.teacher_staff_id = s.id)) end
      ], null), ', ')
    )
  from public.staff s
  join public.people p on p.id = s.person_id
  where s.status <> 'active'
    and (
      exists (select 1 from public.timetable_entries te where te.teacher_staff_id = s.id)
      or exists (select 1 from public.sections se where se.class_teacher_staff_id = s.id)
      or exists (select 1 from public.section_subjects ss where ss.teacher_staff_id = s.id)
    )

  union all

  -- The other direction: employed, but the record says they left. Payroll reads
  -- `date_of_leaving`, so this is somebody who has quietly stopped being paid.
  select
    s.id,
    'warning'::text,
    format(
      '%s %s is active but has a leaving date of %s, so payroll has stopped '
      'paying them. One of the two is wrong.',
      p.first_name, p.last_name, to_char(s.date_of_leaving, 'FMDD Mon YYYY')
    )
  from public.staff s
  join public.people p on p.id = s.person_id
  where s.status = 'active'
    and s.date_of_leaving is not null
    and s.date_of_leaving <= current_date

  order by 2, 3
$$;

revoke all on function public.staff_exit_problems() from public, anon;
grant execute on function public.staff_exit_problems() to authenticated;

comment on function public.staff_exit_problems() is
  'Staff who have left but are still on the timetable, and staff still employed '
  'with a leaving date. Both silent before migration 0177.';
