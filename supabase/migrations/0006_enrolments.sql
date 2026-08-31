-- Enrolments: the one-row-per-student-per-year link to a class section.
-- Session-scoped per CLAUDE.md rule 2 (session_id is stored directly, not
-- only reachable via section_id, so every transactional query can filter
-- on it without a join). This table also carries the first row-ownership
-- RLS policies (teacher -> own section, parent -> own children, student ->
-- self) now that user_profiles exists.

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  roll_number text,
  status text not null default 'active'
    check (status in ('active', 'promoted', 'repeated', 'transferred_out', 'withdrawn')),
  enrolled_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, student_id)
);

create index enrolments_tenant_idx on public.enrolments (tenant_id);
create index enrolments_tenant_session_idx on public.enrolments (tenant_id, session_id);
create index enrolments_section_idx on public.enrolments (section_id);
create index enrolments_student_idx on public.enrolments (student_id);

create trigger set_updated_at before update on public.enrolments
  for each row execute function public.set_updated_at();

alter table public.enrolments enable row level security;

create policy "staff roles view enrolments" on public.enrolments
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'accountant', 'librarian')
  );

create policy "teachers view own section enrolments" on public.enrolments
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'teacher'
    and section_id in (
      select s.id from public.sections s
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = auth.uid()
    )
  );

create policy "parents view own children enrolments" on public.enrolments
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'parent'
    and student_id in (
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = auth.uid()
    )
  );

create policy "students view own enrolments" on public.enrolments
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() = 'student'
    and student_id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
  );

create policy "admins manage enrolments" on public.enrolments
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');
