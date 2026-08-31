-- Performance hardening from the post-migration advisor run
-- (auth_rls_initplan): wrap auth.uid()/auth.jwt() and the tenant/role
-- helper functions in `(select ...)` on every policy so Postgres evaluates
-- them once per query (an InitPlan) instead of once per row. Same policy
-- semantics, cheaper at scale. See https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

alter policy "admins manage sessions" on public.academic_sessions using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members can view sessions" on public.academic_sessions using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins view audit_log" on public.audit_log using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "admins manage class_levels" on public.class_levels using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members view class_levels" on public.class_levels using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins manage enrolments" on public.enrolments using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "parents view own children enrolments" on public.enrolments using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'parent'::text) AND (student_id IN ( SELECT gs.student_id
   FROM (guardian_student gs
     JOIN user_profiles up ON ((up.guardian_id = gs.guardian_id)))
  WHERE (up.id = ( SELECT auth.uid() ))))));
alter policy "staff roles view enrolments" on public.enrolments using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = ANY (ARRAY['admin'::text, 'accountant'::text, 'librarian'::text]))));
alter policy "students view own enrolments" on public.enrolments using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'student'::text) AND (student_id = ( SELECT up.student_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() ))))));
alter policy "teachers view own section enrolments" on public.enrolments using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'teacher'::text) AND (section_id IN ( SELECT s.id
   FROM (sections s
     JOIN user_profiles up ON ((up.staff_id = s.class_teacher_staff_id)))
  WHERE (up.id = ( SELECT auth.uid() ))))));
alter policy "admins manage guardian_student" on public.guardian_student using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "parents view own guardian_student links" on public.guardian_student using (((( SELECT public.current_role_code() ) = 'parent'::text) AND (guardian_id = ( SELECT up.guardian_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() ))))));
alter policy "staff roles view guardian_student" on public.guardian_student using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = ANY (ARRAY['admin'::text, 'teacher'::text, 'accountant'::text, 'librarian'::text]))));
alter policy "students view own guardian_student links" on public.guardian_student using (((( SELECT public.current_role_code() ) = 'student'::text) AND (student_id = ( SELECT up.student_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() ))))));
alter policy "admins manage guardians" on public.guardians using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "staff roles view guardians" on public.guardians using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = ANY (ARRAY['admin'::text, 'teacher'::text, 'accountant'::text, 'librarian'::text]))));
alter policy "students view own guardians" on public.guardians using (((( SELECT public.current_role_code() ) = 'student'::text) AND (EXISTS ( SELECT 1
   FROM guardian_student gs
  WHERE ((gs.guardian_id = guardians.id) AND (gs.student_id = ( SELECT up.student_id
           FROM user_profiles up
          WHERE (up.id = ( SELECT auth.uid() )))))))));
alter policy "admins manage invitations" on public.invitations using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members enqueue jobs" on public.jobs with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (created_by = ( SELECT auth.uid() ))));
alter policy "tenant members view own or all jobs" on public.jobs using (((tenant_id = ( SELECT public.current_tenant_id() )) AND ((( SELECT public.current_role_code() ) = 'admin'::text) OR (created_by = ( SELECT auth.uid() )))));
alter policy "admins manage people" on public.people using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "guardians view own people" on public.people using (((( SELECT public.current_role_code() ) = 'parent'::text) AND (EXISTS ( SELECT 1
   FROM (guardians g
     JOIN user_profiles up ON ((up.guardian_id = g.id)))
  WHERE ((up.id = ( SELECT auth.uid() )) AND (g.person_id = people.id))))));
alter policy "parents view own children's people" on public.people using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'parent'::text) AND (EXISTS ( SELECT 1
   FROM ((students st
     JOIN guardian_student gs ON ((gs.student_id = st.id)))
     JOIN user_profiles up ON ((up.guardian_id = gs.guardian_id)))
  WHERE ((up.id = ( SELECT auth.uid() )) AND (st.person_id = people.id))))));
alter policy "staff roles view people" on public.people using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = ANY (ARRAY['admin'::text, 'teacher'::text, 'accountant'::text, 'librarian'::text]))));
alter policy "students view own people" on public.people using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'student'::text) AND (EXISTS ( SELECT 1
   FROM students st
  WHERE ((st.person_id = people.id) AND (st.id = ( SELECT up.student_id
           FROM user_profiles up
          WHERE (up.id = ( SELECT auth.uid() )))))))));
alter policy "teachers view own section students' people" on public.people using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'teacher'::text) AND (EXISTS ( SELECT 1
   FROM (((students st
     JOIN enrolments e ON ((e.student_id = st.id)))
     JOIN sections s ON ((s.id = e.section_id)))
     JOIN user_profiles up ON ((up.staff_id = s.class_teacher_staff_id)))
  WHERE ((up.id = ( SELECT auth.uid() )) AND (st.person_id = people.id))))));
alter policy "admins manage role_permissions" on public.role_permissions using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members view role_permissions" on public.role_permissions using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins manage roles" on public.roles using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members view roles" on public.roles using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins manage sections" on public.sections using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members view sections" on public.sections using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins manage settings" on public.settings using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "tenant members view settings" on public.settings using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins manage staff" on public.staff using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "staff roles view staff directory" on public.staff using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = ANY (ARRAY['admin'::text, 'teacher'::text, 'accountant'::text, 'librarian'::text]))));
alter policy "tenant members view staff directory" on public.staff using ((tenant_id = ( SELECT public.current_tenant_id() )));
alter policy "admins manage students" on public.students using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "parents view own children" on public.students using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'parent'::text) AND (EXISTS ( SELECT 1
   FROM (guardian_student gs
     JOIN user_profiles up ON ((up.guardian_id = gs.guardian_id)))
  WHERE ((up.id = ( SELECT auth.uid() )) AND (gs.student_id = students.id))))));
alter policy "staff roles view students" on public.students using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = ANY (ARRAY['admin'::text, 'teacher'::text, 'accountant'::text, 'librarian'::text]))));
alter policy "students view self" on public.students using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'student'::text) AND (id = ( SELECT up.student_id
   FROM user_profiles up
  WHERE (up.id = ( SELECT auth.uid() ))))));
alter policy "teachers view own section students" on public.students using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'teacher'::text) AND (EXISTS ( SELECT 1
   FROM ((enrolments e
     JOIN sections s ON ((s.id = e.section_id)))
     JOIN user_profiles up ON ((up.staff_id = s.class_teacher_staff_id)))
  WHERE ((up.id = ( SELECT auth.uid() )) AND (e.student_id = students.id))))));
alter policy "members can view own tenant" on public.tenants using ((id = ( SELECT public.current_tenant_id() )));
alter policy "admins update tenant profiles" on public.user_profiles using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text))) with check (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "admins view tenant profiles" on public.user_profiles using (((tenant_id = ( SELECT public.current_tenant_id() )) AND (( SELECT public.current_role_code() ) = 'admin'::text)));
alter policy "self views own profile" on public.user_profiles using ((id = ( SELECT auth.uid() )));
