-- Phase 3.1, part 2 -- the grading engine.
--
-- THE RULES DOCUMENT
--
-- `grading_schemes.rules` is the engine's only input besides the marks:
--
-- {
--   "grades": [
--     {"code":"A1","min_percent":91,"point":10,"description":"Outstanding"},
--     {"code":"E", "min_percent":0, "point":0, "is_fail":true}
--   ],
--   "pass":     {"aggregate_min_percent": 33},
--   "grace":    {"max_marks": 5, "max_subjects": 1},
--   "aggregate":{"method": "weighted"},          -- or {"method":"best_of","best_of":5}
--   "optional_subject": {"replaces_worst": true}
-- }
--
-- Everything is optional. An empty `{}` gives a straight weighted mean, no
-- grace, no substitution, and no grade -- which is a coherent scheme, not an
-- error.
--
-- EVALUATION ORDER, WHICH IS THE PART THAT MATTERS
--
--   1. Raw marks. Absent counts as zero; not-yet-entered also counts as zero
--      but makes the whole result `incomplete`.
--   2. Grace. Papers short of their pass mark by no more than `grace.max_marks`
--      get exactly the marks they need, cheapest gap first, for at most
--      `grace.max_subjects` papers. Cheapest-first is deliberate: it converts
--      the most failures for the allowance, which is what a school means by
--      grace.
--   3. Per-subject pass, using the graced marks.
--   4. Optional substitution. Where `optional_subject.replaces_worst` is set,
--      each still-failed compulsory paper (worst first) is dropped in favour of
--      a passed optional paper (best first), one for one.
--   5. Best-of-N, if `aggregate.method` is `best_of`: keep the top N of what
--      survived step 4.
--   6. Aggregate over the counted papers, weighted by `exam_subjects.weight`.
--   7. Grade: the highest band whose `min_percent` the aggregate reaches.
--   8. Overall: `incomplete` if any counted paper is unmarked; otherwise `fail`
--      if any counted paper failed or the aggregate is under
--      `pass.aggregate_min_percent`; otherwise `pass`.
--
-- Order 2-before-3 and 4-before-5 are the two that schools argue about, so they
-- are stated here and asserted in `tests/exams/`.

-- ---------------------------------------------------------------------------
-- Grade bands
-- ---------------------------------------------------------------------------

create or replace function public.grading_grade_for(p_rules jsonb, p_percentage numeric)
returns table (code text, point numeric, is_fail boolean, description text)
language sql
immutable
set search_path = public, extensions
as $$
  select g.code, g.point, coalesce(g.is_fail, false), g.description
  from jsonb_to_recordset(coalesce(p_rules -> 'grades', '[]'::jsonb))
    as g(code text, min_percent numeric, point numeric, is_fail boolean, description text)
  where p_percentage >= coalesce(g.min_percent, 0)
  order by g.min_percent desc nulls last
  limit 1
$$;

revoke all on function public.grading_grade_for(jsonb, numeric) from public, anon;
grant execute on function public.grading_grade_for(jsonb, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Telling somebody their scheme is broken
-- ---------------------------------------------------------------------------

-- Not a check constraint. A half-finished scheme should be savable -- an
-- administrator building grade bands one at a time should not be refused at
-- every step -- and a broken one should be explainable in sentences rather than
-- as `violates constraint grading_schemes_rules_chk`.
create or replace function public.grading_scheme_problems(p_rules jsonb)
returns table (problem text)
language sql
immutable
set search_path = public, extensions
as $$
  with grades as (
    select * from jsonb_to_recordset(coalesce(p_rules -> 'grades', '[]'::jsonb))
      as g(code text, min_percent numeric, point numeric, is_fail boolean)
  )
  select 'This scheme has no grade bands, so results will carry marks but no grade.'
  where not exists (select 1 from grades)

  union all
  select 'A grade band has no code, so it cannot be printed on a report card.'
  where exists (select 1 from grades where code is null or trim(code) = '')

  union all
  select 'The lowest grade band starts at ' || (select min(min_percent) from grades)::text
         || '%, so a student below that would get no grade at all. Add a band starting at 0.'
  where exists (select 1 from grades) and (select min(coalesce(min_percent, 0)) from grades) > 0

  union all
  select 'Two grade bands both start at ' || min_percent::text || '%, so which one applies is arbitrary.'
  from grades where min_percent is not null
  group by min_percent having count(*) > 1

  union all
  select 'A grade band starts above 100%, which no aggregate can reach.'
  where exists (select 1 from grades where min_percent > 100)

  union all
  select 'The aggregate method must be "weighted" or "best_of".'
  where coalesce(p_rules -> 'aggregate' ->> 'method', 'weighted') not in ('weighted', 'best_of')

  union all
  select 'The aggregate method is "best_of" but no number of subjects to keep was given.'
  where (p_rules -> 'aggregate' ->> 'method') = 'best_of'
    and coalesce((p_rules -> 'aggregate' ->> 'best_of')::integer, 0) < 1

  union all
  select 'Grace allows marks to be added but says it may be applied to zero subjects, so it will never do anything.'
  where coalesce((p_rules -> 'grace' ->> 'max_marks')::numeric, 0) > 0
    and coalesce((p_rules -> 'grace' ->> 'max_subjects')::integer, 0) < 1

  union all
  select 'Grace may be applied to a subject but the allowance is zero marks, so it will never do anything.'
  where coalesce((p_rules -> 'grace' ->> 'max_subjects')::integer, 0) > 0
    and coalesce((p_rules -> 'grace' ->> 'max_marks')::numeric, 0) <= 0
$$;

revoke all on function public.grading_scheme_problems(jsonb) from public, anon;
grant execute on function public.grading_scheme_problems(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Which scheme applies
-- ---------------------------------------------------------------------------

-- The exam's own scheme, else the tenant's default, else an empty document.
-- Three fallbacks in one place, because a result that silently used a different
-- scheme than the report card header claims is the worst possible bug here.
create or replace function public.exams_rules_for(p_exam_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select gs.rules from public.grading_schemes gs
      where gs.tenant_id = e.tenant_id and gs.id = e.grading_scheme_id),
    (select gs.rules from public.grading_schemes gs
      where gs.tenant_id = e.tenant_id and gs.is_default),
    '{}'::jsonb
  )
  from public.exams e
  where e.id = p_exam_id
$$;

revoke all on function public.exams_rules_for(uuid) from public, anon;
grant execute on function public.exams_rules_for(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The engine
-- ---------------------------------------------------------------------------

-- Per student, per paper, after every rule has been applied -- with a `note`
-- saying which rule touched it. The working, not just the answer: "why is this
-- 61%" has to be answerable a year later, and a number with no derivation is
-- how a school loses an argument with a parent.
--
-- One pass over the whole cohort rather than a call per student, so a result
-- sheet for a class of forty is one query.
create or replace function public.exams_subject_breakdown(
  p_exam_id uuid,
  p_student_id uuid default null
)
returns table (
  student_id uuid,
  exam_subject_id uuid,
  subject_id uuid,
  subject_code text,
  subject_name text,
  max_marks numeric,
  pass_marks numeric,
  weight numeric,
  is_optional boolean,
  marks_obtained numeric,
  is_absent boolean,
  entered boolean,
  grace_marks numeric,
  effective_marks numeric,
  percentage numeric,
  passed boolean,
  counted boolean,
  note text
)
language sql
stable
set search_path = public, extensions
as $$
  with cfg as (
    select
      coalesce((src.r -> 'grace' ->> 'max_marks')::numeric, 0)       as grace_max,
      coalesce((src.r -> 'grace' ->> 'max_subjects')::integer, 0)    as grace_subjects,
      coalesce(src.r -> 'aggregate' ->> 'method', 'weighted')        as agg_method,
      (src.r -> 'aggregate' ->> 'best_of')::integer                  as best_of,
      coalesce((src.r -> 'optional_subject' ->> 'replaces_worst')::boolean, false) as opt_replaces
    from (select public.exams_rules_for(p_exam_id) as r) src
  ),
  papers as (
    select
      en.student_id,
      es.id as exam_subject_id,
      es.subject_id,
      sub.code as subject_code,
      sub.name as subject_name,
      es.max_marks,
      es.pass_marks,
      es.weight,
      es.is_optional,
      m.marks_obtained,
      coalesce(m.is_absent, false) as is_absent,
      (m.marks_obtained is not null) as entered
    from public.exam_subjects es
    join public.subjects sub on sub.id = es.subject_id
    -- The roll is the enrolment, not the marks: a student with no mark row yet
    -- must still appear, or a result sheet would silently shrink as it is being
    -- filled in.
    join public.enrolments en
      on en.section_id = es.section_id
     and en.session_id = es.session_id
     and en.status = 'active'
    left join public.marks m
      on m.exam_subject_id = es.id and m.student_id = en.student_id
    where es.exam_id = p_exam_id
      and (p_student_id is null or en.student_id = p_student_id)
  ),
  gapped as (
    select p.*,
      greatest(p.pass_marks - coalesce(p.marks_obtained, 0), 0) as gap,
      (
        p.entered and not p.is_absent
        and coalesce(p.marks_obtained, 0) < p.pass_marks
        and (p.pass_marks - coalesce(p.marks_obtained, 0)) <= c.grace_max
        and c.grace_max > 0
      ) as grace_eligible
    from papers p cross join cfg c
  ),
  -- Cheapest gap first: the allowance converts as many failures as it can,
  -- which is what a school means by grace.
  grace_ranked as (
    select g.*,
      row_number() over (
        partition by g.student_id
        order by (case when g.grace_eligible then 0 else 1 end), g.gap, g.exam_subject_id
      ) as grace_rank
    from gapped g
  ),
  scored as (
    select g.*,
      case when g.grace_eligible and g.grace_rank <= c.grace_subjects then g.gap else 0 end as grace_marks
    from grace_ranked g cross join cfg c
  ),
  flagged as (
    select s.*,
      (coalesce(s.marks_obtained, 0) + s.grace_marks) as effective_marks,
      (
        s.entered and not s.is_absent
        and (coalesce(s.marks_obtained, 0) + s.grace_marks) >= s.pass_marks
      ) as passed
    from scored s
  ),
  ranked as (
    select f.*,
      round(100.0 * f.effective_marks / nullif(f.max_marks, 0), 3) as percentage,
      -- Ranked within the "failed compulsory" group and the "passed optional"
      -- group separately; the value is only read where the condition holds.
      row_number() over (
        partition by f.student_id, (not f.is_optional and not f.passed)
        order by f.effective_marks / nullif(f.max_marks, 0), f.exam_subject_id
      ) as fail_rank,
      row_number() over (
        partition by f.student_id, (f.is_optional and f.passed)
        order by f.effective_marks / nullif(f.max_marks, 0) desc, f.exam_subject_id
      ) as opt_rank
    from flagged f
  ),
  swaps as (
    select
      r.student_id,
      case when c.opt_replaces then least(
        count(*) filter (where not r.is_optional and not r.passed),
        count(*) filter (where r.is_optional and r.passed)
      ) else 0 end as substitutions
    from ranked r cross join cfg c
    group by r.student_id, c.opt_replaces
  ),
  pooled as (
    select r.*,
      s.substitutions,
      case
        when r.is_optional then (r.passed and r.opt_rank <= s.substitutions)
        else not (not r.passed and r.fail_rank <= s.substitutions)
      end as in_pool
    from ranked r
    join swaps s on s.student_id = r.student_id
  ),
  best as (
    select p.*,
      row_number() over (
        partition by p.student_id, p.in_pool
        order by p.effective_marks / nullif(p.max_marks, 0) desc, p.exam_subject_id
      ) as best_rank
    from pooled p
  )
  select
    b.student_id,
    b.exam_subject_id,
    b.subject_id,
    b.subject_code,
    b.subject_name,
    b.max_marks,
    b.pass_marks,
    b.weight,
    b.is_optional,
    b.marks_obtained,
    b.is_absent,
    b.entered,
    b.grace_marks,
    b.effective_marks,
    b.percentage,
    b.passed,
    (
      b.in_pool
      and (c.agg_method <> 'best_of' or c.best_of is null or b.best_rank <= c.best_of)
    ) as counted,
    nullif(concat_ws(
      '; ',
      case when b.grace_marks > 0
        then 'Grace of ' || b.grace_marks::text || ' applied' end,
      case when not b.is_optional and not b.in_pool
        then 'Replaced by an additional subject' end,
      case when b.is_optional and b.in_pool
        then 'Counted in place of a failed subject' end,
      case when b.in_pool and c.agg_method = 'best_of' and c.best_of is not null
             and b.best_rank > c.best_of
        then 'Dropped by best-of-' || c.best_of::text end,
      case when b.is_absent then 'Absent' end,
      case when not b.entered and not b.is_absent then 'Not marked yet' end
    ), '') as note
  from best b cross join cfg c
  order by b.student_id, b.is_optional, b.subject_code
$$;

revoke all on function public.exams_subject_breakdown(uuid, uuid) from public, anon;
grant execute on function public.exams_subject_breakdown(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The aggregate
-- ---------------------------------------------------------------------------

create or replace function public.exams_result_sheet(
  p_exam_id uuid,
  p_section_id uuid default null
)
returns table (
  student_id uuid,
  admission_number text,
  student_name text,
  roll_number text,
  section_label text,
  total_marks numeric,
  max_marks numeric,
  percentage numeric,
  grade text,
  grade_point numeric,
  result text,
  subjects_counted integer,
  subjects_failed integer,
  subjects_unmarked integer,
  detail jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  with rules as (select public.exams_rules_for(p_exam_id) as r),
  breakdown as (
    select * from public.exams_subject_breakdown(p_exam_id, null)
  ),
  agg as (
    select
      b.student_id,
      sum(b.effective_marks * b.weight) filter (where b.counted) as total_weighted,
      sum(b.max_marks * b.weight) filter (where b.counted)       as max_weighted,
      count(*) filter (where b.counted)::integer                 as subjects_counted,
      count(*) filter (where b.counted and not b.passed)::integer as subjects_failed,
      count(*) filter (where b.counted and not b.entered and not b.is_absent)::integer as subjects_unmarked,
      jsonb_agg(
        jsonb_build_object(
          'subject', b.subject_name,
          'code', b.subject_code,
          'max', b.max_marks,
          'pass', b.pass_marks,
          'obtained', b.marks_obtained,
          'grace', b.grace_marks,
          'effective', b.effective_marks,
          'percent', b.percentage,
          'passed', b.passed,
          'counted', b.counted,
          'optional', b.is_optional,
          'absent', b.is_absent,
          'note', b.note
        )
        order by b.is_optional, b.subject_code
      ) as detail
    from breakdown b
    group by b.student_id
  ),
  scored as (
    select
      a.*,
      round(100.0 * a.total_weighted / nullif(a.max_weighted, 0), 3) as percentage
    from agg a
  )
  select
    s.student_id,
    st.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    en.roll_number,
    (cl.name || ' ' || sec.name)::text,
    round(s.total_weighted, 2),
    round(s.max_weighted, 2),
    s.percentage,
    g.code,
    g.point,
    case
      when s.subjects_unmarked > 0 then 'incomplete'
      when s.subjects_failed > 0 then 'fail'
      when s.percentage < coalesce((r.r -> 'pass' ->> 'aggregate_min_percent')::numeric, 0)
        then 'fail'
      else 'pass'
    end,
    s.subjects_counted,
    s.subjects_failed,
    s.subjects_unmarked,
    s.detail
  from scored s
  cross join rules r
  join public.students st on st.id = s.student_id
  join public.people p on p.id = st.person_id
  join public.enrolments en
    on en.student_id = s.student_id
   and en.session_id = (select e.session_id from public.exams e where e.id = p_exam_id)
   and en.status = 'active'
  join public.sections sec on sec.id = en.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  left join lateral public.grading_grade_for(r.r, s.percentage) g on true
  where p_section_id is null or en.section_id = p_section_id
  order by cl.name, sec.name, en.roll_number, p.first_name
$$;

revoke all on function public.exams_result_sheet(uuid, uuid) from public, anon;
grant execute on function public.exams_result_sheet(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Entering marks
-- ---------------------------------------------------------------------------

-- One paper's whole column in one call. As separate client calls a dropped
-- connection leaves half a class marked, and supabase-js cannot open a
-- transaction. Idempotent on the unique key, so a replayed payload converges.
--
-- SECURITY INVOKER: the subject-teacher policy on `marks` still decides which
-- papers this caller may touch. The function only adds atomicity.
create or replace function public.exams_enter_marks(
  p_exam_subject_id uuid,
  p_entries jsonb
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_paper public.exam_subjects;
  v_exam public.exams;
  v_written integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_paper from public.exam_subjects es
  where es.tenant_id = v_tenant_id and es.id = p_exam_subject_id;

  if v_paper.id is null then
    raise exception 'That paper does not exist';
  end if;

  select * into v_exam from public.exams e where e.id = v_paper.exam_id;

  -- A published result is what a parent has already been shown. Changing the
  -- marks underneath it would leave the frozen `exam_results` row disagreeing
  -- with the marks it was computed from, which is exactly the drift freezing
  -- exists to prevent.
  if v_exam.status = 'published' then
    raise exception 'This exam is published. Unpublish it before changing marks.';
  end if;

  with entries as (
    select
      (e ->> 'student_id')::uuid as student_id,
      nullif(e ->> 'marks_obtained', '')::numeric as marks_obtained,
      coalesce((e ->> 'is_absent')::boolean, false) as is_absent,
      nullif(e ->> 'remarks', '') as remarks
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  )
  insert into public.marks (
    tenant_id, session_id, exam_subject_id, student_id,
    marks_obtained, is_absent, remarks, max_marks, entered_by
  )
  select
    v_tenant_id, v_paper.session_id, v_paper.id, en.student_id,
    -- An absent student has no mark, whatever the payload said. Enforced here
    -- as well as by `marks_absent_chk`, so the caller gets a saved row rather
    -- than a constraint violation for a combination the UI can produce.
    case when en.is_absent then null else en.marks_obtained end,
    en.is_absent,
    en.remarks,
    v_paper.max_marks,
    auth.uid()
  from entries en
  on conflict (tenant_id, exam_subject_id, student_id)
  do update set
    marks_obtained = excluded.marks_obtained,
    is_absent = excluded.is_absent,
    remarks = excluded.remarks,
    entered_by = excluded.entered_by;

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

revoke all on function public.exams_enter_marks(uuid, jsonb) from public, anon;
grant execute on function public.exams_enter_marks(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Freezing
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, like `notify_send`, and for the same reason: `exam_results`
-- has no INSERT policy for anybody. A table whose whole value is being
-- trustworthy should not be hand-writable by the people it describes, so the
-- only way a row gets there is through this function, which does its own admin
-- check.
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
    subjects_counted, subjects_failed, detail, rules_snapshot
  )
  select
    v_tenant_id, v_exam.session_id, p_exam_id, r.student_id,
    r.total_marks, r.max_marks, r.percentage, r.grade, r.grade_point, r.result,
    r.subjects_counted, r.subjects_failed, r.detail, v_rules
  from public.exams_result_sheet(p_exam_id, null) r;

  get diagnostics v_written = row_count;

  update public.exams
  set status = 'published', published_at = now(), published_by = auth.uid()
  where id = p_exam_id;

  return v_written;
end;
$$;

revoke all on function public.exams_publish(uuid) from public, anon;
grant execute on function public.exams_publish(uuid) to authenticated;

-- Deliberately destructive and deliberately audited: it deletes the frozen
-- rows, so a correction is visible as an unpublish/republish pair in
-- `audit_log` rather than as a number that quietly changed.
create or replace function public.exams_unpublish(p_exam_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_removed integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can unpublish results';
  end if;

  if not exists (
    select 1 from public.exams e where e.id = p_exam_id and e.tenant_id = v_tenant_id
  ) then
    raise exception 'That exam does not exist';
  end if;

  delete from public.exam_results er
  where er.exam_id = p_exam_id and er.tenant_id = v_tenant_id;

  get diagnostics v_removed = row_count;

  update public.exams
  set status = 'draft', published_at = null, published_by = null
  where id = p_exam_id and tenant_id = v_tenant_id;

  return v_removed;
end;
$$;

revoke all on function public.exams_unpublish(uuid) from public, anon;
grant execute on function public.exams_unpublish(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- One paper's column, for the marks-entry grid
-- ---------------------------------------------------------------------------

create or replace function public.exams_mark_sheet(p_exam_subject_id uuid)
returns table (
  student_id uuid,
  admission_number text,
  student_name text,
  roll_number text,
  marks_obtained numeric,
  is_absent boolean,
  remarks text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    en.student_id,
    st.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    en.roll_number,
    m.marks_obtained,
    coalesce(m.is_absent, false),
    m.remarks
  from public.exam_subjects es
  join public.enrolments en
    on en.section_id = es.section_id
   and en.session_id = es.session_id
   and en.status = 'active'
  join public.students st on st.id = en.student_id
  join public.people p on p.id = st.person_id
  left join public.marks m
    on m.exam_subject_id = es.id and m.student_id = en.student_id
  where es.id = p_exam_subject_id
  order by en.roll_number nulls last, p.first_name
$$;

revoke all on function public.exams_mark_sheet(uuid) from public, anon;
grant execute on function public.exams_mark_sheet(uuid) to authenticated;
