-- ---------------------------------------------------------------------------
-- Phase 3.2 — the attendance line is frozen too
--
-- Found by reading a real card rather than by reasoning about one. The first
-- version computed the attendance summary at read time, cut off at the exam's
-- `ends_on`. Two things were wrong with it, and only the first was visible:
--
--   1. The demo card said "0 of 0 days", because the register starts two days
--      after the exam week ends. Cutting at `ends_on` answers "attendance
--      during the exam", which is not the question a report card asks. A card
--      reports the term.
--
--   2. Worse, and invisible: the number moved. A card reprinted in December
--      would show more days than the one handed to the parent in March, from
--      the same frozen result row. Every other number on the card is frozen at
--      publish precisely so a reprint matches; attendance was the one that was
--      not, and it is the number a parent is most likely to query.
--
-- So it freezes with the rest, and it carries its own cut-off date, because
-- "172 of 180" means nothing without saying up to when.
-- ---------------------------------------------------------------------------

alter table public.exam_results
  add column attendance jsonb not null default '{}'::jsonb;

comment on column public.exam_results.attendance is
  'The attendance summary as it stood at publish: {upto, marked, present, absent, late, excused}. Frozen, like every other number on the card, so a reprint matches the original. Empty for results published before migration 0080.';

-- Publish, third revision. 0047 froze the marks; 0079 added the rank; this adds
-- the attendance. The window runs to the day of publishing, not to the exam's
-- last paper -- a term report covers the term.
create or replace function public.exams_publish(p_exam_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_exam public.exams;
  v_rules jsonb;
  v_written integer;
  v_upto date := current_date;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can publish results';
  end if;

  select * into v_exam from public.exams e
  where e.id = p_exam_id and e.tenant_id = v_tenant_id;

  if v_exam.id is null then
    raise exception 'That exam does not exist';
  end if;

  if v_exam.status = 'published' then
    raise exception 'This exam is already published';
  end if;

  if not exists (select 1 from public.exam_subjects es where es.exam_id = p_exam_id) then
    raise exception 'This exam has no papers, so there is nothing to publish';
  end if;

  v_rules := public.exams_rules_for(p_exam_id);

  insert into public.exam_results (
    tenant_id, session_id, exam_id, student_id,
    total_marks, max_marks, percentage, grade, grade_point, result,
    subjects_counted, subjects_failed, detail, rules_snapshot,
    rank_in_cohort, cohort_size, attendance
  )
  select
    v_tenant_id, v_exam.session_id, p_exam_id, r.student_id,
    r.total_marks, r.max_marks, r.percentage, r.grade, r.grade_point, r.result,
    r.subjects_counted, r.subjects_failed, r.detail, v_rules,
    rk.rank_in_cohort, rk.cohort_size,
    jsonb_build_object(
      'upto', v_upto,
      'marked', att.days_marked,
      'present', att.days_present,
      'absent', att.days_absent,
      'late', att.days_late,
      'excused', att.days_excused
    )
  from public.exams_result_sheet(p_exam_id, null) r
  left join public.exams_ranking(p_exam_id) rk on rk.student_id = r.student_id
  left join lateral public.exams_attendance_summary(
    r.student_id, v_exam.session_id, v_upto
  ) att on true;

  get diagnostics v_written = row_count;

  update public.exams
  set status = 'published', published_at = now(), published_by = auth.uid()
  where id = p_exam_id;

  return v_written;
end;
$$;

revoke all on function public.exams_publish(uuid) from public, anon;
grant execute on function public.exams_publish(uuid) to authenticated;

-- The card, reading the frozen summary on the published side and computing a
-- live one on the draft side -- where "live" is honest, because the whole card
-- is stamped `provisional`.
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
      'attendance', case when er.attendance = '{}'::jsonb then null else er.attendance end,
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
    where er.exam_id = p_exam_id
      and (p_section_id is null or en.section_id = p_section_id)
      and (p_student_id is null or er.student_id = p_student_id)
    order by cl.name, sec.name, en.roll_number, p.first_name;

    return;
  end if;

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
      'upto', current_date,
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
    r.student_id, v_exam.session_id, current_date
  ) att on true
  where p_student_id is null or r.student_id = p_student_id;
end;
$$;

revoke all on function public.exams_report_cards(uuid, uuid, uuid) from public, anon;
grant execute on function public.exams_report_cards(uuid, uuid, uuid) to authenticated;
