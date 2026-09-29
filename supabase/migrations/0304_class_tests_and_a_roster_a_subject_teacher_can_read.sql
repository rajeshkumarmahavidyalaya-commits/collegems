-- 0304: class tests, and the class list a subject teacher could never read.
--
-- ## The defect, found by asking who enters a class test's marks
--
-- A class test is marked by the teacher who teaches the subject -- which is
-- usually not the class teacher. So the first question was how the existing
-- exam marks sheet gives a subject teacher their class list. It does not:
-- `exams_mark_sheet` is an invoker that joins `enrolments`, and the only
-- teacher policy on enrolments is *teachers view own section enrolments*,
-- keyed on `class_teacher_staff_id`.
--
-- Probed as the demo college's teacher, over the papers they teach in the
-- five classes where they are not class teacher (Grade 1 A Physical
-- Education, Grade 1 B Social Studies, Grade 3 A Computer Science, Grade 5 B
-- Science, Grade 6 A Mathematics):
--
--     roll 27, 25, 25, 25, 25   sheet 0, 0, 0, 0, 0
--
-- An empty sheet. The write side was always correct -- *subject teachers
-- manage their marks* lets them save -- so the only thing between a subject
-- teacher and their marks was a list of names they could not see. Every exam
-- in this product has been marked by the one login anybody used, an
-- administrator.
--
-- ## Why not widen the enrolments policy
--
-- It is the obvious fix and it is wrong here, for rule 4's reason: every
-- `not exists` over enrolments is honest only while both sides are narrowed by
-- the same policy. `attendance_records` is readable by the class teacher alone,
-- so a subject teacher who could suddenly see five more classes' enrolments
-- would see those classes at 0.0% attendance coverage -- 0201's eleven
-- fabricated classes, reintroduced by a fix for something else.
--
-- So the narrower caller gets their own question (rule 4): `teaching_roster`,
-- a definer that answers "who is in this class" only to somebody who teaches
-- that subject in it, is its class teacher, or holds exams.manage; filters by
-- tenant itself in every read; projects the four columns a mark sheet prints
-- and nothing else; and refuses anybody else in a sentence rather than
-- returning an empty list that reads like an empty class.
--
-- `exams_mark_sheet` now takes its children from it. For an administrator and
-- a class teacher the answer is unchanged; for a subject teacher it is the
-- class.
--
-- ## Class tests
--
-- A weekly test is not an examination: no grading scheme, no publishing, no
-- report card. It is a title, a date, a maximum and a mark per child, entered
-- by the subject teacher and read by the family as soon as it is entered.
--
--   * `class_tests` carries (tenant, session, section, subject) as a composite
--     key onto `section_subjects` (rule 4's identity device): a test can only
--     exist for a subject actually taught in that class that year.
--   * `class_test_marks` carries the test's `max_marks` in its key (the value
--     device, as marks carries its paper's): a mark cannot exceed the test's
--     maximum, and lowering the maximum below a mark already given is refused
--     by the cascade.
--   * A test's date must fall inside its class's year (rule 2, 0198): checked
--     in `class_test_create`, with the sentence.
--   * Writes are gated on the matrix (`exams.grade` for the subject teacher of
--     that class, `exams.manage` for the office); a mark must be for a child
--     enrolled in that class. Families read their own children's marks.

begin;

-- ---------------------------------------------------------------------------
-- The class list, for the people who teach it
-- ---------------------------------------------------------------------------

create or replace function public.teaching_roster(p_section_id uuid, p_subject_id uuid default null)
returns table (student_id uuid, admission_number text, student_name text, roll_number text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_staff uuid;
  v_section public.sections;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;

  -- Tenant by hand in every read: no policy runs in here.
  select * into v_section from public.sections s
  where s.id = p_section_id and s.tenant_id = v_tenant;
  if v_section.id is null then
    raise exception 'That class cannot be found.';
  end if;

  select up.staff_id into v_staff from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant;

  if not (
    public.role_has_permission('exams.manage')
    or (v_staff is not null and v_section.class_teacher_staff_id = v_staff)
    or (v_staff is not null and p_subject_id is not null and exists (
          select 1 from public.section_subjects ss
          where ss.tenant_id = v_tenant
            and ss.section_id = v_section.id
            and ss.session_id = v_section.session_id
            and ss.subject_id = p_subject_id
            and ss.teacher_staff_id = v_staff))
  ) then
    raise exception 'You can see the class list only for a class you teach.';
  end if;

  return query
    select e.student_id, st.admission_number, (p.first_name || ' ' || p.last_name)::text, e.roll_number
    from public.enrolments e
    join public.students st on st.id = e.student_id and st.tenant_id = v_tenant
    join public.people p on p.id = st.person_id and p.tenant_id = v_tenant
    where e.tenant_id = v_tenant
      and e.section_id = v_section.id
      and e.session_id = v_section.session_id
      and e.status = 'active'
    order by e.roll_number nulls last, p.first_name, e.student_id;
end;
$$;

comment on function public.teaching_roster(uuid, uuid) is
  'Who is in a class, for somebody who teaches that subject in it, is its class teacher, or holds exams.manage (0304). Definer, tenant by hand, four columns, refuses anybody else. Rule 4: the narrower caller gets their own question rather than a wider enrolments policy.';

revoke all on function public.teaching_roster(uuid, uuid) from public, anon;
grant execute on function public.teaching_roster(uuid, uuid) to authenticated;

-- 0285's definition, with the children taken from teaching_roster instead of
-- the caller's view of enrolments. Everything else is unchanged.
create or replace function public.exams_mark_sheet(p_exam_subject_id uuid)
returns table (student_id uuid, admission_number text, student_name text, roll_number text,
               marks_obtained numeric, is_absent boolean, remarks text, component_marks jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select
    r.student_id,
    r.admission_number,
    r.student_name,
    r.roll_number,
    m.marks_obtained,
    coalesce(m.is_absent, false),
    m.remarks,
    comp.cells
  from public.exam_subjects es
  join public.sections sec on sec.id = es.section_id
  cross join lateral public.teaching_roster(es.section_id, es.subject_id) r
  left join public.marks m
    on m.exam_subject_id = es.id and m.student_id = r.student_id
   and m.exam_component_id is null
  left join lateral (
    select jsonb_object_agg(
      ec.id::text,
      jsonb_build_object(
        'marks', cm.marks_obtained,
        'absent', coalesce(cm.is_absent, false)
      )
    ) as cells
    from public.exam_components ec
    left join public.marks cm
      on cm.exam_component_id = ec.id and cm.student_id = r.student_id
    where ec.exam_subject_id = es.id
  ) comp on true
  where es.id = p_exam_subject_id
    -- Only the children who take this subject: everybody in the class for a
    -- compulsory one, and only those who chose it for an elective (0285).
    and public.student_takes_subject(r.student_id, es.subject_id, es.session_id, sec.class_level_id)
  order by r.roll_number nulls last, r.student_name
$$;

-- ---------------------------------------------------------------------------
-- Class tests
-- ---------------------------------------------------------------------------

create table public.class_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  section_id uuid not null,
  subject_id uuid not null,
  title text not null,
  held_on date not null,
  max_marks numeric(6, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_tests_title_chk check (length(btrim(title)) between 1 and 120),
  constraint class_tests_max_chk check (max_marks > 0 and max_marks <= 1000),
  unique (tenant_id, id),
  unique (tenant_id, id, max_marks),

  -- The identity device: a test exists only for a subject taught in that
  -- class that year.
  constraint class_tests_taught_fkey
    foreign key (tenant_id, session_id, section_id, subject_id)
    references public.section_subjects (tenant_id, session_id, section_id, subject_id)
    on delete restrict
);

create index class_tests_section_idx on public.class_tests (tenant_id, section_id, held_on desc);
create index class_tests_session_idx on public.class_tests (session_id);
create index class_tests_creator_idx on public.class_tests (created_by);

create trigger set_updated_at before update on public.class_tests
  for each row execute function public.set_updated_at();
create trigger audit_class_tests
  after insert or update or delete on public.class_tests
  for each row execute function public.audit_row_change();

alter table public.class_tests enable row level security;

create table public.class_test_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  test_id uuid not null,
  -- The test's maximum, held equal by the key below; never written by hand.
  max_marks numeric(6, 2) not null,
  student_id uuid not null,
  marks numeric(6, 2),
  absent boolean not null default false,
  entered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, test_id, student_id),
  constraint class_test_marks_absent_chk
    check ((absent and marks is null) or (not absent and marks is not null)),
  constraint class_test_marks_range_chk
    check (marks is null or (marks >= 0 and marks <= max_marks)),

  -- The value device: the mark's ceiling is the test's, and lowering the
  -- test's maximum below a mark already given is refused by the cascade.
  constraint class_test_marks_test_fkey
    foreign key (tenant_id, test_id, max_marks)
    references public.class_tests (tenant_id, id, max_marks)
    on update cascade on delete cascade,
  constraint class_test_marks_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create index class_test_marks_student_idx on public.class_test_marks (tenant_id, student_id);
create index class_test_marks_enterer_idx on public.class_test_marks (entered_by);

create trigger set_updated_at before update on public.class_test_marks
  for each row execute function public.set_updated_at();
create trigger audit_class_test_marks
  after insert or update or delete on public.class_test_marks
  for each row execute function public.audit_row_change();

alter table public.class_test_marks enable row level security;

-- Who teaches a test's subject in its class: the one predicate both tables'
-- teacher policies use, written once.
create or replace function public.class_test_i_teach(p_section_id uuid, p_subject_id uuid, p_session_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.section_subjects ss
    join public.user_profiles up on up.staff_id = ss.teacher_staff_id
    where up.id = (select auth.uid())
      and ss.section_id = p_section_id
      and ss.subject_id = p_subject_id
      and ss.session_id = p_session_id
  )
$$;

revoke all on function public.class_test_i_teach(uuid, uuid, uuid) from public, anon;
grant execute on function public.class_test_i_teach(uuid, uuid, uuid) to authenticated;

-- Is this child in this test's class? A subject teacher cannot read that
-- class's enrolments (the reason teaching_roster exists), so the marks write
-- policy asks this definer instead: tenant by hand, a boolean out, never the
-- enrolment itself.
create or replace function public.class_test_enrolled(p_test_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.class_tests t
    join public.enrolments e
      on e.tenant_id = t.tenant_id
     and e.section_id = t.section_id
     and e.session_id = t.session_id
     and e.status = 'active'
    where t.id = p_test_id
      and t.tenant_id = (select public.current_tenant_id())
      and e.student_id = p_student_id
  )
$$;

revoke all on function public.class_test_enrolled(uuid, uuid) from public, anon;
grant execute on function public.class_test_enrolled(uuid, uuid) to authenticated;

-- Tests. Staff read on permissions only staff hold (never exams.view, 0249);
-- a family reads the tests of the class their child is in.
create policy "staff view class_tests" on public.class_tests
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.role_has_permission('exams.grade'))
         or (select public.role_has_permission('exams.remark'))
         or (select public.role_has_permission('exams.manage')))
  );

create policy "students view own class tests" on public.class_tests
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and section_id in (
      select e.section_id from public.enrolments e
      where e.student_id = (select up.student_id from public.user_profiles up where up.id = (select auth.uid()))
    )
  );

create policy "guardians view children's class tests" on public.class_tests
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and section_id in (
      select e.section_id
      from public.enrolments e
      join public.guardian_student gs on gs.student_id = e.student_id
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

create policy "exams office manages class_tests" on public.class_tests
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.role_has_permission('exams.manage')))
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.role_has_permission('exams.manage')));

create policy "subject teachers manage their class_tests" on public.class_tests
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.role_has_permission('exams.grade'))
         and public.class_test_i_teach(section_id, subject_id, session_id))
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.role_has_permission('exams.grade'))
              and public.class_test_i_teach(section_id, subject_id, session_id));

-- Marks. The family policies reference only their own rows -- never
-- class_tests -- so the two tables' policies cannot recurse into each other.
create policy "staff view class_test_marks" on public.class_test_marks
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.role_has_permission('exams.grade'))
         or (select public.role_has_permission('exams.remark'))
         or (select public.role_has_permission('exams.manage')))
  );

create policy "students view own class_test_marks" on public.class_test_marks
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id = (select up.student_id from public.user_profiles up where up.id = (select auth.uid()))
  );

create policy "guardians view children's class_test_marks" on public.class_test_marks
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

create policy "exams office manages class_test_marks" on public.class_test_marks
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.role_has_permission('exams.manage')))
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.manage'))
    and public.class_test_enrolled(test_id, student_id)
  );

create policy "subject teachers manage their class_test_marks" on public.class_test_marks
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.grade'))
    and exists (
      select 1 from public.class_tests t
      where t.id = class_test_marks.test_id
        and public.class_test_i_teach(t.section_id, t.subject_id, t.session_id)
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.grade'))
    and exists (
      select 1 from public.class_tests t
      where t.id = class_test_marks.test_id
        and public.class_test_i_teach(t.section_id, t.subject_id, t.session_id)
        and public.class_test_enrolled(t.id, class_test_marks.student_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Setting a test, and its mark sheet
-- ---------------------------------------------------------------------------

-- The one way a test is made, so the two refusals an INSERT policy would
-- raise as a bare 42501 are sentences instead (rule 6: an INSERT needs its
-- check before it), and the date is held to the class's year (rule 2).
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
  if p_held_on < v_year.starts_on or p_held_on > v_year.ends_on then
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

revoke all on function public.class_test_create(uuid, uuid, text, date, numeric) from public, anon;
grant execute on function public.class_test_create(uuid, uuid, text, date, numeric) to authenticated;

-- One test's sheet: the class list from teaching_roster (so a subject teacher
-- sees the class they teach) beside the marks already entered.
create or replace function public.class_test_sheet(p_test_id uuid)
returns table (student_id uuid, admission_number text, student_name text, roll_number text,
               marks numeric, absent boolean)
language sql
stable
set search_path = public, extensions
as $$
  select r.student_id, r.admission_number, r.student_name, r.roll_number, m.marks, coalesce(m.absent, false)
  from public.class_tests t
  cross join lateral public.teaching_roster(t.section_id, t.subject_id) r
  left join public.class_test_marks m on m.test_id = t.id and m.student_id = r.student_id
  where t.id = p_test_id
  order by r.roll_number nulls last, r.student_name, r.student_id
$$;

revoke all on function public.class_test_sheet(uuid) from public, anon;
grant execute on function public.class_test_sheet(uuid) to authenticated;

revoke truncate, trigger, references, maintain on public.class_tests from anon, authenticated;
revoke truncate, trigger, references, maintain on public.class_test_marks from anon, authenticated;

commit;
