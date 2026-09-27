-- 0291: the overview stops paying twice for two numbers.
--
-- Measured as the demo college's administrator, the day after 0290 applied:
-- module_overview() 727 ms first call, 230 ms after. Two blocks were most of
-- it: fees_day_book(today, today) 105 ms and hr_attendance_sheet(today) 80 ms.
-- dashboard_summary() -- on the same page, in the same request -- already
-- computes both, with the same expressions, under a gate each tile's gate
-- implies (fees.view is held by everybody holding fees.collect; hr.view is the
-- same permission). So the home page reads those two counts from the brief, and
-- this function returns null for them rather than computing them a second time.
--
-- Null, not zero: the page must not draw "0 receipts today" from this document
-- when the answer is simply elsewhere.

create or replace function public.module_overview()
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_session uuid;
  v_today   date;
  v_out     jsonb := '[]'::jsonb;
  v_n       bigint;
  v_m       bigint;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  v_session := public.current_session_id(v_tenant);
  v_today := public.mobile_today();

  if public.current_role_allows('students.view') then
    v_out := v_out || jsonb_build_object('key', 'students',
      'count', (select count(*) from public.students s where s.status = 'active'),
      'attention', null,
      'can_act', public.current_role_allows('students.manage'));
  end if;

  if public.current_role_allows('staff.view') then
    v_out := v_out || jsonb_build_object('key', 'staff',
      'count', (select count(*) from public.staff s where s.status = 'active'),
      'attention', null,
      'can_act', public.current_role_allows('staff.manage'));
  end if;

  if public.current_role_allows('academics.view') then
    v_out := v_out || jsonb_build_object('key', 'classes',
      'count', (select count(*) from public.sections sec where sec.session_id = v_session),
      'attention', null,
      'can_act', public.current_role_allows('academics.manage'));
    v_out := v_out || jsonb_build_object('key', 'timetable',
      'count', (select count(*) from public.timetable_entries t where t.session_id = v_session),
      'attention', null,
      'can_act', public.current_role_allows('academics.manage'));
  end if;

  if public.current_role_allows('attendance.mark') then
    -- Both sides narrowed by the same policy (rule 4, 0201): the classes the
    -- caller can see children in, against the registers taken for them today.
    select count(distinct e.section_id) into v_n
    from public.enrolments e
    where e.session_id = v_session and e.status = 'active';

    select count(distinct e.section_id) into v_m
    from public.attendance_records a
    join public.enrolments e on e.id = a.enrolment_id
    where a.attendance_date = v_today and a.session_id = v_session;

    v_out := v_out || jsonb_build_object('key', 'attendance',
      'count', v_m,
      'total', v_n,
      'attention', case when public.academics_is_teaching_day(v_today)
                        then greatest(v_n - v_m, 0) else null end,
      'can_act', true);
  end if;

  if public.current_role_allows('frontoffice.view') then
    v_out := v_out || jsonb_build_object('key', 'front_office',
      'count', (select count(*) from public.enquiries q
                where q.status in ('new', 'contacted', 'visited', 'applied')),
      'attention', (select count(*) from public.enquiries q
                    where q.status in ('new', 'contacted', 'visited', 'applied')
                      and q.next_follow_up_on <= v_today),
      'can_act', public.current_role_allows('frontoffice.manage'));
  end if;

  if public.current_role_allows('fees.collect') then
    -- Receipts today are dashboard_summary's `fees.receipts_today`; the page
    -- reads them from there (0291).
    v_out := v_out || jsonb_build_object('key', 'fees',
      'count', null,
      'attention', null,
      'can_act', true);
  end if;

  if public.current_role_allows('exams.view') then
    v_out := v_out || jsonb_build_object('key', 'exams',
      'count', (select count(*) from public.exams x where x.session_id = v_session),
      'attention', (select count(*) from public.exams x
                    where x.session_id = v_session and x.status = 'draft'),
      'can_act', public.current_role_allows('exams.manage'));
  end if;

  if public.current_role_allows('homework.manage') then
    v_out := v_out || jsonb_build_object('key', 'homework',
      'count', (select count(*) from public.homework h
                where h.session_id = v_session and h.status = 'published'),
      'attention', (select count(*) from public.homework h
                    where h.session_id = v_session and h.status = 'published'
                      and h.due_on between v_today and v_today + 7),
      'can_act', true);
  end if;

  if public.current_role_allows('library.view') then
    v_out := v_out || jsonb_build_object('key', 'library',
      'count', (select count(*) from public.book_issues i where i.status = 'issued'),
      'attention', (select count(*) from public.book_issues i
                    where i.status = 'issued' and i.due_at < v_today),
      'can_act', public.current_role_allows('library.issue'));
  end if;

  if public.current_role_allows('transport.view') then
    v_out := v_out || jsonb_build_object('key', 'transport',
      'count', (select count(*) from public.transport_assignments ta
                where ta.status = 'active'
                  and ta.starts_on <= v_today and ta.effective_ends_on >= v_today),
      'attention', null,
      'can_act', public.current_role_allows('transport.assign'));
  end if;

  if public.current_role_allows('hostel.view') then
    v_out := v_out || jsonb_build_object('key', 'hostel',
      'count', (select count(*) from public.hostel_allocations h
                where h.status = 'active'
                  and h.starts_on <= v_today and h.effective_ends_on >= v_today),
      'attention', null,
      'can_act', public.current_role_allows('hostel.allocate'));
  end if;

  if public.current_role_allows('notices.view') then
    v_out := v_out || jsonb_build_object('key', 'notices',
      'count', (select count(*) from public.notices n
                where n.status = 'published'
                  and (n.expires_on is null or n.expires_on >= v_today)),
      'attention', null,
      'can_act', public.current_role_allows('notices.manage'));
  end if;

  if public.current_role_allows('leave.decide') then
    v_out := v_out || jsonb_build_object('key', 'student_leave',
      'count', (select count(*) from public.student_leave_requests r
                where r.status = 'pending'),
      'attention', (select count(*) from public.student_leave_requests r
                    where r.status = 'pending'),
      'can_act', true);
  end if;

  if public.current_role_allows('hr.view') then
    -- Marked and roll are dashboard_summary's `staff_attendance`; the page
    -- reads them from there (0291).
    v_out := v_out || jsonb_build_object('key', 'staff_attendance',
      'count', null,
      'attention', case when public.current_role_allows('hr.manage')
                        then (select count(*) from public.leave_requests l where l.status = 'pending')
                        else null end,
      'can_act', public.current_role_allows('hr.manage'));
  end if;

  if public.current_role_allows('payroll.process') then
    v_out := v_out || jsonb_build_object('key', 'payroll',
      'count', null,
      'last_month', (select max(r.period_month) from public.payroll_runs r
                     where r.status = 'finalised' and r.run_kind = 'regular'),
      'attention', null,
      'can_act', true);
  end if;

  if public.current_role_allows('accounts.view') then
    v_out := v_out || jsonb_build_object('key', 'accounts',
      'count', (select count(*) from public.journal_vouchers j
                where j.status = 'posted'
                  and j.voucher_date >= date_trunc('month', v_today)::date),
      'attention', (select count(*) from public.journal_vouchers j where j.status = 'draft'),
      'can_act', public.current_role_allows('accounts.post'));
  end if;

  if public.current_role_allows('inventory.view') then
    v_out := v_out || jsonb_build_object('key', 'inventory',
      'count', (select count(*) from public.inventory_items i where i.is_active),
      'attention', null,
      'can_act', public.current_role_allows('inventory.adjust'));
  end if;

  if public.current_role_allows('certificates.view') then
    v_out := v_out || jsonb_build_object('key', 'certificates',
      'count', (select count(*) from public.certificates c
                where c.session_id = v_session and c.status = 'issued'),
      'attention', null,
      'can_act', public.current_role_allows('certificates.issue'));
  end if;

  if public.current_role_allows('reports.view') then
    v_out := v_out || jsonb_build_object('key', 'reports',
      'count', null, 'attention', null, 'can_act', true);
  end if;

  if public.current_role_allows('users.manage') then
    v_out := v_out || jsonb_build_object('key', 'logins',
      'count', (select count(*) from public.user_profiles up where up.is_active),
      'attention', (select count(*) from public.invitations i where i.status = 'pending'),
      'can_act', true);
  end if;

  if public.current_role_allows('settings.manage') then
    v_out := v_out || jsonb_build_object('key', 'settings',
      'count', null, 'attention', null, 'can_act', true);
  end if;

  return jsonb_build_object('today', v_today, 'modules', v_out);
end;
$$;

comment on function public.module_overview() is
  'One entry per module the caller may open, with the count their own screen would show and the number needing action today (0290, 0291). Invoker on purpose: a tile must agree with the screen behind it.';

revoke all on function public.module_overview() from public, anon;
grant execute on function public.module_overview() to authenticated;
