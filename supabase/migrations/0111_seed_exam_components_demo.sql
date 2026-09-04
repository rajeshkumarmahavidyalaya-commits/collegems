-- ---------------------------------------------------------------------------
-- Demo data: a draft exam whose papers are split
-- ---------------------------------------------------------------------------
--
-- The demo tenant's only exam was published, so there was nowhere to see a
-- split paper being marked -- and a rule nobody can look at is a rule nobody
-- checks. This adds one draft exam over a single section, three of whose eight
-- papers are split, under a scheme that requires each part to be passed.
--
-- One child is deliberately given a strong theory mark and a practical below
-- the minimum: the paper's total passes and the paper does not. That is the
-- whole point of `must_pass_each`, and it is much easier to argue about on a
-- screen than in a migration comment.
--
-- Idempotent: keyed on the exam's name within the session, so re-running it
-- changes nothing.

do $$
declare
  v_tenant uuid;
  v_session uuid;
  v_section uuid;
  v_scheme uuid;
  v_exam uuid;
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then
    return;
  end if;

  select public.current_session_id(v_tenant) into v_session;
  if v_session is null then
    return;
  end if;

  select sec.id into v_section
  from public.sections sec
  join public.class_levels cl on cl.id = sec.class_level_id
  where sec.tenant_id = v_tenant and cl.name = 'Grade 6' and sec.name = 'A'
    and exists (
      select 1 from public.enrolments en
      where en.section_id = sec.id and en.session_id = v_session and en.status = 'active'
    )
  limit 1;

  if v_section is null then
    return;
  end if;

  -- The scheme. Separate from the tenant's default on purpose: turning
  -- `must_pass_each` on for the published exam would change results a family
  -- has already been shown.
  insert into public.grading_schemes (tenant_id, name, description, rules)
  values (
    v_tenant,
    'Board pattern with practicals',
    'Nine-point grade scale, 33% to pass, and every part of a split paper must be passed on its own.',
    jsonb_build_object(
      'grades', jsonb_build_array(
        jsonb_build_object('code', 'A1', 'min_percent', 91, 'point', 10),
        jsonb_build_object('code', 'A2', 'min_percent', 81, 'point', 9),
        jsonb_build_object('code', 'B1', 'min_percent', 71, 'point', 8),
        jsonb_build_object('code', 'B2', 'min_percent', 61, 'point', 7),
        jsonb_build_object('code', 'C1', 'min_percent', 51, 'point', 6),
        jsonb_build_object('code', 'C2', 'min_percent', 41, 'point', 5),
        jsonb_build_object('code', 'D',  'min_percent', 33, 'point', 4),
        jsonb_build_object('code', 'E',  'min_percent', 0,  'point', 0, 'is_fail', true)
      ),
      'pass', jsonb_build_object('aggregate_min_percent', 33),
      'components', jsonb_build_object('must_pass_each', true),
      'rank', jsonb_build_object('scope', 'section', 'method', 'competition', 'include', 'all')
    )
  )
  on conflict (tenant_id, name) do update set rules = excluded.rules
  returning id into v_scheme;

  if v_scheme is null then
    select id into v_scheme from public.grading_schemes
    where tenant_id = v_tenant and name = 'Board pattern with practicals';
  end if;

  insert into public.exams (tenant_id, session_id, name, kind, starts_on, ends_on, grading_scheme_id)
  values (
    v_tenant, v_session, 'Annual Examination', 'annual',
    current_date + 20, current_date + 32, v_scheme
  )
  on conflict (tenant_id, session_id, name) do update set grading_scheme_id = excluded.grading_scheme_id
  returning id into v_exam;

  if v_exam is null then
    select id into v_exam from public.exams
    where tenant_id = v_tenant and session_id = v_session and name = 'Annual Examination';
  end if;

  -- One paper per subject the section actually studies. Out of 100 with a pass
  -- mark of 33, which is the pattern the scheme's grade bands assume.
  insert into public.exam_subjects (
    tenant_id, session_id, exam_id, section_id, subject_id, max_marks, pass_marks, weight, is_optional
  )
  select v_tenant, v_session, v_exam, v_section, ss.subject_id, 100, 33, 1, false
  from public.section_subjects ss
  where ss.tenant_id = v_tenant and ss.session_id = v_session and ss.section_id = v_section
  on conflict (tenant_id, exam_id, section_id, subject_id) do nothing;

  -- The three splits. Written down as (subject code, part code, part name,
  -- maximum, minimum) so the shape of the data is the shape of the rule.
  insert into public.exam_components (
    tenant_id, session_id, exam_subject_id, code, name, max_marks, pass_marks, position
  )
  select v_tenant, v_session, es.id, p.code, p.name, p.max_marks, p.pass_marks, p.position
  from public.exam_subjects es
  join public.subjects sub on sub.id = es.subject_id
  join (values
    ('SCI', 'TH', 'Theory',    70::numeric, 23::numeric, 0),
    ('SCI', 'PR', 'Practical', 30::numeric, 10::numeric, 1),
    ('ENG', 'WR', 'Written',   80::numeric, 26::numeric, 0),
    ('ENG', 'OR', 'Oral',      20::numeric,  7::numeric, 1),
    ('CS',  'TH', 'Theory',    60::numeric, 20::numeric, 0),
    ('CS',  'PR', 'Practical', 40::numeric, 13::numeric, 1)
  ) as p(subject_code, code, name, max_marks, pass_marks, position)
    on p.subject_code = sub.code
  where es.exam_id = v_exam
  on conflict (tenant_id, exam_subject_id, code) do nothing;

  -- Marks for the unsplit papers. Deterministic from the student and subject,
  -- so re-running the seed produces the same sheet rather than a new one.
  insert into public.marks (
    tenant_id, session_id, exam_subject_id, student_id, marks_obtained, is_absent, max_marks
  )
  select
    v_tenant, v_session, es.id, en.student_id,
    33 + ((('x' || substr(md5(en.student_id::text || sub.code), 1, 8))::bit(32)::bigint) % 62),
    false, es.max_marks
  from public.exam_subjects es
  join public.subjects sub on sub.id = es.subject_id
  join public.enrolments en
    on en.section_id = es.section_id and en.session_id = es.session_id and en.status = 'active'
  where es.exam_id = v_exam
    and not exists (select 1 from public.exam_components ec where ec.exam_subject_id = es.id)
  on conflict (tenant_id, exam_subject_id, student_id) where exam_component_id is null do nothing;

  -- ...and for the split ones, part by part.
  insert into public.marks (
    tenant_id, session_id, exam_subject_id, student_id,
    exam_component_id, component_max_marks, marks_obtained, is_absent, max_marks
  )
  select
    v_tenant, v_session, es.id, en.student_id, ec.id, ec.max_marks,
    round(
      ec.max_marks
      * (0.34 + ((('x' || substr(md5(en.student_id::text || sub.code || ec.code), 1, 8))::bit(32)::bigint) % 61) / 100.0)
    ),
    false, es.max_marks
  from public.exam_subjects es
  join public.subjects sub on sub.id = es.subject_id
  join public.exam_components ec on ec.exam_subject_id = es.id
  join public.enrolments en
    on en.section_id = es.section_id and en.session_id = es.session_id and en.status = 'active'
  where es.exam_id = v_exam
  on conflict (tenant_id, exam_subject_id, student_id, exam_component_id)
    where exam_component_id is not null do nothing;

  -- The named case. The lowest roll number in the section gets a strong theory
  -- mark and a practical under the minimum, so the paper adds up to a pass and
  -- is failed anyway -- which is exactly what a school means by "you have to be
  -- able to do the practical".
  update public.marks m
  set marks_obtained = case ec.code when 'TH' then 60 else 8 end
  from public.exam_components ec, public.exam_subjects es, public.subjects sub
  where m.exam_component_id = ec.id
    and es.id = ec.exam_subject_id and es.exam_id = v_exam
    and sub.id = es.subject_id and sub.code = 'SCI'
    and m.student_id = (
      select en.student_id from public.enrolments en
      where en.section_id = v_section and en.session_id = v_session and en.status = 'active'
      order by en.roll_number nulls last, en.student_id
      limit 1
    );
end;
$$;
