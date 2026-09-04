-- ---------------------------------------------------------------------------
-- Billing, now aware of the period it is billing for
--
-- The three functions are dropped and recreated rather than replaced: adding a
-- defaulted parameter to a Postgres function creates an *overload*, and the
-- existing three-argument calls would then be ambiguous. One definition of each
-- is the whole point, so the old ones go.
-- ---------------------------------------------------------------------------

drop function if exists public.fees_generate_section_invoices(uuid, date, uuid[]);
drop function if exists public.fees_generate_invoice(uuid, date, uuid[], text);
drop function if exists public.fees_billable_lines(uuid, date, uuid[]);

-- Every line this child would be billed, from every source, for a given period.
--
-- `p_instalment_id` is the new parameter and the only behavioural change:
--
--   null  -> every head that applies, which is exactly what this did before.
--            That is what the counter's ad-hoc charges want, and it keeps the
--            "bill these particular heads now" path working unchanged.
--   given -> only heads whose `frequency` the period says it `collects`.
--
-- **A transport fare is monthly by construction** -- `route_stops.monthly_fare`
-- is the only rate the module holds -- so it is billed by any period collecting
-- `monthly`. It is charged in full for a period the child was riding at the
-- start of; pro-rating a part month needs a policy document of its own and is
-- recorded as not built in docs/modules/transport.md.
create or replace function public.fees_billable_lines(
  p_student_id uuid,
  p_instalment_id uuid default null,
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
  with period as (
    select fi.collects, fi.period_start, fi.due_date
    from public.fee_instalments fi
    where fi.id = p_instalment_id
  ),
  as_of as (
    -- A school bills in advance: the July invoice is raised for the child who
    -- is riding at the start of July.
    select coalesce(
      p_as_of,
      (select coalesce(period_start, due_date) from period),
      current_date
    ) as d
  )
  select fs.fee_head_id, fh.name::text, fs.amount, 'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    -- A scalar subquery, never a joined one-row CTE: Postgres inlines this
    -- function into its caller and a correlated `limit 1` relation fanned out
    -- under `cross join lateral`. See migration 0089.
    and fs.class_level_id = (
      select s.class_level_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      where e.student_id = p_student_id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
      limit 1
    )
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      -- `= any ((select ...))` parses as the subquery form of ANY and expects a
      -- set of text, not the text[] the column holds. Ranging over the CTE
      -- keeps `collects` an array expression, which is what ANY wants.
      or exists (select 1 from period pp where fs.frequency = any (pp.collects))
    )

  union all

  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, (select d from as_of)) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )
$$;

revoke all on function public.fees_billable_lines(uuid, uuid, date, uuid[]) from public, anon;
grant execute on function public.fees_billable_lines(uuid, uuid, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- One invoice
-- ---------------------------------------------------------------------------

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

    -- The period carries the due date, so nobody has to retype it per class
    -- and two runs of the same period cannot disagree about when it is due.
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

  -- With a period, the unique index is the guard and it is exact. Without one,
  -- the old due-date heuristic still stands: it is the best available answer
  -- for an ad-hoc charge, and 0022 was right that billing the same student
  -- twice for one due date is almost always a mistake.
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
    -- From `invoices_one_per_instalment`. A retried run converging is the
    -- point, so this says what happened rather than showing an index name.
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

  return v_invoice;
end;
$$;

revoke all on function public.fees_generate_invoice(uuid, date, uuid[], text, uuid) from public, anon;
grant execute on function public.fees_generate_invoice(uuid, date, uuid[], text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A whole section
-- ---------------------------------------------------------------------------

-- Bounded on purpose: a section is ~40 students. Billing an entire school
-- belongs in `jobs` (rule 7) and is not built.
--
-- Skips two kinds of student rather than aborting: those already billed for
-- this period (so a re-run after a timeout tops up), and those with nothing to
-- bill (which transport made possible -- two children in one class no longer
-- necessarily owe the same things).
create or replace function public.fees_generate_section_invoices(
  p_section_id uuid,
  p_due_date date default null,
  p_fee_head_ids uuid[] default null,
  p_instalment_id uuid default null
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
      select 1 from public.fees_billable_lines(
        v_student.student_id, p_instalment_id, null, p_fee_head_ids)
    ) then
      continue;
    end if;

    v_billable := v_billable + 1;

    if p_instalment_id is not null then
      if exists (
        select 1 from public.invoices i
        where i.tenant_id = v_tenant_id and i.session_id = v_session_id
          and i.student_id = v_student.student_id
          and i.instalment_id = p_instalment_id and i.status = 'issued'
      ) then
        continue;
      end if;
    elsif exists (
      select 1 from public.invoices i
      where i.tenant_id = v_tenant_id and i.session_id = v_session_id
        and i.student_id = v_student.student_id and i.due_date = p_due_date
        and i.status = 'issued' and i.instalment_id is null
    ) then
      continue;
    end if;

    perform public.fees_generate_invoice(
      v_student.student_id, p_due_date, p_fee_head_ids, null, p_instalment_id);
    v_created := v_created + 1;
  end loop;

  if v_billable = 0 then
    raise exception
      'Nothing applies to anybody in this class for this run: no fee structure collects in this period and no child in it has charged transport.';
  end if;

  return v_created;
end;
$$;

revoke all on function public.fees_generate_section_invoices(uuid, date, uuid[], uuid) from public, anon;
grant execute on function public.fees_generate_section_invoices(uuid, date, uuid[], uuid) to authenticated;

-- What a period would charge a class, before anybody presses the button.
-- Rule 13's instinct: a bulk operation should be previewable. This is the
-- read-only half -- the editable-rows version belongs with a proper billing
-- run and is not built.
create or replace function public.fees_instalment_preview(
  p_section_id uuid,
  p_instalment_id uuid
)
returns table (
  student_id uuid,
  student_name text,
  admission_number text,
  already_billed boolean,
  line_count integer,
  total numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    st.admission_number,
    exists (
      select 1 from public.invoices i
      where i.student_id = e.student_id
        and i.instalment_id = p_instalment_id
        and i.status = 'issued'
    ),
    coalesce(b.lines, 0)::integer,
    coalesce(b.total, 0)
  from public.enrolments e
  join public.students st on st.id = e.student_id
  join public.people p on p.id = st.person_id
  left join lateral (
    select count(*) as lines, sum(l.amount) as total
    from public.fees_billable_lines(e.student_id, p_instalment_id) l
  ) b on true
  where e.section_id = p_section_id
    and e.status = 'active'
    and e.session_id = public.current_session_id(public.current_tenant_id())
  order by e.roll_number, p.first_name
$$;

revoke all on function public.fees_instalment_preview(uuid, uuid) from public, anon;
grant execute on function public.fees_instalment_preview(uuid, uuid) to authenticated;
