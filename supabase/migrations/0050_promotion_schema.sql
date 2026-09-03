-- Phase 1.4 -- promotion, as a preview you can argue with.
--
-- The naive version of this is a button that moves everybody up a class. It is
-- also the version that gets a school to ring you in tears, because promotion
-- is the one operation where the machine's answer and the staff-room's answer
-- differ for three or four named children every single year -- a child who was
-- ill for the examination, one whose parents are transferring in June, one the
-- head has decided to keep back regardless of marks.
--
-- So the preview is not a report. It is a set of rows an administrator can
-- edit, and applying it writes what the rows say -- not what the rules said.
--
--   promotion_runs        one rollover from one session to another, with the
--                         rules it was computed under
--     └── promotion_decisions   one row per student, editable, then applied
--
-- The rules themselves are a JSONB document, per rule 12, because "who gets
-- promoted" is exactly the kind of policy that differs between two schools in
-- the same city: no-detention up to class 8, promotion with one failed subject,
-- an attendance minimum, or nothing at all.

create table public.promotion_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_session_id uuid not null references public.academic_sessions(id) on delete cascade,
  to_session_id uuid not null references public.academic_sessions(id) on delete cascade,
  -- Frozen at the moment the run was created, like `exam_results.rules_snapshot`:
  -- editing the tenant's rules later must not change what a run already decided.
  rules jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'applied', 'discarded')),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint promotion_runs_sessions_differ_chk check (from_session_id <> to_session_id),
  constraint promotion_runs_applied_chk check (
    (status = 'applied') = (applied_at is not null)
  )
);

alter table public.promotion_runs
  add constraint promotion_runs_tenant_id_key unique (tenant_id, id);

create index promotion_runs_tenant_idx on public.promotion_runs (tenant_id, created_at desc);
create index promotion_runs_from_idx on public.promotion_runs (from_session_id);
create index promotion_runs_to_idx on public.promotion_runs (to_session_id);

-- At most one live run per session pair. Two half-built previews of the same
-- rollover would disagree with each other, and whichever got applied second
-- would silently win.
create unique index promotion_runs_one_live
  on public.promotion_runs (tenant_id, from_session_id, to_session_id)
  where status <> 'discarded';

create trigger set_updated_at before update on public.promotion_runs
  for each row execute function public.set_updated_at();
create trigger audit_promotion_runs
  after insert or update or delete on public.promotion_runs
  for each row execute function public.audit_row_change();

alter table public.promotion_runs enable row level security;

-- Admin-only, read as well as write, and deliberately so. A preview says "this
-- child will repeat" before anybody has decided it, and that is not a sentence
-- to leave lying around a staff room. Once applied, the outcome is visible
-- through `enrolments` like any other year.
create policy "admins manage promotion_runs" on public.promotion_runs
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
-- One row per student, editable
-- ---------------------------------------------------------------------------

create table public.promotion_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null,
  student_id uuid not null,
  from_enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  decision text not null
    check (decision in ('promote', 'repeat', 'graduate', 'hold')),
  -- Where they land. Null for a graduate (there is nowhere) and for a hold
  -- (there is nowhere *yet*), which is why the check below ties the two.
  to_section_id uuid,
  -- Always populated, always a sentence. "Why is this child repeating" is the
  -- only question anybody asks of this screen.
  reason text not null,
  -- Set when a person changed the machine's answer. Applying writes what the
  -- row says, so this is the difference between "the rules decided" and
  -- "the head teacher decided", and both must survive into the audit log.
  is_override boolean not null default false,
  carry_forward numeric(12, 2) not null default 0 check (carry_forward >= 0),
  -- What was actually written, so an applied run can be read back and audited
  -- against the enrolments it created.
  applied_enrolment_id uuid references public.enrolments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, run_id, student_id),

  -- A promotion or a repeat has to land somewhere; a graduate and a hold must
  -- not. Without this, "promote" with a null section would apply as a silent
  -- no-op and the student would vanish from next year.
  constraint promotion_decisions_target_chk check (
    (decision in ('promote', 'repeat')) = (to_section_id is not null)
  ),

  constraint promotion_decisions_run_fkey
    foreign key (tenant_id, run_id)
    references public.promotion_runs (tenant_id, id) on delete cascade,
  constraint promotion_decisions_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint promotion_decisions_section_fkey
    foreign key (tenant_id, to_section_id)
    references public.sections (tenant_id, id) on delete set null (to_section_id)
);

create index promotion_decisions_tenant_idx on public.promotion_decisions (tenant_id);
create index promotion_decisions_run_idx on public.promotion_decisions (tenant_id, run_id);
create index promotion_decisions_student_idx on public.promotion_decisions (tenant_id, student_id);

create trigger set_updated_at before update on public.promotion_decisions
  for each row execute function public.set_updated_at();
create trigger audit_promotion_decisions
  after insert or update or delete on public.promotion_decisions
  for each row execute function public.audit_row_change();

alter table public.promotion_decisions enable row level security;

create policy "admins manage promotion_decisions" on public.promotion_decisions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );
