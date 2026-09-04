-- ---------------------------------------------------------------------------
-- Instalments — the missing concept in fee billing
--
-- `fee_structures.frequency` has been stored, displayed and never acted on
-- since migration 0021. Its own comment was honest about it: *"generating the
-- recurring instalments on a schedule is a jobs concern and is not built; today
-- an invoice is raised deliberately, for the heads chosen."*
--
-- The escape hatch was `p_fee_head_ids` — a clerk ticks which heads to bill.
-- That works exactly as long as the clerk ticks correctly every month, and it
-- leaves two real problems:
--
--   1. **A school invoicing monthly re-bills its annual heads twelve times**
--      unless somebody remembers not to. Nothing in the database objects.
--   2. **Nothing records which period an invoice was for**, so the guard
--      against double-billing is a due-date comparison — and 0022's own comment
--      calls billing the same student twice for one due date *"almost always a
--      mistake"*, which is a heuristic, not a rule.
--
-- The missing concept is the **billing period**. Once an invoice knows which
-- period it is for, "what does this period collect" becomes data (rule 12) and
-- "have we already billed this period" becomes a unique index instead of a
-- guess.
-- ---------------------------------------------------------------------------

create table public.fee_instalments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  -- What the school calls it: "July", "Term 1", "First instalment".
  name text not null,
  -- Order within the year. Not derived from the due date, because a school may
  -- reorder or insert a period and the sequence is what people argue about.
  sequence integer not null check (sequence > 0),
  due_date date not null,
  -- The period the instalment covers, used to decide which transport
  -- arrangements were live during it. Null means "no particular window", which
  -- is a legitimate configuration for a one-off charge.
  period_start date,
  period_end date,

  -- **Which frequencies this period collects.** This is the rule-as-data, and
  -- it is deliberately explicit rather than inferred from the sequence number.
  -- Inference needs to know the cadence ("is instalment 4 a quarter boundary?")
  -- and gets it wrong for every school that bills ten months, or two terms, or
  -- monthly-except-December. A school says what July collects; nothing guesses.
  collects text[] not null default array['monthly']::text[],

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, session_id, sequence),
  unique (tenant_id, session_id, name),

  constraint fee_instalments_period_chk
    check (period_end is null or period_start is null or period_end >= period_start),

  -- An empty `collects` is a period that bills nothing, which is a mistake
  -- rather than a configuration; and every entry has to be a frequency
  -- `fee_structures` can actually carry.
  constraint fee_instalments_collects_chk check (
    array_length(collects, 1) >= 1
    and collects <@ array['one_time', 'monthly', 'quarterly', 'annual']::text[]
  )
);

alter table public.fee_instalments
  add constraint fee_instalments_tenant_id_key unique (tenant_id, id);

create index fee_instalments_tenant_idx on public.fee_instalments (tenant_id);
create index fee_instalments_session_idx
  on public.fee_instalments (tenant_id, session_id, sequence);

create trigger set_updated_at before update on public.fee_instalments
  for each row execute function public.set_updated_at();
create trigger audit_fee_instalments
  after insert or update or delete on public.fee_instalments
  for each row execute function public.audit_row_change();

alter table public.fee_instalments enable row level security;

create policy "tenant members view fee_instalments" on public.fee_instalments
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "finance roles manage fee_instalments" on public.fee_instalments
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

comment on table public.fee_instalments is
  'The school''s billing calendar for a session. `collects` says which fee frequencies each period charges -- explicit rather than inferred, because ten-month years and monthly-except-December are both real.';
comment on column public.fee_instalments.collects is
  'Which values of fee_structures.frequency this period bills. A July row typically collects {monthly, annual, one_time}; an August row only {monthly}.';

-- ---------------------------------------------------------------------------
-- An invoice knows its period
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column instalment_id uuid;

alter table public.invoices
  add constraint invoices_instalment_fkey
  foreign key (tenant_id, instalment_id)
  references public.fee_instalments (tenant_id, id) on delete restrict;

create index invoices_instalment_idx on public.invoices (tenant_id, instalment_id);

-- **This is what replaces the due-date heuristic.** One issued invoice per
-- student per period, enforced rather than assumed, so re-running a month's
-- billing after a timeout converges instead of raising a second bill.
--
-- Partial on `issued`: a cancelled invoice must not block re-billing the
-- period, which is exactly what cancelling is for. And partial on
-- `instalment_id is not null`, so the ad-hoc charges the counter raises — which
-- genuinely have no period — are untouched.
create unique index invoices_one_per_instalment
  on public.invoices (tenant_id, session_id, student_id, instalment_id)
  where instalment_id is not null and status = 'issued';

comment on column public.invoices.instalment_id is
  'Which billing period this invoice is for. Null for an ad-hoc charge raised at the counter. When set, a partial unique index makes a second issued invoice for the same student and period impossible.';
