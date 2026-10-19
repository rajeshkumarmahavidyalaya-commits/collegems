-- 0362: the public result lookup shows every year's published results.
--
-- 0361 showed only the working year's. Probed in a college that had just
-- promoted: every published result was in 2025-2026, so the lookup said
-- nothing to every family the week after results day. That is the "data
-- vanished after promotion" report again (0355), arriving on a public page.
-- A result does not stop being the child's when the year turns, so the lookup
-- shows the ten most recent published results, each with its year.

begin;

create or replace function public.public_results(p_slug text, p_admission_number text, p_date_of_birth date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.public_page_tenant(p_slug, 'results');
  v_student uuid;
  v_results jsonb;
begin
  if v_tenant is null then
    return null;
  end if;
  if not public.public_page_take(v_tenant, 'lookup') then
    raise exception 'Too many lookups at this college in the last hour. Please try again later.';
  end if;
  v_student := public.public_student_match(v_tenant, p_admission_number, p_date_of_birth);
  if v_student is null then
    return null;
  end if;
  select jsonb_agg(x.doc order by x.published_at desc, x.exam)
    into v_results
  from (
    select r.published_at, e.name as exam, jsonb_build_object(
      'exam', e.name,
      'session', s.name,
      'published_on', (r.published_at at time zone 'UTC')::date,
      'total', r.total_marks, 'max', r.max_marks, 'percentage', r.percentage,
      'grade', r.grade, 'result', r.result,
      'rank', r.rank_in_cohort, 'cohort', r.cohort_size,
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'subject', d ->> 'subject', 'obtained', d -> 'obtained', 'max', d -> 'max',
          'passed', d -> 'passed', 'absent', d -> 'absent'))
        from jsonb_array_elements(r.detail) d
      ), '[]'::jsonb)
    ) as doc
    from public.exam_results r
    join public.exams e on e.id = r.exam_id
    join public.academic_sessions s on s.id = r.session_id
    where r.student_id = v_student and r.tenant_id = v_tenant and e.status = 'published'
    order by r.published_at desc, e.name
    limit 10
  ) x;
  if v_results is null then
    return null;
  end if;
  return jsonb_build_object(
    'student', (select btrim(concat_ws(' ', p.first_name, p.last_name)) from public.students st
                join public.people p on p.id = st.person_id where st.id = v_student),
    'results', v_results
  );
end;
$$;

commit;
