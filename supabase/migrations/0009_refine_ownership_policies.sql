-- Row-ownership RLS, layered on top of the tenant-wide policies from 0003
-- (Postgres OR's multiple permissive policies for the same command, so
-- these only ever widen access for students/parents/teachers -- they never
-- narrow what admin/accountant/librarian already have).

-- Staff directory (name/designation/department) is not sensitive HR data
-- and is needed by every role to render things like "Class teacher: ...".
create policy "tenant members view staff directory" on public.staff
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Students: teachers see their own section's students; parents see their
-- own children; students see themselves.
create policy "teachers view own section students" on public.students
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'teacher'
    and exists (
      select 1 from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = auth.uid() and e.student_id = students.id
    )
  );

create policy "parents view own children" on public.students
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'parent'
    and exists (
      select 1 from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = auth.uid() and gs.student_id = students.id
    )
  );

create policy "students view self" on public.students
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'student'
    and id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
  );

-- People: mirrors the students policies via the person_id link, plus
-- guardians viewing their own biographical record.
create policy "teachers view own section students' people" on public.people
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'teacher'
    and exists (
      select 1 from public.students st
      join public.enrolments e on e.student_id = st.id
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = auth.uid() and st.person_id = people.id
    )
  );

create policy "parents view own children's people" on public.people
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'parent'
    and exists (
      select 1 from public.students st
      join public.guardian_student gs on gs.student_id = st.id
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = auth.uid() and st.person_id = people.id
    )
  );

create policy "students view own people" on public.people
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'student'
    and exists (
      select 1 from public.students st
      where st.person_id = people.id
        and st.id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
    )
  );

create policy "guardians view own people" on public.people
  for select to authenticated
  using (
    public.current_role_code() = 'parent'
    and exists (
      select 1 from public.guardians g
      join public.user_profiles up on up.guardian_id = g.id
      where up.id = auth.uid() and g.person_id = people.id
    )
  );

-- Guardians: students/parents see the guardians linked to their own
-- student record (a parent's own guardian row is covered by "self").
create policy "students view own guardians" on public.guardians
  for select to authenticated
  using (
    public.current_role_code() = 'student'
    and exists (
      select 1 from public.guardian_student gs
      where gs.guardian_id = guardians.id
        and gs.student_id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
    )
  );

-- guardian_student: teachers/parents/students see the links relevant to
-- their own students (teachers already covered for full tenant via
-- 0003's staff-role policy where applicable; this adds parent/student).
create policy "parents view own guardian_student links" on public.guardian_student
  for select to authenticated
  using (
    public.current_role_code() = 'parent'
    and guardian_id = (select up.guardian_id from public.user_profiles up where up.id = auth.uid())
  );

create policy "students view own guardian_student links" on public.guardian_student
  for select to authenticated
  using (
    public.current_role_code() = 'student'
    and student_id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
  );
