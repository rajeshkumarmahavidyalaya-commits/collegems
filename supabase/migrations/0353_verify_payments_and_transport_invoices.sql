-- 0353: a family pays by bank or UPI and the office verifies it; transport
-- invoices per child.
--
-- The reference's Verify Payments, its payment methods shown to families, and
-- its Transport Invoices screen.
--
-- 1. `fees.payment_methods`, a setting: the bank account and UPI ID a family
--    pays into. Settings are readable by every member of the college (rule
--    12), which is right here: these details exist to be given to families.
--    Nothing secret goes in it. A college that fills in neither has switched
--    the feature off, and `payment_claim_submit` says so.
--
-- 2. `payment_claims`: "I paid 4,500.00 by UPI on 3 October, reference
--    ABC123, here is the screenshot." A claim is not money. The ledger is
--    untouched until somebody in the office checks the bank statement and
--    approves it, and approving writes an ordinary receipt through
--    `fees_record_payment`, so there is one definition of a payment (rule 6).
--
--    - A family has no write policy. `payment_claim_submit` is a definer that
--      checks the child is theirs, the invoice is the child's and issued, the
--      college takes these payments, and the reference has not been sent
--      before.
--    - The office decides through `payment_claim_approve` and
--      `payment_claim_reject`, both INVOKER. The update policy mirrors the
--      ledger's own (admin, accountant), and a column grant limits what that
--      update may change to the decision. Approval runs `fees_record_payment`
--      as the caller, so the ledger's insert policy is what admits the receipt,
--      and it passes the claim's id as the provider event id: approving twice
--      returns the first receipt rather than taking the money twice.
--    - `status = 'approved'` if and only if a receipt is attached, and a
--      rejection carries its reason (CHECKs), so neither can be set by hand
--      without the other half.
--    - A proof is an object in `documents` under
--      `<tenant>/payment-proofs/<student>/`. Families may write there and
--      nowhere else in that bucket (a storage policy below).
--
-- 3. `report_transport_invoices`: one row per child with a bus seat this
--    year. Transport is billed per instalment whose `collects` includes
--    monthly (0317), so for every such period due by today that the seat
--    covers, the period is paid (its invoice nets to nothing), unpaid, or not
--    generated (no invoice for it carries the route's fee head). A college
--    that does not bill by instalment has no periods, and the billed and
--    outstanding amounts still say what the bus has cost.

begin;

-- ---------------------------------------------------------------------------
-- 1. Where a family pays

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'fees.payment_methods',
  'Bank and UPI details for families',
  'The account a family pays fees into, shown on their fee screen with a UPI '
  'QR code. A family then sends the transaction reference and a screenshot, '
  'and the office approves it into a receipt under Verify Payments. Leave '
  'both the account number and the UPI ID empty to switch this off.',
  'Fees',
  'object',
  '[{"name": "account_name", "type": "text", "label": "Account holder"},
    {"name": "bank_name", "type": "text", "label": "Bank"},
    {"name": "account_number", "type": "text", "label": "Account number"},
    {"name": "ifsc", "type": "text", "label": "IFSC"},
    {"name": "branch", "type": "text", "label": "Branch"},
    {"name": "upi_id", "type": "text", "label": "UPI ID"},
    {"name": "instructions", "type": "text", "label": "Note for families"}]'::jsonb,
  '{"account_name": null, "bank_name": null, "account_number": null, "ifsc": null, "branch": null, "upi_id": null, "instructions": null}'::jsonb,
  false,
  'fees.manage',
  40
);

-- ---------------------------------------------------------------------------
-- 2. A payment a family says they made

create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  student_id uuid not null,
  invoice_id uuid,
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  method text not null check (method in ('upi', 'bank_transfer', 'netbanking', 'cheque')),
  reference text not null check (length(btrim(reference)) between 4 and 60),
  paid_on date not null,
  proof_path text check (proof_path is null or length(proof_path) <= 400),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid not null default auth.uid() references auth.users (id),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  ledger_entry_id uuid references public.ledger_entries (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_claims_student_fkey foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint payment_claims_invoice_fkey foreign key (tenant_id, invoice_id)
    references public.invoices (tenant_id, id) on delete set null (invoice_id),
  constraint payment_claims_approved_chk
    check ((status = 'approved') = (ledger_entry_id is not null)),
  constraint payment_claims_decided_chk
    check ((status = 'pending') = (decided_at is null)),
  constraint payment_claims_reason_chk
    check (status <> 'rejected' or length(btrim(coalesce(decision_note, ''))) >= 3)
);

-- The same bank transfer sent twice is one payment. A rejected claim stops
-- counting, so a family can send a corrected one with the same reference.
create unique index payment_claims_reference_once
  on public.payment_claims (tenant_id, lower(btrim(reference)))
  where status <> 'rejected';
create unique index payment_claims_ledger_entry_idx on public.payment_claims (ledger_entry_id);
create index payment_claims_tenant_status_idx on public.payment_claims (tenant_id, status, created_at desc);
create index payment_claims_student_idx on public.payment_claims (student_id);
create index payment_claims_invoice_idx on public.payment_claims (invoice_id);
create index payment_claims_submitted_by_idx on public.payment_claims (submitted_by);
create index payment_claims_decided_by_idx on public.payment_claims (decided_by);

comment on table public.payment_claims is
  'A payment a family says they made by bank or UPI, waiting for the office to check it. A claim is not money: approving it writes an ordinary receipt (0353).';

create trigger set_updated_at before update on public.payment_claims
  for each row execute function public.set_updated_at();
create trigger audit_payment_claims after insert or update or delete on public.payment_claims
  for each row execute function public.audit_row_change();

alter table public.payment_claims enable row level security;

-- The same roles that read and write the ledger.
create policy "finance roles read payment_claims" on public.payment_claims
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) in ('admin', 'accountant')
  );
create policy "families read their children's payment_claims" on public.payment_claims
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and public.family_owns_student(student_id)
  );
-- The decision, and only while the claim is waiting. The column grant below
-- is what keeps the amount, the reference and the proof as the family sent
-- them. There is no insert policy: a family sends a claim through
-- payment_claim_submit, which checks what a policy cannot.
create policy "finance roles decide payment_claims" on public.payment_claims
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) in ('admin', 'accountant')
    and status = 'pending'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) in ('admin', 'accountant')
  );

revoke insert, update, delete on public.payment_claims from authenticated, anon;
grant update (status, decided_by, decided_at, decision_note, ledger_entry_id)
  on public.payment_claims to authenticated;

-- A family uploads the screenshot into their own college's proofs folder,
-- and nowhere else in the bucket.
create policy "families write payment proofs" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.storage_object_tenant_matches(name)
    and (storage.foldername(name))[2] = 'payment-proofs'
  );

create function public.payment_claim_submit(
  p_student_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_paid_on date,
  p_proof_path text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_methods jsonb := public.setting_value('fees.payment_methods');
  v_reference text := btrim(coalesce(p_reference, ''));
  v_id uuid;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if not public.family_owns_student(p_student_id) then
    raise exception 'That is not your child''s account.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(v_methods ->> 'account_number', '')), '') is null
     and nullif(btrim(coalesce(v_methods ->> 'upi_id', '')), '') is null then
    raise exception 'This college does not take bank or UPI payments through the app. Pay at the fee counter.'
      using errcode = '22023';
  end if;
  if p_invoice_id is not null and not exists (
    select 1 from public.invoices i
    where i.id = p_invoice_id and i.tenant_id = v_tenant
      and i.student_id = p_student_id and i.status = 'issued'
  ) then
    raise exception 'That invoice is not one of this child''s open invoices.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Say how much was paid.' using errcode = '22023';
  end if;
  if p_method not in ('upi', 'bank_transfer', 'netbanking', 'cheque') then
    raise exception 'Choose how it was paid: UPI, bank transfer, net banking or cheque.' using errcode = '22023';
  end if;
  if length(v_reference) not between 4 and 60 then
    raise exception 'Give the transaction reference (UTR) from the bank or UPI app.' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > current_date or p_paid_on < current_date - 365 then
    raise exception 'The payment date must be within the last year and not in the future.' using errcode = '22023';
  end if;
  if p_proof_path is not null
     and p_proof_path not like v_tenant::text || '/payment-proofs/' || p_student_id::text || '/%' then
    raise exception 'That screenshot is not in this child''s folder.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.payment_claims c
    where c.tenant_id = v_tenant and c.status <> 'rejected'
      and lower(btrim(c.reference)) = lower(v_reference)
  ) then
    raise exception 'A payment with reference % has already been sent to the office.', v_reference
      using errcode = '23505';
  end if;
  if (select count(*) from public.payment_claims c
      where c.tenant_id = v_tenant and c.student_id = p_student_id and c.status = 'pending') >= 10 then
    raise exception 'Ten payments for this child are already waiting for the office. Wait for those to be checked.'
      using errcode = '22023';
  end if;

  insert into public.payment_claims (
    tenant_id, student_id, invoice_id, amount, method, reference, paid_on, proof_path, note
  ) values (
    v_tenant, p_student_id, p_invoice_id, round(p_amount, 2), p_method, v_reference, p_paid_on,
    p_proof_path, nullif(btrim(coalesce(p_note, '')), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.payment_claim_submit(uuid, uuid, numeric, text, text, date, text, text) is
  'A family says they paid by bank or UPI. DEFINER because families have no insert policy: it checks the child, the invoice, that the college takes such payments and that the reference is new (0353).';

create function public.payment_claim_approve(p_claim_id uuid)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_claim public.payment_claims;
  v_tz text;
  v_entry public.ledger_entries;
  v_rows integer;
begin
  select * into v_claim from public.payment_claims
  where id = p_claim_id and tenant_id = public.current_tenant_id();
  if v_claim.id is null then
    raise exception 'That payment is not in the list.' using errcode = '42501';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'That payment has already been %.', v_claim.status using errcode = '22023';
  end if;
  if public.current_role_code() not in ('admin', 'accountant') then
    raise exception 'Only the office can approve a payment.' using errcode = '42501';
  end if;

  select coalesce(t.timezone, 'Asia/Kolkata') into v_tz from public.tenants t where t.id = v_claim.tenant_id;

  -- One definition of a payment. The claim id as the provider event id makes
  -- a second approval return the first receipt.
  v_entry := public.fees_record_payment(
    v_claim.student_id,
    v_claim.amount,
    v_claim.method,
    (v_claim.paid_on::timestamp + interval '12 hours') at time zone v_tz,
    v_claim.reference,
    v_claim.invoice_id,
    coalesce('Paid by the family, verified. ' || v_claim.note, 'Paid by the family, verified.'),
    'family_claim',
    v_claim.id::text
  );

  update public.payment_claims
  set status = 'approved', ledger_entry_id = v_entry.id,
      decided_by = auth.uid(), decided_at = now()
  where id = v_claim.id and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'That payment could not be marked approved.' using errcode = '42501';
  end if;
  return v_entry;
end;
$$;

comment on function public.payment_claim_approve(uuid) is
  'The office has seen the money arrive: write the receipt through fees_record_payment, as the caller, and mark the claim approved. Idempotent on the claim (0353).';

create function public.payment_claim_reject(p_claim_id uuid, p_reason text)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_rows integer;
begin
  if length(v_reason) < 3 then
    raise exception 'Say why, so the family knows what to do next.' using errcode = '22023';
  end if;
  if public.current_role_code() not in ('admin', 'accountant') then
    raise exception 'Only the office can turn a payment down.' using errcode = '42501';
  end if;
  update public.payment_claims
  set status = 'rejected', decision_note = left(v_reason, 500),
      decided_by = auth.uid(), decided_at = now()
  where id = p_claim_id and tenant_id = public.current_tenant_id() and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'That payment is not waiting to be checked.' using errcode = '22023';
  end if;
end;
$$;

comment on function public.payment_claim_reject(uuid, text) is
  'The office could not find the money: turn the claim down with a reason the family reads (0353).';

revoke all on function public.payment_claim_submit(uuid, uuid, numeric, text, text, date, text, text) from public, anon;
revoke all on function public.payment_claim_approve(uuid) from public, anon;
revoke all on function public.payment_claim_reject(uuid, text) from public, anon;
grant execute on function public.payment_claim_submit(uuid, uuid, numeric, text, text, date, text, text) to authenticated;
grant execute on function public.payment_claim_approve(uuid) to authenticated;
grant execute on function public.payment_claim_reject(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Transport invoices

create function public.report_transport_invoices(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with seats as (
    select ta.id, ta.student_id, ta.session_id, ta.starts_on, ta.effective_ends_on,
           ta.monthly_fare, tr.fee_head_id, tr.code as route_code, tr.name as route_name,
           rs.name as stop_name
    from public.transport_assignments ta
    join public.transport_routes tr on tr.id = ta.route_id
    join public.route_stops rs on rs.id = ta.stop_id
    where ta.session_id = (select public.current_session_id(public.current_tenant_id()))
      and ta.status = 'active'
      and ta.student_id is not null
      and (public.report_param_uuid(p_params, 'route_id') is null
           or ta.route_id = public.report_param_uuid(p_params, 'route_id'))
  ),
  periods as (
    select s.id as seat_id, fi.id as instalment_id,
           (select i.id from public.invoices i
            where i.student_id = s.student_id and i.instalment_id = fi.id and i.status = 'issued'
              and exists (select 1 from public.invoice_lines l
                          where l.invoice_id = i.id and l.fee_head_id = s.fee_head_id)
            limit 1) as invoice_id
    from seats s
    join public.fee_instalments fi
      on fi.session_id = s.session_id and fi.is_active
     and 'monthly' = any (fi.collects)
     and fi.period_start is not null
     and fi.period_start <= s.effective_ends_on and fi.period_end >= s.starts_on
     and fi.due_date <= current_date
  ),
  invoice_open as (
    select i.id,
           (select coalesce(sum(l.amount), 0) from public.invoice_lines l where l.invoice_id = i.id)
           + (select coalesce(sum(e.amount), 0) from public.ledger_entries e
              where e.invoice_id = i.id and e.entry_type in ('payment', 'discount', 'write_off')) as open
    from public.invoices i
    where i.id in (select invoice_id from periods where invoice_id is not null)
  ),
  billed as (
    select s.id as seat_id,
           coalesce(sum(l.amount), 0) as billed,
           coalesce(sum(case when o.open > 0 then l.amount end), 0) as on_open_invoices
    from seats s
    join public.invoices i on i.student_id = s.student_id and i.session_id = s.session_id and i.status = 'issued'
    join public.invoice_lines l on l.invoice_id = i.id and l.fee_head_id = s.fee_head_id
    left join lateral (
      select (select coalesce(sum(x.amount), 0) from public.invoice_lines x where x.invoice_id = i.id)
           + (select coalesce(sum(e.amount), 0) from public.ledger_entries e
              where e.invoice_id = i.id and e.entry_type in ('payment', 'discount', 'write_off')) as open
    ) o on true
    group by s.id
  )
  select to_jsonb(t)
  from (
    select
      st.id as student_id,
      st.admission_number,
      btrim(concat_ws(' ', p.first_name, p.last_name)) as student,
      (select cl.name || ' · ' || sec.name
       from public.enrolments e
       join public.sections sec on sec.id = e.section_id
       join public.class_levels cl on cl.id = sec.class_level_id
       where e.student_id = st.id and e.session_id = s.session_id and e.status = 'active'
       limit 1) as class,
      s.route_code || ' · ' || s.route_name as route,
      s.stop_name as stop,
      s.monthly_fare,
      (select count(*) from periods pp where pp.seat_id = s.id) as periods_due,
      (select count(*) from periods pp join invoice_open o on o.id = pp.invoice_id
       where pp.seat_id = s.id and o.open <= 0) as paid,
      (select count(*) from periods pp join invoice_open o on o.id = pp.invoice_id
       where pp.seat_id = s.id and o.open > 0) as unpaid,
      (select count(*) from periods pp where pp.seat_id = s.id and pp.invoice_id is null) as not_generated,
      coalesce(b.billed, 0) as billed,
      coalesce(b.on_open_invoices, 0) as on_open_invoices
    from seats s
    join public.students st on st.id = s.student_id
    left join public.people p on p.id = st.person_id
    left join billed b on b.seat_id = s.id
    order by s.route_code, student, st.admission_number
  ) t
$$;

comment on function public.report_transport_invoices(jsonb) is
  'One row per child with a bus seat this year: the fare, and for every billing period that collects monthly fees and is due by today, whether it was paid, is unpaid or was never invoiced (0353).';

revoke all on function public.report_transport_invoices(jsonb) from public, anon;
grant execute on function public.report_transport_invoices(jsonb) to authenticated;

insert into reference.reports (
  key, name, description, module, required_permission, function_name, parameters, columns, sort_order, audience
) values (
  'transport.invoices',
  'Transport invoices',
  'Every child with a bus seat this year: route, stop and monthly fare, and how '
  'many of the billing periods due so far were paid, are unpaid or were never '
  'invoiced. A period counts as paid when its invoice has nothing left owing.',
  'Transport',
  'fees.collect',
  'report_transport_invoices',
  '[{"name": "route_id", "type": "route", "label": "Route", "required": false}]'::jsonb,
  '[{"key": "admission_number", "type": "text", "label": "Admission no."},
    {"key": "student", "type": "text", "label": "Student", "href": "/fees/students/{student_id}"},
    {"key": "class", "type": "text", "label": "Class"},
    {"key": "route", "type": "text", "label": "Route"},
    {"key": "stop", "type": "text", "label": "Stop"},
    {"key": "monthly_fare", "type": "money", "align": "right", "label": "Fare a month"},
    {"key": "periods_due", "type": "number", "align": "right", "label": "Periods due"},
    {"key": "paid", "type": "number", "align": "right", "label": "Paid"},
    {"key": "unpaid", "type": "number", "align": "right", "label": "Unpaid"},
    {"key": "not_generated", "type": "number", "align": "right", "label": "Not generated"},
    {"key": "billed", "type": "money", "align": "right", "label": "Transport billed"},
    {"key": "on_open_invoices", "type": "money", "align": "right", "label": "On unpaid invoices"}]'::jsonb,
  30,
  'staff'
);

commit;
