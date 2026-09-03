-- ---------------------------------------------------------------------------
-- Phase 3.2 — demo data, and a backfill for results published before ranking
-- ---------------------------------------------------------------------------

-- 1. A ranking policy for every tenant that has a default scheme.
--
-- Section-wise, competition ranking (1, 2, 2, 4), everybody included. That is
-- the most common Indian school arrangement and a reasonable demo default -- it
-- is not a recommendation, which is exactly why it is a row and not a branch.
update public.grading_schemes
set rules = rules || '{"rank": {"scope": "section", "method": "competition", "include": "all"}}'::jsonb
where is_default
  and not (rules ? 'rank');

-- 2. Backfill.
--
-- `exam_results` rows published before migrations 0077-0080 have no rank and no
-- attendance. The engine cannot be borrowed to fill them in: `exams_ranking`
-- and `exams_attendance_summary` read the caller's tenant out of the JWT, and a
-- migration has no JWT. So the two computations are written out here, once,
-- deliberately duplicated -- a backfill is a historical statement about rows
-- that already exist, not a second implementation that has to stay in step.
--
-- It follows the scope the row's own frozen snapshot names, so a result
-- published under a scheme that does not rank stays unranked.
with cohorts as (
  select
    er.id,
    rank() over (
      partition by er.exam_id, en.section_id
      order by er.percentage desc
    ) as position,
    count(*) over (partition by er.exam_id, en.section_id) as cohort
  from public.exam_results er
  join public.enrolments en
    on en.student_id = er.student_id
   and en.session_id = er.session_id
   and en.tenant_id = er.tenant_id
   and en.status = 'active'
  where er.rank_in_cohort is null
    and coalesce(er.rules_snapshot -> 'rank' ->> 'scope', 'section') = 'section'
    and er.rules_snapshot ? 'rank'
)
update public.exam_results er
set rank_in_cohort = c.position,
    cohort_size = c.cohort
from cohorts c
where c.id = er.id;

-- The same day-level rollup `exams_attendance_summary` performs: absent beats
-- late beats excused beats present. The window ends at the exam's publication,
-- which is the day the card was made.
with days as (
  select
    er.id as result_id,
    ar.attendance_date,
    case
      when bool_or(ar.status = 'absent') then 'absent'
      when bool_or(ar.status = 'late') then 'late'
      when bool_or(ar.status = 'excused') then 'excused'
      else 'present'
    end as day_status
  from public.exam_results er
  join public.enrolments en
    on en.student_id = er.student_id
   and en.session_id = er.session_id
   and en.tenant_id = er.tenant_id
   and en.status = 'active'
  join public.attendance_records ar
    on ar.enrolment_id = en.id
   and ar.session_id = er.session_id
   and ar.attendance_date <= er.published_at::date
  where er.attendance = '{}'::jsonb
  group by er.id, ar.attendance_date
),
summary as (
  select
    d.result_id,
    count(*) as marked,
    count(*) filter (where day_status = 'present') as present,
    count(*) filter (where day_status = 'absent') as absent,
    count(*) filter (where day_status = 'late') as late,
    count(*) filter (where day_status = 'excused') as excused
  from days d
  group by d.result_id
)
update public.exam_results er
set attendance = jsonb_build_object(
  'upto', er.published_at::date,
  'marked', s.marked,
  'present', s.present,
  'absent', s.absent,
  'late', s.late,
  'excused', s.excused
)
from summary s
where s.result_id = er.id;

-- 3. Three remarks, so the card has its last line and the remark sheet has
-- something in it. Written straight in rather than through `exams_set_remark`,
-- which needs a signed-in class teacher; `exam_status` is copied from the exam
-- so the composite key holds either way.
do $$
declare
  v_tenant uuid;
  v_exam public.exams;
  v_section uuid;
  v_row record;
  v_remarks text[] := array[
    'A steady term. Reads aloud with confidence and helps others without being asked.',
    'Much improved since the unit test, particularly in mathematics. Still needs reminding to finish written work.',
    'Cheerful and well liked. Would do better with more regular practice at home.'
  ];
  v_i integer := 1;
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then
    return;
  end if;

  select * into v_exam from public.exams
  where tenant_id = v_tenant order by created_at limit 1;
  if v_exam.id is null then
    return;
  end if;

  select en.section_id into v_section
  from public.enrolments en
  join public.sections sec on sec.id = en.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  where en.tenant_id = v_tenant
    and en.session_id = v_exam.session_id
    and en.status = 'active'
  order by cl.name, sec.name
  limit 1;

  for v_row in
    select en.student_id
    from public.enrolments en
    where en.section_id = v_section and en.status = 'active'
    order by en.roll_number
    limit 3
  loop
    insert into public.exam_remarks (
      tenant_id, session_id, exam_id, student_id, exam_status, remark
    )
    values (
      v_tenant, v_exam.session_id, v_exam.id, v_row.student_id,
      v_exam.status, v_remarks[v_i]
    )
    on conflict (tenant_id, exam_id, student_id) do nothing;
    v_i := v_i + 1;
  end loop;
end $$;
