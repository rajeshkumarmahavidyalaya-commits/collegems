-- ---------------------------------------------------------------------------
-- Concessions: the discount a school decided, rather than one typed each month
-- ---------------------------------------------------------------------------
--
-- Every school this product is for has some of these: a sibling discount, a
-- waiver for a member of staff's own child, an RTE free seat, a merit
-- scholarship, a hardship remission agreed with a family in private. Until now
-- none of them was expressible. The only route was a `discount` ledger entry
-- typed by hand, per child, per invoice, after the invoice had already gone
-- out -- which is exactly the failure rule 13 describes: a decision the office
-- has to re-apply one record at a time, in a different part of the app, every
-- billing period, for as long as the child is at the school.
--
-- AN AWARD, NOT AN INFERRED RULE
--
-- The tempting design is to evaluate eligibility at billing time -- count the
-- siblings, check whether a parent is on staff. It is wrong here, and the
-- reason is the same one rule 13 gives for making a preview editable:
--
--   > A concession is a **decision with money attached**. It is granted by
--   > somebody, on a date, for a reason, and it belongs in the audit log as
--   > that. A rule re-evaluated every billing run changes a family's bill when an
--   > elder sibling leaves, and nobody decided that.
--
-- So `fee_concessions` is the catalogue of what this school offers, and
-- `student_concessions` is the award: this child, this concession, this
-- session, granted by this person, because of this. The same shape as
-- `certificate_templates` / `certificates`, and for the same reason.
--
-- THE INVOICE STAYS POSITIVE
--
-- `invoice_lines` carries `check (amount > 0)` and should keep it. An invoice
-- says what was **charged**; a negative charge is not a thing. What is **owed**
-- is the ledger, which already has a `discount` entry type, already constrains
-- it negative, already shows on the counter, the day book and the family's
-- statement, and is already reversible by rule 6's rules. So a concession is
-- credited there, and no money table changes shape to accommodate it.
--
-- That also means the family sees both halves -- *Tuition 5,000*, *Sibling
-- discount −500* -- which is how a school prints it and what a parent needs to
-- check. Folding the discount into the charge would produce a smaller number
-- nobody can account for.

create table public.fee_concessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  code text not null,
  name text not null,
  description text,

  kind text not null check (kind in ('percentage', 'amount')),
  value numeric(12,2) not null,

  -- Null means every fee head. A sibling discount usually applies to tuition
  -- and not to the bus, and a school that means "everything" should be able to
  -- say so without listing every head it has.
  fee_head_ids uuid[],

  -- A ceiling for a percentage: "20%, up to 2,000 a term". Meaningless for a
  -- fixed amount, so the check refuses it there rather than ignoring it.
  max_amount numeric(12,2),

  -- **Evaluation order is part of the contract** (rule 12). Lower runs first,
  -- and the order matters because the cap below is applied against what is
  -- left. Two concessions with the same priority are ordered by code, so the
  -- result is deterministic rather than whatever the planner returns.
  priority integer not null default 100,

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, code),

  constraint fee_concessions_value_chk check (
    (kind = 'percentage' and value > 0 and value <= 100)
    or (kind = 'amount' and value > 0)
  ),
  constraint fee_concessions_max_amount_chk check (
    max_amount is null or (kind = 'percentage' and max_amount > 0)
  )
);

alter table public.fee_concessions
  add constraint fee_concessions_tenant_id_key unique (tenant_id, id);

create index fee_concessions_tenant_idx
  on public.fee_concessions (tenant_id, priority, code);

create trigger set_updated_at before update on public.fee_concessions
  for each row execute function public.set_updated_at();
create trigger audit_fee_concessions
  after insert or update or delete on public.fee_concessions
  for each row execute function public.audit_row_change();

alter table public.fee_concessions enable row level security;

-- Every tenant member may read the catalogue: a family being told "you have the
-- sibling discount" should be able to see what that means. Only finance writes.
create policy "tenant members view fee_concessions" on public.fee_concessions
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "finance roles manage fee_concessions" on public.fee_concessions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- ---------------------------------------------------------------------------
-- The award
-- ---------------------------------------------------------------------------

create table public.student_concessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- A plain reference, like every other session-scoped table:
  -- `academic_sessions` has no `(tenant_id, id)` key to point a composite at,
  -- and `tenant_id` is already pinned by the student and concession keys below.
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null,
  concession_id uuid not null,

  -- **A reason is required.** A discount with no stated cause is the one thing
  -- an auditor asks about and nobody can answer a year later, and it is the
  -- shape a fraud takes. `certificates` refuses to issue with a placeholder
  -- unfilled for the same instinct.
  reason text not null,

  granted_on date not null default current_date,
  granted_by uuid,

  -- A scholarship for one term rather than the year. Null means "for as long as
  -- the session lasts".
  ends_on date,

  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_concessions_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint student_concessions_concession_fkey
    foreign key (tenant_id, concession_id)
    references public.fee_concessions (tenant_id, id),

  constraint student_concessions_reason_chk check (length(trim(reason)) >= 3),
  constraint student_concessions_revoke_chk check (
    (status = 'revoked' and revoked_at is not null and revoke_reason is not null)
    or (status = 'active' and revoked_at is null)
  )
);

alter table public.student_concessions
  add constraint student_concessions_tenant_id_key unique (tenant_id, id);

-- One live award of a given concession per child per year. Partial on `active`
-- so revoking frees it to be granted again -- the same reasoning as the partial
-- exclusion constraint on leave, where a refused request must not block a
-- better one.
create unique index student_concessions_one_live
  on public.student_concessions (tenant_id, session_id, student_id, concession_id)
  where status = 'active';

create index student_concessions_student_idx
  on public.student_concessions (tenant_id, student_id, session_id);
create index student_concessions_concession_idx
  on public.student_concessions (tenant_id, concession_id);

create trigger set_updated_at before update on public.student_concessions
  for each row execute function public.set_updated_at();
create trigger audit_student_concessions
  after insert or update or delete on public.student_concessions
  for each row execute function public.audit_row_change();

alter table public.student_concessions enable row level security;

create policy "finance roles manage student_concessions" on public.student_concessions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- A family may see their own child's award and nobody else's -- the same shape
-- as their view of the ledger. Read only: being told about a discount is not
-- the same as being able to grant one.
create policy "parents view own children student_concessions" on public.student_concessions
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and exists (
      select 1
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where gs.student_id = student_concessions.student_id
        and up.id = ( select auth.uid() )
    )
  );

create policy "students view own student_concessions" on public.student_concessions
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and exists (
      select 1 from public.user_profiles up
      where up.id = ( select auth.uid() )
        and up.student_id = student_concessions.student_id
    )
  );

comment on table public.student_concessions is
  'An award, not an inferred rule: granted by a person, on a date, for a stated '
  'reason. Credited to the ledger as a `discount` when an invoice is generated; '
  'the invoice itself stays positive. See migration 0171.';

-- ---------------------------------------------------------------------------
-- The ledger's way back to the award
-- ---------------------------------------------------------------------------
--
-- The `book_issue_id` pattern from migration 0026, for the same two reasons:
-- a credit has to say what caused it, and **idempotency is a unique index on
-- the source row** so a re-run converges instead of discounting twice.

alter table public.ledger_entries
  add column concession_award_id uuid;

alter table public.ledger_entries
  add constraint ledger_entries_concession_award_fkey
  foreign key (tenant_id, concession_award_id)
  references public.student_concessions (tenant_id, id);

-- One credit per award per invoice. Excludes reversals, because a reversing
-- entry deliberately pairs with the row it undoes.
create unique index ledger_entries_concession_award_unique
  on public.ledger_entries (tenant_id, invoice_id, concession_award_id)
  where concession_award_id is not null and reverses_entry_id is null;

create index ledger_entries_tenant_concession_idx
  on public.ledger_entries (tenant_id, concession_award_id)
  where concession_award_id is not null;

comment on column public.ledger_entries.concession_award_id is
  'The `student_concessions` row that caused this discount. A unique index over '
  '(tenant, invoice, award) makes a repeated invoice run converge rather than '
  'double-discount -- the `book_issue_id` pattern from migration 0026.';
