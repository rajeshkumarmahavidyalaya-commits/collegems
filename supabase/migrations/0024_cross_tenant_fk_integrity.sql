-- A Northgate accountant could book a payment against a Rajesh Kumar
-- Mahavidyalaya student.
--
-- Found by driving `fees_record_payment` as tenant B with a hardcoded tenant A
-- student id. It succeeded: the row landed in tenant B (tenant_id comes from
-- the JWT, so RLS's WITH CHECK was satisfied) while `student_id` pointed at a
-- student in tenant A. No data leaked -- the caller still cannot read that
-- student -- but the ledger is corrupted, and `on delete cascade` from
-- `students` meant deleting a tenant A student would silently delete tenant B
-- ledger rows.
--
-- The cause is that FOREIGN KEY CHECKS ARE NOT SUBJECT TO RLS. A plain
-- `references students(id)` sees every row in the table, invisible ones
-- included, so it happily accepts a foreign id.
--
-- The fix is structural, not another `if` in every function: give the parent
-- tables a `unique (tenant_id, id)` and point the children at *that* with a
-- composite foreign key. Now "the child's tenant must equal the parent's
-- tenant" is a database constraint that holds for every write path -- the RPCs,
-- a direct PostgREST insert, a future function nobody has written yet -- which
-- is what CLAUDE.md means by "isolation is enforced by Postgres, never by
-- application code".
--
-- `attendance_records` (0019) has the same shape and gets the same treatment.
-- Its RPC filtered by tenant so the hole was not reachable through the app,
-- but the constraint belongs in the schema either way.
--
-- The single-column FKs are dropped where a composite replaces them: keeping
-- both would duplicate every referential check and every cascade.

-- ---------------------------------------------------------------------------
-- Parent keys
-- ---------------------------------------------------------------------------

alter table public.students
  add constraint students_tenant_id_key unique (tenant_id, id);

alter table public.invoices
  add constraint invoices_tenant_id_key unique (tenant_id, id);

alter table public.enrolments
  add constraint enrolments_tenant_id_key unique (tenant_id, id);

-- ---------------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------------

alter table public.invoices
  drop constraint invoices_student_id_fkey;
alter table public.invoices
  add constraint invoices_student_id_fkey
  foreign key (tenant_id, student_id)
  references public.students (tenant_id, id) on delete cascade;

alter table public.invoice_lines
  drop constraint invoice_lines_invoice_id_fkey;
alter table public.invoice_lines
  add constraint invoice_lines_invoice_id_fkey
  foreign key (tenant_id, invoice_id)
  references public.invoices (tenant_id, id) on delete cascade;

alter table public.ledger_entries
  drop constraint ledger_entries_student_id_fkey;
alter table public.ledger_entries
  add constraint ledger_entries_student_id_fkey
  foreign key (tenant_id, student_id)
  references public.students (tenant_id, id) on delete cascade;

-- Kept as `restrict`: an invoice with money against it must not be deletable.
alter table public.ledger_entries
  drop constraint ledger_entries_invoice_id_fkey;
alter table public.ledger_entries
  add constraint ledger_entries_invoice_id_fkey
  foreign key (tenant_id, invoice_id)
  references public.invoices (tenant_id, id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

alter table public.attendance_records
  drop constraint attendance_records_enrolment_id_fkey;
alter table public.attendance_records
  add constraint attendance_records_enrolment_id_fkey
  foreign key (tenant_id, enrolment_id)
  references public.enrolments (tenant_id, id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Covering indexes for the new composite keys
-- ---------------------------------------------------------------------------

create index invoices_tenant_student_idx
  on public.invoices (tenant_id, student_id);
create index invoice_lines_tenant_invoice_idx
  on public.invoice_lines (tenant_id, invoice_id);
create index ledger_entries_tenant_student_idx
  on public.ledger_entries (tenant_id, student_id);
create index ledger_entries_tenant_invoice_idx
  on public.ledger_entries (tenant_id, invoice_id)
  where invoice_id is not null;
create index attendance_records_tenant_enrolment_idx
  on public.attendance_records (tenant_id, enrolment_id);

-- ---------------------------------------------------------------------------
-- A readable error instead of a raw constraint violation
-- ---------------------------------------------------------------------------

-- The composite FK above is what makes this safe; these checks only turn
-- "violates foreign key constraint ledger_entries_student_id_fkey" into
-- something an accountant can act on.

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

  if not exists (
    select 1 from public.students
    where id = p_student_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Student not found';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

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

  if not exists (
    select 1 from public.students
    where id = p_student_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Student not found';
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
