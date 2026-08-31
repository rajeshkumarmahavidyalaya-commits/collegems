-- Identity model. Deliberately layered per CLAUDE.md: a person is
-- biographical data; "student"/"guardian"/"staff" are roles a person can
-- hold; enrolment (added in 0006) is the per-year link to a class section.
-- This is what makes alumni, re-admission, and sibling/staff-who-is-also-a-
-- parent all representable without collapsing distinct concepts into one row.

create table public.people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  first_name text not null,
  middle_name text,
  last_name text not null,
  date_of_birth date,
  gender text check (gender in ('male', 'female', 'other', 'undisclosed')),
  blood_group text,
  photo_path text, -- storage object path in the `avatars` bucket, not a public URL
  email citext,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index people_tenant_idx on public.people (tenant_id);
create index people_tenant_name_idx on public.people (tenant_id, last_name, first_name);

create trigger set_updated_at before update on public.people
  for each row execute function public.set_updated_at();

alter table public.people enable row level security;

create policy "staff roles view people" on public.people
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "admins manage people" on public.people
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Guardians: a person acting in the guardian role for one or more students.

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  occupation text,
  created_at timestamptz not null default now(),
  unique (tenant_id, person_id)
);

create index guardians_tenant_idx on public.guardians (tenant_id);

alter table public.guardians enable row level security;

create policy "staff roles view guardians" on public.guardians
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "admins manage guardians" on public.guardians
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Staff: a person employed by the tenant (teacher, accountant, librarian, admin...).

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  employee_code text not null,
  designation text not null,
  department text,
  date_of_joining date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive', 'terminated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, person_id),
  unique (tenant_id, employee_code)
);

create index staff_tenant_idx on public.staff (tenant_id);

create trigger set_updated_at before update on public.staff
  for each row execute function public.set_updated_at();

alter table public.staff enable row level security;

create policy "staff roles view staff directory" on public.staff
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "admins manage staff" on public.staff
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Students: a person enrolled (or formerly enrolled) at the tenant.
-- `admission_number` is the durable identifier across re-admission/alumni;
-- section membership per year lives in `enrolments`, not here.

create table public.students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  admission_number text not null,
  admission_date date not null default current_date,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'alumni', 'transferred', 'expelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, person_id),
  unique (tenant_id, admission_number)
);

create index students_tenant_idx on public.students (tenant_id);
create index students_tenant_status_idx on public.students (tenant_id, status);

create trigger set_updated_at before update on public.students
  for each row execute function public.set_updated_at();

alter table public.students enable row level security;

create policy "staff roles view students" on public.students
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "admins manage students" on public.students
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- Guardian <-> student linking, many-to-many with a relationship type.

create table public.guardian_student (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text not null check (relationship in ('father', 'mother', 'guardian', 'other')),
  is_primary boolean not null default false,
  can_pickup boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, guardian_id, student_id)
);

create index guardian_student_tenant_idx on public.guardian_student (tenant_id);
create index guardian_student_student_idx on public.guardian_student (tenant_id, student_id);
create index guardian_student_guardian_idx on public.guardian_student (tenant_id, guardian_id);

alter table public.guardian_student enable row level security;

create policy "staff roles view guardian_student" on public.guardian_student
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_role_code() in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "admins manage guardian_student" on public.guardian_student
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');
