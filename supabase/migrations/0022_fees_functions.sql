-- Fees: the write paths and the balance query.
--
-- All SECURITY INVOKER (the default), so every one of these still runs under
-- the caller's RLS policies -- they add atomicity and correctness, never
-- access. All pin `search_path = public, extensions`, for the same reason
-- migration 0018 had to.

-- ---------------------------------------------------------------------------
-- Gapless numbering
-- ---------------------------------------------------------------------------

-- Consumes one number from the tenant's per-session counter and returns it
-- formatted. The UPDATE takes a row lock, so concurrent cash-desk receipts
-- serialise; and because the counter is an ordinary row, a transaction that
-- rolls back returns its number to the pool. That is exactly what a Postgres
-- sequence will not do, and exactly what "gapless" requires.
create or replace function public.fees_next_document_number(p_kind text)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_prefix text;
  v_value bigint;
  v_year text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_kind not in ('receipt', 'invoice') then
    raise exception 'Unknown document kind: %', p_kind;
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  -- Created on first use, so nothing has to seed a counter per tenant per year.
  insert into public.document_sequences (tenant_id, session_id, kind, prefix)
  values (v_tenant_id, v_session_id, p_kind,
          case p_kind when 'receipt' then 'RC' else 'IN' end)
  on conflict (tenant_id, session_id, kind) do nothing;

  update public.document_sequences
     set next_value = next_value + 1
   where tenant_id = v_tenant_id and session_id = v_session_id and kind = p_kind
  returning prefix, next_value - 1 into v_prefix, v_value;

  if v_value is null then
    raise exception 'Could not allocate a % number', p_kind;
  end if;

  select to_char(start_date, 'YYYY') into v_year
  from public.academic_sessions where id = v_session_id;

  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Raising charges
-- ---------------------------------------------------------------------------

-- One invoice for one student, from the fee structure of the class they are
-- enrolled in. Header and lines in one statement pair: if there is nothing to
-- bill, the exception rolls back the header *and* releases the invoice number.
create or replace function public.fees_generate_invoice(
  p_student_id uuid,
  p_due_date date,
  p_fee_head_ids uuid[] default null,
  p_notes text default null
)
returns public.invoices
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_class_level_id uuid;
  v_invoice public.invoices;
  v_lines integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_due_date is null then
    raise exception 'An invoice needs a due date';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  select cl.id into v_class_level_id
  from public.enrolments e
  join public.sections s on s.id = e.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  where e.student_id = p_student_id
    and e.tenant_id = v_tenant_id
    and e.session_id = v_session_id
    and e.status = 'active';

  if v_class_level_id is null then
    raise exception 'That student is not enrolled in a class for the current session';
  end if;

  -- A double-submitted form should not double-bill a family. Billing the same
  -- student twice for the same due date is almost always a mistake; a genuine
  -- second instalment carries a different due date.
  if exists (
    select 1 from public.invoices
    where tenant_id = v_tenant_id and session_id = v_session_id
      and student_id = p_student_id and due_date = p_due_date and status = 'issued'
  ) then
    raise exception 'This student already has an invoice due on %', p_due_date;
  end if;

  insert into public.invoices
    (tenant_id, session_id, student_id, invoice_number, due_date, notes, issued_by)
  values
    (v_tenant_id, v_session_id, p_student_id,
     public.fees_next_document_number('invoice'), p_due_date,
     nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_invoice;

  insert into public.invoice_lines
    (tenant_id, session_id, invoice_id, fee_head_id, description, amount)
  select v_tenant_id, v_session_id, v_invoice.id, fs.fee_head_id, fh.name, fs.amount
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  where fs.tenant_id = v_tenant_id
    and fs.session_id = v_session_id
    and fs.class_level_id = v_class_level_id
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids));

  get diagnostics v_lines = row_count;
  if v_lines = 0 then
    raise exception 'No fee structure is set for this class, so there is nothing to bill';
  end if;

  return v_invoice;
end;
$$;

-- Bill a whole section in one transaction, skipping students who already have
-- an invoice for that due date -- so re-running after a half-finished attempt
-- tops up rather than double-billing.
--
-- Bounded on purpose: a section is ~40 students. Billing an entire school
-- belongs in `jobs` (rule 7) and is not built.
create or replace function public.fees_generate_section_invoices(
  p_section_id uuid,
  p_due_date date,
  p_fee_head_ids uuid[] default null
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_class_level_id uuid;
  v_student record;
  v_created integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  select cl.id into v_class_level_id
  from public.sections s
  join public.class_levels cl on cl.id = s.class_level_id
  where s.id = p_section_id and s.tenant_id = v_tenant_id;

  if v_class_level_id is null then
    raise exception 'Section not found';
  end if;

  -- Checked once, up front: every student in a section shares a class level,
  -- so either all of them are billable or none are. Finding out per student
  -- would abort the batch halfway.
  if not exists (
    select 1 from public.fee_structures fs
    join public.fee_heads fh on fh.id = fs.fee_head_id
    where fs.tenant_id = v_tenant_id
      and fs.session_id = v_session_id
      and fs.class_level_id = v_class_level_id
      and fh.is_active
      and fs.amount > 0
      and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))
  ) then
    raise exception 'No fee structure is set for this class, so there is nothing to bill';
  end if;

  for v_student in
    select e.student_id
    from public.enrolments e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.section_id = p_section_id
      and e.status = 'active'
      and not exists (
        select 1 from public.invoices i
        where i.tenant_id = v_tenant_id and i.session_id = v_session_id
          and i.student_id = e.student_id and i.due_date = p_due_date
          and i.status = 'issued'
      )
  loop
    perform public.fees_generate_invoice(
      v_student.student_id, p_due_date, p_fee_head_ids, null);
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

-- Cancelling is the one state change allowed on the charges side, and only
-- while no money has been recorded against the invoice. Once it has, the
-- correction is a reversing ledger entry, not a rewrite of the bill.
create or replace function public.fees_cancel_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns public.invoices
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_invoice public.invoices;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Cancelling an invoice needs a reason';
  end if;

  select * into v_invoice from public.invoices
  where id = p_invoice_id and tenant_id = v_tenant_id
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'That invoice is already cancelled';
  end if;
  if exists (select 1 from public.ledger_entries where invoice_id = p_invoice_id) then
    raise exception 'Money has been recorded against this invoice. Reverse those entries first.';
  end if;

  update public.invoices
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = trim(p_reason)
   where id = p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

-- Amounts arrive positive, the way a person types them at a cash desk, and are
-- signed here to match the ledger convention. Doing it the other way -- asking
-- the caller for a negative number -- is how sign bugs get into money.
create or replace function public.fees_record_payment(
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz default now(),
  p_reference text default null,
  p_invoice_id uuid default null,
  p_note text default null,
  p_provider text default null,
  p_provider_event_id text default null
)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_entry public.ledger_entries;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment must be a positive amount';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  -- Webhook idempotency, checked BEFORE a receipt number is allocated: a
  -- redelivered gateway event must return the original receipt, not consume
  -- a second number and leave a gap in the book.
  if p_provider_event_id is not null then
    select * into v_entry from public.ledger_entries
    where tenant_id = v_tenant_id
      and provider is not distinct from p_provider
      and provider_event_id = p_provider_event_id;

    if v_entry.id is not null then
      return v_entry;
    end if;
  end if;

  if p_invoice_id is not null then
    if not exists (
      select 1 from public.invoices
      where id = p_invoice_id and tenant_id = v_tenant_id
        and student_id = p_student_id and status = 'issued'
    ) then
      raise exception 'That invoice does not belong to this student, or is cancelled';
    end if;
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    occurred_at, receipt_number, method, reference, note,
    provider, provider_event_id, recorded_by
  ) values (
    v_tenant_id, v_session_id, p_student_id, p_invoice_id, 'payment', -p_amount,
    coalesce(p_occurred_at, now()), public.fees_next_document_number('receipt'),
    p_method, nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    p_provider, p_provider_event_id, auth.uid()
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Money going back out. Gets a document number from the same per-session
-- counter as receipts, so every movement of actual cash has one.
create or replace function public.fees_record_refund(
  p_student_id uuid,
  p_amount numeric,
  p_method text,
  p_occurred_at timestamptz default now(),
  p_reference text default null,
  p_note text default null
)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_entry public.ledger_entries;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A refund must be a positive amount';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, entry_type, amount,
    occurred_at, receipt_number, method, reference, note, recorded_by
  ) values (
    v_tenant_id, v_session_id, p_student_id, 'refund', p_amount,
    coalesce(p_occurred_at, now()), public.fees_next_document_number('receipt'),
    p_method, nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Discounts, fines and write-offs: no cash moves, so no method and no receipt
-- number. A fine increases what is owed; the other two reduce it.
create or replace function public.fees_record_adjustment(
  p_student_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_note text,
  p_invoice_id uuid default null
)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_entry public.ledger_entries;
  v_signed numeric;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_entry_type not in ('discount', 'fine', 'write_off') then
    raise exception 'Not an adjustment type: %', p_entry_type;
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'An adjustment must be a positive amount';
  end if;
  if p_note is null or trim(p_note) = '' then
    raise exception 'An adjustment needs a reason';
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

  v_signed := case when p_entry_type = 'fine' then p_amount else -p_amount end;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    occurred_at, note, recorded_by
  ) values (
    v_tenant_id, v_session_id, p_student_id, p_invoice_id, p_entry_type, v_signed,
    now(), trim(p_note), auth.uid()
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

-- The only way to undo anything in this module: a new row that mirrors the old
-- one and points at it. The original is never touched, so the audit trail
-- shows both what was booked and that it was cancelled.
--
-- A reversal carries no receipt number of its own -- it is not a fresh cash
-- movement, it is the cancellation of one, and it names the receipt it
-- cancels through `reverses_entry_id`.
create or replace function public.fees_reverse_entry(
  p_entry_id uuid,
  p_reason text
)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_original public.ledger_entries;
  v_reversal public.ledger_entries;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reversal needs a reason';
  end if;

  select * into v_original from public.ledger_entries
  where id = p_entry_id and tenant_id = v_tenant_id
  for update;

  if v_original.id is null then
    raise exception 'Entry not found';
  end if;
  if v_original.reverses_entry_id is not null then
    raise exception 'That entry is itself a reversal, so it cannot be reversed';
  end if;
  if exists (select 1 from public.ledger_entries where reverses_entry_id = p_entry_id) then
    raise exception 'That entry has already been reversed';
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    occurred_at, method, reference, note, reverses_entry_id, recorded_by
  ) values (
    v_original.tenant_id, v_original.session_id, v_original.student_id,
    v_original.invoice_id, v_original.entry_type, -v_original.amount,
    now(), v_original.method, v_original.reference,
    'Reversal: ' || trim(p_reason), v_original.id, auth.uid()
  )
  returning * into v_reversal;

  return v_reversal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- One row per enrolled student, reconciling to:
--   balance = charged + fines - discounts - write_offs - paid + refunds
--
-- Reversals need no special handling: a reversed payment is a negative and a
-- positive entry of the same type, so the SUMs net to zero on their own.
--
-- SECURITY INVOKER (the default), so a parent calling this sees only their own
-- children -- the same policies that guard the tables guard this.
create or replace function public.fees_student_balances(
  p_section_id uuid default null,
  p_only_outstanding boolean default false
)
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  section_label text,
  roll_number text,
  charged numeric,
  fines numeric,
  discounts numeric,
  write_offs numeric,
  paid numeric,
  refunds numeric,
  balance numeric,
  last_payment_at timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  with ctx as (
    select public.current_tenant_id() as tenant_id,
           public.current_session_id(public.current_tenant_id()) as session_id
  ),
  roster as (
    select
      s.id as student_id,
      s.admission_number,
      p.first_name || ' ' || p.last_name as full_name,
      cl.name || ' · ' || sec.name as section_label,
      e.roll_number
    from public.enrolments e
    join public.students s on s.id = e.student_id
    join public.people p on p.id = s.person_id
    join public.sections sec on sec.id = e.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    cross join ctx
    where e.tenant_id = ctx.tenant_id
      and e.session_id = ctx.session_id
      and e.status = 'active'
      and (p_section_id is null or e.section_id = p_section_id)
  ),
  charges as (
    select i.student_id, sum(l.amount) as charged
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    cross join ctx
    where i.tenant_id = ctx.tenant_id
      and i.session_id = ctx.session_id
      and i.status = 'issued'
    group by i.student_id
  ),
  movements as (
    select
      le.student_id,
      coalesce(-sum(le.amount) filter (where le.entry_type = 'payment'), 0) as paid,
      coalesce(-sum(le.amount) filter (where le.entry_type = 'discount'), 0) as discounts,
      coalesce(-sum(le.amount) filter (where le.entry_type = 'write_off'), 0) as write_offs,
      coalesce(sum(le.amount) filter (where le.entry_type = 'fine'), 0) as fines,
      coalesce(sum(le.amount) filter (where le.entry_type = 'refund'), 0) as refunds,
      sum(le.amount) as net,
      max(le.occurred_at) filter (
        where le.entry_type = 'payment' and le.reverses_entry_id is null
      ) as last_payment_at
    from public.ledger_entries le
    cross join ctx
    where le.tenant_id = ctx.tenant_id
      and le.session_id = ctx.session_id
    group by le.student_id
  )
  select
    r.student_id,
    r.admission_number,
    r.full_name,
    r.section_label,
    r.roll_number,
    coalesce(c.charged, 0)::numeric,
    coalesce(m.fines, 0)::numeric,
    coalesce(m.discounts, 0)::numeric,
    coalesce(m.write_offs, 0)::numeric,
    coalesce(m.paid, 0)::numeric,
    coalesce(m.refunds, 0)::numeric,
    (coalesce(c.charged, 0) + coalesce(m.net, 0))::numeric,
    m.last_payment_at
  from roster r
  left join charges c on c.student_id = r.student_id
  left join movements m on m.student_id = r.student_id
  where not p_only_outstanding
     or (coalesce(c.charged, 0) + coalesce(m.net, 0)) > 0
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.fees_next_document_number(text) from public, anon;
revoke all on function public.fees_generate_invoice(uuid, date, uuid[], text) from public, anon;
revoke all on function public.fees_generate_section_invoices(uuid, date, uuid[]) from public, anon;
revoke all on function public.fees_cancel_invoice(uuid, text) from public, anon;
revoke all on function public.fees_record_payment(uuid, numeric, text, timestamptz, text, uuid, text, text, text) from public, anon;
revoke all on function public.fees_record_refund(uuid, numeric, text, timestamptz, text, text) from public, anon;
revoke all on function public.fees_record_adjustment(uuid, text, numeric, text, uuid) from public, anon;
revoke all on function public.fees_reverse_entry(uuid, text) from public, anon;
revoke all on function public.fees_student_balances(uuid, boolean) from public, anon;

grant execute on function public.fees_next_document_number(text) to authenticated;
grant execute on function public.fees_generate_invoice(uuid, date, uuid[], text) to authenticated;
grant execute on function public.fees_generate_section_invoices(uuid, date, uuid[]) to authenticated;
grant execute on function public.fees_cancel_invoice(uuid, text) to authenticated;
grant execute on function public.fees_record_payment(uuid, numeric, text, timestamptz, text, uuid, text, text, text) to authenticated;
grant execute on function public.fees_record_refund(uuid, numeric, text, timestamptz, text, text) to authenticated;
grant execute on function public.fees_record_adjustment(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.fees_reverse_entry(uuid, text) to authenticated;
grant execute on function public.fees_student_balances(uuid, boolean) to authenticated;
