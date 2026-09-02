-- Phase 1.2, part 3 -- a readable refusal for a break period, and a demo week.

-- ---------------------------------------------------------------------------
-- Saying "that is the lunch break" in words
-- ---------------------------------------------------------------------------

-- The composite foreign key added in 0040 already refuses an exam period or a
-- break, and that is the enforcement. What it produces is
-- `violates foreign key constraint "timetable_entries_slot_fkey"`, which is a
-- correct answer to a question nobody asked.
--
-- The clash paths in 0041 already got sentences; this one deserves the same
-- treatment for the same reason. The check is not the safety mechanism -- the
-- foreign key is, and it still runs underneath -- it only decides what the
-- person sees.
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

-- ---------------------------------------------------------------------------
-- A week worth looking at
-- ---------------------------------------------------------------------------

-- Row by row, not one set-based insert, on purpose. The teacher clash index is
-- the whole point of this table, and a single `insert ... select` cannot see the
-- rows it is inserting -- so it would either raise halfway through or need the
-- clash rules restated as a window function, which is the same logic written
-- twice and free to disagree with the index.
--
-- The loop lets a busy teacher simply skip the cell. The resulting free periods
-- are not a defect of the seed: a real routine has them for exactly this reason,
-- and a demo where every cell is full would misrepresent what building one
-- feels like.
--
-- Each section keeps one home room, so rooms never clash. That is also how most
-- schools in this product's market actually run: the class stays put and the
-- teachers move.
do $$
declare
  v_section record;
  v_slot record;
  v_day integer;
  v_subject record;
  v_subject_count integer;
  v_index integer;
begin
  for v_section in
    select s.id, s.tenant_id, s.session_id,
           row_number() over (partition by s.tenant_id order by s.name) - 1 as seq
    from public.sections s
    where s.session_id = (
      select a.id from public.academic_sessions a
      where a.tenant_id = s.tenant_id and a.is_current
    )
  loop
    select count(*) into v_subject_count
    from public.section_subjects ss
    where ss.section_id = v_section.id and ss.session_id = v_section.session_id;

    continue when v_subject_count = 0;

    for v_day in 1..5 loop
      v_index := 0;

      for v_slot in
        select ts.id, ts.period_number
        from public.time_slots ts
        where ts.tenant_id = v_section.tenant_id and ts.schedulable
        order by ts.period_number
      loop
        -- A different starting subject per section and per day, so the demo
        -- does not read as the same period repeated twelve times.
        select ss.subject_id, ss.teacher_staff_id into v_subject
        from public.section_subjects ss
        where ss.section_id = v_section.id and ss.session_id = v_section.session_id
        order by ss.subject_id
        offset ((v_section.seq * 3 + v_day * 2 + v_index) % v_subject_count)
        limit 1;

        begin
          insert into public.timetable_entries (
            tenant_id, session_id, section_id, subject_id,
            teacher_staff_id, class_room_id, time_slot_id, weekday
          )
          select
            v_section.tenant_id, v_section.session_id, v_section.id,
            v_subject.subject_id, v_subject.teacher_staff_id,
            (
              select cr.id from public.class_rooms cr
              where cr.tenant_id = v_section.tenant_id and cr.is_active
              order by cr.name
              offset (v_section.seq % greatest((
                select count(*) from public.class_rooms cr2
                where cr2.tenant_id = v_section.tenant_id and cr2.is_active
              ), 1))
              limit 1
            ),
            v_slot.id, v_day;
        exception when unique_violation then
          -- The teacher is already elsewhere in this period. Leave it free.
          null;
        end;

        v_index := v_index + 1;
      end loop;
    end loop;
  end loop;
end $$;
