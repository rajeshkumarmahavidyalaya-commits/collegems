-- 0186 — A receipt belongs to the year it settles.
--
-- `fees_record_payment` takes an optional `p_invoice_id`, checks that the
-- invoice belongs to the student and is issued, and then stamps the entry with
-- `current_session_id()`. It never compares the two.
--
-- Probed, on the demo school, with the year turned over:
--
--     invoice IN-2025-00001 is in session 2025-2026;
--     the receipt landed in session 2026-2027 (RC-2026-00001).
--
-- One row, two wrong numbers, and both of them money:
--
--   * `fees_student_balances` is bound to the current session, so the payment
--     is counted against **2026-2027** — this year's dues drop by money that
--     paid last year's bill, and a family looks squarer with the school than it
--     is;
--   * and it is *not* counted against 2025-2026, so the invoice it names stays
--     outstanding **for ever**. There is no way to clear it: every subsequent
--     attempt lands in the current year too.
--
-- The online path already had this right. `fees_settle_gateway_payment` takes
-- the session from the payment intent and numbers the receipt with
-- `fees_next_document_number_for(tenant, intent.session, 'receipt')`. The
-- counter — the screen a bursar actually stands at — did not.
--
-- ---------------------------------------------------------------------------
-- What `session_id` on a ledger entry means
--
-- This is the decision the bug came from, so it is written down rather than
-- left to be inferred:
--
-- > **`session_id` is which year's account this entry moves. `occurred_at` is
-- > when the money crossed the counter.** They are different questions and a
-- > row answers both.
--
-- Arrears collected in July 2026 against a 2025-26 bill are a 2025-26
-- collection that happened on a July day. The subledger must see it in
-- 2025-26 or the debt never closes; the cash book must see it on that July day
-- or the till does not balance. Both are satisfiable at once, and were not.
--
-- ---------------------------------------------------------------------------
-- The constraint first, because a rule enforced only in a function is a rule
--
-- The composite-key device (rule 4), carrying an **identity**: the invoice's
-- own year, held on the entry, so "this receipt is in the invoice's year" is a
-- foreign key rather than something four writers have to remember.
--
-- Deliberately **without** `on update cascade`. Everywhere else in this schema
-- the cascade keeps a copy in step; here it would silently move money between
-- years. Changing an invoice's session after money has been received against
-- it is not a correction — it is a different invoice — and the refusal is the
-- right answer.
--
-- MATCH SIMPLE means the key is skipped entirely when `invoice_id` is null, so
-- an on-account payment with no invoice is untouched and stays in the year it
-- was taken in.

alter table public.invoices
  add constraint invoices_session_key unique (tenant_id, id, session_id);

comment on constraint invoices_session_key on public.invoices is
  'The target of the session-carrying foreign keys in migration 0186: a ledger '
  'entry or a payment intent that names an invoice must be in that invoice''s '
  'academic year.';

-- Replaced rather than added alongside: the new key implies the old one, and
-- two constraints saying overlapping things is where one of them stops being
-- read. `on delete restrict` is carried across unchanged -- an invoice with
-- money against it cannot be deleted.
alter table public.ledger_entries
  drop constraint ledger_entries_invoice_id_fkey;

alter table public.ledger_entries
  add constraint ledger_entries_invoice_id_fkey
  foreign key (tenant_id, invoice_id, session_id)
  references public.invoices (tenant_id, id, session_id)
  on delete restrict;

alter table public.payment_intents
  drop constraint payment_intents_invoice_id_fkey;

alter table public.payment_intents
  add constraint payment_intents_invoice_id_fkey
  foreign key (tenant_id, invoice_id, session_id)
  references public.invoices (tenant_id, id, session_id)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- The counter
--
-- Two changes, and the second is the one that makes arrears collectable at all:
-- the session and the receipt number both come from the invoice when there is
-- one. A receipt numbered RC-2025-00042 taken on a July 2026 morning says
-- exactly what it is — a 2025-26 collection — and appending to that year's
-- gapless book is not a gap in it.
-- ---------------------------------------------------------------------------

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
  v_invoice record;
  v_entry public.ledger_entries;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A payment must be a positive amount';
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
    select i.session_id, i.invoice_number, s.name as session_name
    into v_invoice
    from public.invoices i
    join public.academic_sessions s on s.id = i.session_id
    where i.id = p_invoice_id and i.tenant_id = v_tenant_id
      and i.student_id = p_student_id and i.status = 'issued';

    if v_invoice.session_id is null then
      raise exception 'That invoice does not belong to this student, or is cancelled';
    end if;

    -- The year this settles, not the year we happen to be in. See the header.
    v_session_id := v_invoice.session_id;
  else
    -- Money on account belongs to the year it is taken in, because there is no
    -- invoice to say otherwise.
    v_session_id := public.current_session_id(v_tenant_id);
    if v_session_id is null then
      raise exception 'No current academic session for this tenant';
    end if;
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    occurred_at, receipt_number, method, reference, note,
    provider, provider_event_id, recorded_by
  ) values (
    v_tenant_id, v_session_id, p_student_id, p_invoice_id, 'payment', -p_amount,
    coalesce(p_occurred_at, now()),
    public.fees_next_document_number_for(v_tenant_id, v_session_id, 'receipt'),
    p_method, nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    p_provider, p_provider_event_id, auth.uid()
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.fees_record_payment(uuid, numeric, text, timestamptz, text, uuid, text, text, text) from public, anon;
grant execute on function public.fees_record_payment(uuid, numeric, text, timestamptz, text, uuid, text, text, text) to authenticated;

-- A discount, a fine or a write-off against a named invoice is the same
-- question with no cash in it: written in this year, it would reduce this
-- year's dues for a bill raised in another one.
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
  if not exists (
    select 1 from public.students
    where id = p_student_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Student not found';
  end if;

  if p_invoice_id is not null then
    select i.session_id into v_session_id
    from public.invoices i
    where i.id = p_invoice_id and i.tenant_id = v_tenant_id
      and i.student_id = p_student_id and i.status = 'issued';

    if v_session_id is null then
      raise exception 'That invoice does not belong to this student, or is cancelled';
    end if;
  else
    v_session_id := public.current_session_id(v_tenant_id);
    if v_session_id is null then
      raise exception 'No current academic session for this tenant';
    end if;
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

revoke all on function public.fees_record_adjustment(uuid, text, numeric, text, uuid) from public, anon;
grant execute on function public.fees_record_adjustment(uuid, text, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The day book asks a date question
--
-- It filtered on `session_id = current_session_id()` *and* a date range. The
-- date range is the question — "what crossed the counter between these two
-- days" — and the session filter was a second, weaker answer to it that
-- happened to agree only because every entry was stamped with the year it was
-- taken in.
--
-- Now that an arrears receipt is stamped with the year it settles, keeping the
-- filter would hide it from the till it was actually taken at. Dropping it is
-- not a loosening: `occurred_at` is bounded, `tenant_id` is bounded, and RLS
-- is unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.fees_day_book(
  p_from date,
  p_to date
)
returns table (
  id uuid,
  occurred_at timestamptz,
  entry_type text,
  receipt_number text,
  method text,
  reference text,
  note text,
  amount numeric,
  student_id uuid,
  student_name text,
  admission_number text,
  is_reversal boolean,
  is_reversed boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with ctx as (
    select t.id as tenant_id, t.timezone
    from public.tenants t
    where t.id = public.current_tenant_id()
  ),
  bounds as (
    select
      (p_from::timestamp at time zone ctx.timezone) as from_ts,
      ((p_to + 1)::timestamp at time zone ctx.timezone) as to_ts
    from ctx
  )
  select
    le.id,
    le.occurred_at,
    le.entry_type,
    le.receipt_number,
    le.method,
    le.reference,
    le.note,
    le.amount,
    le.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    s.admission_number,
    (le.reverses_entry_id is not null),
    exists (
      select 1 from public.ledger_entries r where r.reverses_entry_id = le.id
    )
  from public.ledger_entries le
  join public.students s on s.id = le.student_id
  join public.people p on p.id = s.person_id
  cross join ctx
  cross join bounds
  where le.tenant_id = ctx.tenant_id
    -- Only money that actually crossed the counter. A discount changes what a
    -- family owes but nothing left the drawer, so including it would make
    -- these totals disagree with the cash.
    and le.entry_type in ('payment', 'refund')
    and le.occurred_at >= bounds.from_ts
    and le.occurred_at < bounds.to_ts
  order by le.occurred_at desc
$$;

revoke all on function public.fees_day_book(date, date) from public, anon;
grant execute on function public.fees_day_book(date, date) to authenticated;

comment on function public.fees_day_book(date, date) is
  'What crossed the counter between two dates. A date question, so it is '
  'answered with dates -- an arrears receipt settling a previous year appears '
  'on the day it was taken (migration 0186).';

-- ---------------------------------------------------------------------------
-- The online path
--
-- `fees_settle_gateway_payment` already took its session from the intent, so
-- the fix belongs one step earlier: an intent for last year's invoice must be
-- an intent in last year's account, or the receipt it eventually writes lands
-- in the wrong one. The new foreign key on `payment_intents` refuses it
-- anyway; this is the sentence a parent would otherwise never see.
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

  if p_invoice_id is not null then
    -- The year this settles, exactly as at the counter (migration 0186).
    select i.session_id into v_session_id
    from public.invoices i
    where i.id = p_invoice_id and i.tenant_id = v_tenant_id
      and i.student_id = p_student_id and i.status = 'issued';

    if v_session_id is null then
      raise exception 'That invoice does not belong to this student, or is cancelled';
    end if;
  else
    v_session_id := public.current_session_id(v_tenant_id);
    if v_session_id is null then
      raise exception 'No current academic session for this tenant';
    end if;
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
