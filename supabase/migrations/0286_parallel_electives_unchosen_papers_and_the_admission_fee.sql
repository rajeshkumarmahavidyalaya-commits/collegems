-- 0286: three things the electives module left for later, done.
--
-- 1. A period can hold parallel elective lessons.
--
--    `timetable_entries_section_slot_key` made a period one subject for the
--    whole class. An elective is the opposite: in period 3 half of Grade 11 A
--    goes to Hindi and half to Sanskrit. So the key now includes the subject,
--    and a trigger allows a second subject in a period ONLY when every subject
--    in that period is an option of one elective group for the class and year.
--    Anything else ("Physics and Maths at once") is refused in a sentence.
--
--    It is a trigger, not a check in `timetable_set_entry`, because an
--    administrator's plain insert through PostgREST routes around any function
--    (0205). It takes an advisory lock on the period, because the rule is about
--    other rows and no constraint sees a second row (rule 4).
--
--    `timetable_set_entry` gains `p_entry_id`: editing a lesson updates THAT
--    row; without it the call adds a lesson (or updates the same subject in the
--    same period). The old seven-argument function is dropped, not kept beside
--    it: two bodies is where a check stops being updated in one of them.
--    Teacher and room clash checks now exclude only the row being written, so a
--    teacher booked for the parallel lesson in the same class is named rather
--    than meeting the raw unique-index error.
--
--    `timetable_busy_in_slot` excludes the lesson being edited rather than the
--    whole class, for the same reason. `timetable_copy_day` still fills empty
--    periods only -- a period with any lesson in it is skipped -- and copies a
--    parallel period whole.
--
--    `timetable_for_section` shows a family only the lessons their child takes:
--    a compulsory subject, or an elective they chose (`student_takes_subject`,
--    0285). Staff -- anybody whose login is a member of staff -- still see the
--    whole class. The test is the login's own relationship, not the tier, which
--    decides nothing in SQL (0208).
--
-- 2. A child who has not chosen is named, as a count.
--
--    0285 left a child with no choice with no paper, silently. `exams_problems`
--    now says, per class and elective group, how many children have not
--    finished choosing and which papers they therefore do not sit. The count
--    comes from a definer read model, `exams_unchosen_electives`, because the
--    question is a `not exists` over enrolments and choices, and those carry
--    different policies for different roles -- the invoker version would tell
--    an accountant granted `exams.manage` that nobody had chosen. It is gated
--    on `exams.manage` or `academics.manage` (who can act on it), filters the
--    tenant by hand, and returns counts, never names.
--
-- 3. The admission fee is billed on admission, when the school says so.
--
--    `fee_heads.bill_on_admission`, off by default (a school that installs this
--    and finds every new child invoiced without anybody deciding has been badly
--    served). `fees_bill_on_admission(student)` raises one invoice over the
--    flagged heads through `fees_generate_invoice` -- the one definition of
--    what a child is charged -- and answers in jsonb rather than raising,
--    because a failed invoice is not a failed admission: the child is admitted
--    either way and the office is told why the bill was not raised. It is not
--    called by the importer, which loads an existing roll.

-- ---------------------------------------------------------------------------
-- 1. Parallel elective lessons
-- ---------------------------------------------------------------------------

alter table public.timetable_entries
  drop constraint timetable_entries_section_slot_key;

alter table public.timetable_entries
  add constraint timetable_entries_section_slot_subject_key
  unique (tenant_id, session_id, section_id, weekday, time_slot_id, subject_id);

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

  select string_agg(sub.name, ', ' order by sub.name) into v_names
  from public.subjects sub where sub.id = any (v_others);

  select ts.period_number into v_period
  from public.time_slots ts where ts.id = new.time_slot_id;

  raise exception
    '% already has % in period % that day. Two subjects can share a period only when both are choices in one elective group for the class, so each child goes to the one they chose. Put them in a group under Academics > Electives, or use another period.',
    v_section_label, v_names, v_period;
end;
$$;

comment on function public.timetable_entries_share_a_period() is
  'A period holds one subject, or several only when all are options of one elective group for the class and year (0286). A trigger because a plain insert routes around any function.';

revoke all on function public.timetable_entries_share_a_period() from public, anon, authenticated;

create trigger timetable_entries_share_a_period
  before insert or update of subject_id, section_id, weekday, time_slot_id, session_id
  on public.timetable_entries
  for each row execute function public.timetable_entries_share_a_period();

drop function public.timetable_set_entry(uuid, integer, uuid, uuid, uuid, uuid, text);

create function public.timetable_set_entry(
  p_section_id uuid,
  p_weekday integer,
  p_time_slot_id uuid,
  p_subject_id uuid,
  p_teacher_staff_id uuid default null,
  p_class_room_id uuid default null,
  p_note text default null,
  p_entry_id uuid default null
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
  v_target_id uuid;
  v_teacher_name text;
  v_teacher_status text;
  v_teacher_left date;
  v_rows integer;
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
    raise exception 'The school is closed on that weekday. Turn it on under Academics > Teaching week first.';
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

  -- Which row this call writes: the lesson being edited, or the same subject
  -- already in this period (the upsert below). Clash checks exclude exactly
  -- that row, and nothing else -- a parallel lesson in the same class is
  -- somewhere a teacher cannot also be.
  if p_entry_id is not null then
    select e.id into v_target_id
    from public.timetable_entries e
    where e.id = p_entry_id
      and e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.section_id = p_section_id
      and e.weekday = p_weekday
      and e.time_slot_id = p_time_slot_id;

    if v_target_id is null then
      raise exception 'That lesson is no longer on this period. Reload the timetable and try again.';
    end if;
  else
    select e.id into v_target_id
    from public.timetable_entries e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.section_id = p_section_id
      and e.weekday = p_weekday
      and e.time_slot_id = p_time_slot_id
      and e.subject_id = p_subject_id;
  end if;

  if p_teacher_staff_id is not null then
    -- Somebody who has left cannot be put back on the roster (0191).
    select (p.first_name || ' ' || p.last_name), s.status, s.date_of_leaving
    into v_teacher_name, v_teacher_status, v_teacher_left
    from public.staff s
    join public.people p on p.id = s.person_id
    where s.id = p_teacher_staff_id and s.tenant_id = v_tenant_id;

    if v_teacher_name is null then
      raise exception 'That member of staff does not exist';
    end if;

    if v_teacher_status <> 'active' then
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
      and e.id is distinct from v_target_id
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
      and e.id is distinct from v_target_id
    limit 1;

    if v_clash_id is not null then
      raise exception 'That room is already in use for %', public.timetable_describe_entry(v_clash_id);
    end if;
  end if;

  if p_entry_id is not null then
    update public.timetable_entries e
    set subject_id = p_subject_id,
        teacher_staff_id = p_teacher_staff_id,
        class_room_id = p_class_room_id,
        note = nullif(trim(coalesce(p_note, '')), '')
    where e.id = v_target_id
    returning * into v_entry;

    -- An UPDATE no policy matches writes nothing and raises nothing (rule 6).
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'The lesson was not changed. Only an administrator can edit the timetable.';
    end if;

    return v_entry;
  end if;

  insert into public.timetable_entries (
    tenant_id, session_id, section_id, subject_id,
    teacher_staff_id, class_room_id, time_slot_id, weekday, note
  ) values (
    v_tenant_id, v_session_id, p_section_id, p_subject_id,
    p_teacher_staff_id, p_class_room_id, p_time_slot_id, p_weekday,
    nullif(trim(coalesce(p_note, '')), '')
  )
  on conflict on constraint timetable_entries_section_slot_subject_key
  do update set
    teacher_staff_id = excluded.teacher_staff_id,
    class_room_id = excluded.class_room_id,
    note = excluded.note
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.timetable_set_entry(uuid, integer, uuid, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.timetable_set_entry(uuid, integer, uuid, uuid, uuid, uuid, text, uuid) to authenticated;

drop function public.timetable_busy_in_slot(integer, uuid, uuid);

create function public.timetable_busy_in_slot(
  p_weekday integer,
  p_time_slot_id uuid,
  p_entry_id uuid default null
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
      -- The lesson being edited is not a conflict with itself. A parallel
      -- lesson in the same class is (0286), so the class is not excluded.
      and (p_entry_id is null or e.id <> p_entry_id)
  )
  select 'teacher'::text, o.teacher_staff_id, public.timetable_describe_entry(o.id)
  from occupied o where o.teacher_staff_id is not null
  union all
  select 'room'::text, o.class_room_id, public.timetable_describe_entry(o.id)
  from occupied o where o.class_room_id is not null
$$;

revoke all on function public.timetable_busy_in_slot(integer, uuid, uuid) from public, anon;
grant execute on function public.timetable_busy_in_slot(integer, uuid, uuid) to authenticated;

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
    raise exception 'The school is closed on that weekday. Turn it on under Academics > Teaching week first.';
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
    -- Empty periods only. The key now includes the subject (0286), so the
    -- promise "a copy never overwrites" is kept here, per period: a period
    -- with any lesson in it on the target day is skipped whole.
    and not exists (
      select 1 from public.timetable_entries filled
      where filled.tenant_id = src.tenant_id
        and filled.session_id = src.session_id
        and filled.section_id = src.section_id
        and filled.weekday = p_to_weekday
        and filled.time_slot_id = src.time_slot_id
    )
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
  on conflict on constraint timetable_entries_section_slot_subject_key do nothing;

  get diagnostics v_copied = row_count;

  return query select v_copied, v_source - v_copied;
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
  with mine as (
    -- The caller's own children in this class, or themselves if they are the
    -- student. Empty for a member of staff, who sees the whole class -- even a
    -- teacher whose own child is in it (0286).
    select f.student_id
    from public.family_my_students() f
    where f.section_id = p_section_id
      and not exists (
        select 1 from public.user_profiles up
        where up.id = ( select auth.uid() ) and up.staff_id is not null
      )
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
      or exists (
        select 1 from mine m
        where public.student_takes_subject(
          m.student_id, e.subject_id, e.session_id,
          (select s.class_level_id from public.sections s where s.id = e.section_id))
      )
    )
  order by e.weekday, ts.period_number, sub.name
$$;

-- ---------------------------------------------------------------------------
-- 2. Children who have not chosen, counted
-- ---------------------------------------------------------------------------

create or replace function public.exams_unchosen_electives(p_exam_id uuid)
returns table (
  section_label text,
  group_name text,
  subjects text[],
  min_choices integer,
  unchosen integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with ex as (
    select e.id, e.tenant_id
    from public.exams e
    where e.id = p_exam_id
      and e.tenant_id = public.current_tenant_id()
      -- Addressed to whoever can act on it: choose for the child, or open the
      -- choice. Anybody else gets no sentence rather than a guess.
      and (public.role_has_permission('exams.manage')
           or public.role_has_permission('academics.manage'))
  ),
  papers as (
    select es.section_id, es.session_id, g.id as group_id, g.name as group_name,
           g.min_choices, sub.name as subject_name
    from ex
    join public.exam_subjects es on es.exam_id = ex.id and es.tenant_id = ex.tenant_id
    join public.sections sec on sec.id = es.section_id
    join public.subjects sub on sub.id = es.subject_id
    join public.subject_group_options o
      on o.subject_id = es.subject_id and o.tenant_id = ex.tenant_id
    join public.subject_groups g
      on g.id = o.group_id
     and g.session_id = es.session_id
     and g.class_level_id = sec.class_level_id
    where g.min_choices > 0
  ),
  grp as (
    select section_id, session_id, group_id, group_name, min_choices,
           array_agg(distinct subject_name order by subject_name) as subjects
    from papers
    group by section_id, session_id, group_id, group_name, min_choices
  )
  select
    (cl.name || ' ' || sec.name)::text,
    grp.group_name,
    grp.subjects,
    grp.min_choices,
    count(*)::integer
  from grp
  join public.sections sec on sec.id = grp.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  join public.enrolments en
    on en.section_id = grp.section_id
   and en.session_id = grp.session_id
   and en.status = 'active'
  where (
    select count(*) from public.student_subject_choices c
    where c.group_id = grp.group_id and c.student_id = en.student_id
  ) < grp.min_choices
  group by cl.sequence, cl.name, sec.name, grp.group_name, grp.subjects, grp.min_choices
  order by cl.sequence, sec.name, grp.group_name
$$;

comment on function public.exams_unchosen_electives(uuid) is
  'Per class and elective group in an exam: how many active children have not finished choosing, so sit none of its papers (0286). Definer, tenant-filtered, gated on exams.manage or academics.manage, counts only.';

revoke all on function public.exams_unchosen_electives(uuid) from public, anon;
grant execute on function public.exams_unchosen_electives(uuid) to authenticated;

create or replace function public.exams_problems(p_exam_id uuid)
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  with e as (
    select ex.id, ex.tenant_id, public.exams_rules_for(ex.id) as rules
    from public.exams ex where ex.id = p_exam_id
  ),
  papers as (
    select
      es.id,
      es.max_marks,
      (cl.name || ' ' || sec.name || ' ' || chr(183) || ' ' || sub.name)::text as label
    from public.exam_subjects es
    join public.sections sec on sec.id = es.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    join public.subjects sub on sub.id = es.subject_id
    where es.exam_id = p_exam_id
  ),
  parts as (
    select
      p.id, p.label, p.max_marks,
      count(ec.id) as component_count,
      coalesce(sum(ec.max_marks), 0) as component_total,
      count(*) filter (where ec.pass_marks > 0) as with_minimum
    from papers p
    left join public.exam_components ec on ec.exam_subject_id = p.id
    group by p.id, p.label, p.max_marks
  )
  select gp.problem from e, lateral public.grading_scheme_problems(e.rules) gp

  union all
  -- Only reachable by writing `exam_components` directly, which an admin's RLS
  -- policy permits; `exams_set_components` refuses it. Worth saying anyway,
  -- because the paper would quietly mark out of the wrong total.
  select 'The parts of ' || pt.label || ' add up to ' || public.format_quantity(pt.component_total)
         || ' but the paper is out of ' || public.format_quantity(pt.max_marks)
         || ', so its marks will not add up either.'
  from parts pt
  where pt.component_count > 0 and pt.component_total <> pt.max_marks

  union all
  select 'The parts of ' || pt.label || ' carry a minimum of their own, but this exam''s scheme does not '
         || 'require passing each part, so those minimums will not fail anybody. Set '
         || '"components": { "must_pass_each": true } in the scheme if they should.'
  from parts pt, e
  where pt.with_minimum > 0
    and not coalesce((e.rules -> 'components' ->> 'must_pass_each')::boolean, false)

  union all
  select 'This exam''s scheme requires every part of a paper to be passed, but no paper in it is '
         || 'split into parts, so the rule will never do anything.'
  from e
  where coalesce((e.rules -> 'components' ->> 'must_pass_each')::boolean, false)
    and not exists (select 1 from parts where component_count > 0)

  union all
  -- The leftover state the engine deliberately ignores rather than adds in.
  select 'Marks exist against ' || pt.label || ' as a whole as well as against its parts. '
         || 'Only the parts are counted; the older marks are ignored.'
  from parts pt
  where pt.component_count > 0
    and exists (
      select 1 from public.marks m
      where m.exam_subject_id = pt.id and m.exam_component_id is null
        and (m.marks_obtained is not null or m.is_absent)
    )

  union all
  -- A child who has not finished choosing sits none of the group's papers
  -- (0285), and until 0286 nothing said so. Counted by a definer read model,
  -- because the invoker `not exists` over enrolments and choices would be
  -- answered differently by every role (rule 4).
  select
    u.unchosen || case when u.unchosen = 1 then ' student in ' else ' students in ' end
    || u.section_label
    || case when u.unchosen = 1 then ' has not ' else ' have not ' end
    || case when u.min_choices = 1 then 'chosen' else 'finished choosing' end
    || ' from "' || u.group_name || '" yet, so they have no paper in '
    || case when cardinality(u.subjects) = 1 then u.subjects[1]
            else array_to_string(u.subjects[1:cardinality(u.subjects) - 1], ', ')
                 || ' or ' || u.subjects[cardinality(u.subjects)] end
    || ' in this exam. Choose for '
    || case when u.unchosen = 1 then 'them on the student''s page' else 'them on each student''s page' end
    || ', or open the choice under Academics > Electives.'
  from public.exams_unchosen_electives(p_exam_id) u
$$;

-- ---------------------------------------------------------------------------
-- 3. The admission fee, billed on admission
-- ---------------------------------------------------------------------------

alter table public.fee_heads
  add column bill_on_admission boolean not null default false;

comment on column public.fee_heads.bill_on_admission is
  'Invoice this head when a child is admitted from the students screen (0286). Off by default; the importer never bills.';

create or replace function public.fees_bill_on_admission(p_student_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_heads uuid[];
  v_invoice public.invoices;
  v_amount numeric;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select array_agg(h.id order by h.name) into v_heads
  from public.fee_heads h
  where h.tenant_id = v_tenant_id and h.is_active and h.bill_on_admission;

  -- Nothing is set to bill on admission: there is nothing to say.
  if v_heads is null then
    return jsonb_build_object('billed', false, 'reason', null);
  end if;

  -- Every answer below is a sentence, not an exception: the child is admitted
  -- whatever happens here, and the office is told why no bill was raised.
  if not public.role_has_permission('fees.collect') then
    return jsonb_build_object('billed', false, 'reason',
      'Your role does not raise invoices, so the admission fee was not billed. The fee counter can bill it from the child''s fee account.');
  end if;

  v_session_id := public.current_session_id(v_tenant_id);

  if exists (
    select 1
    from public.invoice_lines il
    join public.invoices i on i.id = il.invoice_id
    where i.tenant_id = v_tenant_id
      and i.session_id = v_session_id
      and i.student_id = p_student_id
      and i.status = 'issued'
      and il.fee_head_id = any (v_heads)
  ) then
    return jsonb_build_object('billed', false, 'reason',
      'This child has already been billed the admission fees this year, so no second invoice was raised.');
  end if;

  if not exists (
    select 1 from public.fees_billable_lines(p_student_id, null, null, v_heads)
  ) then
    return jsonb_build_object('billed', false, 'reason',
      'No amount is set for the admission fees in this child''s class, so nothing was billed. Set it under Fees > Fee setup.');
  end if;

  begin
    v_invoice := public.fees_generate_invoice(p_student_id, current_date, v_heads, 'Admission fees', null);
  exception when others then
    return jsonb_build_object('billed', false, 'reason', sqlerrm);
  end;

  select coalesce(sum(il.amount), 0) into v_amount
  from public.invoice_lines il where il.invoice_id = v_invoice.id;

  return jsonb_build_object(
    'billed', true,
    'invoiceId', v_invoice.id,
    'invoiceNumber', v_invoice.invoice_number,
    'amount', v_amount,
    'reason', null
  );
end;
$$;

comment on function public.fees_bill_on_admission(uuid) is
  'Raise one invoice over the heads marked bill_on_admission, through fees_generate_invoice (0286). Answers in jsonb {billed, invoiceNumber, amount, reason} rather than raising: a failed bill is not a failed admission.';

revoke all on function public.fees_bill_on_admission(uuid) from public, anon;
grant execute on function public.fees_bill_on_admission(uuid) to authenticated;
