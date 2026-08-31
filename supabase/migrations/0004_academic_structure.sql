-- Academic structure: grade levels and their per-session sections
-- (e.g. "Grade 6" -> "6A" for the 2025-2026 session).

create table public.class_levels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sequence integer not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (tenant_id, sequence)
);

create index class_levels_tenant_idx on public.class_levels (tenant_id);

alter table public.class_levels enable row level security;

create policy "tenant members view class_levels" on public.class_levels
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "admins manage class_levels" on public.class_levels
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_level_id uuid not null references public.class_levels(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  name text not null,
  capacity integer not null default 40,
  class_teacher_staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, class_level_id, session_id, name)
);

create index sections_tenant_idx on public.sections (tenant_id);
create index sections_tenant_session_idx on public.sections (tenant_id, session_id);
create index sections_class_teacher_idx on public.sections (class_teacher_staff_id);

create trigger set_updated_at before update on public.sections
  for each row execute function public.set_updated_at();

alter table public.sections enable row level security;

create policy "tenant members view sections" on public.sections
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "admins manage sections" on public.sections
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');
