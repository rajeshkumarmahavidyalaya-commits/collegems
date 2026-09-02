-- Phase 3.1, part 3 -- two schemes that disagree, and an exam to run them on.
--
-- Two schemes rather than one, because the entire claim of this module is that
-- the rules are data. A single scheme demonstrates nothing: it is
-- indistinguishable from hardcoded logic. Two schemes over the *same* marks,
-- producing different results, is the demonstration.
--
-- Marks are generated from a hash of the student and subject ids, so the demo
-- is identical on every machine and every re-run, with a deliberate band of
-- near-misses at 28-32 so grace has something to do.

do $$
declare
  v_tenant record;
  v_session_id uuid;
  v_scheme_id uuid;
  v_exam_id uuid;
  v_art_id uuid;
begin
  for v_tenant in select id from public.tenants loop
    select a.id into v_session_id
    from public.academic_sessions a
    where a.tenant_id = v_tenant.id and a.is_current;

    continue when v_session_id is null;
    -- Nothing to examine.
    continue when not exists (
      select 1 from public.section_subjects ss
      where ss.tenant_id = v_tenant.id and ss.session_id = v_session_id
    );

    ------------------------------------------------------------------
    -- The default scheme: eight bands, grace, and an additional subject
    -- that may stand in for a failed compulsory one.
    ------------------------------------------------------------------
    insert into public.grading_schemes (tenant_id, name, description, is_default, rules)
    values (
      v_tenant.id,
      'Standard (nine-point, with grace)',
      'Eight grade bands, five grace marks in one subject, and an additional subject that can replace a failed compulsory one.',
      true,
      jsonb_build_object(
        'grades', jsonb_build_array(
          jsonb_build_object('code','A1','min_percent',91,'point',10,'description','Outstanding'),
          jsonb_build_object('code','A2','min_percent',81,'point',9, 'description','Excellent'),
          jsonb_build_object('code','B1','min_percent',71,'point',8, 'description','Very good'),
          jsonb_build_object('code','B2','min_percent',61,'point',7, 'description','Good'),
          jsonb_build_object('code','C1','min_percent',51,'point',6, 'description','Fair'),
          jsonb_build_object('code','C2','min_percent',41,'point',5, 'description','Satisfactory'),
          jsonb_build_object('code','D', 'min_percent',33,'point',4, 'description','Pass'),
          jsonb_build_object('code','E', 'min_percent',0, 'point',0, 'description','Needs improvement','is_fail',true)
        ),
        'pass', jsonb_build_object('aggregate_min_percent', 33),
        'grace', jsonb_build_object('max_marks', 5, 'max_subjects', 1),
        'aggregate', jsonb_build_object('method', 'weighted'),
        'optional_subject', jsonb_build_object('replaces_worst', true)
      )
    )
    on conflict (tenant_id, name) do nothing
    returning id into v_scheme_id;

    if v_scheme_id is null then
      select id into v_scheme_id from public.grading_schemes
      where tenant_id = v_tenant.id and name = 'Standard (nine-point, with grace)';
    end if;

    ------------------------------------------------------------------
    -- The same bands over a different aggregate. Switching an exam to
    -- this scheme changes every student's percentage without a single
    -- mark being touched -- which is the whole point of the module.
    ------------------------------------------------------------------
    insert into public.grading_schemes (tenant_id, name, description, is_default, rules)
    select
      v_tenant.id,
      'Best five of six',
      'The same grade bands, but only a student''s five strongest subjects count. No grace, no substitution.',
      false,
      jsonb_set(
        jsonb_set(gs.rules, '{aggregate}',
          jsonb_build_object('method', 'best_of', 'best_of', 5)),
        '{grace}', jsonb_build_object('max_marks', 0, 'max_subjects', 0)
      ) - 'optional_subject'
    from public.grading_schemes gs
    where gs.id = v_scheme_id
    on conflict (tenant_id, name) do nothing;

    ------------------------------------------------------------------
    -- The exam
    ------------------------------------------------------------------
    insert into public.exams (tenant_id, session_id, name, kind, starts_on, ends_on, grading_scheme_id)
    values (
      v_tenant.id, v_session_id, 'Half-Yearly Examination', 'half_yearly',
      current_date - 40, current_date - 30, v_scheme_id
    )
    on conflict (tenant_id, session_id, name) do nothing
    returning id into v_exam_id;

    continue when v_exam_id is null;

    -- Art is the additional subject, where a school has one. It is the
    -- realistic choice and it gives the substitution rule something to act on.
    select id into v_art_id from public.subjects
    where tenant_id = v_tenant.id and code = 'ART';

    insert into public.exam_subjects (
      tenant_id, session_id, exam_id, section_id, subject_id,
      max_marks, pass_marks, weight, is_optional, exam_date
    )
    select
      ss.tenant_id, ss.session_id, v_exam_id, ss.section_id, ss.subject_id,
      100, 33, 1,
      (v_art_id is not null and ss.subject_id = v_art_id),
      current_date - 40 + (row_number() over (
        partition by ss.section_id order by ss.subject_id
      ))::integer
    from public.section_subjects ss
    where ss.tenant_id = v_tenant.id and ss.session_id = v_session_id;

    ------------------------------------------------------------------
    -- The marks
    ------------------------------------------------------------------
    -- Hash-derived so the demo is reproducible, and deliberately shaped: one
    -- student in twenty is absent from one paper, and roughly one mark in
    -- twelve lands in the 28-32 band that grace exists for.
    insert into public.marks (
      tenant_id, session_id, exam_subject_id, student_id, marks_obtained, is_absent, max_marks
    )
    select
      es.tenant_id, es.session_id, es.id, en.student_id,
      case
        when h.bucket = 0 then null
        when h.bucket between 1 and 3 then 28 + (h.spread % 5)
        else 33 + (h.spread % 62)
      end,
      h.bucket = 0,
      es.max_marks
    from public.exam_subjects es
    join public.enrolments en
      on en.section_id = es.section_id
     and en.session_id = es.session_id
     and en.status = 'active'
    cross join lateral (
      select
        -- bit(32) casts to a *signed* int, so half the hashes come out
        -- negative and `%` would then produce negative marks.
        abs(('x' || substr(md5(es.id::text || en.student_id::text), 1, 8))::bit(32)::int::bigint) as raw
    ) seed
    cross join lateral (
      select
        (seed.raw % 40) as bucket,
        (seed.raw / 40) as spread
    ) h
    on conflict (tenant_id, exam_subject_id, student_id) do nothing;

    v_exam_id := null;
    v_scheme_id := null;
  end loop;
end $$;
