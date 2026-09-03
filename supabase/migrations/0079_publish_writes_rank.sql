-- ---------------------------------------------------------------------------
-- Phase 3.2 — publish writes the rank, and the critic learns about ranking
-- ---------------------------------------------------------------------------

-- Publishing already froze the marks, the aggregate and the rules. It now
-- freezes the rank too, in the same statement, from the same cohort -- which is
-- the only moment at which "4th of 38" is true and can be made permanent.
--
-- Unchanged from 0047 apart from the two columns and the join: the admin check,
-- the already-published refusal and the empty-exam refusal are all still here.
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
    subjects_counted, subjects_failed, detail, rules_snapshot,
    rank_in_cohort, cohort_size
  )
  select
    v_tenant_id, v_exam.session_id, p_exam_id, r.student_id,
    r.total_marks, r.max_marks, r.percentage, r.grade, r.grade_point, r.result,
    r.subjects_counted, r.subjects_failed, r.detail, v_rules,
    rk.rank_in_cohort, rk.cohort_size
  from public.exams_result_sheet(p_exam_id, null) r
  left join public.exams_ranking(p_exam_id) rk on rk.student_id = r.student_id;

  get diagnostics v_written = row_count;

  update public.exams
  set status = 'published', published_at = now(), published_by = auth.uid()
  where id = p_exam_id;

  return v_written;
end;
$$;

revoke all on function public.exams_publish(uuid) from public, anon;
grant execute on function public.exams_publish(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------

-- Same contract as 0047: sentences, not error codes, and it lives next to the
-- engine so the thing that judges a scheme and the thing that evaluates it
-- cannot drift. Three new sentences, all about the `rank` key.
--
-- The one that matters is the last: a misspelt scope silently means "do not
-- rank", which is the safe behaviour but a baffling one to discover on a
-- printed card. Saying so here is what makes the safe default honest.
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

  union all
  select 'The rank scope is "' || (p_rules -> 'rank' ->> 'scope')
         || '", which is not one of "section", "class_level" or "school", so no rank will be worked out at all.'
  where p_rules ? 'rank'
    and coalesce(p_rules -> 'rank' ->> 'scope', 'section') not in ('section', 'class_level', 'school')

  union all
  select 'The rank method must be "competition" (1, 2, 2, 4) or "dense" (1, 2, 2, 3). "'
         || (p_rules -> 'rank' ->> 'method') || '" will be treated as "competition".'
  where p_rules ? 'rank'
    and coalesce(p_rules -> 'rank' ->> 'method', 'competition') not in ('competition', 'dense')

  union all
  select 'Ranking must include "all" students or only those who "passed". "'
         || (p_rules -> 'rank' ->> 'include') || '" will be treated as "all".'
  where p_rules ? 'rank'
    and coalesce(p_rules -> 'rank' ->> 'include', 'all') not in ('all', 'passed')
$$;

revoke all on function public.grading_scheme_problems(jsonb) from public, anon;
grant execute on function public.grading_scheme_problems(jsonb) to authenticated;
