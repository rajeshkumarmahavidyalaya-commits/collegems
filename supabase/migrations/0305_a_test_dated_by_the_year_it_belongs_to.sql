-- 0305: 0304's class_test_create, reading the year's real column names.
--
-- Found by 0304's own probe, on its first call: `record "v_year" has no field
-- "starts_on"`. academic_sessions calls them `start_date` and `end_date`;
-- `starts_on`/`ends_on` are the names this schema uses on rows that carry a
-- year's boundary (transport_assignments, hostel_allocations), and the
-- function was written from memory of those rather than from the table.
-- PL/pgSQL resolves a record's fields when the line runs, not when the
-- function is created, so the migration applied cleanly and the first test a
-- teacher set would have failed. The rest of the body is unchanged.

create or replace function public.class_test_create(
  p_section_id uuid,
  p_subject_id uuid,
  p_title text,
  p_held_on date,
  p_max_marks numeric
)
returns uuid
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_section public.sections;
  v_year public.academic_sessions;
  v_subject text;
  v_id uuid;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 1 then
    raise exception 'Give the test a title, such as "Unit 3 test".';
  end if;
  if p_max_marks is null or p_max_marks <= 0 or p_max_marks > 1000 then
    raise exception 'The test is out of a number between 1 and 1000.';
  end if;

  select * into v_section from public.sections s where s.id = p_section_id;
  if v_section.id is null then
    raise exception 'That class cannot be found.';
  end if;
  select * into v_year from public.academic_sessions a where a.id = v_section.session_id;
  select sub.name into v_subject from public.subjects sub where sub.id = p_subject_id;

  if not exists (
    select 1 from public.section_subjects ss
    where ss.section_id = v_section.id and ss.subject_id = p_subject_id
      and ss.session_id = v_section.session_id
  ) then
    raise exception '% is not taught in that class this year. Add it to the class under Academics first.',
      coalesce(v_subject, 'That subject');
  end if;

  if not (public.role_has_permission('exams.manage')
          or (public.role_has_permission('exams.grade')
              and public.class_test_i_teach(v_section.id, p_subject_id, v_section.session_id))) then
    raise exception 'You can set a test only for a subject you teach in that class.';
  end if;

  p_held_on := coalesce(p_held_on, public.mobile_today());
  if p_held_on < v_year.start_date or p_held_on > v_year.end_date then
    raise exception '% falls outside %, the year this class belongs to. Check the date.',
      to_char(p_held_on, 'FMDD Mon YYYY'), v_year.name;
  end if;

  insert into public.class_tests
    (tenant_id, session_id, section_id, subject_id, title, held_on, max_marks, created_by)
  values
    (v_tenant, v_section.session_id, v_section.id, p_subject_id, btrim(p_title), p_held_on,
     round(p_max_marks, 2), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
