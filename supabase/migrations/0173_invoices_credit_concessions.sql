-- ---------------------------------------------------------------------------
-- The invoice raises the charge; the ledger takes the concession off
-- ---------------------------------------------------------------------------
--
-- `fees_generate_invoice` gains one step at the end: after the lines are
-- inserted, it asks `fees_concession_lines` what this child is owed off and
-- books each answer as a `discount` in the ledger, against the invoice.
--
-- Three things this deliberately does **not** do:
--
--   * **It does not touch `invoice_lines`.** That table carries
--     `check (amount > 0)` and keeps it. An invoice says what was *charged*; a
--     negative charge is not a thing. What is *owed* is the ledger, which
--     already constrains a discount negative, already shows on the counter, the
--     day book and the family's statement, and is already reversible by rule
--     6's rules.
--   * **It does not refuse when a concession covers the whole bill.** A 100%
--     RTE seat produces an invoice for the full amount and a credit for the
--     full amount, netting zero. That is the correct record: the school did
--     charge, and did waive, and both belong in the books.
--   * **It does not recompute the charge.** The concession is taken off exactly
--     what the invoice says, passed in as a jsonb map of head to amount, so a
--     preview and an invoice cannot disagree -- the reason `fees_billable_lines`
--     is consulted by both rather than reimplemented.
--
-- IDEMPOTENCY IS THE UNIQUE INDEX, NOT A CHECK
--
-- `on conflict do nothing` against `ledger_entries_concession_award_unique`.
-- Rule 6's third library-fine rule, applied unchanged: a retried invoice run
-- converges instead of discounting twice, and it converges *in the database*
-- rather than in a check that two concurrent runs could both pass.
--
-- `SECURITY INVOKER` throughout. The `finance roles add ledger_entries` policy
-- already permits an administrator or accountant to write a discount, which is
-- exactly who raises an invoice, so no new policy and no definer function.

create or replace function public.fees_generate_invoice(
  p_student_id uuid,
  p_due_date date default null,
  p_fee_head_ids uuid[] default null,
  p_notes text default null,
  p_instalment_id uuid default null
)
returns public.invoices
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_class_level_id uuid;
  v_instalment public.fee_instalments;
  v_due date := p_due_date;
  v_invoice public.invoices;
  v_lines integer;
  v_charges jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if p_instalment_id is not null then
    select * into v_instalment from public.fee_instalments fi
    where fi.id = p_instalment_id and fi.tenant_id = v_tenant_id;

    if v_instalment.id is null then
      raise exception 'That billing period does not exist';
    end if;
    if v_instalment.session_id <> v_session_id then
      raise exception 'Billing period "%" belongs to a different academic session', v_instalment.name;
    end if;
    if not v_instalment.is_active then
      raise exception 'Billing period "%" is closed', v_instalment.name;
    end if;

    v_due := coalesce(v_due, v_instalment.due_date);
  end if;

  if v_due is null then
    raise exception 'An invoice needs a due date';
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

  if p_instalment_id is null and exists (
    select 1 from public.invoices
    where tenant_id = v_tenant_id and session_id = v_session_id
      and student_id = p_student_id and due_date = v_due and status = 'issued'
      and instalment_id is null
  ) then
    raise exception 'This student already has an invoice due on %', v_due;
  end if;

  if not exists (
    select 1 from public.fees_billable_lines(
      p_student_id, p_instalment_id, null, p_fee_head_ids)
  ) then
    if p_instalment_id is null then
      raise exception
        'There is nothing to bill this student: no fee structure applies to their class and they have no charged transport.';
    else
      raise exception
        'Nothing is due from this student for %: the period collects % and none of their fees are charged that way.',
        v_instalment.name, array_to_string(v_instalment.collects, ', ');
    end if;
  end if;

  begin
    insert into public.invoices
      (tenant_id, session_id, student_id, invoice_number, due_date, notes,
       issued_by, instalment_id)
    values
      (v_tenant_id, v_session_id, p_student_id,
       public.fees_next_document_number('invoice'), v_due,
       nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), p_instalment_id)
    returning * into v_invoice;
  exception when unique_violation then
    raise exception 'This student has already been billed for %', v_instalment.name;
  end;

  insert into public.invoice_lines
    (tenant_id, session_id, invoice_id, fee_head_id, description, amount)
  select v_tenant_id, v_session_id, v_invoice.id, b.fee_head_id, b.description, b.amount
  from public.fees_billable_lines(p_student_id, p_instalment_id, null, p_fee_head_ids) b;

  get diagnostics v_lines = row_count;
  if v_lines = 0 then
    raise exception 'Nothing was billed, so the invoice was not raised';
  end if;

  -- What was actually charged, by head -- read back from the invoice rather
  -- than recomputed, so the credit can only ever be taken off a real line.
  select coalesce(jsonb_object_agg(il.fee_head_id::text, il.amount), '{}'::jsonb)
  into v_charges
  from (
    select fee_head_id, sum(amount) as amount
    from public.invoice_lines
    where invoice_id = v_invoice.id
    group by fee_head_id
  ) il;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    note, concession_award_id, recorded_by
  )
  select
    v_tenant_id, v_session_id, p_student_id, v_invoice.id, 'discount',
    -- Rule 6: amounts are signed and a discount is a credit. The RPCs take
    -- positive numbers and do the signing; this is the signing.
    -c.amount,
    format('%s (invoice %s)', c.name, v_invoice.invoice_number),
    c.award_id,
    auth.uid()
  from public.fees_concession_lines(p_student_id, v_charges, v_due) c
  on conflict do nothing;

  return v_invoice;
end;
$$;

revoke all on function public.fees_generate_invoice(uuid, date, uuid[], text, uuid)
  from public, anon;
grant execute on function public.fees_generate_invoice(uuid, date, uuid[], text, uuid)
  to authenticated;

comment on function public.fees_generate_invoice(uuid, date, uuid[], text, uuid) is
  'Raises the invoice from `fees_billable_lines`, then credits any concessions '
  'to the ledger against it. The invoice stays positive; the discount is a '
  'ledger entry, idempotent on the award. See migration 0173.';

-- ---------------------------------------------------------------------------
-- Permissions and the register
-- ---------------------------------------------------------------------------

insert into reference.permissions (code, module, ability, description) values
  ('concessions.view', 'fees', 'view', 'See fee concessions and who holds them'),
  ('concessions.manage', 'fees', 'manage', 'Create concessions and award them')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('concessions.view'), ('concessions.manage')) as p(code)
where r.code in ('admin', 'accountant')
on conflict (tenant_id, role_id, permission_code) do nothing;

-- A teacher may see that a child has a concession -- it explains why a fee
-- chase list looks the way it does -- but not what the school's whole
-- concession policy costs, and never how to grant one.
insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'concessions.view'
from public.roles r
where r.code = 'teacher'
on conflict (tenant_id, role_id, permission_code) do nothing;

create or replace function public.report_concessions(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      st.admission_number,
      (p.first_name || ' ' || p.last_name)::text as student,
      (cl.name || ' ' || sec.name)::text as section,
      fc.name as concession,
      fc.kind,
      fc.value,
      sc.reason,
      sc.granted_on,
      sc.ends_on,
      sc.status,
      -- What it has actually cost, from the ledger rather than recomputed --
      -- rule 11: a report that recomputes what a module already knows is free
      -- to disagree with the screen the money is taken on.
      coalesce((
        select -sum(le.amount)
        from public.ledger_entries le
        where le.concession_award_id = sc.id
          and le.reverses_entry_id is null
      ), 0) as credited
    from public.student_concessions sc
    join public.fee_concessions fc on fc.id = sc.concession_id
    join public.students st on st.id = sc.student_id
    join public.people p on p.id = st.person_id
    left join public.enrolments en
      on en.student_id = sc.student_id and en.session_id = sc.session_id
     and en.status = 'active'
    left join public.sections sec on sec.id = en.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    where sc.session_id = public.current_session_id(public.current_tenant_id())
      and (
        public.report_param_uuid(p_params, 'concession') is null
        or sc.concession_id = public.report_param_uuid(p_params, 'concession')
      )
      and (
        public.report_param_text(p_params, 'status') is null
        or sc.status = public.report_param_text(p_params, 'status')
      )
      and (
        public.report_param_uuid(p_params, 'section') is null
        or en.section_id = public.report_param_uuid(p_params, 'section')
      )
    order by fc.priority, fc.name, p.last_name, p.first_name, sc.id
  ) t
$$;

revoke all on function public.report_concessions(jsonb) from public, anon;
grant execute on function public.report_concessions(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'fees.concessions',
    'Concessions awarded',
    'Who holds which concession, why, and what it has actually cost -- the credited column is summed from the ledger rather than recomputed from the rule, so it cannot disagree with the family''s statement. A revoked award keeps its history: money already credited stays credited.',
    'Fees', 'concessions.view', 'report_concessions',
    '[
      {"name":"concession","label":"Concession","type":"select","required":false,"options":[]},
      {"name":"section","label":"Class","type":"section","required":false},
      {"name":"status","label":"Status","type":"select","required":false,
       "options":[{"value":"active","label":"Active"},{"value":"revoked","label":"Withdrawn"}]}
    ]'::jsonb,
    '[
      {"key":"admission_number","label":"Adm. no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"section","label":"Class","type":"text"},
      {"key":"concession","label":"Concession","type":"text"},
      {"key":"kind","label":"Kind","type":"badge"},
      {"key":"value","label":"Value","type":"number","align":"right"},
      {"key":"credited","label":"Credited","type":"money","align":"right"},
      {"key":"status","label":"Status","type":"badge"},
      {"key":"granted_on","label":"From","type":"date"},
      {"key":"ends_on","label":"Until","type":"date"},
      {"key":"reason","label":"Reason","type":"text"}
    ]'::jsonb,
    36
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  module = excluded.module,
  required_permission = excluded.required_permission,
  function_name = excluded.function_name,
  parameters = excluded.parameters,
  columns = excluded.columns,
  sort_order = excluded.sort_order;
