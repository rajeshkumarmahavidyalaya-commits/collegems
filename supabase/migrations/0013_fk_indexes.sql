-- Missing covering indexes on foreign key columns, per the performance
-- advisor (unindexed_foreign_keys). Composite unique indexes that lead
-- with tenant_id (e.g. guardians(tenant_id, person_id)) don't cover a
-- lookup by the FK column alone, so these are added separately.

create index guardians_person_idx on public.guardians (person_id);
create index staff_person_idx on public.staff (person_id);
create index students_person_idx on public.students (person_id);
create index guardian_student_guardian_fk_idx on public.guardian_student (guardian_id);
create index guardian_student_student_fk_idx on public.guardian_student (student_id);
create index sections_class_level_fk_idx on public.sections (class_level_id);
create index sections_session_fk_idx on public.sections (session_id);
create index role_permissions_permission_code_idx on public.role_permissions (permission_code);
create index role_permissions_role_fk_idx on public.role_permissions (role_id);
create index invitations_guardian_idx on public.invitations (guardian_id);
create index invitations_invited_by_idx on public.invitations (invited_by);
create index invitations_person_idx on public.invitations (person_id);
create index invitations_role_idx on public.invitations (role_id);
create index invitations_staff_idx on public.invitations (staff_id);
create index invitations_student_idx on public.invitations (student_id);
create index user_profiles_person_fk_idx on public.user_profiles (person_id);
create index user_profiles_role_idx on public.user_profiles (role_id);
create index enrolments_session_fk_idx on public.enrolments (session_id);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index jobs_created_by_idx on public.jobs (created_by);
create index settings_updated_by_idx on public.settings (updated_by);
