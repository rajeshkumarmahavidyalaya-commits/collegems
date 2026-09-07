-- ---------------------------------------------------------------------------
-- Three catalog reports: staff attendance, a teacher summary, and exam results
-- ---------------------------------------------------------------------------
--
-- RULE 11, LITERALLY. "Do not add a screen to answer a question." Every
-- question here -- *how often was each teacher in?*, *what is each teacher
-- carrying?*, *who passed?* -- has parameters, and a question with parameters
-- is a row in `reference.reports` plus one `SECURITY INVOKER` function. None of
-- them gets a page.
--
-- WHAT GATES THEM IS THE MATRIX, AND THAT IS DELIBERATE
--
-- `report_run` checks `required_permission` *inside* the function that produces
-- the data, which is the distinction CLAUDE.md draws for reads that RLS leaves
-- tenant-wide. Two of these are double-locked and one is not, and it is worth
-- knowing which:
--
--   * `staff` and `people` are readable by any tenant member, so on the
--     teacher-summary report the matrix is the *only* thing standing between an
--     accountant and a teacher's timetable. `hr.view` is that thing.
--   * `staff_attendance` is admin/accountant-or-your-own-row under RLS as well,
--     so the attendance report is locked twice. That is not redundancy to tidy
--     away: the matrix decides who may ask, RLS decides what comes back, and
--     removing either leaves a hole the other does not cover.
--
-- The two attendance-bearing reports therefore require `hr.view`, not
-- `academics.view` -- a report that mixes a timetable with a register is as
-- sensitive as its most sensitive column, and the catalog has one permission
-- per row.

-- ---------------------------------------------------------------------------
-- 1. Staff attendance over a date range
-- ---------------------------------------------------------------------------

create or replace function public.report_staff_attendance(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    -- `mobile_today()` rather than `current_date`: Supabase and Vercel both run
    -- in UTC, and "this month" on the 1st at 9am in Kolkata is last month in
    -- UTC. The same reason rule 11 gives for `report_day_bounds()`, applied to
    -- a default rather than to a filter.
    select
      public.report_param_date(
        p_params, 'from', date_trunc('month', public.mobile_today())::date) as from_date,
      public.report_param_date(p_params, 'to', public.mobile_today()) as to_date
  ),
  -- Only staff who teach, when asked. `designation` is free text, so the match
  -- is deliberately loose: one school writes "Teacher", the next writes "TGT",
  -- "Asst. Teacher" and "PGT Physics", and an exact list would silently drop
  -- three of those and report a school with no teachers in it.
  wanted as (
    select
      s.id,
      s.employee_code,
      s.designation,
      s.department,
      (p.first_name || ' ' || p.last_name)::text as staff_name
    from public.staff s
    join public.people p on p.id = s.person_id
    where s.status = 'active'
      and (
        coalesce(nullif(p_params ->> 'teachers_only', '')::boolean, false) = false
        or s.designation ilike any (array[
          '%teacher%', '%tgt%', '%pgt%', '%prt%', '%principal%', '%lecturer%', '%faculty%'
        ])
      )
      and (
        public.report_param_text(p_params, 'department') is null
        or s.department = public.report_param_text(p_params, 'department')
      )
  ),
  marked as (
    select
      a.staff_id,
      count(*) filter (where a.status = 'present')  as present,
      count(*) filter (where a.status = 'absent')   as absent,
      count(*) filter (where a.status = 'half_day') as half_day,
      count(*) filter (where a.status = 'on_leave') as on_leave,
      count(*) filter (where a.status = 'on_duty')  as on_duty,
      count(*)                                      as days_marked
    from public.staff_attendance a, bounds b
    where a.attendance_date between b.from_date and b.to_date
    group by a.staff_id
  )
  select to_jsonb(t)
  from (
    select
      w.employee_code,
      w.staff_name as staff,
      w.designation,
      w.department,
      coalesce(m.present, 0)     as present,
      coalesce(m.absent, 0)      as absent,
      coalesce(m.half_day, 0)    as half_day,
      coalesce(m.on_leave, 0)    as on_leave,
      coalesce(m.on_duty, 0)     as on_duty,
      coalesce(m.days_marked, 0) as days_marked,
      -- Over what was marked, never over the calendar. A register half taken
      -- must read as half taken, not as a school half empty. On duty counts as
      -- in; a half day counts as half. Leave is neither present nor absent and
      -- so is excluded from the numerator while still counting as a marked day
      -- -- which is what makes a month of approved leave read as 0%, not as a
      -- blank.
      case
        when coalesce(m.days_marked, 0) = 0 then null
        else round(
          100.0 * (coalesce(m.present, 0) + coalesce(m.on_duty, 0) + 0.5 * coalesce(m.half_day, 0))
          / m.days_marked, 1)
      end as attendance_percent
    from wanted w
    left join marked m on m.staff_id = w.id
    -- Worst attendance first, because that is the row the head is looking for;
    -- anybody with nothing marked sorts last rather than reading as perfect.
    order by
      case when coalesce(m.days_marked, 0) = 0 then 1 else 0 end,
      attendance_percent nulls last,
      w.staff_name
  ) t
$$;

revoke all on function public.report_staff_attendance(jsonb) from public, anon;
grant execute on function public.report_staff_attendance(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. One row per teacher: what they carry, and how often they are in
-- ---------------------------------------------------------------------------

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
      public.report_param_date(p_params, 'to', public.mobile_today()) as to_date
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
        -- ...or anybody the timetable already treats as one. A school that
        -- writes "Coordinator" in the designation field and then gives that
        -- person eighteen periods a week has told us what they are.
        or exists (
          select 1 from public.timetable_entries te where te.teacher_staff_id = s.id
        )
        or exists (
          select 1 from public.sections sec where sec.class_teacher_staff_id = s.id
        )
      )
  ),
  -- The timetable module's own answer, not a second one. `timetable_teacher_load`
  -- is what the timetable screen shows; recomputing periods here would be free
  -- to disagree with it.
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
    where sec.class_teacher_staff_id is not null
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

revoke all on function public.report_teacher_summary(jsonb) from public, anon;
grant execute on function public.report_teacher_summary(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Exam results: who passed, who did not
-- ---------------------------------------------------------------------------
--
-- Reads `exam_results`, which is the frozen table the exam module *writes* --
-- never a recomputation from `marks`. A report that re-evaluates a grading
-- scheme is free to disagree with the card the child took home, and the whole
-- point of `rules_snapshot` is that it cannot.
--
-- The exam is chosen by name because the catalog's parameter types are static
-- (`section`, `class_level`, `date`, `number`, `select`, `text`) and there is no
-- control that can list this tenant's exams. Blank means the most recently
-- published one, which is the answer somebody wants nine times in ten.

create or replace function public.report_exam_results(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with wanted_exam as (
    select e.id, e.name
    from public.exams e
    where e.status = 'published'
      and (
        public.report_param_text(p_params, 'exam') is null
        or e.name ilike '%' || public.report_param_text(p_params, 'exam') || '%'
      )
    order by e.published_at desc nulls last
    limit 1
  )
  select to_jsonb(t)
  from (
    select
      we.name as exam,
      st.admission_number,
      (p.first_name || ' ' || p.last_name)::text as student,
      (cl.name || ' ' || sec.name)::text as section,
      r.total_marks,
      r.max_marks,
      r.percentage,
      r.grade,
      r.result,
      r.subjects_counted,
      r.subjects_failed,
      r.rank_in_cohort,
      r.cohort_size
    from public.exam_results r
    join wanted_exam we on we.id = r.exam_id
    join public.students st on st.id = r.student_id
    join public.people p on p.id = st.person_id
    left join public.enrolments en
      on en.student_id = r.student_id and en.session_id = r.session_id
    left join public.sections sec on sec.id = en.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    where (
      public.report_param_uuid(p_params, 'section') is null
      or en.section_id = public.report_param_uuid(p_params, 'section')
    )
    and (
      public.report_param_text(p_params, 'result') is null
      or r.result = public.report_param_text(p_params, 'result')
    )
    -- Failures first, then by rank: the list is read to find the children who
    -- need something done about them, not to admire the toppers.
    order by
      case r.result when 'fail' then 0 when 'incomplete' then 1 else 2 end,
      r.rank_in_cohort nulls last,
      p.first_name
  ) t
$$;

revoke all on function public.report_exam_results(jsonb) from public, anon;
grant execute on function public.report_exam_results(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The catalog rows
-- ---------------------------------------------------------------------------

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'hr.staff_attendance',
    'Staff attendance',
    'How often each member of staff was in, over a date range. The percentage is over the days actually marked, so a register nobody took reads as unmarked rather than as an absence.',
    'Staff', 'hr.view', 'report_staff_attendance',
    '[
      {"name":"from","label":"From","type":"date","required":false},
      {"name":"to","label":"To","type":"date","required":false},
      {"name":"department","label":"Department","type":"text","required":false},
      {"name":"teachers_only","label":"Teaching staff","type":"select","required":false,
       "options":[{"value":"true","label":"Teaching staff only"}]}
    ]'::jsonb,
    '[
      {"key":"employee_code","label":"Code","type":"text"},
      {"key":"staff","label":"Name","type":"text"},
      {"key":"designation","label":"Designation","type":"text"},
      {"key":"department","label":"Department","type":"text"},
      {"key":"present","label":"Present","type":"number","align":"right"},
      {"key":"absent","label":"Absent","type":"number","align":"right"},
      {"key":"half_day","label":"Half day","type":"number","align":"right"},
      {"key":"on_leave","label":"On leave","type":"number","align":"right"},
      {"key":"on_duty","label":"On duty","type":"number","align":"right"},
      {"key":"days_marked","label":"Days marked","type":"number","align":"right"},
      {"key":"attendance_percent","label":"Attendance","type":"percent","align":"right"}
    ]'::jsonb,
    90
  ),
  (
    'hr.teacher_summary',
    'Teacher summary',
    'One row per teacher: the class they are responsible for, the periods and subjects they carry, the homework they set, and how often they were in.',
    'Staff', 'hr.view', 'report_teacher_summary',
    '[
      {"name":"from","label":"From","type":"date","required":false},
      {"name":"to","label":"To","type":"date","required":false},
      {"name":"department","label":"Department","type":"text","required":false}
    ]'::jsonb,
    '[
      {"key":"employee_code","label":"Code","type":"text"},
      {"key":"teacher","label":"Teacher","type":"text"},
      {"key":"designation","label":"Designation","type":"text"},
      {"key":"department","label":"Department","type":"text"},
      {"key":"class_teacher_of","label":"Class teacher of","type":"text"},
      {"key":"periods_per_week","label":"Periods/week","type":"number","align":"right"},
      {"key":"sections_taught","label":"Sections","type":"number","align":"right"},
      {"key":"subjects_taught","label":"Subjects","type":"number","align":"right"},
      {"key":"homework_set","label":"Homework set","type":"number","align":"right"},
      {"key":"days_marked","label":"Days marked","type":"number","align":"right"},
      {"key":"attendance_percent","label":"Attendance","type":"percent","align":"right"}
    ]'::jsonb,
    91
  ),
  (
    'exams.results',
    'Exam results',
    'Pass, fail and incomplete for a published exam, worst first. Reads the frozen result rows the exam module wrote, so it always agrees with the report cards that went home. Leave the exam blank for the most recently published one.',
    'Exams', 'exams.view', 'report_exam_results',
    '[
      {"name":"exam","label":"Exam name","type":"text","required":false},
      {"name":"section","label":"Class","type":"section","required":false},
      {"name":"result","label":"Outcome","type":"select","required":false,
       "options":[{"value":"pass","label":"Passed"},{"value":"fail","label":"Failed"},{"value":"incomplete","label":"Incomplete"}]}
    ]'::jsonb,
    '[
      {"key":"exam","label":"Exam","type":"text"},
      {"key":"admission_number","label":"Adm. no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"section","label":"Class","type":"text"},
      {"key":"total_marks","label":"Total","type":"number","align":"right"},
      {"key":"max_marks","label":"Out of","type":"number","align":"right"},
      {"key":"percentage","label":"Percentage","type":"percent","align":"right"},
      {"key":"grade","label":"Grade","type":"badge"},
      {"key":"result","label":"Result","type":"badge"},
      {"key":"subjects_failed","label":"Subjects failed","type":"number","align":"right"},
      {"key":"rank_in_cohort","label":"Rank","type":"number","align":"right"},
      {"key":"cohort_size","label":"Of","type":"number","align":"right"}
    ]'::jsonb,
    92
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  module = excluded.module,
  required_permission = excluded.required_permission,
  function_name = excluded.function_name,
  parameters = excluded.parameters,
  columns = excluded.columns,
  sort_order = excluded.sort_order;
