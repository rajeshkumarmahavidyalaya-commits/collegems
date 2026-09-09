-- 0191 — An ending is not a door that stays shut.
--
-- `student_exit` and `staff_exit` end the relationships somebody had. Neither
-- stops new ones being made the next morning, and four doors were still open.
-- All four were probed live, on this school, inside a rolled-back transaction:
--
--   1. **A library book, to a child who has left.** `student_exit` ran, the
--      student came back `transferred` -- and `members.status` was still
--      `active`, so `library_issue_book` issued them a book. The exit function
--      even *counts* their unreturned books to report them; it just never
--      closed the membership.
--   2. **The same door for staff.** `staff_exit` reads `members` for the same
--      report and leaves it open the same way.
--   3. **A fee concession, to a child who has left.** `concession_award`
--      accepted one for the student `student_exit` had just revoked all their
--      concessions from.
--   4. **A lesson, to a teacher who left 30 days ago.** `timetable_set_entry`
--      checks the tenant, the session, the weekday, the teaching week, the
--      period and a clash -- and not whether the person still works here.
--      Probed: *"Rajesh Kumar left 30 days ago; timetable_set_entry ACCEPTED
--      them for weekday 1"*, which is precisely the 19 lessons migration 0176
--      had just finished unassigning.
--
-- And a fifth found by reading rather than probing: `substitution_arrange`
-- takes a substitute's id and never checks it. `substitution_candidates`
-- offers only active staff, but a list is a convenience and the function is
-- the gate.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix
--
-- Two different answers, and the difference is the point.
--
-- **The library membership is part of the ending**, so it belongs in
-- `student_end_relationships` and `staff_exit` beside the bus seat and the
-- hostel bed. `expired`, not `suspended`: a suspension is something a
-- librarian does about behaviour, and this is a membership that ran out
-- because the person is no longer here. The borrowing history stays exactly
-- where it is, and a book still out is still reported rather than forgiven.
--
-- **The other three are guards on the write**, because there is nothing to end
-- -- the relationship does not exist yet. A guard is the only thing that can
-- refuse to create one.
--
-- Why not a constraint for the timetable, given rule 4 prefers one? Because the
-- composite-key device would hold `teacher_status` on the entry, and
-- `on update cascade` would then **refuse the status change itself** while a
-- departed teacher still held lessons. `staff_exit` unassigns first, so it
-- would work -- and an administrator editing a status directly would be
-- stopped by a constraint error instead of being told to unassign. The check
-- goes in the function, and this comment is why.


create or replace function public.student_end_relationships(
  p_student_id uuid,
  p_on date,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_enrolments integer := 0;
  v_transport integer := 0;
  v_hostel integer := 0;
  v_concessions integer := 0;
  v_library integer := 0;
begin
  -- No validation here on purpose: this is the act, and the two callers have
  -- different things to check before performing it. `student_exit` refuses an
  -- empty reason; `promotion_apply` has already refused a run that is not a
  -- draft. A third caller must do its own checking, and that is the point of
  -- the function being this narrow.

  -- 1. The enrolment. `withdrawn` rather than `transferred_out` unless the
  --    school said transfer, because the two mean different things to whoever
  --    reads a class list next year. A caller that has already closed the
  --    outgoing year with a better word -- `promoted`, for a graduate -- finds
  --    nothing active here and closes nothing.
  update public.enrolments
  set status = case when p_status = 'transferred' then 'transferred_out' else 'withdrawn' end
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_enrolments = row_count;

  -- 2. The bus seat. Ended, not cancelled: the child genuinely rode the bus
  --    until the day they left, and rewriting that to `cancelled` erases a fact
  --    the school was right to record.
  update public.transport_assignments
  set ends_on = p_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= p_on
    and effective_ends_on > p_on;
  get diagnostics v_transport = row_count;

  -- An arrangement that has not started yet was never ridden, and an `ends_on`
  -- before `starts_on` is refused by the range CHECK anyway.
  update public.transport_assignments
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > p_on;

  -- 3. The hostel bed, which also frees it for somebody else.
  update public.hostel_allocations
  set ends_on = p_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= p_on
    and effective_ends_on > p_on;
  get diagnostics v_hostel = row_count;

  update public.hostel_allocations
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > p_on;

  -- 4. Concessions. A discount on a bill nobody will raise is harmless, but it
  --    keeps the child on the concessions register and in its cost total, which
  --    is a number a bursar reports to a board.
  update public.student_concessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = ( select auth.uid() ),
      revoke_reason = p_reason
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_concessions = row_count;

  -- 5. The library membership. `expired`, not `suspended`: a suspension is
  --    something a librarian does about behaviour, and this is a membership
  --    that ran out because the person is no longer at the school. The
  --    borrowing history stays exactly where it is -- and any book still out
  --    is reported below rather than silently forgiven.
  update public.members
  set status = 'expired'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_library = row_count;

  -- 6. The status itself, last, so a failure above leaves the child visibly
  --    still here rather than half-gone.
  update public.students
  set status = p_status
  where id = p_student_id and tenant_id = v_tenant_id;

  return jsonb_build_object(
    'enrolments', v_enrolments,
    'transport', v_transport,
    'hostel', v_hostel,
    'concessions', v_concessions,
    'library', v_library
  );
end;
$$;


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
    'outstanding', v_outstanding
  );
end;
$$;


create or replace function public.concession_award(
  p_student_id uuid,
  p_concession_id uuid,
  p_reason text,
  p_ends_on date default null
)
returns public.student_concessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.student_concessions;
  v_name text;
  v_session record;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session';
  end if;

  select name, end_date into v_session
  from public.academic_sessions where id = v_session_id;

  -- An award is for a year. Running one past the year's end would make next
  -- year's bill quietly cheaper for a family nobody re-awarded (0178).
  if p_ends_on is not null and p_ends_on > v_session.end_date then
    raise exception
      'An award runs for one year. % ends on %, so this one cannot run to %. Award it again next year.',
      v_session.name, to_char(v_session.end_date, 'FMDD Mon YYYY'),
      to_char(p_ends_on, 'FMDD Mon YYYY');
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this concession was granted -- a discount with no reason is the one an auditor asks about';
  end if;

  select name into v_name from public.fee_concessions
  where id = p_concession_id and is_active;
  if v_name is null then
    raise exception 'No such concession, or it is no longer offered';
  end if;

  -- A concession comes off a bill, so there has to be one. A child with no
  -- active enrolment this year is not being invoiced, and awarding them a
  -- discount only writes a row nobody will ever apply -- see migration 0191.
  if not exists (
    select 1 from public.enrolments e
    where e.student_id = p_student_id
      and e.session_id = v_session_id
      and e.status = 'active'
  ) then
    raise exception
      'That child is not enrolled in %, so there is no bill to take a concession off.',
      v_session.name;
  end if;

  begin
    insert into public.student_concessions (
      tenant_id, session_id, student_id, concession_id,
      reason, ends_on, granted_by, session_ends_on
    )
    values (
      v_tenant_id, v_session_id, p_student_id, p_concession_id,
      trim(p_reason), p_ends_on, ( select auth.uid() ), v_session.end_date
    )
    returning * into v_row;
  exception when unique_violation then
    raise exception '% is already awarded to this student for this year. Revoke it first if the terms have changed.', v_name;
  end;

  if v_row.id is null then
    raise exception 'You may not award concessions';
  end if;

  return v_row;
end;
$$;


create or replace function public.timetable_set_entry(
  p_section_id uuid,
  p_weekday integer,
  p_time_slot_id uuid,
  p_subject_id uuid,
  p_teacher_staff_id uuid default null,
  p_class_room_id uuid default null,
  p_note text default null
)
returns public.timetable_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_clash_id uuid;
  v_slot public.time_slots;
  v_entry public.timetable_entries;
  v_teacher_name text;
  v_teacher_status text;
  v_teacher_left date;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if p_weekday is null or p_weekday not between 1 and 7 then
    raise exception 'A weekday must be 1 (Monday) through 7 (Sunday)';
  end if;

  if exists (
    select 1 from public.weekends w
    where w.tenant_id = v_tenant_id
      and w.weekday = p_weekday
      and not w.is_teaching
  ) then
    raise exception 'The school is closed on that weekday. Turn it on under Academics → Teaching week first.';
  end if;

  select * into v_slot from public.time_slots ts
  where ts.tenant_id = v_tenant_id and ts.id = p_time_slot_id;

  if v_slot.id is null then
    raise exception 'That period does not exist';
  end if;

  if not v_slot.schedulable then
    raise exception 'Period % is %, so no lesson can be scheduled in it',
      v_slot.period_number,
      case when v_slot.is_break then 'a break' else 'part of the exam schedule' end;
  end if;

  if p_teacher_staff_id is not null then
    -- Somebody who has left cannot be put back on the roster. `staff_exit`
    -- unassigns their lessons and nothing stopped them being reassigned the
    -- next day -- probed: a teacher terminated 30 days ago was accepted onto
    -- Monday's timetable (migration 0191). The check is here rather than at a
    -- constraint because a status change has to stay possible while the
    -- unassignment it triggers is still in flight.
    select (p.first_name || ' ' || p.last_name), s.status, s.date_of_leaving
    into v_teacher_name, v_teacher_status, v_teacher_left
    from public.staff s
    join public.people p on p.id = s.person_id
    where s.id = p_teacher_staff_id and s.tenant_id = v_tenant_id;

    if v_teacher_name is null then
      raise exception 'That member of staff does not exist';
    end if;

    if v_teacher_status <> 'active' then
      -- Two placeholders, not three: `%%` in a `raise` format is a literal
      -- per cent sign, so the leaving date is concatenated onto the status
      -- rather than passed as a third argument.
      raise exception
        '% is marked %, so they cannot be given a lesson. Pick somebody else, or put them back on the staff list first.',
        v_teacher_name,
        v_teacher_status || case when v_teacher_left is not null
          then ' (left ' || to_char(v_teacher_left, 'FMDD Mon YYYY') || ')'
          else '' end;
    end if;

    select e.id into v_clash_id
    from public.timetable_entries e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.weekday = p_weekday
      and e.time_slot_id = p_time_slot_id
      and e.teacher_staff_id = p_teacher_staff_id
      and e.section_id <> p_section_id
    limit 1;

    if v_clash_id is not null then
      raise exception 'That teacher is already taking %', public.timetable_describe_entry(v_clash_id);
    end if;
  end if;

  if p_class_room_id is not null then
    select e.id into v_clash_id
    from public.timetable_entries e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.weekday = p_weekday
      and e.time_slot_id = p_time_slot_id
      and e.class_room_id = p_class_room_id
      and e.section_id <> p_section_id
    limit 1;

    if v_clash_id is not null then
      raise exception 'That room is already in use for %', public.timetable_describe_entry(v_clash_id);
    end if;
  end if;

  insert into public.timetable_entries (
    tenant_id, session_id, section_id, subject_id,
    teacher_staff_id, class_room_id, time_slot_id, weekday, note
  ) values (
    v_tenant_id, v_session_id, p_section_id, p_subject_id,
    p_teacher_staff_id, p_class_room_id, p_time_slot_id, p_weekday,
    nullif(trim(coalesce(p_note, '')), '')
  )
  on conflict on constraint timetable_entries_section_slot_key
  do update set
    subject_id = excluded.subject_id,
    teacher_staff_id = excluded.teacher_staff_id,
    class_room_id = excluded.class_room_id,
    note = excluded.note
  returning * into v_entry;

  return v_entry;
end;
$$;


create or replace function public.substitution_arrange(
  p_timetable_entry_id uuid,
  p_date date,
  p_substitute_staff_id uuid default null,
  p_note text default null
)
returns public.substitutions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_e public.timetable_entries;
  v_row public.substitutions;
  v_name text;
  v_sub_status text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_e from public.timetable_entries where id = p_timetable_entry_id;
  if v_e.id is null then
    raise exception 'No such lesson, or you cannot see it';
  end if;

  if v_e.weekday <> extract(isodow from p_date)::integer then
    raise exception 'That lesson is not taught on a %', to_char(p_date, 'FMDay');
  end if;

  -- An unassigned lesson is coverable without anybody being away: there is
  -- nobody to be away. `absent_staff_id` is nullable for exactly this.
  if v_e.teacher_staff_id is not null
     and not public.staff_is_away(p_date, v_e.teacher_staff_id) then
    select (p.first_name || ' ' || p.last_name) into v_name
    from public.staff s join public.people p on p.id = s.person_id
    where s.id = v_e.teacher_staff_id;

    raise exception
      '% is not marked away on %. Approve their leave or mark the register first.',
      v_name, to_char(p_date, 'FMDD Mon YYYY');
  end if;

  -- The cover teacher has to still work here. `substitution_candidates` already
  -- offers only active staff, but the list is a convenience and this function
  -- is the gate: a caller passing an id directly bypassed it entirely.
  if p_substitute_staff_id is not null then
    select (p.first_name || ' ' || p.last_name), s.status
    into v_name, v_sub_status
    from public.staff s join public.people p on p.id = s.person_id
    where s.id = p_substitute_staff_id and s.tenant_id = v_tenant_id;

    if v_name is null then
      raise exception 'That member of staff does not exist';
    end if;

    if v_sub_status <> 'active' then
      raise exception
        '% is marked %, so they cannot cover a class.', v_name, v_sub_status;
    end if;
  end if;

  begin
    insert into public.substitutions (
      tenant_id, session_id, on_date, timetable_entry_id,
      absent_staff_id, time_slot_id, substitute_staff_id, note, arranged_by
    )
    values (
      v_tenant_id, v_e.session_id, p_date, v_e.id,
      v_e.teacher_staff_id, v_e.time_slot_id, p_substitute_staff_id,
      nullif(trim(coalesce(p_note, '')), ''), ( select auth.uid() )
    )
    on conflict (timetable_entry_id, on_date) do update
      set substitute_staff_id = excluded.substitute_staff_id,
          note = excluded.note,
          arranged_by = excluded.arranged_by
    returning * into v_row;
  exception when unique_violation then
    select (p.first_name || ' ' || p.last_name) into v_name
    from public.staff s join public.people p on p.id = s.person_id
    where s.id = p_substitute_staff_id;

    raise exception
      '% is already covering another class in that period on %.',
      coalesce(v_name, 'That teacher'), to_char(p_date, 'FMDD Mon YYYY');
  end;

  if v_row.id is null then
    raise exception 'You cannot arrange cover for this lesson';
  end if;

  return v_row;
end;
$$;

