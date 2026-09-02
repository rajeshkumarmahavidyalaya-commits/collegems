-- Phase 3.1, part 4 -- two rules the substitution step got wrong.
--
-- Both were found by reading the demo cohort's numbers rather than by reading
-- the code. 49 students had an absence and only 4 of those absences counted
-- against anyone -- which was the engine quietly doing something nobody asked
-- it to.
--
-- ---------------------------------------------------------------------------
-- 1. An unmarked paper is not a failure, and must never be substituted away
-- ---------------------------------------------------------------------------
--
-- `passed` is false for a paper with no mark, because a paper with no mark has
-- not been passed. The substitution step read that as "a failed compulsory
-- subject" and replaced it with the optional one -- so the unmarked paper left
-- the counted set, `subjects_unmarked` fell to zero, and the student was
-- reported as having PASSED an exam one of whose papers nobody had marked.
--
-- Reproduced on the demo cohort: deleting a single mark row turned
-- `result = 'incomplete'` into `result = 'pass'`, with `subjects_unmarked: 0`.
--
-- The fix is that only a *resolved* paper -- one with a mark, or one recorded
-- as an absence -- can be substituted. An unmarked paper stays in the counted
-- set, keeps the result `incomplete`, and keeps the marks-entry screen honest
-- about what is left to do.
--
-- ---------------------------------------------------------------------------
-- 2. Whether an absence may be substituted is the school's decision, not ours
-- ---------------------------------------------------------------------------
--
-- An absent paper is a failed paper as far as the aggregate is concerned, so
-- the substitution step treated it as one and let the additional subject cover
-- it. That is a defensible school policy and it is emphatically not a universal
-- one: most schools will not let a pupil skip a paper and have art stand in for
-- it.
--
-- So it becomes a rule: `optional_subject.replaces_absent`, defaulting to
-- **false**. The conservative default is the right one here -- a school that
-- wants the lenient behaviour will say so, whereas a school that gets it by
-- accident will not notice until a parent asks why their child never sat
-- science and passed anyway.
--
-- This is the shape the whole module is built for. The rule that was wrong was
-- wrong in a JSON document, so fixing it for one school is a row and fixing it
-- for everybody is this migration -- not a release branch per customer.

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
      coalesce((src.r -> 'optional_subject' ->> 'replaces_worst')::boolean, false) as opt_replaces,
      coalesce((src.r -> 'optional_subject' ->> 'replaces_absent')::boolean, false) as opt_replaces_absent
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
      ) as passed,
      -- "This paper has an outcome." A paper with neither a mark nor an
      -- absence has not happened yet, and nothing may be inferred from it.
      (s.entered or s.is_absent) as resolved
    from scored s
  ),
  ranked as (
    select f.*,
      round(100.0 * f.effective_marks / nullif(f.max_marks, 0), 3) as percentage,
      (
        not f.is_optional
        and f.resolved
        and not f.passed
        and (c.opt_replaces_absent or not f.is_absent)
      ) as substitutable_fail,
      row_number() over (
        partition by f.student_id, (
          not f.is_optional and f.resolved and not f.passed
          and (c.opt_replaces_absent or not f.is_absent)
        )
        order by f.effective_marks / nullif(f.max_marks, 0), f.exam_subject_id
      ) as fail_rank,
      row_number() over (
        partition by f.student_id, (f.is_optional and f.passed)
        order by f.effective_marks / nullif(f.max_marks, 0) desc, f.exam_subject_id
      ) as opt_rank
    from flagged f cross join cfg c
  ),
  swaps as (
    select
      r.student_id,
      case when c.opt_replaces then least(
        count(*) filter (where r.substitutable_fail),
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
        else not (r.substitutable_fail and r.fail_rank <= s.substitutions)
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
      case when not b.resolved then 'Not marked yet' end
    ), '') as note
  from best b cross join cfg c
  order by b.student_id, b.is_optional, b.subject_code
$$;
