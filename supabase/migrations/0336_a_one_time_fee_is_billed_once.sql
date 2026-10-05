-- 0336: A one-time or yearly fee is billed once a year.
--
-- Found by the 0333 walkthrough, on the "Raise invoice" button that sweep
-- gave the fee account: a child admitted with the admission fee billed on
-- admission (IN-2026-00001, 1,000.00) was billed it again by the next invoice
-- (IN-2026-00003, the same 1,000.00). The button was new; the defect was not.
--
-- `fees_billable_lines` is the one definition of what a child would be charged
-- (rule 6), and an invoice raised without a billing period -- the section run,
-- the fee account, the admission bill -- asked it with no memory of what the
-- year had already billed. A college that bills by instalments was protected
-- by `invoices_one_per_instalment` and each period's `collects`; one that
-- raises invoices as it goes (every college the wizard sets up: it creates no
-- periods) was not, and every invoice charged every head again. And the two
-- paths met: an admission fee billed on admission was billed again by any
-- period that collects one-time fees.
--
-- `fee_structures.frequency` says what the fee is. 'one_time' and 'annual' are
-- once a year by their own definition, so a head of either frequency that is
-- already on an issued invoice for this child this year is not billable again,
-- on any path. A cancelled invoice does not count, so cancelling one re-opens
-- the fee, as `invoices_one_per_instalment` does for a period. Monthly and
-- quarterly fees are left as they were: without periods there is no way to
-- know which month an ad-hoc invoice is for, and guessing would under-bill.
--
-- The message for an invoice with nothing on it now says why when this is the
-- reason, instead of "no fee structure applies", which would be false.

begin;

create or replace function public.fees_billable_lines(
  p_student_id uuid,
  p_instalment_id uuid default null,
  p_as_of date default null,
  p_fee_head_ids uuid[] default null
)
returns table(fee_head_id uuid, description text, amount numeric, source text)
language sql
stable
set search_path = public, extensions
as $$
  with period as (
    select fi.collects, fi.period_start, fi.period_end, fi.due_date
    from public.fee_instalments fi
    where fi.id = p_instalment_id
  ),
  as_of as (
    select coalesce(
      p_as_of,
      (select coalesce(period_start, due_date) from period),
      current_date
    ) as d
  )
  select fs.fee_head_id,
         (fh.name || coalesce(' (' || st.name || ')', ''))::text,
         fs.amount,
         'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  left join public.student_types st on st.id = fs.student_type_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    and fs.class_level_id = (
      select s.class_level_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      where e.student_id = p_student_id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
      limit 1
    )
    and (
      fs.student_type_id = (
        select a.student_type_id
        from public.student_type_assignments a
        where a.student_id = p_student_id
          and a.session_id = public.current_session_id(public.current_tenant_id())
      )
      or (
        fs.student_type_id is null
        and not exists (
          select 1
          from public.fee_structures o
          where o.tenant_id = fs.tenant_id
            and o.session_id = fs.session_id
            and o.class_level_id = fs.class_level_id
            and o.fee_head_id = fs.fee_head_id
            and o.student_type_id = (
              select a.student_type_id
              from public.student_type_assignments a
              where a.student_id = p_student_id
                and a.session_id = public.current_session_id(public.current_tenant_id())
            )
        )
      )
    )
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where fs.frequency = any (pp.collects))
    )
    -- Once a year means once a year, on every path (0336).
    and not (
      fs.frequency in ('one_time', 'annual')
      and exists (
        select 1
        from public.invoice_lines il
        join public.invoices i on i.id = il.invoice_id
        where i.student_id = p_student_id
          and i.session_id = fs.session_id
          and i.status = 'issued'
          and il.fee_head_id = fs.fee_head_id
      )
    )

  union all

  -- Transport, one day: no instalment, or an instalment with no dates.
  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, (select d from as_of)) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
    and not exists (select 1 from period pp where pp.period_start is not null and pp.period_end is not null)
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )

  union all

  -- Transport, a period: every arrangement that overlapped it (0317).
  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from period pp
  cross join lateral public.transport_fee_lines_for_period(p_student_id, pp.period_start, pp.period_end) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where pp.period_start is not null and pp.period_end is not null
    and 'monthly' = any (pp.collects)
    and fh.is_active
    and t.amount > 0
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))

  union all

  select hl.fee_head_id, hl.description, hl.amount, 'hostel'::text
  from public.hostel_fee_lines(p_student_id, (select d from as_of)) hl
  join public.fee_heads fh on fh.id = hl.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or hl.fee_head_id = any (p_fee_head_ids))
    and not exists (select 1 from period pp where pp.period_start is not null and pp.period_end is not null)
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )

  union all

  select hl.fee_head_id, hl.description, hl.amount, 'hostel'::text
  from period pp
  cross join lateral public.hostel_fee_lines_for_period(p_student_id, pp.period_start, pp.period_end) hl
  join public.fee_heads fh on fh.id = hl.fee_head_id
  where pp.period_start is not null and pp.period_end is not null
    and 'monthly' = any (pp.collects)
    and fh.is_active
    and hl.amount > 0
    and (p_fee_head_ids is null or hl.fee_head_id = any (p_fee_head_ids))
$$;

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
        'There is nothing to bill this student: their class has no fee set for this year that is not already on an invoice (a one-time or yearly fee is billed once a year), and they have no bus or hostel charge.';
    else
      raise exception
        'Nothing is due from this student for %: the period collects % and none of their fees are charged that way, or they were already billed this year.',
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
    -c.amount,
    format('%s (invoice %s)', c.name, v_invoice.invoice_number),
    c.award_id,
    auth.uid()
  from public.fees_concession_lines(p_student_id, v_charges, v_due) c
  on conflict do nothing;

  return v_invoice;
end;
$$;

commit;
