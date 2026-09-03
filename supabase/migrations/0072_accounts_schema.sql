-- Phase 2.2 -- the chart of accounts, and double-entry vouchers.
--
-- The capstone of the money story. Two modules already produce entries that
-- "belong in a chart of accounts" and had nowhere to post until one existed: the
-- fee ledger (a receivable) and `payroll_payments` (a payable settled).
--
-- Same discipline as rule 6, one level up: a *posted* voucher is immutable, a
-- correction is a reversing voucher never an edit, and the number is a gapless
-- per-tenant-per-session sequence. What double-entry adds is the balance rule --
-- every voucher's debits equal its credits -- which, being a fact about several
-- rows at once, is enforced at post time, not by a CHECK.

-- ---------------------------------------------------------------------------
-- The chart
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null
    check (account_type in ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_id uuid,
  -- Leaf/group distinction. "Current assets" is a heading; "Bank" is where a
  -- line lands. Posting to a group would double-count its own total.
  is_postable boolean not null default true,
  -- A system account is one the posting map points at; renameable, not
  -- deletable, so a mapping never dangles.
  is_system boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Constant true, so a child FK can demand a postable account by construction.
  postable_flag boolean not null generated always as (is_postable) stored,

  unique (tenant_id, code)
);

alter table public.accounts add constraint accounts_tenant_id_key unique (tenant_id, id);
alter table public.accounts
  add constraint accounts_type_key unique (tenant_id, id, account_type);
alter table public.accounts
  add constraint accounts_postable_key unique (tenant_id, id, postable_flag);

-- Self-referential and tenant-safe: a parent is in the same tenant. Added after
-- the unique key it points at exists.
alter table public.accounts
  add constraint accounts_parent_fkey
  foreign key (tenant_id, parent_id)
  references public.accounts (tenant_id, id) on delete restrict;

create index accounts_tenant_idx on public.accounts (tenant_id, code);
create index accounts_parent_idx on public.accounts (tenant_id, parent_id);

create trigger set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger audit_accounts
  after insert or update or delete on public.accounts
  for each row execute function public.audit_row_change();

alter table public.accounts enable row level security;

create policy "finance roles manage accounts" on public.accounts
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
-- The voucher (journal entry header)
-- ---------------------------------------------------------------------------

create table public.journal_vouchers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  voucher_number text,
  voucher_date date not null default current_date,
  narration text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  source_kind text not null default 'manual'
    check (source_kind in ('manual', 'fee_ledger', 'payroll_payment', 'reversal')),
  source_id uuid,
  reverses_voucher_id uuid references public.journal_vouchers(id) on delete restrict,
  posted_at timestamptz,
  posted_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint journal_vouchers_posted_chk check (
    (status = 'posted') = (posted_at is not null)
  ),
  -- A number is allocated at post, so a discarded draft never burns one.
  constraint journal_vouchers_number_chk check (
    (status = 'draft') = (voucher_number is null)
  )
);

alter table public.journal_vouchers
  add constraint journal_vouchers_tenant_id_key unique (tenant_id, id);
alter table public.journal_vouchers
  add constraint journal_vouchers_status_key unique (tenant_id, id, status);

create index journal_vouchers_tenant_idx
  on public.journal_vouchers (tenant_id, voucher_date desc);
create index journal_vouchers_session_idx on public.journal_vouchers (session_id);
create index journal_vouchers_number_idx on public.journal_vouchers (tenant_id, voucher_number);
create unique index journal_vouchers_source_unique
  on public.journal_vouchers (tenant_id, source_kind, source_id)
  where source_id is not null and status <> 'void' and source_kind not in ('manual', 'reversal');
create unique index journal_vouchers_reversal_unique
  on public.journal_vouchers (reverses_voucher_id)
  where reverses_voucher_id is not null;

create trigger set_updated_at before update on public.journal_vouchers
  for each row execute function public.set_updated_at();
create trigger audit_journal_vouchers
  after insert or update or delete on public.journal_vouchers
  for each row execute function public.audit_row_change();

alter table public.journal_vouchers enable row level security;

create policy "finance roles manage journal_vouchers" on public.journal_vouchers
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
-- The lines
-- ---------------------------------------------------------------------------

create table public.voucher_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_id uuid not null,
  voucher_status text not null,
  account_id uuid not null,
  account_type text not null,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  narration text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- Constant true, to demand a postable account through the FK below.
  account_postable boolean not null generated always as (true) stored,

  -- Exactly one side carries a value: a line with both or neither would still
  -- let the voucher balance while meaning nothing.
  constraint voucher_lines_one_side_chk check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

alter table public.voucher_lines
  add constraint voucher_lines_voucher_fkey
  foreign key (tenant_id, voucher_id, voucher_status)
  references public.journal_vouchers (tenant_id, id, status)
  on update cascade on delete cascade;

-- A group account (is_postable=false) has no row satisfying postable_flag=true,
-- so this FK makes it unreferenceable -- the rule enforced by construction, not
-- a trigger.
alter table public.voucher_lines
  add constraint voucher_lines_account_postable_fkey
  foreign key (tenant_id, account_id, account_postable)
  references public.accounts (tenant_id, id, postable_flag);

alter table public.voucher_lines
  add constraint voucher_lines_account_type_fkey
  foreign key (tenant_id, account_id, account_type)
  references public.accounts (tenant_id, id, account_type);

create index voucher_lines_tenant_idx on public.voucher_lines (tenant_id);
create index voucher_lines_voucher_idx on public.voucher_lines (tenant_id, voucher_id, sort_order);
create index voucher_lines_account_idx on public.voucher_lines (tenant_id, account_id);

create trigger audit_voucher_lines
  after insert or update or delete on public.voucher_lines
  for each row execute function public.audit_row_change();

alter table public.voucher_lines enable row level security;

create policy "finance roles manage draft voucher_lines" on public.voucher_lines
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
    and voucher_status = 'draft'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
    and voucher_status = 'draft'
  );

create policy "finance roles view voucher_lines" on public.voucher_lines
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- ---------------------------------------------------------------------------
-- The posting map -- rules as data, per rule 12
-- ---------------------------------------------------------------------------

create table public.posting_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_key text not null,
  debit_account_id uuid not null,
  credit_account_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_postable boolean not null generated always as (true) stored,

  unique (tenant_id, event_key),
  constraint posting_rules_distinct_chk check (debit_account_id <> credit_account_id)
);

alter table public.posting_rules
  add constraint posting_rules_debit_fkey
  foreign key (tenant_id, debit_account_id, account_postable)
  references public.accounts (tenant_id, id, postable_flag);
alter table public.posting_rules
  add constraint posting_rules_credit_fkey
  foreign key (tenant_id, credit_account_id, account_postable)
  references public.accounts (tenant_id, id, postable_flag);

create index posting_rules_tenant_idx on public.posting_rules (tenant_id);

create trigger set_updated_at before update on public.posting_rules
  for each row execute function public.set_updated_at();
create trigger audit_posting_rules
  after insert or update or delete on public.posting_rules
  for each row execute function public.audit_row_change();

alter table public.posting_rules enable row level security;

create policy "finance roles manage posting_rules" on public.posting_rules
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- Voucher numbers join the gapless counter the fees module already owns.
alter table public.document_sequences drop constraint document_sequences_kind_check;
alter table public.document_sequences
  add constraint document_sequences_kind_check check (kind in ('receipt', 'invoice', 'voucher'));
