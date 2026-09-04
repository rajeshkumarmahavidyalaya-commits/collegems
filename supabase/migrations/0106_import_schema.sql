-- ---------------------------------------------------------------------------
-- Bulk student import — rule 13's shape, bounded per rule 7
--
-- CLAUDE.md rule 7 lists bulk import as `jobs` work. Rule 7's own refinement
-- says the test is boundedness, not the category: *"bound it and say what the
-- bound is, or queue it."* An import of one class is a few dozen rows; an
-- import of a whole school is not, and the bound here is **500 rows per run**,
-- stated in the constraint rather than in a comment.
--
-- More importantly, rule 13 applies with full force. Every import gets three or
-- four rows wrong — a date in the wrong format, a duplicate admission number, a
-- class that does not exist — and **the person who can fix them is standing at
-- the screen**. A preview they can only read is a preview they have to correct
-- afterwards, one student at a time, in a different part of the app.
--
-- So: `import_runs` -> `import_rows`, the same pair as
-- `promotion_runs` -> `promotion_decisions`, and apply writes **what the rows
-- say** rather than re-parsing the file.
-- ---------------------------------------------------------------------------

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  -- One kind today. The table is typed because the second kind (staff,
  -- guardians, opening fee balances) will want the same preview machinery and
  -- should not need a second pair of tables.
  kind text not null default 'students' check (kind in ('students')),
  file_name text,
  status text not null default 'draft'
    check (status in ('draft', 'applied', 'discarded')),
  row_count integer not null default 0 check (row_count >= 0 and row_count <= 500),
  applied_count integer not null default 0 check (applied_count >= 0),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Same pairing as `promotion_runs` and `exams`: a status and the evidence
  -- for it, kept in step by a constraint.
  constraint import_runs_applied_chk check (
    (status = 'applied') = (applied_at is not null)
  ),
  constraint import_runs_applied_count_chk check (applied_count <= row_count)
);

alter table public.import_runs
  add constraint import_runs_tenant_id_key unique (tenant_id, id);
-- Carried onto the rows, so "this row belongs to a draft run" is a foreign key
-- and the write policy can ask it without joining -- the same device that makes
-- payslips and exam remarks immutable.
alter table public.import_runs
  add constraint import_runs_status_key unique (tenant_id, id, status);

-- **At most one live import per tenant.** Two half-corrected previews of the
-- same spreadsheet disagree, and whichever is applied second silently wins --
-- exactly the reasoning behind `promotion_runs_one_live`.
create unique index import_runs_one_live
  on public.import_runs (tenant_id, kind)
  where status = 'draft';

create index import_runs_tenant_idx on public.import_runs (tenant_id, created_at desc);
create index import_runs_session_idx on public.import_runs (session_id);
create index import_runs_creator_idx on public.import_runs (created_by);

create trigger set_updated_at before update on public.import_runs
  for each row execute function public.set_updated_at();
create trigger audit_import_runs
  after insert or update or delete on public.import_runs
  for each row execute function public.audit_row_change();

alter table public.import_runs enable row level security;

create policy "office views import_runs" on public.import_runs
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "office manages import_runs" on public.import_runs
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- The rows
-- ---------------------------------------------------------------------------

-- One row per line of the file, **editable**, with whatever the parser could
-- not make sense of recorded against it. `problems` is an array of sentences,
-- the same contract as `grading_scheme_problems` — the person reading them is
-- about to fix them.
create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null,
  -- Held equal to the run's status by the composite key below, so a row of an
  -- applied run cannot be edited: the write policy simply stops matching.
  run_status text not null default 'draft',

  -- Which line of the file this was, so a message can say "row 14" and mean the
  -- row the person is looking at in their spreadsheet.
  line_number integer not null check (line_number > 0),

  first_name text,
  middle_name text,
  last_name text,
  date_of_birth date,
  gender text,
  admission_number text,
  admission_date date,
  section_id uuid,
  roll_number text,
  guardian_name text,
  guardian_phone text,
  guardian_relationship text,
  phone text,
  email text,
  address_line1 text,
  city text,

  -- Sentences, not codes. Empty means the row is ready to write.
  problems text[] not null default '{}'::text[],
  -- Set by apply. A row that failed at write time keeps its reason here rather
  -- than vanishing, which is what makes a partial apply recoverable.
  applied_student_id uuid,
  apply_error text,
  -- Deliberate skip: a person can decide a row should not be imported at all
  -- without deleting it, so the run still accounts for every line of the file.
  skipped boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, run_id, line_number),

  constraint import_rows_run_fkey
    foreign key (tenant_id, run_id, run_status)
    references public.import_runs (tenant_id, id, status)
    on update cascade on delete cascade,

  constraint import_rows_section_fkey
    foreign key (tenant_id, section_id)
    references public.sections (tenant_id, id) on delete set null,

  constraint import_rows_student_fkey
    foreign key (tenant_id, applied_student_id)
    references public.students (tenant_id, id) on delete set null
);

create index import_rows_tenant_idx on public.import_rows (tenant_id);
create index import_rows_run_idx on public.import_rows (tenant_id, run_id, line_number);
create index import_rows_problem_idx
  on public.import_rows (tenant_id, run_id)
  where array_length(problems, 1) > 0;

create trigger set_updated_at before update on public.import_rows
  for each row execute function public.set_updated_at();
create trigger audit_import_rows
  after insert or update or delete on public.import_rows
  for each row execute function public.audit_row_change();

alter table public.import_rows enable row level security;

create policy "office views import_rows" on public.import_rows
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- Writable only while the run is a draft. Applying is one UPDATE on the parent;
-- the cascade rewrites every row's `run_status` and from that instant this
-- policy matches nothing -- so an imported row is a permanent record of what
-- was actually written, not a scratchpad.
create policy "office manages draft import_rows" on public.import_rows
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
    and run_status = 'draft'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
    and run_status = 'draft'
  );

comment on table public.import_rows is
  'One editable row per line of the file. Rule 13: every import gets three or four rows wrong and the person who can fix them is standing at the screen, so the preview is rows they can correct, and apply writes what the rows say rather than re-parsing the file.';
comment on column public.import_rows.problems is
  'Sentences, not codes -- the same contract as grading_scheme_problems(). Empty means the row is ready to write.';
