-- 0294: every module page opens on its numbers.
--
-- The home page (0290) gives each module one tile. The page behind the tile
-- then opened on a list, and what a school office looks for first -- how many
-- vehicles, how many routes, how many children and staff on them -- was a
-- matter of counting rows. The WordPress school plugins an office already
-- knows open every module on the same shape: a strip of count cards, then the
-- main action, then the list. This is the data half of that shape.
--
-- `module_cards(p_module)` returns the cards for one module, or null when the
-- caller may not open it. Four things, each copied from 0290 on purpose:
--
--   * INVOKER. A card counts what the caller's own screen would list, so the
--     number on the card and the rows under it cannot disagree (0290's "a tile
--     is a door, so its number is the room's").
--   * Gated on the same permission as the module's tile, inside the function;
--     tests/dashboard/module-cards.test.ts compares the two. A card for a module
--     the caller cannot open would be a count of a room they may not enter.
--   * No `where tenant_id =`: RLS decides (rule 11).
--   * A card whose honest answer depends on a policy the caller does not pass
--     is left out, not zeroed. Staff leave is row-owned, so a teacher would be
--     told nobody is on leave; those cards are drawn only for hr.manage.
--
-- One call per page, and the counts are over tables bounded by the size of a
-- school, except where noted.

create or replace function public.module_cards(p_module text)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_session uuid;
  v_from    date;
  v_to      date;
  v_today   date;
  v_cards   jsonb;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  v_session := public.current_session_id(v_tenant);
  select s.start_date, s.end_date into v_from, v_to
  from public.academic_sessions s where s.id = v_session;
  v_today := public.mobile_today();

  if p_module = 'students' then
    if not public.current_role_allows('students.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'on_roll',
        'count', (select count(*) from public.students s where s.status = 'active')),
      jsonb_build_object('key', 'admitted_this_year',
        'count', (select count(*) from public.students s
                  where s.admission_date between v_from and v_to)),
      jsonb_build_object('key', 'without_class',
        'count', (select count(*) from public.students s
                  where s.status = 'active'
                    and not exists (select 1 from public.enrolments e
                                    where e.student_id = s.id and e.session_id = v_session
                                      and e.status = 'active'))),
      jsonb_build_object('key', 'left_this_year',
        'count', (select count(*) from public.students s
                  where s.status <> 'active' and s.date_of_leaving between v_from and v_to)));

  elsif p_module = 'staff' then
    if not public.current_role_allows('staff.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'active',
        'count', (select count(*) from public.staff s where s.status = 'active')),
      jsonb_build_object('key', 'class_teachers',
        'count', (select count(distinct sec.class_teacher_staff_id) from public.sections sec
                  where sec.session_id = v_session and sec.class_teacher_staff_id is not null)),
      jsonb_build_object('key', 'departments',
        'count', (select count(distinct s.department) from public.staff s
                  where s.status = 'active' and s.department is not null)),
      jsonb_build_object('key', 'left',
        'count', (select count(*) from public.staff s where s.status <> 'active')));

  elsif p_module = 'classes' then
    if not public.current_role_allows('academics.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'class_levels',
        'count', (select count(*) from public.class_levels)),
      jsonb_build_object('key', 'sections',
        'count', (select count(*) from public.sections sec where sec.session_id = v_session)),
      jsonb_build_object('key', 'no_class_teacher',
        'count', (select count(*) from public.sections sec
                  where sec.session_id = v_session and sec.class_teacher_staff_id is null)),
      jsonb_build_object('key', 'subjects',
        'count', (select count(*) from public.subjects sub where sub.is_active)));

  elsif p_module = 'attendance' then
    if not public.current_role_allows('attendance.mark') then return null; end if;
    -- Both sides narrowed by the same policies (0201): the classes the caller
    -- can see children in, and the registers taken for those children.
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'classes',
        'count', (select count(distinct e.section_id) from public.enrolments e
                  where e.session_id = v_session and e.status = 'active')),
      jsonb_build_object('key', 'marked_today',
        'count', (select count(distinct e.section_id)
                  from public.attendance_records a
                  join public.enrolments e on e.id = a.enrolment_id
                  where a.attendance_date = v_today and a.session_id = v_session)),
      jsonb_build_object('key', 'present_today',
        'count', (select count(distinct a.enrolment_id) from public.attendance_records a
                  where a.attendance_date = v_today and a.session_id = v_session
                    and a.status = 'present')),
      jsonb_build_object('key', 'absent_today',
        'count', (select count(distinct a.enrolment_id) from public.attendance_records a
                  where a.attendance_date = v_today and a.session_id = v_session
                    and a.status = 'absent')));

  elsif p_module = 'fees' then
    if not public.current_role_allows('fees.collect') then return null; end if;
    -- "Owing" is the module's own read path (rule 11): the balances screen
    -- below the cards asks the same function.
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'owing',
        'count', (select count(*) from public.fees_student_balances(null, true, null))),
      jsonb_build_object('key', 'invoices_this_year',
        'count', (select count(*) from public.invoices i
                  where i.session_id = v_session and i.status = 'issued')),
      jsonb_build_object('key', 'cancelled_this_year',
        'count', (select count(*) from public.invoices i
                  where i.session_id = v_session and i.status = 'cancelled')),
      jsonb_build_object('key', 'fee_heads',
        'count', (select count(*) from public.fee_heads h where h.is_active)));

  elsif p_module = 'exams' then
    if not public.current_role_allows('exams.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'this_year',
        'count', (select count(*) from public.exams x where x.session_id = v_session)),
      jsonb_build_object('key', 'drafts',
        'count', (select count(*) from public.exams x
                  where x.session_id = v_session and x.status = 'draft')),
      jsonb_build_object('key', 'published',
        'count', (select count(*) from public.exams x
                  where x.session_id = v_session and x.status = 'published')));

  elsif p_module = 'homework' then
    if not public.current_role_allows('homework.manage') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'set_this_year',
        'count', (select count(*) from public.homework h
                  where h.session_id = v_session and h.status = 'published')),
      jsonb_build_object('key', 'due_this_week',
        'count', (select count(*) from public.homework h
                  where h.session_id = v_session and h.status = 'published'
                    and h.due_on between v_today and v_today + 7)),
      jsonb_build_object('key', 'to_grade',
        'count', (select count(*) from public.homework_submissions hs
                  where hs.session_id = v_session and hs.status = 'submitted')),
      jsonb_build_object('key', 'drafts',
        'count', (select count(*) from public.homework h
                  where h.session_id = v_session and h.status = 'draft')));

  elsif p_module = 'library' then
    if not public.current_role_allows('library.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'titles',
        'count', (select count(*) from public.books)),
      jsonb_build_object('key', 'members',
        'count', (select count(*) from public.members m where m.status = 'active')),
      jsonb_build_object('key', 'out',
        'count', (select count(*) from public.book_issues i where i.status = 'issued')),
      jsonb_build_object('key', 'overdue',
        'count', (select count(*) from public.book_issues i
                  where i.status = 'issued' and i.due_at < v_today)));

  elsif p_module = 'transport' then
    if not public.current_role_allows('transport.view') then return null; end if;
    -- Riders today, split the way a transport office reads them: children
    -- and staff share the buses and the seat count (0293).
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'vehicles',
        'count', (select count(*) from public.vehicles v where v.is_active)),
      jsonb_build_object('key', 'routes',
        'count', (select count(*) from public.transport_routes r
                  where r.session_id = v_session and r.is_active)),
      jsonb_build_object('key', 'students',
        'count', (select count(*) from public.transport_assignments ta
                  where ta.student_id is not null and ta.status = 'active'
                    and ta.starts_on <= v_today and ta.effective_ends_on >= v_today)),
      jsonb_build_object('key', 'staff',
        'count', (select count(*) from public.transport_assignments ta
                  where ta.staff_id is not null and ta.status = 'active'
                    and ta.starts_on <= v_today and ta.effective_ends_on >= v_today)));

  elsif p_module = 'hostel' then
    if not public.current_role_allows('hostel.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'hostels',
        'count', (select count(*) from public.hostels h where h.is_active)),
      jsonb_build_object('key', 'rooms',
        'count', (select count(*) from public.hostel_rooms r where r.is_active)),
      jsonb_build_object('key', 'beds',
        'count', (select coalesce(sum(r.beds), 0) from public.hostel_rooms r where r.is_active)),
      jsonb_build_object('key', 'occupied',
        'count', (select count(*) from public.hostel_allocations a
                  where a.status = 'active'
                    and a.starts_on <= v_today and a.effective_ends_on >= v_today)));

  elsif p_module = 'inventory' then
    if not public.current_role_allows('inventory.view') then return null; end if;
    -- Below reorder is the module's own stock function: quantity on hand is a
    -- sum, never a column (rule 6), and a second sum here could disagree.
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'items',
        'count', (select count(*) from public.inventory_items i where i.is_active)),
      jsonb_build_object('key', 'below_reorder',
        'count', (select count(*) from public.stock_on_hand(v_today) s
                  where s.is_active and s.below_reorder)),
      jsonb_build_object('key', 'assets',
        'count', (select count(*) from public.inventory_items i where i.is_active and i.is_asset)));

  elsif p_module = 'front_office' then
    if not public.current_role_allows('frontoffice.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'open_enquiries',
        'count', (select count(*) from public.enquiries q
                  where q.status in ('new', 'contacted', 'visited', 'applied'))),
      jsonb_build_object('key', 'follow_ups_due',
        'count', (select count(*) from public.enquiries q
                  where q.status in ('new', 'contacted', 'visited', 'applied')
                    and q.next_follow_up_on <= v_today)),
      jsonb_build_object('key', 'admitted_this_year',
        'count', (select count(*) from public.enquiries q
                  where q.session_id = v_session and q.status = 'admitted')),
      jsonb_build_object('key', 'visitors_in',
        'count', (select count(*) from public.visitors v
                  where v.checked_out_at is null
                    and v.checked_in_at > now() - interval '1 day')));

  elsif p_module = 'notices' then
    if not public.current_role_allows('notices.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'up',
        'count', (select count(*) from public.notices n
                  where n.status = 'published'
                    and (n.expires_on is null or n.expires_on >= v_today))),
      jsonb_build_object('key', 'pinned',
        'count', (select count(*) from public.notices n
                  where n.status = 'published' and n.is_pinned
                    and (n.expires_on is null or n.expires_on >= v_today))),
      jsonb_build_object('key', 'drafts',
        'count', (select count(*) from public.notices n where n.status = 'draft')));

  elsif p_module = 'accounts' then
    if not public.current_role_allows('accounts.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'posted_this_month',
        'count', (select count(*) from public.journal_vouchers j
                  where j.status = 'posted'
                    and j.voucher_date >= date_trunc('month', v_today)::date)),
      jsonb_build_object('key', 'drafts',
        'count', (select count(*) from public.journal_vouchers j where j.status = 'draft')),
      jsonb_build_object('key', 'ledgers',
        'count', (select count(*) from public.accounts a where a.is_active and a.is_postable)));

  elsif p_module = 'certificates' then
    if not public.current_role_allows('certificates.view') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'issued_this_year',
        'count', (select count(*) from public.certificates c
                  where c.session_id = v_session and c.status = 'issued')),
      jsonb_build_object('key', 'for_staff',
        'count', (select count(*) from public.certificates c
                  where c.session_id = v_session and c.status = 'issued'
                    and c.staff_id is not null)),
      jsonb_build_object('key', 'cancelled_this_year',
        'count', (select count(*) from public.certificates c
                  where c.session_id = v_session and c.status = 'cancelled')));

  elsif p_module = 'payroll' then
    if not public.current_role_allows('payroll.process') then return null; end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'finalised_this_year',
        'count', (select count(*) from public.payroll_runs r
                  where r.session_id = v_session and r.status = 'finalised')),
      jsonb_build_object('key', 'drafts',
        'count', (select count(*) from public.payroll_runs r where r.status = 'draft')),
      jsonb_build_object('key', 'on_payroll',
        'count', (select count(*) from public.staff s where s.status = 'active')));

  elsif p_module = 'staff_attendance' then
    -- Staff leave and the staff register are row-owned: a teacher reads their
    -- own row. hr.view alone would make these a count of one person, so the
    -- cards are drawn for hr.manage only (rule 4, "an invoker lies quietly").
    if not public.current_role_allows('hr.view') then return null; end if;
    if not public.current_role_allows('hr.manage') then
      return jsonb_build_object('module', p_module, 'cards', '[]'::jsonb);
    end if;
    v_cards := jsonb_build_array(
      jsonb_build_object('key', 'marked_today',
        'count', (select count(distinct sa.staff_id) from public.staff_attendance sa
                  where sa.attendance_date = v_today)),
      jsonb_build_object('key', 'on_leave_today',
        'count', (select count(distinct l.staff_id) from public.leave_requests l
                  where l.status = 'approved' and v_today between l.starts_on and l.ends_on)),
      jsonb_build_object('key', 'leave_waiting',
        'count', (select count(*) from public.leave_requests l where l.status = 'pending')));

  else
    return null;
  end if;

  return jsonb_build_object('module', p_module, 'cards', v_cards);
end;
$$;

comment on function public.module_cards(text) is
  'The count cards at the top of one module page (0294), or null when the caller may not open that module. INVOKER on purpose: a card counts what the list under it shows. Gated on the same permission as the module''s home tile (0290).';

revoke all on function public.module_cards(text) from public, anon;
grant execute on function public.module_cards(text) to authenticated;
