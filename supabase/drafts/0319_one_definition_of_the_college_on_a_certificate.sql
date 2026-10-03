-- 0319: one definition of the college on a certificate; /checks loads again.
--
-- 0248 left certificate_snapshot with its own copy of the seven school.*
-- values and added a critic comparing it with certificate_school_values(),
-- asking the next migration to collapse the two and delete the critic.
--
-- The critic built a whole student certificate to compare seven settings:
-- 1.6-8.9 s as Northgate's administrator, against an 8 s statement timeout
-- for signed-in callers, so /checks showed its error boundary in the 3 Oct
-- 2026 walkthrough. A timeout cancels the statement, so checks_run could not
-- catch it and every other critic went down with it.
--
-- The expressions were identical and the keys disjoint. Old and new snapshots
-- were compared for students of both colleges, as each administrator, in a
-- rolled-back transaction: 9 compared, 0 different. The critic goes.

begin;

create or replace function public.certificate_snapshot(p_student_id uuid, p_issued_on date default null::date, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id  uuid := public.current_tenant_id();
  v_session_id uuid;
  v_issued_on  date;
  v_out        jsonb;
  v_row        record;
  v_att        record;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  v_issued_on := coalesce(p_issued_on, public.mobile_today());

  select
    st.admission_number,
    st.admission_date,
    st.status as student_status,
    trim(both ' ' from
      p.first_name || ' ' || coalesce(p.middle_name || ' ', '') || p.last_name) as full_name,
    p.first_name,
    p.date_of_birth,
    p.gender,
    p.blood_group,
    nullif(trim(both ', ' from concat_ws(', ',
      p.address_line1, p.address_line2, p.city, p.state, p.postal_code)), '') as address,
    ( select trim(both ' ' from gp.first_name || ' ' || gp.last_name)
      from public.guardian_student gs
      join public.guardians g on g.id = gs.guardian_id
      join public.people gp on gp.id = g.person_id
      where gs.student_id = st.id and gs.relationship = 'father'
      order by gs.is_primary desc
      limit 1 ) as father_name,
    ( select trim(both ' ' from gp.first_name || ' ' || gp.last_name)
      from public.guardian_student gs
      join public.guardians g on g.id = gs.guardian_id
      join public.people gp on gp.id = g.person_id
      where gs.student_id = st.id and gs.relationship = 'mother'
      order by gs.is_primary desc
      limit 1 ) as mother_name,
    ( select trim(both ' ' from gp.first_name || ' ' || gp.last_name)
      from public.guardian_student gs
      join public.guardians g on g.id = gs.guardian_id
      join public.people gp on gp.id = g.person_id
      where gs.student_id = st.id
      order by gs.is_primary desc
      limit 1 ) as guardian_name,
    en.roll_number,
    cl.name as class_name,
    sec.name as section_name,
    ( select acs.name from public.academic_sessions acs where acs.id = v_session_id ) as session_name
  into v_row
  from public.students st
  join public.people p on p.id = st.person_id
  left join public.enrolments en
    on en.student_id = st.id and en.session_id = v_session_id
  left join public.sections sec on sec.id = en.section_id
  left join public.class_levels cl on cl.id = sec.class_level_id
  where st.id = p_student_id;

  if v_row.admission_number is null then
    raise exception 'No such student, or you cannot see them';
  end if;

  select * into v_att
  from public.exams_attendance_summary(p_student_id, v_session_id, v_issued_on);

  -- The college: the one definition staff certificates use too (0248, 0319).
  v_out := public.certificate_school_values(v_tenant_id) || jsonb_strip_nulls(jsonb_build_object(
    'student.name', v_row.full_name,
    'student.first_name', v_row.first_name,
    'student.admission_number', v_row.admission_number,
    'student.date_of_birth', to_char(v_row.date_of_birth, 'FMDD Mon YYYY'),
    'student.gender', initcap(v_row.gender),
    'student.blood_group', v_row.blood_group,
    'student.address', v_row.address,
    'student.father_name', v_row.father_name,
    'student.mother_name', v_row.mother_name,
    'student.guardian_name', v_row.guardian_name,

    'admission.date', to_char(v_row.admission_date, 'FMDD Mon YYYY'),
    'class.name', v_row.class_name,
    'class.label', nullif(concat_ws(' ', v_row.class_name, v_row.section_name), ''),
    'section.name', v_row.section_name,
    'roll_number', v_row.roll_number,
    'session.name', v_row.session_name,

    'attendance.days_marked', v_att.days_marked,
    'attendance.days_present', v_att.days_present,
    'attendance.percent', case
      when coalesce(v_att.days_marked, 0) = 0 then null
      else to_char(round(
        100.0 * (v_att.days_present + v_att.days_late) / v_att.days_marked, 1), 'FM990.0')
    end,

    'result.exam', ( select e.name from public.exam_results r
                     join public.exams e on e.id = r.exam_id
                     where r.student_id = p_student_id and e.status = 'published'
                     order by e.published_at desc nulls last limit 1 ),
    'result.outcome', ( select initcap(r.result) from public.exam_results r
                        join public.exams e on e.id = r.exam_id
                        where r.student_id = p_student_id and e.status = 'published'
                        order by e.published_at desc nulls last limit 1 ),
    'result.percentage', ( select to_char(round(r.percentage, 1), 'FM990.0') from public.exam_results r
                           join public.exams e on e.id = r.exam_id
                           where r.student_id = p_student_id and e.status = 'published'
                           order by e.published_at desc nulls last limit 1 ),
    'result.grade', ( select r.grade from public.exam_results r
                      join public.exams e on e.id = r.exam_id
                      where r.student_id = p_student_id and e.status = 'published'
                      order by e.published_at desc nulls last limit 1 ),

    'fees.outstanding', ( select to_char(b.balance, 'FM9999999990.00')
                          from public.fees_student_balances(null, false, array[p_student_id]) b ),

    'date.issued', to_char(v_issued_on, 'FMDD Mon YYYY'),
    'serial', null
  ));

  return v_out || coalesce(p_extra, '{}'::jsonb);
end;
$function$;

delete from reference.checks where key = 'certificates.school_values';

drop function public.certificate_school_values_problems();

commit;
