-- ---------------------------------------------------------------------------
-- The certificate engine, part one: assemble and criticise
-- ---------------------------------------------------------------------------
--
-- Rendering, the snapshot, and the critic. Migration 0134 has the half that
-- writes: preview, issue and cancel. The rule that spans both:
--
-- > **Preview computes; issue freezes.** After `certificate_issue` returns,
-- > nothing in either file is ever consulted about that document again. A
-- > duplicate printed in 2034 reads `certificates.body`.
--
-- That is rule 12's freeze rule, and a transfer certificate is where it bites
-- hardest: by the time somebody asks for a duplicate the child has left, the
-- enrolment is over, the class has different children in it, and the fee ledger
-- has moved on. Recomputing would produce a *plausible* document that is not
-- the one the family was given.
--
-- A NULL IS LEFT UNRESOLVED ON PURPOSE
--
-- The obvious kindness is to render a missing value as a blank or a dash. It is
-- the wrong kindness: a leaving certificate reading *"Father's Name: —"* is a
-- document a school has to apologise for, and it goes out because nobody
-- noticed. So a null leaves its `{{placeholder}}` standing, `certificate_preview`
-- lists it, and `certificate_issue` **refuses**. The way out is the template's
-- own `fields` — the issuer types the value — which is what that column is for.
--
-- ...AND ONE THING IS DELIBERATELY NOT A REFUSAL
--
-- Outstanding fees. Withholding a transfer certificate until dues are cleared is
-- a real policy at real schools and an unlawful one at others, so it is a
-- **sentence in `problems`**, not a check — the `grading_scheme_problems()`
-- pattern. The engine says "4,200.00 is still outstanding"; a person decides.

-- ---------------------------------------------------------------------------
-- Rendering
-- ---------------------------------------------------------------------------

create or replace function public.certificate_placeholders(p_body text)
returns text[]
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(distinct m[1]), '{}')
  from regexp_matches(coalesce(p_body, ''), '\{\{\s*([A-Za-z0-9_.]+)\s*\}\}', 'g') m
$$;

comment on function public.certificate_placeholders(text) is
  'Every {{name}} in a template body, deduplicated. Used to criticise a '
  'template before it is ever issued against, and to find what a rendered '
  'certificate still has standing.';

create or replace function public.certificate_render(p_body text, p_values jsonb)
returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_out text := coalesce(p_body, '');
  v_key text;
  v_val text;
begin
  -- Only non-null values are substituted. A null leaves its placeholder
  -- standing so that `certificate_preview` can name it -- see the header.
  for v_key, v_val in select key, value from jsonb_each_text(coalesce(p_values, '{}'::jsonb))
  loop
    if v_val is not null then
      v_out := regexp_replace(
        v_out,
        '\{\{\s*' || regexp_replace(v_key, '([.\\])', '\\\1', 'g') || '\s*\}\}',
        -- The value is data, not a pattern: a student called "A\1B" must not
        -- become a back-reference. `\\&` and `\\1` in a replacement string are
        -- the only two things regexp_replace treats specially.
        replace(replace(v_val, '\', '\\'), '&', '\&'),
        'g'
      );
    end if;
  end loop;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- The snapshot
-- ---------------------------------------------------------------------------
--
-- `SECURITY INVOKER`, so every value in it has already passed the same policies
-- a direct select would. The one definer call is `exams_attendance_summary`,
-- which the report-card module already owns and which does its own visibility
-- check -- wrapping it rather than recomputing days from `attendance_records`
-- is rule 11's instruction, and it is what stops a certificate's attendance
-- line disagreeing with the report card's.

create or replace function public.certificate_snapshot(
  p_student_id uuid,
  p_issued_on date default null,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant_id  uuid := public.current_tenant_id();
  v_session_id uuid;
  v_issued_on  date;
  v_out        jsonb;
  v_school     jsonb;
  v_row        record;
  v_att        record;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  v_issued_on := coalesce(p_issued_on, public.mobile_today());

  select coalesce(s.value, '{}'::jsonb) into v_school
  from public.settings s
  where s.tenant_id = v_tenant_id and s.key = 'school.profile';

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
    -- The relationship, not a column. `people` has no father_name and must not
    -- grow one: rule 5's identity model is what keeps a guardian who is also
    -- staff, or a child with two mothers, representable.
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

  v_out := jsonb_strip_nulls(jsonb_build_object(
    'school.name', ( select t.name from public.tenants t where t.id = v_tenant_id ),
    'school.address', nullif(trim(both ', ' from concat_ws(', ',
      v_school ->> 'address_line1', v_school ->> 'address_line2',
      v_school ->> 'city', v_school ->> 'state', v_school ->> 'postal_code')), ''),
    'school.city', v_school ->> 'city',
    'school.state', v_school ->> 'state',
    'school.phone', v_school ->> 'phone',
    'school.email', v_school ->> 'email',
    'school.website', v_school ->> 'website',

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

    -- The last *published* exam only. An unpublished result is provisional and
    -- has no business on a document a family keeps.
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

    -- The fees module's own read path, per rule 11. A certificate that
    -- disagreed with the counter about what a family owes would be handed
    -- over at exactly the moment that mattered.
    'fees.outstanding', ( select to_char(b.balance, 'FM9999999990.00')
                          from public.fees_student_balances(null, false, array[p_student_id]) b ),

    'date.issued', to_char(v_issued_on, 'FMDD Mon YYYY'),
    -- Filled in by `certificate_issue`. In a preview it is honestly absent, so
    -- a template that prints it is told the number comes later.
    'serial', null
  ));

  -- What the issuer typed wins: `fields` exists precisely to supply what the
  -- database cannot know, and a school correcting a mother's name on one
  -- certificate must not have to correct the record first.
  return v_out || coalesce(p_extra, '{}'::jsonb);
end;
$$;

revoke all on function public.certificate_snapshot(uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_snapshot(uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Criticise, in Postgres, in sentences
-- ---------------------------------------------------------------------------

create or replace function public.certificate_template_problems(p_template_id uuid)
returns table (severity text, message text)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_t public.certificate_templates;
  v_placeholders text[];
  v_declared text[];
  v_known text[];
  v_name text;
begin
  select * into v_t from public.certificate_templates where id = p_template_id;
  if v_t.id is null then
    return;
  end if;

  v_placeholders := public.certificate_placeholders(v_t.body);
  select coalesce(array_agg(f ->> 'name'), '{}')
    into v_declared
    from jsonb_array_elements(v_t.fields) f;

  -- Every key the engine can produce. Kept here rather than in the app because
  -- the thing that judges a template and the thing that fills it must not be
  -- free to drift -- the `grading_scheme_problems()` rule.
  v_known := array[
    'school.name','school.address','school.city','school.state','school.phone',
    'school.email','school.website',
    'student.name','student.first_name','student.admission_number',
    'student.date_of_birth','student.gender','student.blood_group',
    'student.address','student.father_name','student.mother_name',
    'student.guardian_name',
    'admission.date','class.name','class.label','section.name','roll_number',
    'session.name',
    'attendance.days_marked','attendance.days_present','attendance.percent',
    'result.exam','result.outcome','result.percentage','result.grade',
    'fees.outstanding','date.issued','serial'
  ];

  if array_length(v_placeholders, 1) is null then
    return query select 'warning'::text,
      'This template has no {{placeholders}} at all, so every certificate '
      'issued from it will be word for word identical.';
  end if;

  foreach v_name in array coalesce(v_placeholders, '{}')
  loop
    if not (v_name = any (v_known)) and not (v_name = any (coalesce(v_declared, '{}'))) then
      return query select 'error'::text, format(
        'Nothing fills {{%s}}. Either it is a typo, or it belongs in this '
        'template''s fields so the person issuing the certificate is asked for it.',
        v_name);
    end if;
  end loop;

  foreach v_name in array coalesce(v_declared, '{}')
  loop
    if not (v_name = any (coalesce(v_placeholders, '{}'))) then
      return query select 'warning'::text, format(
        'The field "%s" is asked for but never printed -- the wording does not '
        'mention {{%s}}.', v_name, v_name);
    end if;
  end loop;

  -- Kind-specific readings. A leaving certificate that does not say when the
  -- child left is the one a school gets sent back.
  if v_t.kind = 'transfer' and not (v_t.body ilike '%{{date.issued}}%') then
    return query select 'warning'::text,
      'A transfer certificate normally carries the date it was issued. '
      'Nothing here prints {{date.issued}}.';
  end if;

  if v_t.kind = 'transfer' and not (v_t.body ilike '%{{admission.date}}%') then
    return query select 'warning'::text,
      'A transfer certificate normally states the date of admission, which the '
      'next school needs. Nothing here prints {{admission.date}}.';
  end if;

  return;
end;
$$;

revoke all on function public.certificate_template_problems(uuid) from public, anon;
grant execute on function public.certificate_template_problems(uuid) to authenticated;
