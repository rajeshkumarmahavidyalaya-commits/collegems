-- ---------------------------------------------------------------------------
-- Phase 3.2 — the report-card read model
--
-- Three functions do the work no single table can:
--
--   exams_ranking             a fact about the cohort, so it is computed over
--                             the whole cohort or not at all
--   exams_attendance_summary  a day-level rollup of a period-level register
--   exams_report_cards        one card per student, assembled from the frozen
--                             result when there is one and computed live when
--                             the exam is still a draft
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- A permission check, in SQL
-- ---------------------------------------------------------------------------

-- The matrix already gates menus in the app. This is the same question asked
-- from inside a function, for the case CLAUDE.md rule 4 describes: where RLS is
-- deliberately tenant-wide, `role_permissions` is the only thing expressing
-- "this role may not". `report_run` inlines this query; from here on there is
-- one copy of it.
create or replace function public.current_role_allows(p_permission_code text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.role_permissions rp
    join public.roles ro on ro.id = rp.role_id
    where rp.tenant_id = ( select public.current_tenant_id() )
      and ro.code = ( select public.current_role_code() )
      and rp.permission_code = p_permission_code
      and rp.allowed
  )
$$;

revoke all on function public.current_role_allows(text) from public, anon;
grant execute on function public.current_role_allows(text) to authenticated;

-- ---------------------------------------------------------------------------
-- May this caller see this child at all?
-- ---------------------------------------------------------------------------

-- Every function below is about one named student, and each of them would
-- otherwise repeat the same four-branch answer. Definer, because the parent
-- branch reads `guardian_student` and the staff branch is a permission check
-- rather than a row-ownership one -- and narrow, because all it ever returns is
-- one boolean about one student.
create or replace function public.exams_may_see_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case ( select public.current_role_code() )
    when 'admin' then exists (
      select 1 from public.students s
      where s.id = p_student_id and s.tenant_id = ( select public.current_tenant_id() )
    )
    when 'teacher' then ( select public.current_role_allows('exams.view') ) and exists (
      select 1 from public.students s
      where s.id = p_student_id and s.tenant_id = ( select public.current_tenant_id() )
    )
    when 'student' then exists (
      select 1 from public.user_profiles up
      where up.id = ( select auth.uid() ) and up.student_id = p_student_id
    )
    when 'parent' then exists (
      select 1
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() ) and gs.student_id = p_student_id
    )
    else false
  end
$$;

revoke all on function public.exams_may_see_student(uuid) from public, anon;
grant execute on function public.exams_may_see_student(uuid) to authenticated;

comment on function public.exams_may_see_student(uuid) is
  'Staff with exams.view may see any child in the tenant; a student only themselves; a guardian only their own. Used by the report-card functions, which are definer and therefore have to ask this themselves.';

-- ---------------------------------------------------------------------------
-- Rank
-- ---------------------------------------------------------------------------

-- Ranking is policy, so it is a key in the rules document rather than a column
-- or an `if`. A missing `rank` key means the school does not rank -- the
-- conservative reading, and not a hypothetical one: several boards have
-- abolished class rank outright, and a card that invents one is worse than a
-- card without one.
--
--   "rank": {"scope": "section", "method": "competition", "include": "all"}
--
--   scope    section | class_level | school | none
--   method   competition (1,2,2,4) | dense (1,2,2,3)
--   include  all | passed        -- whether a failed result takes a position
--
-- SECURITY DEFINER, and this is the whole reason: `exams_result_sheet` is
-- invoker, so a teacher sees only their own section's rows. A rank computed
-- from the rows the caller happens to see is a confident wrong number -- fourth
-- of eleven, when the class level has ninety. Rank is a fact about the cohort,
-- so it is computed over the cohort or not at all. Nothing per-student leaks by
-- doing so: staff already read `exam_results` tenant-wide.
create or replace function public.exams_ranking(p_exam_id uuid)
returns table (student_id uuid, rank_in_cohort integer, cohort_size integer)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with exam as (
    select e.* from public.exams e
    where e.id = p_exam_id
      and e.tenant_id = ( select public.current_tenant_id() )
  ),
  rules as (select public.exams_rules_for(p_exam_id) as r from exam),
  cfg as (
    select
      case
        when not (r ? 'rank') then 'none'
        when coalesce(r -> 'rank' ->> 'scope', 'section')
             in ('section', 'class_level', 'school') then coalesce(r -> 'rank' ->> 'scope', 'section')
        else 'none'
      end as scope,
      case when coalesce(r -> 'rank' ->> 'method', 'competition') = 'dense'
           then 'dense' else 'competition' end as method,
      case when coalesce(r -> 'rank' ->> 'include', 'all') = 'passed'
           then 'passed' else 'all' end as include
    from rules
  ),
  sheet as (
    select
      s.student_id,
      s.percentage,
      s.result,
      en.section_id,
      sec.class_level_id
    from public.exams_result_sheet(p_exam_id, null) s
    join exam e on true
    join public.enrolments en
      on en.student_id = s.student_id
     and en.session_id = e.session_id
     and en.status = 'active'
    join public.sections sec on sec.id = en.section_id
  ),
  eligible as (
    select
      sh.student_id,
      sh.percentage,
      case (select scope from cfg)
        when 'section' then sh.section_id::text
        when 'class_level' then sh.class_level_id::text
        else 'school'
      end as cohort_key
    from sheet sh
    where (select scope from cfg) <> 'none'
      and ((select include from cfg) = 'all' or sh.result = 'pass')
  )
  select
    e.student_id,
    (case (select method from cfg)
      when 'dense' then dense_rank() over (partition by e.cohort_key order by e.percentage desc)
      else rank() over (partition by e.cohort_key order by e.percentage desc)
    end)::integer,
    (count(*) over (partition by e.cohort_key))::integer
  from eligible e
$$;

revoke all on function public.exams_ranking(uuid) from public, anon;
grant execute on function public.exams_ranking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Attendance, rolled up to days
-- ---------------------------------------------------------------------------

-- The register is per period; a card says "present 172 of 180 days". Rolling
-- one into the other needs a rule for a day with disagreeing periods, and the
-- rule is worst-first: absent beats late beats excused beats present. A child
-- who missed two periods was not present all day, and a card that says
-- otherwise is wrong in the direction a parent notices.
--
-- Definer for the same reason as above: a teacher's own attendance policy is
-- class-teacher-only, so a subject teacher printing a card would otherwise get
-- a silent zero rather than a refusal. `exams_may_see_student` is the gate.
create or replace function public.exams_attendance_summary(
  p_student_id uuid,
  p_session_id uuid,
  p_upto date default null
)
returns table (
  days_marked integer,
  days_present integer,
  days_absent integer,
  days_late integer,
  days_excused integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with allowed as (select public.exams_may_see_student(p_student_id) as ok),
  days as (
    select
      ar.attendance_date,
      case
        when bool_or(ar.status = 'absent') then 'absent'
        when bool_or(ar.status = 'late') then 'late'
        when bool_or(ar.status = 'excused') then 'excused'
        else 'present'
      end as day_status
    from public.attendance_records ar
    join public.enrolments en on en.id = ar.enrolment_id
    cross join allowed a
    where a.ok
      and ar.tenant_id = ( select public.current_tenant_id() )
      and en.student_id = p_student_id
      and ar.session_id = p_session_id
      and (p_upto is null or ar.attendance_date <= p_upto)
    group by ar.attendance_date
  )
  select
    count(*)::integer,
    count(*) filter (where day_status = 'present')::integer,
    count(*) filter (where day_status = 'absent')::integer,
    count(*) filter (where day_status = 'late')::integer,
    count(*) filter (where day_status = 'excused')::integer
  from days
$$;

revoke all on function public.exams_attendance_summary(uuid, uuid, date) from public, anon;
grant execute on function public.exams_attendance_summary(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The card
-- ---------------------------------------------------------------------------

-- One jsonb document per student, in printing order. Two sources, chosen by the
-- exam's status and never mixed:
--
--   published -> `exam_results`, exactly as it was frozen. A reprint in
--                December matches the card handed out in March, including the
--                rank and its denominator.
--   draft     -> computed live, staff only, and stamped `provisional: true`.
--                A draft card has no rank: ranks are written by publish, and a
--                provisional position that moves when one more paper is marked
--                is a number nobody should read.
--
-- Bounded by the section, per rule 7 -- a section is a class, not a school.
create or replace function public.exams_report_cards(
  p_exam_id uuid,
  p_section_id uuid default null,
  p_student_id uuid default null
)
returns setof jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_exam public.exams;
  v_role text := ( select public.current_role_code() );
  v_school text;
  v_session text;
begin
  -- Invoker, so RLS decides whether this exam exists for this caller.
  select * into v_exam from public.exams e where e.id = p_exam_id;
  if v_exam.id is null then
    raise exception 'That exam does not exist';
  end if;

  if p_student_id is not null and not public.exams_may_see_student(p_student_id) then
    raise exception 'You cannot see that student''s report card';
  end if;

  select t.name into v_school from public.tenants t where t.id = v_exam.tenant_id;
  select s.name into v_session from public.academic_sessions s where s.id = v_exam.session_id;

  if v_exam.status = 'published' then
    return query
    select jsonb_build_object(
      'school', jsonb_build_object('name', v_school),
      'session', jsonb_build_object('id', v_exam.session_id, 'name', v_session),
      'exam', jsonb_build_object(
        'id', v_exam.id, 'name', v_exam.name, 'kind', v_exam.kind,
        'status', v_exam.status, 'starts_on', v_exam.starts_on,
        'ends_on', v_exam.ends_on, 'published_at', v_exam.published_at
      ),
      'provisional', false,
      'student', jsonb_build_object(
        'id', er.student_id,
        'name', p.first_name || ' ' || p.last_name,
        'admission_number', st.admission_number,
        'roll_number', en.roll_number,
        'section', cl.name || ' ' || sec.name,
        'class_teacher', ctp.first_name || ' ' || ctp.last_name
      ),
      'papers', er.detail,
      'totals', jsonb_build_object(
        'obtained', er.total_marks, 'max', er.max_marks,
        'percentage', er.percentage, 'grade', er.grade,
        'grade_point', er.grade_point, 'result', er.result,
        'subjects_counted', er.subjects_counted,
        'subjects_failed', er.subjects_failed
      ),
      'rank', case
        when er.rank_in_cohort is null then null
        else jsonb_build_object(
          'position', er.rank_in_cohort,
          'cohort_size', er.cohort_size,
          'scope', coalesce(er.rules_snapshot -> 'rank' ->> 'scope', 'section')
        )
      end,
      'attendance', jsonb_build_object(
        'marked', att.days_marked, 'present', att.days_present,
        'absent', att.days_absent, 'late', att.days_late,
        'excused', att.days_excused
      ),
      'remark', case
        when rm.remark is null then null
        else jsonb_build_object('text', rm.remark, 'updated_at', rm.updated_at)
      end
    )
    from public.exam_results er
    join public.students st on st.id = er.student_id
    join public.people p on p.id = st.person_id
    join public.enrolments en
      on en.student_id = er.student_id
     and en.session_id = v_exam.session_id
     and en.status = 'active'
    join public.sections sec on sec.id = en.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    left join public.staff ct on ct.id = sec.class_teacher_staff_id
    left join public.people ctp on ctp.id = ct.person_id
    left join public.exam_remarks rm
      on rm.exam_id = p_exam_id and rm.student_id = er.student_id
    left join lateral public.exams_attendance_summary(
      er.student_id, v_exam.session_id, v_exam.ends_on
    ) att on true
    where er.exam_id = p_exam_id
      and (p_section_id is null or en.section_id = p_section_id)
      and (p_student_id is null or er.student_id = p_student_id)
    order by cl.name, sec.name, en.roll_number, p.first_name;

    return;
  end if;

  -- Draft.
  if v_role not in ('admin', 'teacher') then
    raise exception 'These results have not been published yet';
  end if;

  return query
  select jsonb_build_object(
    'school', jsonb_build_object('name', v_school),
    'session', jsonb_build_object('id', v_exam.session_id, 'name', v_session),
    'exam', jsonb_build_object(
      'id', v_exam.id, 'name', v_exam.name, 'kind', v_exam.kind,
      'status', v_exam.status, 'starts_on', v_exam.starts_on,
      'ends_on', v_exam.ends_on, 'published_at', v_exam.published_at
    ),
    'provisional', true,
    'student', jsonb_build_object(
      'id', r.student_id,
      'name', r.student_name,
      'admission_number', r.admission_number,
      'roll_number', r.roll_number,
      'section', r.section_label,
      'class_teacher', ctp.first_name || ' ' || ctp.last_name
    ),
    'papers', r.detail,
    'totals', jsonb_build_object(
      'obtained', r.total_marks, 'max', r.max_marks,
      'percentage', r.percentage, 'grade', r.grade,
      'grade_point', r.grade_point, 'result', r.result,
      'subjects_counted', r.subjects_counted,
      'subjects_failed', r.subjects_failed
    ),
    'rank', null,
    'attendance', jsonb_build_object(
      'marked', att.days_marked, 'present', att.days_present,
      'absent', att.days_absent, 'late', att.days_late,
      'excused', att.days_excused
    ),
    'remark', case
      when rm.remark is null then null
      else jsonb_build_object('text', rm.remark, 'updated_at', rm.updated_at)
    end
  )
  from public.exams_result_sheet(p_exam_id, p_section_id) r
  join public.enrolments en
    on en.student_id = r.student_id
   and en.session_id = v_exam.session_id
   and en.status = 'active'
  join public.sections sec on sec.id = en.section_id
  left join public.staff ct on ct.id = sec.class_teacher_staff_id
  left join public.people ctp on ctp.id = ct.person_id
  left join public.exam_remarks rm
    on rm.exam_id = p_exam_id and rm.student_id = r.student_id
  left join lateral public.exams_attendance_summary(
    r.student_id, v_exam.session_id, v_exam.ends_on
  ) att on true
  where p_student_id is null or r.student_id = p_student_id;
end;
$$;

revoke all on function public.exams_report_cards(uuid, uuid, uuid) from public, anon;
grant execute on function public.exams_report_cards(uuid, uuid, uuid) to authenticated;

-- One card, for the family's own screen.
create or replace function public.exams_report_card(p_exam_id uuid, p_student_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select c from public.exams_report_cards(p_exam_id, null, p_student_id) c limit 1
$$;

revoke all on function public.exams_report_card(uuid, uuid) from public, anon;
grant execute on function public.exams_report_card(uuid, uuid) to authenticated;

-- Which exams a family may open a card for: published ones with a result row
-- for this child. RLS on `exam_results` does the filtering, so there is no
-- `where tenant_id =` here.
create or replace function public.exams_published_for_student(p_student_id uuid)
returns table (
  exam_id uuid,
  exam_name text,
  kind text,
  ends_on date,
  published_at timestamptz,
  percentage numeric,
  grade text,
  result text,
  rank_in_cohort integer,
  cohort_size integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.id, e.name, e.kind, e.ends_on, e.published_at,
    er.percentage, er.grade, er.result, er.rank_in_cohort, er.cohort_size
  from public.exam_results er
  join public.exams e on e.id = er.exam_id
  where er.student_id = p_student_id
  order by e.ends_on desc nulls last, e.name
$$;

revoke all on function public.exams_published_for_student(uuid) from public, anon;
grant execute on function public.exams_published_for_student(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Writing a remark
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the policies on `exam_remarks` already decide who may write
-- which child's, and the draft-only rule is carried by `exam_status`. The
-- function exists for the upsert and for the two messages -- a raw foreign-key
-- or policy error is not something to show a class teacher.
create or replace function public.exams_set_remark(
  p_exam_id uuid,
  p_student_id uuid,
  p_remark text
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_exam public.exams;
  v_id uuid;
  v_text text := btrim(coalesce(p_remark, ''));
begin
  select * into v_exam from public.exams e where e.id = p_exam_id;
  if v_exam.id is null then
    raise exception 'That exam does not exist';
  end if;

  if v_exam.status <> 'draft' then
    raise exception 'These results are published, so the remarks are frozen. Unpublish the exam to change them.';
  end if;

  if v_text = '' then
    delete from public.exam_remarks rm
    where rm.exam_id = p_exam_id and rm.student_id = p_student_id;
    return null;
  end if;

  if length(v_text) > 500 then
    raise exception 'A remark is one line on a card. Keep it under 500 characters (this one is %).', length(v_text);
  end if;

  if not exists (
    select 1 from public.enrolments en
    where en.student_id = p_student_id
      and en.session_id = v_exam.session_id
      and en.status = 'active'
  ) then
    raise exception 'That student is not enrolled in the session this exam belongs to';
  end if;

  insert into public.exam_remarks (
    tenant_id, session_id, exam_id, student_id, remark, authored_by
  )
  values (
    v_exam.tenant_id, v_exam.session_id, p_exam_id, p_student_id, v_text, auth.uid()
  )
  on conflict (tenant_id, exam_id, student_id) do update
    set remark = excluded.remark,
        authored_by = excluded.authored_by
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.exams_set_remark(uuid, uuid, text) from public, anon;
grant execute on function public.exams_set_remark(uuid, uuid, text) to authenticated;

-- The class teacher's working list: every child in the section with their
-- current remark, so the whole class is one screen rather than forty.
create or replace function public.exams_remark_sheet(p_exam_id uuid, p_section_id uuid)
returns table (
  student_id uuid,
  student_name text,
  admission_number text,
  roll_number text,
  remark text,
  updated_at timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select
    en.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    st.admission_number,
    en.roll_number,
    rm.remark,
    rm.updated_at
  from public.enrolments en
  join public.students st on st.id = en.student_id
  join public.people p on p.id = st.person_id
  left join public.exam_remarks rm
    on rm.exam_id = p_exam_id and rm.student_id = en.student_id
  where en.section_id = p_section_id
    and en.status = 'active'
    and en.session_id = (select e.session_id from public.exams e where e.id = p_exam_id)
  order by en.roll_number, p.first_name
$$;

revoke all on function public.exams_remark_sheet(uuid, uuid) from public, anon;
grant execute on function public.exams_remark_sheet(uuid, uuid) to authenticated;
