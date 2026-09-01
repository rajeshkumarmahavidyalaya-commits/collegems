-- Online payments through Razorpay, and the queue for invoice emails.
--
-- The money half is complete and enforced here. The mail half is deliberately
-- a queue with no sender attached: invoice emails are enqueued in `jobs` and
-- nothing consumes them, because sending was held back. Wiring a provider is a
-- consumer of this queue, not a change to it.
--
-- HOW A GATEWAY PAYMENT REACHES THE LEDGER
--
--   app        fees_create_payment_intent()      -> payment_intents (created)
--   edge fn    razorpay-create-link              -> provider_order_id, payment_url
--   family     pays on Razorpay's page
--   razorpay   POST webhook (signed)
--   edge fn    razorpay-webhook, verifies HMAC   -> fees_settle_gateway_payment()
--   ledger     one `payment` entry, one receipt number
--
-- The intent exists so the webhook can answer "who paid, and how much were
-- they supposed to pay" from a row this system wrote, rather than trusting
-- anything in the callback body beyond the order id.
--
-- WHY ONE FUNCTION HERE IS SECURITY DEFINER
--
-- Every other function in this module is INVOKER, because a user is present
-- and their policies should decide. A webhook has no user: there is no JWT, so
-- `current_tenant_id()` is null and the invoker functions cannot run at all.
-- `fees_settle_gateway_payment` is therefore DEFINER, and narrowed to
-- compensate -- it settles an existing intent and nothing else, deriving the
-- tenant, session, student and expected amount from that intent rather than
-- from its arguments, and it is revoked from every role a person could hold.
-- Only the service role, which the Edge Function uses, can execute it.

-- ---------------------------------------------------------------------------
-- Document numbering, split so both paths share one implementation
-- ---------------------------------------------------------------------------

-- The webhook cannot use `fees_next_document_number()` -- that resolves the
-- tenant from a JWT which does not exist. Rather than let the settle function
-- carry a second copy of the gapless-counter logic (a receipt series with two
-- implementations is a receipt series waiting to collide), the real work moves
-- into a tenant-explicit function and the original becomes a thin wrapper.
create or replace function public.fees_next_document_number_for(
  p_tenant_id uuid,
  p_session_id uuid,
  p_kind text
)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_prefix text;
  v_value bigint;
  v_year text;
begin
  if p_kind not in ('receipt', 'invoice') then
    raise exception 'Unknown document kind: %', p_kind;
  end if;
  if p_tenant_id is null or p_session_id is null then
    raise exception 'A document number needs a tenant and a session';
  end if;

  insert into public.document_sequences (tenant_id, session_id, kind, prefix)
  values (p_tenant_id, p_session_id, p_kind,
          case p_kind when 'receipt' then 'RC' else 'IN' end)
  on conflict (tenant_id, session_id, kind) do nothing;

  update public.document_sequences
     set next_value = next_value + 1
   where tenant_id = p_tenant_id and session_id = p_session_id and kind = p_kind
  returning prefix, next_value - 1 into v_prefix, v_value;

  if v_value is null then
    raise exception 'Could not allocate a % number', p_kind;
  end if;

  select to_char(start_date, 'YYYY') into v_year
  from public.academic_sessions where id = p_session_id;

  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, 5, '0');
end;
$$;

create or replace function public.fees_next_document_number(p_kind text)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  return public.fees_next_document_number_for(v_tenant_id, v_session_id, p_kind);
end;
$$;

revoke all on function public.fees_next_document_number_for(uuid, uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- Payment intents
-- ---------------------------------------------------------------------------

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null,
  invoice_id uuid,
  amount numeric(12, 2) not null check (amount > 0),
  provider text not null default 'razorpay',
  provider_order_id text,
  payment_url text,
  status text not null default 'created'
    check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
  expires_at timestamptz,
  -- Set when the webhook settles it, so an intent can never be settled twice
  -- into two different ledger rows.
  ledger_entry_id uuid references public.ledger_entries(id) on delete restrict,
  failure_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite, for the reason set out in migration 0024: foreign key checks
  -- are not subject to RLS, so a single-column reference would accept another
  -- tenant's student.
  constraint payment_intents_student_id_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint payment_intents_invoice_id_fkey
    foreign key (tenant_id, invoice_id)
    references public.invoices (tenant_id, id) on delete restrict
);

-- One intent per gateway order, so a redelivered callback resolves to the same
-- row rather than creating a second.
create unique index payment_intents_provider_order_unique
  on public.payment_intents (tenant_id, provider, provider_order_id)
  where provider_order_id is not null;

create index payment_intents_tenant_idx on public.payment_intents (tenant_id);
create index payment_intents_student_idx
  on public.payment_intents (tenant_id, session_id, student_id);
create index payment_intents_open_idx
  on public.payment_intents (tenant_id, status) where status in ('created', 'pending');
create index payment_intents_session_idx on public.payment_intents (session_id);
create index payment_intents_tenant_invoice_idx
  on public.payment_intents (tenant_id, invoice_id) where invoice_id is not null;
create index payment_intents_ledger_entry_idx on public.payment_intents (ledger_entry_id);
create index payment_intents_created_by_idx on public.payment_intents (created_by);

create trigger set_updated_at before update on public.payment_intents
  for each row execute function public.set_updated_at();
create trigger audit_payment_intents
  after insert or update or delete on public.payment_intents
  for each row execute function public.audit_row_change();

alter table public.payment_intents enable row level security;

create policy "finance roles manage payment_intents" on public.payment_intents
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "students view own payment_intents" on public.payment_intents
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children payment_intents" on public.payment_intents
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

-- ---------------------------------------------------------------------------
-- Creating an intent (a person is present -- INVOKER)
-- ---------------------------------------------------------------------------

create or replace function public.fees_create_payment_intent(
  p_student_id uuid,
  p_amount numeric,
  p_invoice_id uuid default null
)
returns public.payment_intents
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_intent public.payment_intents;
  v_enabled boolean;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment link must be for a positive amount';
  end if;

  select coalesce((s.value ->> 'enabled')::boolean, false) into v_enabled
  from public.settings s
  where s.tenant_id = v_tenant_id and s.key = 'fees.online_payments';

  if not coalesce(v_enabled, false) then
    raise exception 'Online payments are switched off for this school';
  end if;

  if not exists (
    select 1 from public.students where id = p_student_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Student not found';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if p_invoice_id is not null and not exists (
    select 1 from public.invoices
    where id = p_invoice_id and tenant_id = v_tenant_id
      and student_id = p_student_id and status = 'issued'
  ) then
    raise exception 'That invoice does not belong to this student, or is cancelled';
  end if;

  insert into public.payment_intents
    (tenant_id, session_id, student_id, invoice_id, amount, created_by)
  values
    (v_tenant_id, v_session_id, p_student_id, p_invoice_id, p_amount, auth.uid())
  returning * into v_intent;

  return v_intent;
end;
$$;

revoke all on function public.fees_create_payment_intent(uuid, numeric, uuid) from public, anon;
grant execute on function public.fees_create_payment_intent(uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settling one (no person present -- DEFINER, and narrowed to compensate)
-- ---------------------------------------------------------------------------

create or replace function public.fees_settle_gateway_payment(
  p_provider text,
  p_provider_order_id text,
  p_provider_event_id text,
  p_amount numeric,
  p_method text default 'online',
  p_reference text default null
)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_intent public.payment_intents;
  v_entry public.ledger_entries;
begin
  if p_provider_event_id is null or trim(p_provider_event_id) = '' then
    raise exception 'A gateway payment needs the provider event id -- it is the idempotency key';
  end if;

  select * into v_intent from public.payment_intents
  where provider = p_provider and provider_order_id = p_provider_order_id
  for update;

  if v_intent.id is null then
    raise exception 'No payment intent for % order %', p_provider, p_provider_order_id;
  end if;

  -- Idempotent replay. Checked before a receipt number is allocated, so a
  -- redelivered webhook returns the original receipt rather than burning a
  -- number and leaving a hole in the book.
  select * into v_entry from public.ledger_entries
  where tenant_id = v_intent.tenant_id
    and provider = p_provider
    and provider_event_id = p_provider_event_id;

  if v_entry.id is not null then
    return v_entry;
  end if;

  -- The amount is taken from the intent this system wrote, and the callback's
  -- figure only has to agree with it. Nothing in the webhook body decides how
  -- much was paid.
  if p_amount is null or round(p_amount, 2) <> round(v_intent.amount, 2) then
    raise exception 'Gateway reported % but the intent was for %', p_amount, v_intent.amount;
  end if;

  if v_intent.status = 'paid' then
    raise exception 'That payment intent is already settled';
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    occurred_at, receipt_number, method, reference, note,
    provider, provider_event_id
  ) values (
    v_intent.tenant_id, v_intent.session_id, v_intent.student_id, v_intent.invoice_id,
    'payment', -v_intent.amount, now(),
    public.fees_next_document_number_for(v_intent.tenant_id, v_intent.session_id, 'receipt'),
    p_method, nullif(trim(coalesce(p_reference, '')), ''),
    'Paid online via ' || p_provider,
    p_provider, p_provider_event_id
  )
  returning * into v_entry;

  update public.payment_intents
     set status = 'paid', ledger_entry_id = v_entry.id
   where id = v_intent.id;

  return v_entry;
end;
$$;

-- Executable by the service role only. No person, in any role, can call this:
-- it is the one function in the module that does not run under the caller's
-- policies, so nothing that holds a JWT is allowed near it.
revoke all on function public.fees_settle_gateway_payment(text, text, text, numeric, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invoice email: a queue with no sender
-- ---------------------------------------------------------------------------

-- Enqueues one invoice for emailing to the address the school administrator
-- configured. Nothing consumes `jobs` of this type yet -- sending is not
-- connected -- so a queued row is a record of intent, not a promise of
-- delivery. The UI says so.
create or replace function public.fees_queue_invoice_email(p_invoice_id uuid)
returns public.jobs
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_invoice public.invoices;
  v_to text;
  v_enabled boolean;
  v_student text;
  v_admission text;
  v_total numeric;
  v_job public.jobs;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_invoice from public.invoices
  where id = p_invoice_id and tenant_id = v_tenant_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  select coalesce((s.value ->> 'enabled')::boolean, false),
         nullif(trim(coalesce(s.value ->> 'to', '')), '')
    into v_enabled, v_to
  from public.settings s
  where s.tenant_id = v_tenant_id and s.key = 'notifications.invoice_email';

  if not coalesce(v_enabled, false) or v_to is null then
    raise exception 'No billing email is configured for this school';
  end if;

  select p.first_name || ' ' || p.last_name, st.admission_number
    into v_student, v_admission
  from public.students st
  join public.people p on p.id = st.person_id
  where st.id = v_invoice.student_id;

  select coalesce(sum(l.amount), 0) into v_total
  from public.invoice_lines l where l.invoice_id = v_invoice.id;

  insert into public.jobs (tenant_id, job_type, status, payload, created_by)
  values (
    v_tenant_id, 'invoice_email', 'queued',
    jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'student_name', v_student,
      'admission_number', v_admission,
      'issue_date', v_invoice.issue_date,
      'due_date', v_invoice.due_date,
      'total', v_total,
      'to', v_to
    ),
    auth.uid()
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.fees_queue_invoice_email(uuid) from public, anon;
grant execute on function public.fees_queue_invoice_email(uuid) to authenticated;

-- Default settings rows, both off. Nothing is enabled by a migration.
insert into public.settings (tenant_id, key, value)
select t.id, 'fees.online_payments', '{"enabled": false, "provider": "razorpay"}'::jsonb
from public.tenants t
on conflict (tenant_id, key) do nothing;

insert into public.settings (tenant_id, key, value)
select t.id, 'notifications.invoice_email', '{"enabled": false, "to": null}'::jsonb
from public.tenants t
on conflict (tenant_id, key) do nothing;
