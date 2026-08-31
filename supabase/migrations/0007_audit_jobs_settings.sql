-- Audit trail, background job queue, and tenant settings.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index audit_log_tenant_idx on public.audit_log (tenant_id, created_at desc);
create index audit_log_tenant_table_row_idx on public.audit_log (tenant_id, table_name, row_id);

alter table public.audit_log enable row level security;

create policy "admins view audit_log" on public.audit_log
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');

-- No insert/update/delete policy for `authenticated`: rows are written only
-- by the audit trigger (0008, security definer) or the service role.

-- Heavy/async work (report generation, bulk SMS/email, imports, promotion
-- runs) is queued here and consumed by Supabase Edge Functions -- never
-- run inline in a Next.js request handler. See CLAUDE.md rule 7.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index jobs_tenant_idx on public.jobs (tenant_id, created_at desc);
create index jobs_tenant_status_idx on public.jobs (tenant_id, status) where status in ('queued', 'processing');

alter table public.jobs enable row level security;

create policy "tenant members view own or all jobs" on public.jobs
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.current_role_code() = 'admin' or created_by = auth.uid())
  );

create policy "tenant members enqueue jobs" on public.jobs
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and created_by = auth.uid());

-- status/result/error transitions are written by Edge Functions using the
-- service role, which bypasses RLS -- no update policy for `authenticated`.

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique (tenant_id, key)
);

create index settings_tenant_idx on public.settings (tenant_id);

create trigger set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;

create policy "tenant members view settings" on public.settings
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "admins manage settings" on public.settings
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.current_role_code() = 'admin');
