-- 0354: transport invoices say what was billed outside a period.
--
-- 0353's report counts, per billing period, whether the bus was invoiced for
-- it. Run read-only against the demo college it said, for its first row,
-- "12 not generated" beside "4,800.00 billed": the college had set up twelve
-- monthly periods, run only September, and billed the bus as one lump on an
-- invoice raised outside any period. Both numbers were true and together they
-- read as a contradiction. The missing third number is how much of the
-- transport billed sits on invoices with no period, so a reader sees why the
-- periods read as not generated.
--
-- create or replace keeps the function's grants.

begin;

create or replace function public.report_transport_invoices(p_params jsonb)
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
           coalesce(sum(case when o.open > 0 then l.amount end), 0) as on_open_invoices,
           coalesce(sum(case when i.instalment_id is null then l.amount end), 0) as outside_periods
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
      coalesce(b.on_open_invoices, 0) as on_open_invoices,
      coalesce(b.outside_periods, 0) as billed_outside_periods
    from seats s
    join public.students st on st.id = s.student_id
    left join public.people p on p.id = st.person_id
    left join billed b on b.seat_id = s.id
    order by s.route_code, student, st.admission_number
  ) t
$$;

comment on function public.report_transport_invoices(jsonb) is
  'One row per child with a bus seat this year: the fare; for every billing period that collects monthly fees and is due by today, whether it was paid, is unpaid or was never invoiced; and how much transport was billed outside any period (0353, 0354).';

update reference.reports
set description =
      'Every child with a bus seat this year: route, stop and monthly fare, and how '
      'many of the billing periods due so far were paid, are unpaid or were never '
      'invoiced. A period counts as paid when its invoice has nothing left owing. '
      'Fares billed on an invoice outside any period are counted separately, and '
      'leave those periods reading as not generated.',
    columns = columns || '[{"key": "billed_outside_periods", "type": "money", "align": "right", "label": "Billed outside a period"}]'::jsonb
where key = 'transport.invoices';

commit;
