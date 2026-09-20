-- 0247 -- A template critic that knows who it is for.
--
-- `certificate_template_problems` held one hardcoded list of every key the
-- engine can produce, and flagged any placeholder outside it. With a second
-- kind of subject that list has to split, and **merging the two would be the
-- quiet failure**:
--
-- > A student template printing `{{staff.designation}}` renders **empty**,
-- > leaves no placeholder standing, and therefore **issues** — a certificate
-- > with a hole in the middle of a sentence, which is the one thing rule 12
-- > says a certificate must never be.
--
-- So the known keys are per subject, and the seven `school.*` keys are common
-- to both because `certificate_school_values()` is.
--
-- The message is per subject too. *"Nothing fills {{student.name}}"* on a staff
-- template reads like a bug in the engine; *"this template is written for a
-- member of staff, so {{student.name}} is never filled"* reads like the thing
-- somebody has to fix. `0196`'s lesson about writing for people, one module on.
--
-- And one new kind-specific reading, matching the two that already exist for a
-- transfer certificate: an experience certificate that never prints
-- `{{service.to}}` does not say when the service ended, which is the whole
-- thing it is for.


begin;

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
  -- **Split by subject**, not merged. Merging the two lists would accept a
  -- student template that prints {{staff.designation}} -- which renders empty,
  -- leaves no placeholder standing, and issues a certificate with a hole in
  -- the sentence. The school keys are common to both because
  -- `certificate_school_values()` is.
  v_known := array[
    'school.name','school.address','school.city','school.state','school.phone',
    'school.email','school.website',
    'date.issued','serial'
  ];

  if v_t.subject = 'staff' then
    v_known := v_known || array[
      'staff.name','staff.first_name','staff.employee_code','staff.designation',
      'staff.department','staff.date_of_birth','staff.gender','staff.blood_group',
      'staff.address','staff.status',
      'service.from','service.to','service.reason','service.length'
    ];
  else
    v_known := v_known || array[
      'student.name','student.first_name','student.admission_number',
      'student.date_of_birth','student.gender','student.blood_group',
      'student.address','student.father_name','student.mother_name',
      'student.guardian_name',
      'admission.date','class.name','class.label','section.name','roll_number',
      'session.name',
      'attendance.days_marked','attendance.days_present','attendance.percent',
      'result.exam','result.outcome','result.percentage','result.grade',
      'fees.outstanding'
    ];
  end if;

  if array_length(v_placeholders, 1) is null then
    return query select 'warning'::text,
      'This template has no {{placeholders}} at all, so every certificate '
      'issued from it will be word for word identical.';
  end if;

  foreach v_name in array coalesce(v_placeholders, '{}')
  loop
    if not (v_name = any (v_known)) and not (v_name = any (coalesce(v_declared, '{}'))) then
      -- Naming the reason, because "nothing fills {{student.name}}" on a staff
      -- template reads like a bug in the engine rather than a template written
      -- for the wrong kind of person.
      if v_t.subject = 'staff' and v_name like 'student.%' then
        return query select 'error'::text, format(
          'This template is written for a member of staff, so {{%s}} is never '
          'filled. Use the staff equivalent, or change who the template is for.',
          v_name);
      elsif v_t.subject = 'student' and (v_name like 'staff.%' or v_name like 'service.%') then
        return query select 'error'::text, format(
          'This template is written for a student, so {{%s}} is never filled. '
          'Use the student equivalent, or change who the template is for.',
          v_name);
      else
        return query select 'error'::text, format(
          'Nothing fills {{%s}}. Either it is a typo, or it belongs in this '
          'template''s fields so the person issuing the certificate is asked for it.',
          v_name);
      end if;
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

  if v_t.subject = 'staff' and v_t.kind = 'experience'
     and not (v_t.body ilike '%{{service.to}}%') then
    return query select 'warning'::text,
      'An experience certificate normally states the last day of service. '
      'Nothing here prints {{service.to}}.';
  end if;

  return;
end;
$$;


revoke all on function public.certificate_template_problems(uuid) from public, anon;
grant execute on function public.certificate_template_problems(uuid) to authenticated;

commit;
