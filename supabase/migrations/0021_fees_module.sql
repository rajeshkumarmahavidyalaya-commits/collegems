-- Fees: the append-only money module (CLAUDE.md rule 6).
--
-- Two halves that must not be confused with each other:
--
--   charges  invoices + invoice_lines -- what the school billed
--   ledger   ledger_entries           -- every movement against those charges
--
-- balance = sum(lines of issued invoices) + sum(ledger entries)
--
-- ONE LEDGER TABLE, NOT FOUR. docs/domain/erd.md sketched separate
-- `payments` / `discounts` / `fines` / `refunds` tables. Building it that way
-- would mean four sets of policies, four audit triggers, four reversal
-- mechanisms, and a five-way UNION to answer "what does this child owe".
-- A single `ledger_entries` table with a typed `entry_type` and a
-- sign constraint per type gives the same guarantees, makes the balance one
-- SUM, and makes reversal uniform. The roadmap entry is updated to match.
--
-- SIGN CONVENTION: `amount` is signed, and positive always means "the student
-- owes more". Charges and fines are positive; payments, discounts and
-- write-offs are negative; refunds are positive again, because money going
-- back to a payer restores the debt. The check constraint below enforces this
-- per entry type, so a mis-signed row cannot be inserted at all.
--
-- NOTHING HERE IS EVER UPDATED OR DELETED. `ledger_entries` and
-- `invoice_lines` have no UPDATE or DELETE policy *and* have those privileges
-- revoked outright, so a future `for all` policy added by mistake still cannot
-- rewrite history. A correction is a reversing entry (`fees_reverse_entry`),
-- which is a new row pointing at the one it cancels.

-- ---------------------------------------------------------------------------
-- Catalog: what a school charges for, and how much per class
-- ---------------------------------------------------------------------------

create table public.fee_heads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  category text not null default 'other'
    check (category in ('tuition', 'transport', 'hostel', 'exam', 'library', 'activity', 'other')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index fee_heads_tenant_idx on public.fee_heads (tenant_id);

create trigger set_updated_at before update on public.fee_heads
  for each row execute function public.set_updated_at();
create trigger audit_fee_heads
  after insert or update or delete on public.fee_heads
  for each row execute function public.audit_row_change();

alter table public.fee_heads enable row level security;

create policy "tenant members view fee_heads" on public.fee_heads
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "finance roles manage fee_heads" on public.fee_heads
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- What a given class level pays for a given head in a given year.
--
-- `amount` is the amount *per instalment*, and `frequency` describes how often
-- that instalment is billed -- it does not divide the amount. Generating the
-- recurring instalments on a schedule is a `jobs` concern (rule 7) and is not
-- built; today an invoice is raised deliberately, for the heads chosen.
create table public.fee_structures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  class_level_id uuid not null references public.class_levels(id) on delete cascade,
  fee_head_id uuid not null references public.fee_heads(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  frequency text not null default 'annual'
    check (frequency in ('one_time', 'monthly', 'quarterly', 'annual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, class_level_id, fee_head_id)
);

create index fee_structures_tenant_idx on public.fee_structures (tenant_id);
create index fee_structures_lookup_idx
  on public.fee_structures (tenant_id, session_id, class_level_id);
create index fee_structures_fee_head_idx on public.fee_structures (fee_head_id);
create index fee_structures_session_idx on public.fee_structures (session_id);
create index fee_structures_class_level_idx on public.fee_structures (class_level_id);

create trigger set_updated_at before update on public.fee_structures
  for each row execute function public.set_updated_at();
create trigger audit_fee_structures
  after insert or update or delete on public.fee_structures
  for each row execute function public.audit_row_change();

alter table public.fee_structures enable row level security;

create policy "tenant members view fee_structures" on public.fee_structures
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "finance roles manage fee_structures" on public.fee_structures
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
-- Gapless document numbers
-- ---------------------------------------------------------------------------

-- A Postgres sequence is the wrong tool: sequences deliberately do NOT roll
-- back, so a failed payment would burn a receipt number and leave a hole.
-- Auditors treat a hole in a receipt book as a missing receipt. A counter row
-- incremented inside the same transaction is gapless precisely because it
-- rolls back with everything else -- at the cost of serialising concurrent
-- receipts per tenant per session, which is the right trade for a cash desk.
create table public.document_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  kind text not null check (kind in ('receipt', 'invoice')),
  prefix text not null default '',
  next_value bigint not null default 1 check (next_value >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, kind)
);

create index document_sequences_tenant_idx on public.document_sequences (tenant_id);
create index document_sequences_session_idx on public.document_sequences (session_id);

create trigger set_updated_at before update on public.document_sequences
  for each row execute function public.set_updated_at();
create trigger audit_document_sequences
  after insert or update or delete on public.document_sequences
  for each row execute function public.audit_row_change();

alter table public.document_sequences enable row level security;

create policy "finance roles use document_sequences" on public.document_sequences
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
-- Charges
-- ---------------------------------------------------------------------------

-- Keyed to `student_id` rather than `enrolment_id` (unlike attendance): a bill
-- follows the child for the year, and a mid-year move from 6A to 6B must not
-- orphan or duplicate it. `session_id` carries the year directly, per rule 2.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  invoice_number text not null,
  issue_date date not null default current_date,
  due_date date not null,
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  notes text,
  issued_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, invoice_number),
  -- A cancellation is only a cancellation if it says who and why.
  constraint invoices_cancel_reason_chk check (
    (status = 'cancelled' and cancelled_at is not null and cancel_reason is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  )
);

create index invoices_tenant_idx on public.invoices (tenant_id);
create index invoices_student_idx on public.invoices (tenant_id, session_id, student_id);
create index invoices_due_idx
  on public.invoices (tenant_id, session_id, due_date) where status = 'issued';
create index invoices_session_idx on public.invoices (session_id);
create index invoices_issued_by_idx on public.invoices (issued_by);
create index invoices_cancelled_by_idx on public.invoices (cancelled_by);

create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function public.audit_row_change();

alter table public.invoices enable row level security;

create policy "finance roles manage invoices" on public.invoices
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "students view own invoices" on public.invoices
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children invoices" on public.invoices
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and student_id in (
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

-- Append-only. No `updated_at`, no UPDATE/DELETE policy, and the privileges
-- are revoked below as well.
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  fee_head_id uuid references public.fee_heads(id) on delete restrict,
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index invoice_lines_tenant_idx on public.invoice_lines (tenant_id);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index invoice_lines_fee_head_idx on public.invoice_lines (fee_head_id);
create index invoice_lines_session_idx on public.invoice_lines (session_id);

create trigger audit_invoice_lines
  after insert or update or delete on public.invoice_lines
  for each row execute function public.audit_row_change();

alter table public.invoice_lines enable row level security;

create policy "finance roles read invoice_lines" on public.invoice_lines
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "finance roles add invoice_lines" on public.invoice_lines
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "students view own invoice_lines" on public.invoice_lines
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and invoice_id in (
      select i.id from public.invoices i
      where i.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    )
  );

create policy "parents view own children invoice_lines" on public.invoice_lines
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and invoice_id in (
      select i.id from public.invoices i
      join public.guardian_student gs on gs.student_id = i.student_id
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- Optional: a payment can be allocated to one invoice, or sit on account.
  invoice_id uuid references public.invoices(id) on delete restrict,
  entry_type text not null
    check (entry_type in ('payment', 'discount', 'fine', 'refund', 'write_off')),
  amount numeric(12, 2) not null check (amount <> 0),
  occurred_at timestamptz not null default now(),
  -- Only movements of actual money carry a receipt number.
  receipt_number text,
  method text check (method in ('cash', 'cheque', 'card', 'upi', 'netbanking', 'bank_transfer', 'online')),
  reference text,
  note text,
  -- Payment-gateway idempotency: the provider's own event id, unique per
  -- tenant, so a webhook redelivered five times still books one payment.
  provider text,
  provider_event_id text,
  reverses_entry_id uuid references public.ledger_entries(id) on delete restrict,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- Positive always means "owes more". Enforced per type, and inverted for a
  -- reversal, so a mis-signed correction is rejected by the database.
  constraint ledger_entries_sign_chk check (
    case
      when reverses_entry_id is null then
        case entry_type
          when 'payment' then amount < 0
          when 'discount' then amount < 0
          when 'write_off' then amount < 0
          when 'fine' then amount > 0
          when 'refund' then amount > 0
          else false
        end
      else
        case entry_type
          when 'payment' then amount > 0
          when 'discount' then amount > 0
          when 'write_off' then amount > 0
          when 'fine' then amount < 0
          when 'refund' then amount < 0
          else false
        end
    end
  ),
  -- Money moved => a method was used. No method on a paper adjustment.
  constraint ledger_entries_method_chk check (
    (entry_type in ('payment', 'refund') and method is not null)
    or (entry_type in ('discount', 'fine', 'write_off') and method is null)
  )
);

create unique index ledger_entries_receipt_unique
  on public.ledger_entries (tenant_id, session_id, receipt_number)
  where receipt_number is not null;

-- One booking per provider event, forever. This is the whole webhook
-- idempotency story -- the constraint, not application code.
create unique index ledger_entries_provider_event_unique
  on public.ledger_entries (tenant_id, provider, provider_event_id)
  where provider_event_id is not null;

-- An entry can be reversed once. A second attempt hits this index.
create unique index ledger_entries_reversal_unique
  on public.ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;

create index ledger_entries_tenant_idx on public.ledger_entries (tenant_id);
create index ledger_entries_student_idx
  on public.ledger_entries (tenant_id, session_id, student_id);
create index ledger_entries_collection_idx
  on public.ledger_entries (tenant_id, session_id, occurred_at) where entry_type = 'payment';
create index ledger_entries_invoice_idx on public.ledger_entries (invoice_id);
create index ledger_entries_session_idx on public.ledger_entries (session_id);
create index ledger_entries_recorded_by_idx on public.ledger_entries (recorded_by);

create trigger audit_ledger_entries
  after insert or update or delete on public.ledger_entries
  for each row execute function public.audit_row_change();

alter table public.ledger_entries enable row level security;

create policy "finance roles read ledger_entries" on public.ledger_entries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "finance roles add ledger_entries" on public.ledger_entries
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "students view own ledger_entries" on public.ledger_entries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children ledger_entries" on public.ledger_entries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and student_id in (
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

-- Belt and braces on top of "no UPDATE/DELETE policy exists": revoke the
-- privileges outright, so adding a careless `for all` policy later still
-- cannot rewrite a ledger row.
revoke update, delete on public.ledger_entries from authenticated, anon;
revoke update, delete on public.invoice_lines from authenticated, anon;
