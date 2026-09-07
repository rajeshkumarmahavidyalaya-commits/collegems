-- ---------------------------------------------------------------------------
-- The morning: what is uncovered, who is free, and what went stale
-- ---------------------------------------------------------------------------
--
-- Every function here is `SECURITY INVOKER`. `timetable_entries`,
-- `leave_requests` and `staff_attendance` all carry policies, and the roster is
-- arranged by an administrator who can read all three -- so RLS is the gate and
-- a definer function would only be a second one.
--
-- THE THREE QUESTIONS, IN THE ORDER SOMEBODY ASKS THEM
--
--   `substitution_gaps`       what has nobody in front of it today
--   `substitution_candidates` who is genuinely free for this period
--   `substitution_problems`   what I arranged yesterday that is now wrong
--
-- The third is the one a paper roster cannot do at all, and it is why this is
-- worth building rather than printing.

-- ---------------------------------------------------------------------------
-- What is uncovered
-- ---------------------------------------------------------------------------

create or replace function public.substitution_gaps(p_date date default null)
returns table (
  timetable_entry_id uuid,
  time_slot_id uuid,
  period_number integer,
  starts_at time,
  section_label text,
  subject_name text,
  absent_staff_id uuid,
  absent_teacher text,
  substitute_staff_id uuid,
  substitute_teacher text,
  note text,
  arranged boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with day as (
    select
      coalesce(p_date, public.mobile_today()) as on_date,
      extract(isodow from coalesce(p_date, public.mobile_today()))::integer as weekday
  )
  select
    e.id,
    e.time_slot_id,
    ts.period_number,
    ts.starts_at,
    (cl.name || ' ' || sec.name)::text,
    sub.name,
    e.teacher_staff_id,
    (ap.first_name || ' ' || ap.last_name)::text,
    s.substitute_staff_id,
    (sp.first_name || ' ' || sp.last_name)::text,
    s.note,
    s.id is not null
  from public.timetable_entries e
  cross join day d
  join public.time_slots ts on ts.id = e.time_slot_id
  join public.sections sec on sec.id = e.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  join public.subjects sub on sub.id = e.subject_id
  join public.staff ast on ast.id = e.teacher_staff_id
  join public.people ap on ap.id = ast.person_id
  left join public.substitutions s
    on s.timetable_entry_id = e.id and s.on_date = d.on_date
  left join public.staff sst on sst.id = s.substitute_staff_id
  left join public.people sp on sp.id = sst.person_id
  where e.weekday = d.weekday
    and e.session_id = public.current_session_id(public.current_tenant_id())
    and e.teacher_staff_id is not null
    -- A lesson only needs covering if its teacher is away. Everything else on
    -- the timetable is somebody's ordinary Tuesday.
    and public.staff_is_away(d.on_date, e.teacher_staff_id)
    -- ...and only on a day the school is open. Rule: one definition of that,
    -- and it is `attendance_calendar` (migration 0153).
    and (select c.is_working from public.attendance_calendar(d.on_date, d.on_date) c)
  -- Unarranged first, then by period: the list is worked down before assembly.
  order by (s.id is not null), ts.period_number, 5
$$;

revoke all on function public.substitution_gaps(date) from public, anon;
grant execute on function public.substitution_gaps(date) to authenticated;

comment on function public.substitution_gaps(date) is
  'Lessons whose teacher is away, with any arrangement already made. An '
  'arranged row with a null substitute is a decision ("class merged"), not a '
  'gap -- the gap is the absence of a row.';

-- ---------------------------------------------------------------------------
-- Who is free
-- ---------------------------------------------------------------------------
--
-- "Free" is four conditions and every one of them has bitten a school that
-- worked it out on paper:
--
--   1. not away themselves;
--   2. nothing of their own scheduled in that period;
--   3. not already covering something else in that period;
--   4. not the person being covered for.
--
-- Ranking is a suggestion, not a rule: somebody who already teaches the subject
-- first, then whoever is carrying the fewest covers today. A head of department
-- overruling that is the normal case, so the order is advice and every eligible
-- person is returned.

create or replace function public.substitution_candidates(
  p_timetable_entry_id uuid,
  p_date date default null
)
returns table (
  staff_id uuid,
  staff_name text,
  designation text,
  teaches_subject boolean,
  covers_today integer,
  periods_today integer
)
language sql
stable
set search_path = public, extensions
as $$
  with lesson as (
    select e.id, e.time_slot_id, e.weekday, e.subject_id, e.teacher_staff_id, e.session_id
    from public.timetable_entries e
    where e.id = p_timetable_entry_id
  ),
  day as (
    select coalesce(p_date, public.mobile_today()) as on_date
  )
  select
    st.id,
    (p.first_name || ' ' || p.last_name)::text,
    st.designation,
    exists (
      select 1 from public.section_subjects ss, lesson l
      where ss.teacher_staff_id = st.id and ss.subject_id = l.subject_id
    ) or exists (
      select 1 from public.timetable_entries te, lesson l
      where te.teacher_staff_id = st.id and te.subject_id = l.subject_id
        and te.session_id = l.session_id
    ),
    (
      select count(*)::integer from public.substitutions s, day d
      where s.substitute_staff_id = st.id and s.on_date = d.on_date
    ),
    (
      select count(*)::integer from public.timetable_entries te, lesson l
      where te.teacher_staff_id = st.id and te.weekday = l.weekday
        and te.session_id = l.session_id
    )
  from public.staff st
  join public.people p on p.id = st.person_id
  cross join lesson l
  cross join day d
  where st.status = 'active'
    -- (4) not the person being covered for
    and st.id <> l.teacher_staff_id
    -- (1) not away themselves
    and not public.staff_is_away(d.on_date, st.id)
    -- (2) nothing of their own in that period
    and not exists (
      select 1 from public.timetable_entries te
      where te.teacher_staff_id = st.id
        and te.weekday = l.weekday
        and te.time_slot_id = l.time_slot_id
        and te.session_id = l.session_id
    )
    -- (3) not already covering something else in that period. The unique index
    -- refuses this anyway; offering it and then refusing it is a worse screen.
    and not exists (
      select 1 from public.substitutions s
      where s.substitute_staff_id = st.id
        and s.on_date = d.on_date
        and s.time_slot_id = l.time_slot_id
    )
  order by 4 desc, 5, 6, 2
$$;

revoke all on function public.substitution_candidates(uuid, date) from public, anon;
grant execute on function public.substitution_candidates(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Arrange
-- ---------------------------------------------------------------------------

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
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_e from public.timetable_entries where id = p_timetable_entry_id;
  if v_e.id is null then
    raise exception 'No such lesson, or you cannot see it';
  end if;

  -- The lesson has to happen on that day. Arranging Monday's cover against a
  -- Thursday is a slip a date picker makes easy and nothing else would catch.
  if v_e.weekday <> extract(isodow from p_date)::integer then
    raise exception 'That lesson is not taught on a %', to_char(p_date, 'FMDay');
  end if;

  if v_e.teacher_staff_id is null then
    raise exception 'That lesson has no teacher assigned, so there is nobody to cover for';
  end if;

  -- Checked here rather than by a constraint, and this is the boundary
  -- migration 0155's header is about: "is this teacher away" is derived from
  -- two other tables and changes after the fact, so it cannot be a key.
  if not public.staff_is_away(p_date, v_e.teacher_staff_id) then
    select (p.first_name || ' ' || p.last_name) into v_name
    from public.staff s join public.people p on p.id = s.person_id
    where s.id = v_e.teacher_staff_id;

    raise exception
      '% is not marked away on %. Approve their leave or mark the register first.',
      v_name, to_char(p_date, 'FMDD Mon YYYY');
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
    -- The double-booking index. Naming who and when is the difference between
    -- a person fixing it and a person filing a support ticket.
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

revoke all on function public.substitution_arrange(uuid, date, uuid, text) from public, anon;
grant execute on function public.substitution_arrange(uuid, date, uuid, text) to authenticated;

create or replace function public.substitution_clear(
  p_timetable_entry_id uuid,
  p_date date
)
returns boolean
language sql
set search_path = public, extensions
as $$
  delete from public.substitutions
  where timetable_entry_id = p_timetable_entry_id and on_date = p_date
  returning true
$$;

revoke all on function public.substitution_clear(uuid, date) from public, anon;
grant execute on function public.substitution_clear(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- What went stale
-- ---------------------------------------------------------------------------
--
-- The thing a paper roster cannot do. An arrangement is made against a state of
-- the world -- who was away, who was free -- and that state keeps moving after
-- the sheet is printed: leave gets cancelled, the substitute falls ill, the
-- timetable is edited. None of those is an error at the moment it happens, and
-- every one of them leaves a wrong roster on a noticeboard.
--
-- `grading_scheme_problems()` in sentences, aimed at a morning.

create or replace function public.substitution_problems(p_date date default null)
returns table (timetable_entry_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with day as (select coalesce(p_date, public.mobile_today()) as on_date),
  arranged as (
    select
      s.*,
      (ap.first_name || ' ' || ap.last_name)::text as absent_name,
      (sp.first_name || ' ' || sp.last_name)::text as sub_name,
      ts.period_number
    from public.substitutions s
    cross join day d
    join public.staff ast on ast.id = s.absent_staff_id
    join public.people ap on ap.id = ast.person_id
    join public.time_slots ts on ts.id = s.time_slot_id
    left join public.staff sst on sst.id = s.substitute_staff_id
    left join public.people sp on sp.id = sst.person_id
    where s.on_date = d.on_date
  )
  -- The leave was cancelled, or the register was corrected.
  select a.timetable_entry_id, 'warning'::text, format(
    '%s is not marked away any more, but period %s is still covered by %s. '
    'Clear it, or the class has two teachers and another has none.',
    a.absent_name, a.period_number, coalesce(a.sub_name, 'nobody'))
  from arranged a, day d
  where not public.staff_is_away(d.on_date, a.absent_staff_id)

  union all

  -- The substitute has since gone away themselves.
  select a.timetable_entry_id, 'error'::text, format(
    '%s is covering period %s and is now marked away as well. That class has '
    'nobody.', a.sub_name, a.period_number)
  from arranged a, day d
  where a.substitute_staff_id is not null
    and public.staff_is_away(d.on_date, a.substitute_staff_id)

  union all

  -- The timetable moved under the arrangement. Only findable because
  -- `time_slot_id` is frozen on the substitution: comparing against the live
  -- lesson is exactly what tells you the two have diverged.
  select a.timetable_entry_id, 'error'::text, format(
    '%s is covering period %s, but now teaches their own class in that period. '
    'The timetable changed after this was arranged.', a.sub_name, a.period_number)
  from arranged a
  cross join day d
  join public.timetable_entries e on e.id = a.timetable_entry_id
  where a.substitute_staff_id is not null
    and exists (
      select 1 from public.timetable_entries te
      where te.teacher_staff_id = a.substitute_staff_id
        and te.time_slot_id = a.time_slot_id
        and te.weekday = extract(isodow from d.on_date)::integer
        and te.session_id = e.session_id
    )

  union all

  -- Arranged, and deliberately left with nobody. Not a fault -- a school does
  -- merge two classes -- but it belongs on the list somebody reads out.
  select a.timetable_entry_id, 'info'::text, format(
    'Period %s (for %s) has no substitute. Make sure somebody knows those '
    'children are being merged or supervised.', a.period_number, a.absent_name)
  from arranged a
  where a.substitute_staff_id is null
$$;

revoke all on function public.substitution_problems(date) from public, anon;
grant execute on function public.substitution_problems(date) to authenticated;
