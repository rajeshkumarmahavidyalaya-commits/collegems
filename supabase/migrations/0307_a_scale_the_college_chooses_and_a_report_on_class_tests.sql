-- 0307: the behaviour scale is the college's, and class tests get a report.
--
-- ## 1. The scale is data (rule 12)
--
-- 0303 fixed the behaviour scale at A to E with CBSE's five words, and said a
-- different scale would be "a follow-up with its own catalogue row". This is
-- that row. `exams.behaviour_scale` says how many points the college grades on
-- (3, 4 or 5 -- A to C, A to D, A to E) and the word each letter means; the
-- grid offers only those letters, and the report card prints the college's own
-- words beneath the grades.
--
-- The letters themselves stay A to E in the table's CHECK, deliberately: the
-- CHECK is what a grade *can* be, the setting is what this college *uses*. A
-- college that moves from five points to three keeps every D already given --
-- rewriting history is not what changing a scale means -- and new grades are
-- held to the new scale by a BEFORE INSERT OR UPDATE trigger, because the grid
-- writes through a plain upsert that no function sees (0205's lesson). The
-- trigger answers in a sentence naming the scale.
--
-- A missing or malformed setting means the conservative reading (rule 12):
-- five points, CBSE's words, exactly what 0303 shipped.
--
-- ## 2. A report on class tests (rule 11)
--
-- 0304 left class tests without one. `classtests.marks` lists every mark in a
-- window, test by test: date, class, subject, test, child, mark, out of,
-- percent. An invoker with no hand-written tenant filter; every table it reads
-- is readable by the staff it is gated on (class_tests and class_test_marks by
-- exams.grade, students and people by every staff role), so there is no
-- narrower seat for it to lie to (rule 4). It does not read enrolments -- a
-- subject teacher can see only their own class's -- so there is no roll
-- number column to go quietly blank for the classes they merely teach.

begin;

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'exams.behaviour_scale',
  'Behaviour and skills scale',
  'How many grades behaviour and skills are marked on (3 means A to C, 5 means '
  'A to E) and what each letter means. The words are printed on the report card '
  'under the grades.',
  'Exams',
  'object',
  '[{"name": "points", "type": "number", "label": "Number of grades (3 to 5)"},
    {"name": "A", "type": "text", "label": "A means"},
    {"name": "B", "type": "text", "label": "B means"},
    {"name": "C", "type": "text", "label": "C means"},
    {"name": "D", "type": "text", "label": "D means"},
    {"name": "E", "type": "text", "label": "E means"}]'::jsonb,
  '{"points": 5, "A": "Outstanding", "B": "Very good", "C": "Good", "D": "Fair", "E": "Needs improvement"}'::jsonb,
  false,
  'exams.manage',
  85
)
on conflict (key) do nothing;

-- The number of points in use, read once, clamped to what the letters allow.
create or replace function public.behaviour_scale_points()
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select case
    when (public.setting_value('exams.behaviour_scale') ->> 'points') ~ '^[0-9]+$'
      then least(5, greatest(3, (public.setting_value('exams.behaviour_scale') ->> 'points')::integer))
    else 5
  end
$$;

revoke all on function public.behaviour_scale_points() from public, anon;
grant execute on function public.behaviour_scale_points() to authenticated;

create or replace function public.behaviour_ratings_in_scale()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_points integer := public.behaviour_scale_points();
begin
  -- An unchanged grade on an update is not a new grade (a cascade from the
  -- exam's status touches every row and must not be refused).
  if tg_op = 'UPDATE' and new.grade = old.grade then
    return new;
  end if;
  if position(new.grade in left('ABCDE', v_points)) = 0 then
    raise exception 'This college grades behaviour and skills from A to %, so % is not a grade it gives. Change the scale under Settings if that is wrong.',
      substr('ABCDE', v_points, 1), new.grade;
  end if;
  return new;
end;
$$;

revoke all on function public.behaviour_ratings_in_scale() from public, anon, authenticated;

create trigger behaviour_ratings_in_scale
  before insert or update of grade on public.behaviour_ratings
  for each row execute function public.behaviour_ratings_in_scale();

-- ---------------------------------------------------------------------------
-- Class tests, as a catalogue report
-- ---------------------------------------------------------------------------

create or replace function public.report_class_tests(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      ct.held_on,
      cl.name || ' ' || sec.name as class,
      sub.name as subject,
      ct.title as test,
      (p.first_name || ' ' || p.last_name) as student,
      st.admission_number,
      m.marks,
      ct.max_marks,
      case when m.absent then 'Absent' else '' end as absent,
      case when m.absent or m.marks is null then null
           else round(100.0 * m.marks / ct.max_marks, 1) end as percent,
      m.student_id,
      ct.id as test_id
    from public.class_test_marks m
    join public.class_tests ct on ct.id = m.test_id
    join public.sections sec on sec.id = ct.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    join public.subjects sub on sub.id = ct.subject_id
    join public.students st on st.id = m.student_id
    join public.people p on p.id = st.person_id
    where ct.held_on >= public.report_param_date(p_params, 'from', public.mobile_today() - 90)
      and (public.report_param_uuid(p_params, 'section_id') is null
           or ct.section_id = public.report_param_uuid(p_params, 'section_id'))
    order by ct.held_on desc, ct.id, p.first_name, p.last_name, m.student_id
  ) t
$$;

revoke all on function public.report_class_tests(jsonb) from public, anon;
grant execute on function public.report_class_tests(jsonb) to authenticated;

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values (
  'classtests.marks', 'Class test marks',
  'Every class test mark since a date (the last 90 days unless you say otherwise), test by test: the class, the subject, each child''s mark out of the test''s maximum, and who was absent.',
  'Exams', 'exams.grade', 'report_class_tests',
  '[
     {"name": "from", "type": "date", "label": "Since", "required": false},
     {"name": "section_id", "type": "section", "label": "Class", "required": false}
   ]'::jsonb,
  '[
     {"key": "held_on", "type": "date", "label": "Date"},
     {"key": "class", "type": "text", "label": "Class"},
     {"key": "subject", "type": "text", "label": "Subject"},
     {"key": "test", "type": "text", "label": "Test", "href": "/class-tests/{test_id}"},
     {"key": "student", "type": "text", "label": "Student", "href": "/students/{student_id}"},
     {"key": "admission_number", "type": "text", "label": "Adm. no."},
     {"key": "marks", "type": "number", "label": "Marks", "align": "right"},
     {"key": "max_marks", "type": "number", "label": "Out of", "align": "right"},
     {"key": "percent", "type": "percent", "label": "Percent", "align": "right"},
     {"key": "absent", "type": "text", "label": "Note"}
   ]'::jsonb,
  36, 'staff'
)
on conflict (key) do nothing;

commit;
