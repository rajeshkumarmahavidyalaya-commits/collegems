-- Phase 1.2, part 2 -- the routine's read paths and its one write path.
--
-- The unique indexes in 0040 are what make a clash impossible. These functions
-- are what make a clash *legible*: "Mrs Sharma is already taking Grade 7A
-- mathematics" instead of
-- "duplicate key value violates unique constraint timetable_entries_teacher_clash".
--
-- The check-then-insert here is not the safety mechanism and is not pretending
-- to be. Two concurrent saves can both pass the check; the index still refuses
-- the second, and the caller still gets an error. The check exists only so that
-- the usual case gets a sentence a human can act on.

-- ---------------------------------------------------------------------------
-- Naming a period, for error messages
-- ---------------------------------------------------------------------------

create or replace function public.timetable_describe_entry(p_entry_id uuid)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select cl.name || ' ' || s.name || ' · ' || sub.name
         || ' (period ' || ts.period_number || ')'
  from public.timetable_entries e
  join public.sections s on s.id = e.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = e.subject_id
  join public.time_slots ts on ts.id = e.time_slot_id
  where e.id = p_entry_id
$$;

revoke all on function public.timetable_describe_entry(uuid) from public, anon;
grant execute on function public.timetable_describe_entry(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Saving a cell
-- ---------------------------------------------------------------------------

-- An upsert, because the grid's mental model is that a cell holds one lesson.
-- Saving into a filled cell replaces what is there; that is what a person who
-- clicks a filled cell and picks a different subject means, and making them
-- delete first would be ceremony.
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

  -- The school's own statement about which days it teaches. A lesson scheduled
  -- on a closed day would never be marked, and attendance would quietly report
  -- it missing forever.
  if exists (
    select 1 from public.weekends w
    where w.tenant_id = v_tenant_id
      and w.weekday = p_weekday
      and not w.is_teaching
  ) then
    raise exception 'The school is closed on that weekday. Turn it on under Academics → Teaching week first.';
  end if;

  -- Same period, same teacher, a different class. Excluding this section is
  -- what identifies "the cell being written" -- weekday and slot already match,
  -- so the section is the only thing left that distinguishes the target row
  -- from a genuine clash.
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

revoke all on function public.timetable_set_entry(uuid, integer, uuid, uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.timetable_set_entry(uuid, integer, uuid, uuid, uuid, uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Copying a day
-- ---------------------------------------------------------------------------

-- Most schools run four or five near-identical days, so building each one by
-- hand is the single most tedious thing about setting up a routine.
--
-- It fills empty periods only. A copy that overwrote the target day would be a
-- destructive action disguised as a convenience, and there is no undo for it --
-- so periods already filled, and periods where the teacher or the room is busy
-- elsewhere, are skipped and counted. The caller reports both numbers.
create or replace function public.timetable_copy_day(
  p_section_id uuid,
  p_from_weekday integer,
  p_to_weekday integer
)
returns table (copied integer, skipped integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_source integer;
  v_copied integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if p_from_weekday = p_to_weekday then
    raise exception 'Pick two different days';
  end if;

  if exists (
    select 1 from public.weekends w
    where w.tenant_id = v_tenant_id and w.weekday = p_to_weekday and not w.is_teaching
  ) then
    raise exception 'The school is closed on that weekday. Turn it on under Academics → Teaching week first.';
  end if;

  select count(*) into v_source
  from public.timetable_entries e
  where e.tenant_id = v_tenant_id
    and e.session_id = v_session_id
    and e.section_id = p_section_id
    and e.weekday = p_from_weekday;

  insert into public.timetable_entries (
    tenant_id, session_id, section_id, subject_id,
    teacher_staff_id, class_room_id, time_slot_id, weekday, note
  )
  select
    src.tenant_id, src.session_id, src.section_id, src.subject_id,
    src.teacher_staff_id, src.class_room_id, src.time_slot_id, p_to_weekday, src.note
  from public.timetable_entries src
  where src.tenant_id = v_tenant_id
    and src.session_id = v_session_id
    and src.section_id = p_section_id
    and src.weekday = p_from_weekday
    -- The teacher and room clash indexes would raise rather than skip, and one
    -- busy teacher must not abandon the whole copy, so they are filtered here.
    and not exists (
      select 1 from public.timetable_entries busy
      where busy.tenant_id = src.tenant_id
        and busy.session_id = src.session_id
        and busy.weekday = p_to_weekday
        and busy.time_slot_id = src.time_slot_id
        and busy.teacher_staff_id is not null
        and busy.teacher_staff_id = src.teacher_staff_id
    )
    and not exists (
      select 1 from public.timetable_entries busy
      where busy.tenant_id = src.tenant_id
        and busy.session_id = src.session_id
        and busy.weekday = p_to_weekday
        and busy.time_slot_id = src.time_slot_id
        and busy.class_room_id is not null
        and busy.class_room_id = src.class_room_id
    )
  on conflict on constraint timetable_entries_section_slot_key do nothing;

  get diagnostics v_copied = row_count;

  return query select v_copied, v_source - v_copied;
end;
$$;

revoke all on function public.timetable_copy_day(uuid, integer, integer) from public, anon;
grant execute on function public.timetable_copy_day(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading a section's week
-- ---------------------------------------------------------------------------

-- Written here rather than as a PostgREST query with embeds: every foreign key
-- on this table is composite, and embedding across a composite key is not
-- something this project has been able to verify. The join is plain SQL and
-- plainly correct.
create or replace function public.timetable_for_section(p_section_id uuid)
returns table (
  id uuid,
  weekday integer,
  time_slot_id uuid,
  period_number integer,
  slot_label text,
  starts_at time,
  ends_at time,
  subject_id uuid,
  subject_name text,
  subject_code text,
  teacher_staff_id uuid,
  teacher_name text,
  class_room_id uuid,
  room_name text,
  note text
)
language sql
stable
set search_path = public, extensions
as $$
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
    case when p.first_name is null then null else p.first_name || ' ' || p.last_name end,
    e.class_room_id,
    cr.name,
    e.note
  from public.timetable_entries e
  join public.time_slots ts on ts.id = e.time_slot_id
  join public.subjects sub on sub.id = e.subject_id
  left join public.staff st on st.id = e.teacher_staff_id
  left join public.people p on p.id = st.person_id
  left join public.class_rooms cr on cr.id = e.class_room_id
  where e.section_id = p_section_id
    and e.session_id = public.current_session_id(public.current_tenant_id())
  order by e.weekday, ts.period_number
$$;

revoke all on function public.timetable_for_section(uuid) from public, anon;
grant execute on function public.timetable_for_section(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading a teacher's week
-- ---------------------------------------------------------------------------

-- `p_staff_id` defaults to the caller's own staff record, so a teacher opening
-- "My week" needs to pass nothing -- and cannot pass somebody else's id by
-- accident. Passing one explicitly is how an administrator reviews a colleague's
-- load; RLS allows it because a routine is public within the school.
create or replace function public.timetable_for_teacher(p_staff_id uuid default null)
returns table (
  id uuid,
  weekday integer,
  time_slot_id uuid,
  period_number integer,
  starts_at time,
  ends_at time,
  section_id uuid,
  section_label text,
  subject_name text,
  subject_code text,
  room_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.weekday,
    e.time_slot_id,
    ts.period_number,
    ts.starts_at,
    ts.ends_at,
    e.section_id,
    cl.name || ' ' || s.name,
    sub.name,
    sub.code,
    cr.name
  from public.timetable_entries e
  join public.time_slots ts on ts.id = e.time_slot_id
  join public.sections s on s.id = e.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = e.subject_id
  left join public.class_rooms cr on cr.id = e.class_room_id
  where e.session_id = public.current_session_id(public.current_tenant_id())
    and e.teacher_staff_id = coalesce(
      p_staff_id,
      ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  order by e.weekday, ts.period_number
$$;

revoke all on function public.timetable_for_teacher(uuid) from public, anon;
grant execute on function public.timetable_for_teacher(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is busy in this period?
-- ---------------------------------------------------------------------------

-- Answered before the save, not after it. A dropdown that lets somebody pick a
-- teacher who is demonstrably teaching elsewhere, and only then refuses, wastes
-- the one thing this screen is short of -- the administrator's patience during
-- a two-hour timetable-building session.
create or replace function public.timetable_busy_in_slot(
  p_weekday integer,
  p_time_slot_id uuid,
  p_section_id uuid default null
)
returns table (
  entity text,
  entity_id uuid,
  busy_with text
)
language sql
stable
set search_path = public, extensions
as $$
  with occupied as (
    select e.id, e.teacher_staff_id, e.class_room_id
    from public.timetable_entries e
    where e.session_id = public.current_session_id(public.current_tenant_id())
      and e.weekday = p_weekday
      and e.time_slot_id = p_time_slot_id
      -- The cell being edited is not a conflict with itself.
      and (p_section_id is null or e.section_id <> p_section_id)
  )
  select 'teacher'::text, o.teacher_staff_id, public.timetable_describe_entry(o.id)
  from occupied o where o.teacher_staff_id is not null
  union all
  select 'room'::text, o.class_room_id, public.timetable_describe_entry(o.id)
  from occupied o where o.class_room_id is not null
$$;

revoke all on function public.timetable_busy_in_slot(integer, uuid, uuid) from public, anon;
grant execute on function public.timetable_busy_in_slot(integer, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Teaching load
-- ---------------------------------------------------------------------------

-- Periods per week per teacher. The number a head teacher actually looks at
-- when deciding whether a routine is finished: an unbalanced load is the usual
-- reason one gets rebuilt.
create or replace function public.timetable_teacher_load()
returns table (
  staff_id uuid,
  teacher_name text,
  employee_code text,
  periods integer,
  sections integer,
  subjects integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    st.id,
    p.first_name || ' ' || p.last_name,
    st.employee_code,
    count(e.id)::integer,
    count(distinct e.section_id)::integer,
    count(distinct e.subject_id)::integer
  from public.staff st
  join public.people p on p.id = st.person_id
  left join public.timetable_entries e
    on e.teacher_staff_id = st.id
   and e.session_id = public.current_session_id(public.current_tenant_id())
  where st.status = 'active'
  group by st.id, p.first_name, p.last_name, st.employee_code
  order by count(e.id) desc, st.employee_code
$$;

revoke all on function public.timetable_teacher_load() from public, anon;
grant execute on function public.timetable_teacher_load() to authenticated;
