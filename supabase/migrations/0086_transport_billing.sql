-- ---------------------------------------------------------------------------
-- Phase 5.2 — a fee that does not depend on a class
--
-- This is the migration the transport module exists for.
--
-- `fee_structures` is keyed on `(session, class_level, fee_head)`. That answers
-- one question well — "what does a child in Class 6 pay" — and it is the only
-- question `fees_generate_invoice` has ever asked. Transport asks a different
-- one: **what does a child who boards at Sector 12 pay**, and the answer is the
-- same for a six-year-old and a sixteen-year-old on the same bus, and different
-- for two children sitting next to each other in the same class.
--
-- No amount of data in `fee_structures` can express that. Adding a
-- `route_id`/`stop_id` dimension to it would make every other fee carry two
-- null columns and would still be wrong for the next fee that varies by
-- something else (a hostel room, an optional subject, a music lesson).
--
-- So the fix is not another dimension. It is to stop treating `fee_structures`
-- as *the* source of invoice lines and make it *a* source:
--
--   fees_billable_lines(student, as_of, heads)   <- one definition
--     |- from fee_structures   (what your class pays)
--     `- from transport        (what your stop costs)
--
-- `fees_generate_invoice` inserts what that function returns.
-- `fees_generate_section_invoices` asks the same function whether there is
-- anything to bill. One definition of "what would this child be charged",
-- consulted by both, so the preview and the invoice cannot disagree — the same
-- reasoning as `transport_route_load` being the only definition of "seats
-- free".
--
-- Note on instalments: `fee_structures.amount` is documented in 0021 as the
-- amount *per instalment*, and `frequency` is descriptive — the generator has
-- never divided or multiplied by it. A transport `monthly_fare` is one
-- instalment on one invoice, which is consistent with that. Turning `frequency`
-- into arithmetic is a real gap and a pre-existing one; it is not fixed here
-- and is recorded in docs/modules/transport.md.
-- ---------------------------------------------------------------------------

-- What transport would add to this child's next bill. Separate from
-- `fees_billable_lines` so the transport screens can show a family's fare
-- without pulling in the fee structure.
create or replace function public.transport_fee_lines(
  p_student_id uuid,
  p_as_of date default null
)
returns table (
  fee_head_id uuid,
  description text,
  amount numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select
    tr.fee_head_id,
    -- The stop is in the description on purpose. "Transport 1200" on a bill
    -- starts a phone call; "Transport - Sector 12 (Route R1)" answers it.
    ('Transport - ' || rs.name || ' (Route ' || tr.code || ')')::text,
    ta.monthly_fare
  from public.transport_assignments ta
  join public.transport_routes tr on tr.id = ta.route_id
  join public.route_stops rs on rs.id = ta.stop_id
  where ta.student_id = p_student_id
    and ta.status = 'active'
    and ta.monthly_fare > 0
    and tr.fee_head_id is not null
    and ta.starts_on <= coalesce(p_as_of, current_date)
    and (ta.ends_on is null or ta.ends_on >= coalesce(p_as_of, current_date))
$$;

revoke all on function public.transport_fee_lines(uuid, date) from public, anon;
grant execute on function public.transport_fee_lines(uuid, date) to authenticated;

-- Every line this child would be billed, from every source. Invoker, so RLS
-- decides what is visible; no `where tenant_id =` is doing security work.
create or replace function public.fees_billable_lines(
  p_student_id uuid,
  p_as_of date default null,
  p_fee_head_ids uuid[] default null
)
returns table (
  fee_head_id uuid,
  description text,
  amount numeric,
  source text
)
language sql
stable
set search_path = public, extensions
as $$
  with class_level as (
    select cl.id
    from public.enrolments e
    join public.sections s on s.id = e.section_id
    join public.class_levels cl on cl.id = s.class_level_id
    where e.student_id = p_student_id
      and e.session_id = public.current_session_id(public.current_tenant_id())
      and e.status = 'active'
    limit 1
  )
  select fs.fee_head_id, fh.name::text, fs.amount, 'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  join class_level c on c.id = fs.class_level_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))

  union all

  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, p_as_of) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
$$;

revoke all on function public.fees_billable_lines(uuid, date, uuid[]) from public, anon;
grant execute on function public.fees_billable_lines(uuid, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The invoice generator, third revision
-- ---------------------------------------------------------------------------

-- Unchanged from 0022 apart from where the lines come from: the double-billing
-- guard, the due-date requirement and the enrolment check are all still here,
-- and so is the refusal when there is nothing to bill — it just now means
-- "nothing from either source" rather than "no fee structure for this class".
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

  if exists (
    select 1 from public.invoices
    where tenant_id = v_tenant_id and session_id = v_session_id
      and student_id = p_student_id and due_date = p_due_date and status = 'issued'
  ) then
    raise exception 'This student already has an invoice due on %', p_due_date;
  end if;

  -- Asked before the invoice row is written, so a child with nothing to bill
  -- does not leave an empty invoice number burned in the sequence.
  if not exists (
    select 1 from public.fees_billable_lines(p_student_id, p_due_date, p_fee_head_ids)
  ) then
    raise exception
      'There is nothing to bill this student: no fee structure applies to their class and they have no charged transport.';
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
  select v_tenant_id, v_session_id, v_invoice.id, b.fee_head_id, b.description, b.amount
  from public.fees_billable_lines(p_student_id, p_due_date, p_fee_head_ids) b;

  get diagnostics v_lines = row_count;
  if v_lines = 0 then
    -- Unreachable given the check above, and kept because an invoice with no
    -- lines is the one outcome this function must never commit.
    raise exception 'Nothing was billed, so the invoice was not raised';
  end if;

  return v_invoice;
end;
$$;

-- Bill a whole section, skipping students who already have an invoice for that
-- due date -- and now also skipping students with nothing to bill, rather than
-- aborting the batch on the first of them.
--
-- The up-front check in 0022 read "every student in a section shares a class
-- level, so either all of them are billable or none are". Transport made that
-- false: two children in one class can differ, because one of them rides a bus.
-- So the check moved to "is there anything to bill anybody in this section",
-- which is still one query and still worth asking before starting.
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
  v_student record;
  v_created integer := 0;
  v_billable integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if not exists (
    select 1 from public.sections s
    where s.id = p_section_id and s.tenant_id = v_tenant_id
  ) then
    raise exception 'Section not found';
  end if;

  for v_student in
    select e.student_id
    from public.enrolments e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.section_id = p_section_id
      and e.status = 'active'
  loop
    if not exists (
      select 1 from public.fees_billable_lines(v_student.student_id, p_due_date, p_fee_head_ids)
    ) then
      continue;
    end if;

    v_billable := v_billable + 1;

    if exists (
      select 1 from public.invoices i
      where i.tenant_id = v_tenant_id and i.session_id = v_session_id
        and i.student_id = v_student.student_id and i.due_date = p_due_date
        and i.status = 'issued'
    ) then
      continue;
    end if;

    perform public.fees_generate_invoice(
      v_student.student_id, p_due_date, p_fee_head_ids, null);
    v_created := v_created + 1;
  end loop;

  if v_billable = 0 then
    raise exception
      'Nothing applies to anybody in this class: no fee structure is set for it and no child in it has charged transport.';
  end if;

  return v_created;
end;
$$;
