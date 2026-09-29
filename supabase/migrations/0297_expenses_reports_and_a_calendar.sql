-- 0297: an expense in one form, four reports a school office asks for, and a
-- calendar made of dates the school already keeps.
--
-- 1. `accounts_record_cash(kind, account, paid_via, amount, date, narration)`.
--    WPSchool's office records "electricity bill, 4,500, paid in cash" on one
--    form. Here the only way in was a journal voucher -- debits, credits, lines
--    -- which a clerk should not have to write to pay a bill. This builds the
--    same two-line voucher and posts it through `accounts_post_voucher`, so
--    nothing about the books changes: a double-entry voucher, gaplessly
--    numbered, reversible like any other. INVOKER: the voucher policies and
--    `accounts.post` decide who may.
--
--    The voucher is filed under the year its own date falls in (0198): the
--    date is the whole answer for a bill paid on a day. A date no year covers
--    is refused in a sentence rather than filed into the current flag.
--
-- 2-5. Four catalogue reports (rule 11), each gated on the permission that
--    acts on it (0200, 0295):
--      exams.subjects      how each paper went, from the engine's own frozen
--                          verdict on each child (exam_results.detail) --
--                          grace included -- never re-marked here;
--      hostel.residents    who sleeps where on a day;
--      inventory.stock     the store's own stock_on_hand, with a filter;
--      frontoffice.enquiries  the admissions pipeline by status and source.
--
-- 6. `school_calendar(from, to)`: holidays, exams, fee due dates and notices
--    in one list, for a Calendar screen. INVOKER, so each source is filtered
--    by its own policies: a family sees the notices addressed to them, and a
--    source the caller may not read contributes nothing. No new table: every
--    date here already has an owner, and a second copy of it would disagree.

create or replace function public.accounts_record_cash(
  p_kind text,
  p_account_id uuid,
  p_paid_via_id uuid,
  p_amount numeric,
  p_on date,
  p_narration text
)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_session uuid;
  v_account public.accounts;
  v_via     public.accounts;
  v_id      uuid;
  v_number  text;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if p_kind not in ('expense', 'income') then
    raise exception 'Record an expense or an income.';
  end if;
  if not public.current_role_allows('accounts.post') then
    raise exception 'Recording money in the books needs accounts.post.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'An amount has at most two decimal places.';
  end if;
  if length(btrim(coalesce(p_narration, ''))) < 3 then
    raise exception 'Say what it was for -- the voucher book is read by somebody who was not there.';
  end if;
  p_on := coalesce(p_on, public.mobile_today());

  select * into v_account from public.accounts a where a.id = p_account_id;
  if v_account.id is null then
    raise exception 'That account does not exist.';
  end if;
  if v_account.account_type <> p_kind then
    raise exception '% is an % account, not an % account.',
      v_account.name, v_account.account_type, p_kind;
  end if;
  if not v_account.is_postable or not v_account.is_active then
    raise exception '% is a heading or is closed, so it cannot take an entry.', v_account.name;
  end if;

  select * into v_via from public.accounts a where a.id = p_paid_via_id;
  if v_via.id is null or v_via.account_type <> 'asset' or not v_via.is_postable or not v_via.is_active then
    raise exception 'Choose the cash or bank account the money % .',
      case when p_kind = 'expense' then 'left from' else 'went into' end;
  end if;

  v_session := public.academics_session_for_date(p_on);
  if v_session is null then
    raise exception 'No academic year covers %. Add it under Academic years first.',
      to_char(p_on, 'FMDD Mon YYYY');
  end if;

  insert into public.journal_vouchers (
    tenant_id, session_id, voucher_date, narration, status, source_kind, created_by)
  values (v_tenant, v_session, p_on, btrim(p_narration), 'draft', 'manual', auth.uid())
  returning id into v_id;

  -- An expense debits the expense and credits the cash that paid it; an
  -- income debits the cash it arrived in and credits the income.
  insert into public.voucher_lines (
    tenant_id, voucher_id, voucher_status, account_id, account_type, debit, credit, sort_order)
  values
    (v_tenant, v_id, 'draft',
     case when p_kind = 'expense' then v_account.id else v_via.id end,
     case when p_kind = 'expense' then v_account.account_type else v_via.account_type end,
     p_amount, 0, 1),
    (v_tenant, v_id, 'draft',
     case when p_kind = 'expense' then v_via.id else v_account.id end,
     case when p_kind = 'expense' then v_via.account_type else v_account.account_type end,
     0, p_amount, 2);

  v_number := public.accounts_post_voucher(v_id);
  -- accounts_post_voucher's final UPDATE is policy-governed; a voucher that
  -- stayed a draft must not be reported as posted (rule 6).
  perform 1 from public.journal_vouchers v where v.id = v_id and v.status = 'posted';
  if not found then
    raise exception 'The voucher could not be posted.';
  end if;
  return v_number;
end;
$$;

comment on function public.accounts_record_cash(text, uuid, uuid, numeric, date, text) is
  'An expense or an income in one form, as a posted two-line voucher (0297). INVOKER; refuses without accounts.post; filed under the year its date falls in.';

revoke all on function public.accounts_record_cash(text, uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.accounts_record_cash(text, uuid, uuid, numeric, date, text) to authenticated;

-- 2. How each paper went.
create or replace function public.report_exam_subjects(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      x.name as exam,
      cl.name || ' ' || sec.name as class,
      d ->> 'subject' as subject,
      count(*) filter (where not coalesce((d ->> 'absent')::boolean, false)) as sat,
      count(*) filter (where coalesce((d ->> 'absent')::boolean, false)) as absent,
      count(*) filter (where coalesce((d ->> 'passed')::boolean, false)
                        and not coalesce((d ->> 'absent')::boolean, false)) as passed,
      round(100.0 * count(*) filter (where coalesce((d ->> 'passed')::boolean, false)
                                      and not coalesce((d ->> 'absent')::boolean, false))
            / nullif(count(*) filter (where not coalesce((d ->> 'absent')::boolean, false)), 0), 1)
        as pass_rate,
      round(avg((d ->> 'percent')::numeric)
            filter (where not coalesce((d ->> 'absent')::boolean, false)), 1) as average,
      max((d ->> 'percent')::numeric) as highest,
      x.id as exam_id,
      sec.id as section_id
    from public.exam_results r
    join public.exams x on x.id = r.exam_id
    cross join lateral jsonb_array_elements(coalesce(r.detail, '[]'::jsonb)) d
    left join public.enrolments e
      on e.student_id = r.student_id and e.session_id = r.session_id and e.status = 'active'
    left join public.sections sec on sec.id = e.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    where r.session_id = (select public.current_session_id(public.current_tenant_id()))
      and (public.report_param_uuid(p_params, 'exam_id') is null
           or r.exam_id = public.report_param_uuid(p_params, 'exam_id'))
      and (public.report_param_uuid(p_params, 'section_id') is null
           or e.section_id = public.report_param_uuid(p_params, 'section_id'))
    group by x.id, x.name, sec.id, cl.name, sec.name, cl.sequence, d ->> 'subject'
    order by x.name, cl.sequence nulls last, sec.name, d ->> 'subject', x.id, sec.id
  ) t
$$;

-- 3. Who sleeps where on a day.
create or replace function public.report_hostel_residents(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      a.student_id,
      h.name as hostel,
      r.room_number as room,
      r.floor,
      (p.first_name || coalesce(' ' || p.last_name, '')) as student,
      st.admission_number,
      cl.name || ' ' || sec.name as class,
      a.monthly_fare,
      a.starts_on,
      a.effective_ends_on as ends_on,
      a.id as allocation_id
    from public.hostel_allocations a
    join public.hostels h on h.id = a.hostel_id
    join public.hostel_rooms r on r.id = a.room_id
    join public.students st on st.id = a.student_id
    join public.people p on p.id = st.person_id
    left join public.enrolments e
      on e.student_id = a.student_id and e.session_id = a.session_id and e.status = 'active'
    left join public.sections sec on sec.id = e.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    where a.status = 'active'
      and a.starts_on <= public.report_param_date(p_params, 'on', public.mobile_today())
      and a.effective_ends_on >= public.report_param_date(p_params, 'on', public.mobile_today())
      and (public.report_param_uuid(p_params, 'section_id') is null
           or e.section_id = public.report_param_uuid(p_params, 'section_id'))
    order by h.name, r.room_number, p.first_name, a.id
  ) t
$$;

-- 4. The store, through its own stock function (rule 6: a sum, never a column).
create or replace function public.report_inventory_stock(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      s.sku, s.name as item, s.category_name as category, s.unit,
      s.on_hand, s.reorder_level,
      case when s.below_reorder then 'below reorder' else 'ok' end as state,
      s.issued_out, s.average_cost,
      round(s.on_hand * coalesce(s.average_cost, 0), 2) as stock_value,
      s.last_movement,
      s.item_id
    from public.stock_on_hand(public.report_param_date(p_params, 'on', public.mobile_today())) s
    where s.is_active
      and (public.report_param_text(p_params, 'only') is null
           or (public.report_param_text(p_params, 'only') = 'below_reorder' and s.below_reorder)
           or (public.report_param_text(p_params, 'only') = 'assets' and s.is_asset))
    order by s.below_reorder desc, s.category_name nulls last, s.name, s.item_id
  ) t
$$;

-- 5. The admissions pipeline.
create or replace function public.report_enquiries(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      q.enquiry_number,
      (q.applicant_first_name || coalesce(' ' || q.applicant_last_name, '')) as applicant,
      cl.name as class,
      q.contact_name, q.contact_phone,
      q.source, q.status, q.next_follow_up_on,
      (q.created_at at time zone 'Asia/Kolkata')::date as received_on,
      q.id as enquiry_id
    from public.enquiries q
    left join public.class_levels cl on cl.id = q.class_level_id
    where (public.report_param_text(p_params, 'status') is null
           or q.status = public.report_param_text(p_params, 'status'))
      and (public.report_param_text(p_params, 'source') is null
           or q.source = public.report_param_text(p_params, 'source'))
      and q.created_at >= (public.report_param_date(p_params, 'from', public.mobile_today() - 90)::timestamp
                           at time zone 'Asia/Kolkata')
    order by q.created_at desc, q.id
  ) t
$$;

revoke all on function public.report_exam_subjects(jsonb) from public, anon;
revoke all on function public.report_hostel_residents(jsonb) from public, anon;
revoke all on function public.report_inventory_stock(jsonb) from public, anon;
revoke all on function public.report_enquiries(jsonb) from public, anon;
grant execute on function public.report_exam_subjects(jsonb) to authenticated;
grant execute on function public.report_hostel_residents(jsonb) to authenticated;
grant execute on function public.report_inventory_stock(jsonb) to authenticated;
grant execute on function public.report_enquiries(jsonb) to authenticated;

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values
(
  'exams.subjects', 'How each paper went',
  'For each exam, class and subject this year: how many sat, were absent and passed, the pass rate, the average and the highest mark. Read from the result each child was given, so grace marks count exactly as they did on the card.',
  'Exams', 'exams.grade', 'report_exam_subjects',
  '[
     {"name": "section_id", "type": "section", "label": "Class", "required": false}
   ]'::jsonb,
  '[
     {"key": "exam", "type": "text", "label": "Exam"},
     {"key": "class", "type": "text", "label": "Class"},
     {"key": "subject", "type": "text", "label": "Subject"},
     {"key": "sat", "type": "number", "label": "Sat", "align": "right"},
     {"key": "absent", "type": "number", "label": "Absent", "align": "right"},
     {"key": "passed", "type": "number", "label": "Passed", "align": "right"},
     {"key": "pass_rate", "type": "percent", "label": "Pass rate", "align": "right"},
     {"key": "average", "type": "percent", "label": "Average", "align": "right"},
     {"key": "highest", "type": "percent", "label": "Highest", "align": "right"}
   ]'::jsonb,
  35, 'staff'
),
(
  'hostel.residents', 'Who is in which room',
  'Every child in a hostel bed on a day, hostel by hostel and room by room, with their class and the monthly fare.',
  'Hostel', 'hostel.allocate', 'report_hostel_residents',
  '[
     {"name": "on", "type": "date", "label": "On", "required": false},
     {"name": "section_id", "type": "section", "label": "Class", "required": false}
   ]'::jsonb,
  '[
     {"key": "hostel", "type": "text", "label": "Hostel"},
     {"key": "room", "type": "text", "label": "Room"},
     {"key": "floor", "type": "text", "label": "Floor"},
     {"key": "student", "type": "text", "label": "Student", "href": "/students/{student_id}"},
     {"key": "admission_number", "type": "text", "label": "Adm. no."},
     {"key": "class", "type": "text", "label": "Class"},
     {"key": "monthly_fare", "type": "money", "label": "Fare", "align": "right"},
     {"key": "starts_on", "type": "date", "label": "From"},
     {"key": "ends_on", "type": "date", "label": "Until"}
   ]'::jsonb,
  76, 'staff'
),
(
  'inventory.stock', 'Stock in the store',
  'What is on the shelf on a day, item by item, with the reorder level and the value at average cost. Items below their reorder level come first.',
  'Inventory', 'inventory.view', 'report_inventory_stock',
  '[
     {"name": "on", "type": "date", "label": "On", "required": false},
     {"name": "only", "type": "select", "label": "Show", "required": false,
      "options": [
        {"value": "below_reorder", "label": "Below reorder level"},
        {"value": "assets", "label": "Assets"}
      ]}
   ]'::jsonb,
  '[
     {"key": "sku", "type": "text", "label": "SKU"},
     {"key": "item", "type": "text", "label": "Item", "href": "/inventory/{item_id}"},
     {"key": "category", "type": "text", "label": "Category"},
     {"key": "unit", "type": "text", "label": "Unit"},
     {"key": "on_hand", "type": "number", "label": "On hand", "align": "right"},
     {"key": "reorder_level", "type": "number", "label": "Reorder at", "align": "right"},
     {"key": "state", "type": "badge", "label": "State"},
     {"key": "issued_out", "type": "number", "label": "Issued out", "align": "right"},
     {"key": "stock_value", "type": "money", "label": "Value", "align": "right"},
     {"key": "last_movement", "type": "date", "label": "Last moved"}
   ]'::jsonb,
  80, 'staff'
),
(
  'frontoffice.enquiries', 'Admission enquiries',
  'Every enquiry received since a date (the last 90 days unless you choose), newest first, with where it came from, where it has got to and when the next follow-up is due.',
  'Front office', 'frontoffice.view', 'report_enquiries',
  '[
     {"name": "from", "type": "date", "label": "Received since", "required": false},
     {"name": "status", "type": "select", "label": "Stage", "required": false,
      "options": [
        {"value": "new", "label": "New"},
        {"value": "contacted", "label": "Contacted"},
        {"value": "visited", "label": "Visited"},
        {"value": "applied", "label": "Applied"},
        {"value": "admitted", "label": "Admitted"},
        {"value": "lost", "label": "Lost"}
      ]}
   ]'::jsonb,
  '[
     {"key": "enquiry_number", "type": "text", "label": "No."},
     {"key": "applicant", "type": "text", "label": "Applicant"},
     {"key": "class", "type": "text", "label": "For class"},
     {"key": "contact_name", "type": "text", "label": "Contact"},
     {"key": "contact_phone", "type": "text", "label": "Phone"},
     {"key": "source", "type": "badge", "label": "Source"},
     {"key": "status", "type": "badge", "label": "Stage"},
     {"key": "next_follow_up_on", "type": "date", "label": "Follow up"},
     {"key": "received_on", "type": "date", "label": "Received"}
   ]'::jsonb,
  85, 'staff'
)
on conflict (key) do nothing;

-- 6. The calendar.
create or replace function public.school_calendar(p_from date, p_to date)
returns table (
  starts_on date,
  ends_on date,
  kind text,
  title text,
  detail text,
  href text
)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    select least(p_from, p_to) as f,
           least(greatest(p_from, p_to), least(p_from, p_to) + 400) as t
  )
  select * from (
    select h.starts_on, h.ends_on, 'holiday'::text, h.name, h.note, null::text
    from public.holidays h, bounds b
    where h.starts_on <= b.t and h.ends_on >= b.f
    union all
    select x.starts_on, coalesce(x.ends_on, x.starts_on), 'exam', x.name,
           case when x.status = 'draft' then 'Draft' else 'Results published' end,
           '/exams/' || x.id
    from public.exams x, bounds b
    where x.starts_on is not null and x.starts_on <= b.t
      and coalesce(x.ends_on, x.starts_on) >= b.f
    union all
    select i.due_date, i.due_date, 'fee_due', i.name || ' due', null, '/fees/instalments'
    from public.fee_instalments i, bounds b
    where i.is_active and i.due_date between b.f and b.t
    union all
    select n.starts_on, coalesce(n.expires_on, n.starts_on), 'notice', n.title, null,
           '/notices/' || n.id
    from public.notices n, bounds b
    where n.status = 'published' and n.starts_on is not null
      and n.starts_on between b.f and b.t
  ) c(starts_on, ends_on, kind, title, detail, href)
  order by c.starts_on, c.kind, c.title
$$;

comment on function public.school_calendar(date, date) is
  'Holidays, exams, fee due dates and notices between two dates (at most 400 days), for the Calendar screen (0297). INVOKER: each source is read through its own policies, so a caller sees the dates they may see.';

revoke all on function public.school_calendar(date, date) from public, anon;
grant execute on function public.school_calendar(date, date) to authenticated;
