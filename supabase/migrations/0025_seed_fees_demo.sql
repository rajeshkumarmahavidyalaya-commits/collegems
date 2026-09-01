-- Demo fee data: heads, per-class amounts, one invoice per enrolled student,
-- and a realistic spread of payments, discounts, a fine and one reversal -- so
-- the collection screen, the student ledger and the dashboard are never
-- designed against an empty ledger.
--
-- This runs as the migration role, which bypasses RLS and has no JWT, so
-- `current_tenant_id()` and `auth.uid()` are both null and the `fees_*` RPCs
-- cannot be used. Everything is inserted directly, which means the document
-- numbers have to be generated here too -- and `document_sequences` is set at
-- the end so the first real receipt continues the series instead of colliding
-- with a seeded one.
--
-- Who pays what is decided by a hash of the student id, not random(), so the
-- demo looks the same on every rebuild:
--
--   bucket < 60   paid in full
--   60-79         paid 40% -- part payment, still owing
--   80-89         20% sibling discount, then paid the remaining 80%
--   >= 90         nothing paid, and >= 95 also picked up a late fine

do $$
declare
  v_tenant_id uuid;
  v_session_id uuid;
  v_year text;
  v_demo_entry uuid;
begin
  select id into v_tenant_id from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant_id is null then
    raise notice 'Demo tenant not present; skipping fees seed.';
    return;
  end if;

  select id, to_char(start_date, 'YYYY') into v_session_id, v_year
  from public.academic_sessions
  where tenant_id = v_tenant_id and is_current
  limit 1;

  if v_session_id is null then
    raise notice 'No current session for the demo tenant; skipping fees seed.';
    return;
  end if;

  insert into public.fee_heads (tenant_id, code, name, description, category) values
    (v_tenant_id, 'TUITION', 'Tuition fee', 'Teaching fee for the academic year', 'tuition'),
    (v_tenant_id, 'EXAM', 'Examination fee', 'Board and internal examinations', 'exam'),
    (v_tenant_id, 'TRANSPORT', 'Transport fee', 'School bus, all routes', 'transport'),
    (v_tenant_id, 'LIBRARY', 'Library fee', 'Books, periodicals and reading room', 'library'),
    (v_tenant_id, 'ACTIVITY', 'Activity fee', 'Sports, clubs and annual day', 'activity')
  on conflict (tenant_id, code) do nothing;

  -- Tuition rises with the grade; everything else is flat across the school.
  insert into public.fee_structures
    (tenant_id, session_id, class_level_id, fee_head_id, amount, frequency)
  select
    v_tenant_id, v_session_id, cl.id, fh.id,
    case fh.code
      when 'TUITION' then 6000 + (cl.sequence * 900)
      when 'EXAM' then 1200
      when 'TRANSPORT' then 4800
      when 'LIBRARY' then 600
      else 900
    end,
    case fh.code when 'EXAM' then 'one_time' when 'LIBRARY' then 'one_time' else 'annual' end
  from public.class_levels cl
  cross join public.fee_heads fh
  where cl.tenant_id = v_tenant_id and fh.tenant_id = v_tenant_id
  on conflict (tenant_id, session_id, class_level_id, fee_head_id) do nothing;

  -- Everything below is the transactional half. Re-running must not double it.
  if exists (
    select 1 from public.invoices where tenant_id = v_tenant_id and session_id = v_session_id
  ) then
    raise notice 'Fees already seeded for this session; leaving the ledger alone.';
    return;
  end if;

  -- Issued six weeks ago and due two weeks ago, so the demo has genuinely
  -- overdue accounts rather than a school where nothing is late yet.
  insert into public.invoices
    (tenant_id, session_id, student_id, invoice_number, issue_date, due_date)
  select
    v_tenant_id, v_session_id, n.student_id,
    'IN-' || v_year || '-' || lpad(n.rn::text, 5, '0'),
    current_date - 45,
    current_date - 15
  from (
    select e.student_id, row_number() over (order by s.admission_number) as rn
    from public.enrolments e
    join public.students s on s.id = e.student_id
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.status = 'active'
  ) n;

  insert into public.invoice_lines
    (tenant_id, session_id, invoice_id, fee_head_id, description, amount)
  select v_tenant_id, v_session_id, i.id, fs.fee_head_id, fh.name, fs.amount
  from public.invoices i
  join public.enrolments e
    on e.student_id = i.student_id and e.session_id = v_session_id and e.status = 'active'
  join public.sections sec on sec.id = e.section_id
  join public.fee_structures fs
    on fs.class_level_id = sec.class_level_id
   and fs.session_id = v_session_id
   and fs.tenant_id = v_tenant_id
  join public.fee_heads fh on fh.id = fs.fee_head_id
  where i.tenant_id = v_tenant_id and i.session_id = v_session_id;

  -- Discounts first: they carry no receipt number, so they do not disturb the
  -- receipt series generated below.
  insert into public.ledger_entries
    (tenant_id, session_id, student_id, invoice_id, entry_type, amount, occurred_at, note)
  select
    v_tenant_id, v_session_id, t.student_id, t.invoice_id, 'discount',
    -round(t.total * 0.20, 2), (current_date - 40)::timestamptz, 'Sibling concession'
  from (
    select i.id as invoice_id, i.student_id,
           (select sum(l.amount) from public.invoice_lines l where l.invoice_id = i.id) as total,
           abs(hashtext(i.student_id::text)) % 100 as bucket
    from public.invoices i
    where i.tenant_id = v_tenant_id and i.session_id = v_session_id
  ) t
  where t.bucket between 80 and 89 and t.total is not null;

  insert into public.ledger_entries
    (tenant_id, session_id, student_id, invoice_id, entry_type, amount,
     occurred_at, receipt_number, method)
  select
    v_tenant_id, v_session_id, n.student_id, n.invoice_id, 'payment', -n.amount,
    (current_date - (10 + (abs(hashtext(n.invoice_id::text)) % 25)))::timestamptz,
    'RC-' || v_year || '-' || lpad(n.rn::text, 5, '0'),
    (array['cash', 'upi', 'cheque', 'netbanking', 'card'])[
      1 + (abs(hashtext(n.student_id::text)) % 5)
    ]
  from (
    select
      p.student_id, p.invoice_id, p.amount,
      row_number() over (order by p.invoice_id) as rn
    from (
      select
        t.student_id, t.invoice_id,
        case
          when t.bucket < 60 then t.total
          when t.bucket < 80 then round(t.total * 0.40, 2)
          else round(t.total * 0.80, 2)
        end as amount
      from (
        select i.id as invoice_id, i.student_id,
               (select sum(l.amount) from public.invoice_lines l where l.invoice_id = i.id) as total,
               abs(hashtext(i.student_id::text)) % 100 as bucket
        from public.invoices i
        where i.tenant_id = v_tenant_id and i.session_id = v_session_id
      ) t
      where t.bucket < 90 and t.total is not null
    ) p
    where p.amount > 0
  ) n;

  insert into public.ledger_entries
    (tenant_id, session_id, student_id, entry_type, amount, occurred_at, note)
  select
    v_tenant_id, v_session_id, i.student_id, 'fine', 200,
    (current_date - 5)::timestamptz, 'Late payment fine'
  from public.invoices i
  where i.tenant_id = v_tenant_id and i.session_id = v_session_id
    and abs(hashtext(i.student_id::text)) % 100 >= 95;

  -- One reversal, so the ledger view has a real example of the module's only
  -- undo: the original stays, struck through, with its mirror beneath it.
  select id into v_demo_entry
  from public.ledger_entries
  where tenant_id = v_tenant_id and entry_type = 'payment' and receipt_number is not null
  order by receipt_number
  limit 1;

  if v_demo_entry is not null then
    insert into public.ledger_entries
      (tenant_id, session_id, student_id, invoice_id, entry_type, amount,
       occurred_at, method, note, reverses_entry_id)
    select
      tenant_id, session_id, student_id, invoice_id, entry_type, -amount,
      (current_date - 3)::timestamptz, method,
      'Reversal: cheque returned unpaid', id
    from public.ledger_entries
    where id = v_demo_entry;
  end if;

  -- Continue the series rather than colliding with it.
  insert into public.document_sequences (tenant_id, session_id, kind, prefix, next_value)
  values
    (v_tenant_id, v_session_id, 'invoice', 'IN',
     (select count(*) + 1 from public.invoices
      where tenant_id = v_tenant_id and session_id = v_session_id)),
    (v_tenant_id, v_session_id, 'receipt', 'RC',
     (select count(*) + 1 from public.ledger_entries
      where tenant_id = v_tenant_id and session_id = v_session_id
        and receipt_number is not null))
  on conflict (tenant_id, session_id, kind) do update
    set next_value = excluded.next_value;

  raise notice 'Fees seeded for session %', v_year;
end $$;
