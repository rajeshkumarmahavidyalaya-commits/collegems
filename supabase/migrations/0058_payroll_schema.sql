-- Phase 2.3, part two -- salary structures and payroll runs.
--
-- Two of the architecture's standing rules meet here, and the module is mostly
-- an application of them.
--
-- RULE 12: WHAT A SALARY IS MADE OF IS POLICY, NOT CODE
--
-- Basic, HRA, DA, PF, professional tax, gratuity, an internet allowance a
-- particular school pays its IT teacher -- every one of those is a real
-- school's real arrangement, and the list differs between two schools on the
-- same street. Hardcoding one school's components is the single most reliable
-- way to fail the second, so a structure is a JSONB document and the engine
-- reads it.
--
-- RULE 13: A PAYROLL RUN'S PREVIEW IS EDITABLE ROWS
--
-- Payroll has the same shape as promotion: the rules get three or four named
-- people wrong every month -- somebody's arrears, a bonus the head promised in
-- a corridor, a deduction that was already settled in cash -- and the person
-- who knows is standing at the screen. So `payroll_preview` materialises
-- payslips a person can edit, and finalising writes what the rows say, not what
-- the structure said.

-- ---------------------------------------------------------------------------
-- The structure
-- ---------------------------------------------------------------------------

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  -- The document. Deliberately not constrained beyond "is an object": a
  -- half-finished structure must be savable, exactly as a half-finished
  -- grading scheme must be. `salary_structure_problems()` criticises it in
  -- sentences; see migration 0059.
  components jsonb not null default '{"components": []}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, name),
  constraint salary_structures_object_chk check (jsonb_typeof(components) = 'object')
);

alter table public.salary_structures
  add constraint salary_structures_tenant_id_key unique (tenant_id, id);

create index salary_structures_tenant_idx on public.salary_structures (tenant_id);

create trigger set_updated_at before update on public.salary_structures
  for each row execute function public.set_updated_at();
create trigger audit_salary_structures
  after insert or update or delete on public.salary_structures
  for each row execute function public.audit_row_change();

alter table public.salary_structures enable row level security;

-- Salary is not the staff directory. `staff` is readable by four roles because
-- a librarian needs to look somebody up; what that person is paid is not part
-- of that, and this is one of the places where the permission matrix and RLS
-- have to agree rather than one covering for the other.
create policy "admins manage salary_structures" on public.salary_structures
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "accountants view salary_structures" on public.salary_structures
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'accountant'
  );

-- ---------------------------------------------------------------------------
-- Who is on which structure, and for how much
-- ---------------------------------------------------------------------------

-- The structure holds the *shape* -- that HRA is 40% of basic. The assignment
-- holds the *amounts*, because two teachers on the identical structure are on
-- different basic pay, and duplicating the whole document per person to change
-- one number is how a school ends up with forty structures and no idea which is
-- current.
create table public.staff_salary_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  structure_id uuid not null,
  -- `{"BASIC": 32000}` -- merged over the structure's own amounts by component
  -- code. A code not named here keeps whatever the structure declares.
  overrides jsonb not null default '{}'::jsonb,
  effective_from date not null,
  -- Null means "current". A raise closes the old row and opens a new one, so
  -- last March's payslip can still be recomputed against last March's pay.
  effective_to date,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_salary_assignments_range_chk check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint staff_salary_assignments_overrides_chk check (
    jsonb_typeof(overrides) = 'object'
  ),

  constraint staff_salary_assignments_staff_fkey
    foreign key (tenant_id, staff_id)
    references public.staff (tenant_id, id) on delete cascade,
  constraint staff_salary_assignments_structure_fkey
    foreign key (tenant_id, structure_id)
    references public.salary_structures (tenant_id, id) on delete restrict
);

alter table public.staff_salary_assignments
  add constraint staff_salary_assignments_tenant_id_key unique (tenant_id, id);

create index staff_salary_assignments_tenant_idx on public.staff_salary_assignments (tenant_id);
create index staff_salary_assignments_staff_idx
  on public.staff_salary_assignments (tenant_id, staff_id, effective_from desc);

-- No two salaries in force on the same day. Same device as the leave overlap
-- rule, and for the same reason: no CHECK can see a second row, and two open
-- assignments would make "what is this person paid" ambiguous at exactly the
-- moment payroll asks.
alter table public.staff_salary_assignments
  add constraint staff_salary_assignments_no_overlap
  exclude using gist (
    tenant_id with =,
    staff_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  );

create trigger set_updated_at before update on public.staff_salary_assignments
  for each row execute function public.set_updated_at();
create trigger audit_staff_salary_assignments
  after insert or update or delete on public.staff_salary_assignments
  for each row execute function public.audit_row_change();

alter table public.staff_salary_assignments enable row level security;

create policy "admins manage staff_salary_assignments" on public.staff_salary_assignments
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "accountants view staff_salary_assignments" on public.staff_salary_assignments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'accountant'
  );

-- A person may see what they themselves are paid. They may not see anybody
-- else's, and no policy here lets them change it.
create policy "staff view own salary assignment" on public.staff_salary_assignments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

-- ---------------------------------------------------------------------------
-- The run
-- ---------------------------------------------------------------------------

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  -- The first of the month. A `date` rather than a (year, month) pair so every
  -- range query, ordering and overlap check is ordinary date arithmetic.
  period_month date not null,
  status text not null default 'draft'
    check (status in ('draft', 'finalised', 'discarded')),
  -- Frozen when the run is created, like `promotion_runs.rules` and
  -- `exam_results.rules_snapshot`: editing a structure in April must not change
  -- what March paid.
  rules_snapshot jsonb not null default '{}'::jsonb,
  note text,
  finalised_at timestamptz,
  finalised_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payroll_runs_month_chk check (extract(day from period_month) = 1),
  constraint payroll_runs_finalised_chk check (
    (status = 'finalised') = (finalised_at is not null)
  )
);

alter table public.payroll_runs
  add constraint payroll_runs_tenant_id_key unique (tenant_id, id);
-- `status` rides in the key so `payslips` can point at it and let a CHECK ask
-- "is my parent still a draft?" -- see the child table below.
alter table public.payroll_runs
  add constraint payroll_runs_status_key unique (tenant_id, id, status);

create index payroll_runs_tenant_idx on public.payroll_runs (tenant_id, period_month desc);
create index payroll_runs_session_idx on public.payroll_runs (session_id);

-- One live run per month. Two half-built previews of March disagree, and
-- whichever is finalised second silently wins -- the same failure the promotion
-- module's partial index exists to prevent.
create unique index payroll_runs_one_live
  on public.payroll_runs (tenant_id, period_month)
  where status <> 'discarded';

create trigger set_updated_at before update on public.payroll_runs
  for each row execute function public.set_updated_at();
create trigger audit_payroll_runs
  after insert or update or delete on public.payroll_runs
  for each row execute function public.audit_row_change();

alter table public.payroll_runs enable row level security;

create policy "admins manage payroll_runs" on public.payroll_runs
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "accountants manage payroll_runs" on public.payroll_runs
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'accountant'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'accountant'
  );

-- ---------------------------------------------------------------------------
-- The payslip
-- ---------------------------------------------------------------------------

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null,
  staff_id uuid not null,
  -- Denormalised from the parent and held equal to it by the composite key
  -- below. Its only job is to give the "no edits after finalising" rule a
  -- local column, so it is a CHECK rather than a trigger -- the same device as
  -- `homework_submissions.max_marks`, used for a status instead of a number.
  run_status text not null,

  -- The register, as it stood when the slip was computed.
  working_days numeric(5, 1) not null default 0,
  paid_days numeric(5, 1) not null default 0,
  lop_days numeric(5, 1) not null default 0,

  gross_earnings numeric(12, 2) not null default 0 check (gross_earnings >= 0),
  total_deductions numeric(12, 2) not null default 0 check (total_deductions >= 0),
  net_pay numeric(12, 2) not null default 0,

  -- Rule 13: the difference between "the structure decided" and "the head
  -- teacher decided", and both belong in the audit log.
  is_override boolean not null default false,
  note text,
  -- What the engine computed, before anybody edited it. Keeping the machine's
  -- answer next to the human's is what makes an override reviewable a year
  -- later, when nobody remembers the corridor conversation.
  computed jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, run_id, staff_id),

  -- Net pay is allowed to be negative and that is not a mistake: a month with
  -- more deductions than earnings is a real (bad) month, and refusing to
  -- represent it would push somebody into fudging a number.
  constraint payslips_days_chk check (
    working_days >= 0 and paid_days >= 0 and lop_days >= 0
    and paid_days + lop_days <= working_days + 0.001
  ),

  constraint payslips_run_fkey
    foreign key (tenant_id, run_id, run_status)
    references public.payroll_runs (tenant_id, id, status)
    on update cascade on delete cascade,
  constraint payslips_staff_fkey
    foreign key (tenant_id, staff_id)
    references public.staff (tenant_id, id) on delete cascade
);

alter table public.payslips add constraint payslips_tenant_id_key unique (tenant_id, id);
alter table public.payslips
  add constraint payslips_status_key unique (tenant_id, id, run_status);

create index payslips_tenant_idx on public.payslips (tenant_id);
create index payslips_run_idx on public.payslips (tenant_id, run_id);
create index payslips_staff_idx on public.payslips (tenant_id, staff_id);

create trigger set_updated_at before update on public.payslips
  for each row execute function public.set_updated_at();
create trigger audit_payslips
  after insert or update or delete on public.payslips
  for each row execute function public.audit_row_change();

alter table public.payslips enable row level security;

-- Editable only while the parent run is a draft. This is a *row* rule, which is
-- what RLS is for -- unlike the column problem in `homework_submissions`, there
-- is no second party here needing different columns on the same row.
--
-- The `run_status` in USING and the cascade on the composite key do the work
-- together: finalising the run rewrites every child's copy, and from that
-- moment no policy matches the row, so it is immutable without revoking
-- anything.
create policy "payroll staff manage draft payslips" on public.payslips
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
    and run_status = 'draft'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
    and run_status = 'draft'
  );

create policy "payroll staff view all payslips" on public.payslips
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- A person sees their own payslip once it is real. A draft is a number still
-- being argued about in the office, and showing it would have somebody planning
-- around a figure that is about to change.
create policy "staff view own finalised payslips" on public.payslips
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and run_status = 'finalised'
    and staff_id = ( select up.staff_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

-- ---------------------------------------------------------------------------
-- The lines
-- ---------------------------------------------------------------------------

-- A payslip's totals are a summary; this is the thing a person actually
-- queries when they ring to ask why March was less than February.
create table public.payslip_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payslip_id uuid not null,
  payslip_status text not null,
  code text not null,
  name text not null,
  kind text not null check (kind in ('earning', 'deduction')),
  amount numeric(12, 2) not null check (amount >= 0),
  -- How this number was arrived at, in the structure's own words -- "40% of
  -- BASIC", "fixed", "prorated for 3 days of unpaid leave". Text, because its
  -- only reader is a human being holding a payslip.
  basis text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  unique (tenant_id, payslip_id, code),

  constraint payslip_lines_payslip_fkey
    foreign key (tenant_id, payslip_id, payslip_status)
    references public.payslips (tenant_id, id, run_status)
    on update cascade on delete cascade
);

create index payslip_lines_tenant_idx on public.payslip_lines (tenant_id);
create index payslip_lines_payslip_idx on public.payslip_lines (tenant_id, payslip_id, sort_order);

create trigger audit_payslip_lines
  after insert or update or delete on public.payslip_lines
  for each row execute function public.audit_row_change();

alter table public.payslip_lines enable row level security;

create policy "payroll staff manage draft payslip_lines" on public.payslip_lines
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
    and payslip_status = 'draft'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
    and payslip_status = 'draft'
  );

create policy "payroll staff view all payslip_lines" on public.payslip_lines
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- A line is readable by whoever can read the slip it belongs to -- expressed as
-- an EXISTS against the parent so there is one place the rule lives.
create policy "readers of the payslip read its lines" on public.payslip_lines
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and exists (select 1 from public.payslips p where p.id = payslip_lines.payslip_id)
  );
