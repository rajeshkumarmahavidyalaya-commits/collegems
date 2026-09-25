-- 0287: two corrections to 0286, both found by probing it.
--
-- 1. The timetable was slow for a family. `timetable_for_section` resolved "my
--    children in this class" through `family_my_students()`, which projects
--    names and photographs through the policies on `people` and `students`:
--    measured 87 ms a call as a student, against 4 ms for the whole read as an
--    administrator. The relationship is now read as ids from `user_profiles`
--    and `guardian_student` (the same two columns that function reads), and
--    `student_takes_subject` is asked only about elective subjects -- for any
--    other subject its answer is yes for everybody, and each call cost 0.8 ms.
--    Both numbers were measured as the student, not as `postgres`.
--
-- 2. The refusal for a third subject read "Grade 4 A already has Art & Craft,
--    Hindi in period 4" and then said "both". The list takes its conjunction
--    and the sentence no longer assumes two.

create or replace function public.timetable_entries_share_a_period()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_others uuid[];
  v_class_level_id uuid;
  v_section_label text;
  v_period integer;
  v_names text;
begin
  -- One period of one class at a time: two concurrent writes each seeing the
  -- period empty would otherwise both succeed.
  perform pg_advisory_xact_lock(
    hashtextextended('timetable_period:' || new.tenant_id || ':' || new.session_id || ':'
      || new.section_id || ':' || new.weekday || ':' || new.time_slot_id, 0));

  select array_agg(distinct e.subject_id) into v_others
  from public.timetable_entries e
  where e.tenant_id = new.tenant_id
    and e.session_id = new.session_id
    and e.section_id = new.section_id
    and e.weekday = new.weekday
    and e.time_slot_id = new.time_slot_id
    and e.id <> new.id
    and e.subject_id <> new.subject_id;

  if v_others is null then
    return new;
  end if;

  select s.class_level_id, cl.name || ' ' || s.name
  into v_class_level_id, v_section_label
  from public.sections s
  join public.class_levels cl on cl.id = s.class_level_id
  where s.id = new.section_id;

  if exists (
    select 1
    from public.subject_groups g
    where g.tenant_id = new.tenant_id
      and g.session_id = new.session_id
      and g.class_level_id = v_class_level_id
      and not exists (
        select 1
        from unnest(v_others || new.subject_id) as x(subject_id)
        where not exists (
          select 1 from public.subject_group_options o
          where o.group_id = g.id and o.subject_id = x.subject_id
        )
      )
  ) then
    return new;
  end if;

  -- "Art & Craft and Hindi", not "Art & Craft, Hindi": the conjunction is part
  -- of the sentence (0287).
  select case
           when count(*) = 1 then min(sub.name)
           else array_to_string((array_agg(sub.name order by sub.name))[1:count(*)::int - 1], ', ')
                || ' and ' || (array_agg(sub.name order by sub.name))[count(*)::int]
         end
  into v_names
  from public.subjects sub where sub.id = any (v_others);

  select ts.period_number into v_period
  from public.time_slots ts where ts.id = new.time_slot_id;

  raise exception
    '% already has % in period % that day. Subjects can share a period only when every one of them is a choice in the same elective group for the class, so each child goes to the one they chose. Put them in a group under Academics > Electives, or use another period.',
    v_section_label, v_names, v_period;
end;
$$;

create or replace function public.timetable_for_section(p_section_id uuid)
returns table (
  id uuid, weekday integer, time_slot_id uuid, period_number integer,
  slot_label text, starts_at time, ends_at time,
  subject_id uuid, subject_name text, subject_code text,
  teacher_staff_id uuid, teacher_name text,
  class_room_id uuid, room_name text, note text
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select up.student_id, up.guardian_id
    from public.user_profiles up
    where up.id = ( select auth.uid() ) and up.staff_id is null
  ),
  mine as (
    -- The caller's own children in this class, or themselves if they are the
    -- student. Empty for a member of staff, who sees the whole class -- even a
    -- teacher whose own child is in it (0286).
    --
    -- The relationship `family_my_students()` defines (the login's student,
    -- and the guardian's children), read as ids alone: that function projects
    -- names and photographs through the policies on `people` and `students`,
    -- which measured 87 ms a call for a student, to answer a question that
    -- needs two uuids (0287).
    select en.student_id
    from me
    join public.enrolments en
      on en.section_id = p_section_id
     and en.status = 'active'
     and en.session_id = public.current_session_id(public.current_tenant_id())
    where en.student_id = me.student_id
       or en.student_id in (
         select gs.student_id from public.guardian_student gs
         where gs.guardian_id = me.guardian_id
       )
  ),
  electives as (
    -- The subjects that are a choice for this class this year. Only those need
    -- asking about per child; every other subject is everybody's.
    select o.subject_id
    from public.subject_group_options o
    join public.subject_groups g on g.id = o.group_id
    where g.session_id = public.current_session_id(public.current_tenant_id())
      and g.class_level_id = (select s.class_level_id from public.sections s where s.id = p_section_id)
  )
  select
    e.id,
    e.weekday,
    e.time_slot_id,
    ts.period_number,
    ts.label,
    ts.starts_at,
    ts.ends_at,
    e.subject_id,
    sub.name,
    sub.code,
    e.teacher_staff_id,
    sd.full_name,
    e.class_room_id,
    cr.name,
    e.note
  from public.timetable_entries e
  join public.time_slots ts on ts.id = e.time_slot_id
  join public.subjects sub on sub.id = e.subject_id
  left join public.staff_directory() sd on sd.staff_id = e.teacher_staff_id
  left join public.class_rooms cr on cr.id = e.class_room_id
  where e.section_id = p_section_id
    and e.session_id = public.current_session_id(public.current_tenant_id())
    -- A family sees the lessons their child takes: a compulsory subject, or an
    -- elective they chose. Parallel electives they did not choose are not
    -- their lesson (0286).
    and (
      not exists (select 1 from mine)
      or e.subject_id not in (select el.subject_id from electives el)
      or exists (
        select 1 from mine m
        where public.student_takes_subject(
          m.student_id, e.subject_id, e.session_id,
          (select s.class_level_id from public.sections s where s.id = e.section_id))
      )
    )
  order by e.weekday, ts.period_number, sub.name
$$;
