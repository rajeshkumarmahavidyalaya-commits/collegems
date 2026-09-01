-- Support for the fee counter: the data-entry desk an accountant sits at.
--
-- Two gaps the collection screen did not have to care about, and a counter
-- cannot work without.
--
-- 1. LOOKING UP ONE STUDENT'S BALANCE. `fees_student_balances` filtered by
--    section only, so a type-ahead picker could not show "Ravi Kumar -- 6,200
--    due" without computing every student in the school on each keystroke. It
--    gains a `p_student_ids` filter rather than growing a second function with
--    a copy of the same arithmetic -- the balance identity is the one thing in
--    this module that must never have two implementations.
--
--    Adding a defaulted third parameter to a live function would create an
--    ambiguous overload (existing 0/1/2-argument calls could match either), so
--    the old one is dropped and recreated. Callers passing `{}` or a section
--    are unaffected.
--
-- 2. RAISING AN AD-HOC CHARGE. `fees_generate_invoice` always derives its lines
--    from the class fee structure, which is right for termly billing and
--    useless for "replacement for a lost book, 450". `fees_raise_charge` books
--    a one-line invoice at an amount the clerk types.
--
--    Deliberately WITHOUT the duplicate-due-date guard that
--    `fees_generate_invoice` has. That guard exists because double-submitting a
--    termly billing form should not double-bill a family; an ad-hoc charge is a
--    considered act, and two of them on one day (two lost books) is ordinary.

drop function if exists public.fees_student_balances(uuid, boolean);

create or replace function public.fees_student_balances(
  p_section_id uuid default null,
  p_only_outstanding boolean default false,
  p_student_ids uuid[] default null
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
      and (p_student_ids is null or s.id = any (p_student_ids))
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

revoke all on function public.fees_student_balances(uuid, boolean, uuid[]) from public, anon;
grant execute on function public.fees_student_balances(uuid, boolean, uuid[]) to authenticated;

-- A single charge at an amount someone types, rather than one derived from the
-- class fee structure. One invoice, one line, the same gapless numbering.
create or replace function public.fees_raise_charge(
  p_student_id uuid,
  p_amount numeric,
  p_description text,
  p_due_date date,
  p_fee_head_id uuid default null
)
returns public.invoices
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_invoice public.invoices;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'A charge must be a positive amount';
  end if;
  if p_description is null or trim(p_description) = '' then
    raise exception 'A charge needs a description -- it is what the family will see';
  end if;
  if p_due_date is null then
    raise exception 'A charge needs a due date';
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

  if p_fee_head_id is not null and not exists (
    select 1 from public.fee_heads
    where id = p_fee_head_id and tenant_id = v_tenant_id
  ) then
    raise exception 'Fee head not found';
  end if;

  insert into public.invoices
    (tenant_id, session_id, student_id, invoice_number, due_date, notes, issued_by)
  values
    (v_tenant_id, v_session_id, p_student_id,
     public.fees_next_document_number('invoice'), p_due_date,
     'Raised at the fee counter', auth.uid())
  returning * into v_invoice;

  insert into public.invoice_lines
    (tenant_id, session_id, invoice_id, fee_head_id, description, amount)
  values
    (v_tenant_id, v_session_id, v_invoice.id, p_fee_head_id, trim(p_description), p_amount);

  return v_invoice;
end;
$$;

revoke all on function public.fees_raise_charge(uuid, numeric, text, date, uuid) from public, anon;
grant execute on function public.fees_raise_charge(uuid, numeric, text, date, uuid) to authenticated;
