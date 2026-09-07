-- ---------------------------------------------------------------------------
-- "Grade 4 A, Grade 4 A" -- a section belongs to a year, and 0126 forgot
-- ---------------------------------------------------------------------------
--
-- `report_teacher_summary` listed what each teacher is class teacher of by
-- grouping `sections`, and printed *"Grade 4 A, Grade 4 A"* for a school in its
-- second year. Not a duplicate row: rule 2 says every transactional table
-- carries `session_id` directly, and `sections` is one of them -- last year's
-- Grade 4 A and this year's are two different sections with the same name, and
-- the same teacher was responsible for both.
--
-- It reads as a rendering bug and is not one. The number beside it was already
-- right, because `timetable_teacher_load()` -- the module's own read path,
-- wrapped rather than reimplemented -- has filtered on the current session
-- since migration 0041. The two facts on one row disagreed, and the one that
-- was wrong was the one this migration wrote by hand. Which is rule 11's
-- "wrap the module's own read path" earning its place twice in one report: the
-- half that wrapped was correct and the half that did not was not.
--
-- The `exists` clauses get the same treatment. They are there so that somebody
-- the timetable treats as a teacher is counted as one whatever their
-- designation says -- but a person who taught two years ago and does not teach
-- now is not on this year's staff summary, and without the filter they were.

create or replace function public.report_teacher_summary(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    select
      public.report_param_date(
        p_params, 'from', date_trunc('month', public.mobile_today())::date) as from_date,
      public.report_param_date(p_params, 'to', public.mobile_today()) as to_date,
      public.current_session_id(public.current_tenant_id()) as session_id
  ),
  teachers as (
    select
      s.id,
      s.employee_code,
      s.designation,
      s.department,
      (p.first_name || ' ' || p.last_name)::text as teacher_name
    from public.staff s
    join public.people p on p.id = s.person_id
    where s.status = 'active'
      and (
        public.report_param_text(p_params, 'department') is null
        or s.department = public.report_param_text(p_params, 'department')
      )
      and (
        s.designation ilike any (array[
          '%teacher%', '%tgt%', '%pgt%', '%prt%', '%principal%', '%lecturer%', '%faculty%'
        ])
        -- ...or anybody this year's timetable already treats as one. A school
        -- that writes "Coordinator" in the designation field and then gives
        -- that person eighteen periods a week has told us what they are.
        or exists (
          select 1 from public.timetable_entries te, bounds b
          where te.teacher_staff_id = s.id
            and (b.session_id is null or te.session_id = b.session_id)
        )
        or exists (
          select 1 from public.sections sec, bounds b
          where sec.class_teacher_staff_id = s.id
            and (b.session_id is null or sec.session_id = b.session_id)
        )
      )
  ),
  load as (
    select l.staff_id, l.periods, l.sections, l.subjects
    from public.timetable_teacher_load() l
  ),
  class_of as (
    select
      sec.class_teacher_staff_id as staff_id,
      string_agg(cl.name || ' ' || sec.name, ', ' order by cl.sequence, sec.name) as sections
    from public.sections sec
    join public.class_levels cl on cl.id = sec.class_level_id
    cross join bounds b
    where sec.class_teacher_staff_id is not null
      and (b.session_id is null or sec.session_id = b.session_id)
    group by sec.class_teacher_staff_id
  ),
  register as (
    select
      a.staff_id,
      count(*) as days_marked,
      round(
        100.0 * (
          count(*) filter (where a.status = 'present')
          + count(*) filter (where a.status = 'on_duty')
          + 0.5 * count(*) filter (where a.status = 'half_day')
        ) / count(*), 1) as attendance_percent
    from public.staff_attendance a, bounds b
    where a.attendance_date between b.from_date and b.to_date
    group by a.staff_id
  ),
  set_work as (
    select h.assigned_by_staff_id as staff_id, count(*) as homework_set
    from public.homework h, bounds b
    where h.assigned_on between b.from_date and b.to_date
      and h.assigned_by_staff_id is not null
    group by h.assigned_by_staff_id
  )
  select to_jsonb(t)
  from (
    select
      tc.employee_code,
      tc.teacher_name as teacher,
      tc.designation,
      tc.department,
      co.sections as class_teacher_of,
      coalesce(ld.periods, 0)  as periods_per_week,
      coalesce(ld.sections, 0) as sections_taught,
      coalesce(ld.subjects, 0) as subjects_taught,
      coalesce(sw.homework_set, 0) as homework_set,
      coalesce(rg.days_marked, 0)  as days_marked,
      rg.attendance_percent
    from teachers tc
    left join load ld     on ld.staff_id = tc.id
    left join class_of co on co.staff_id = tc.id
    left join register rg on rg.staff_id = tc.id
    left join set_work sw on sw.staff_id = tc.id
    order by coalesce(ld.periods, 0) desc, tc.teacher_name
  ) t
$$;
