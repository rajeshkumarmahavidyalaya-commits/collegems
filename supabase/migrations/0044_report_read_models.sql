-- Phase 6.1, part 2 -- the read models, and the catalog rows that describe them.
--
-- Eight reports across five modules. Each is one SECURITY INVOKER function
-- taking `jsonb` parameters and returning `jsonb` rows, so the dispatcher can
-- run any of them without knowing anything about their shape, and RLS still
-- decides every row.
--
-- Four of them are thin wrappers over functions that already exist --
-- `fees_day_book`, `fees_student_balances`, `timetable_teacher_load`,
-- `timetable_for_section`. That is deliberate and is most of the point: a
-- report is a *view* of a module's own read path, not a second implementation
-- of it that is free to disagree. Where a report needed logic that did not
-- exist yet, it is written here once.

-- ---------------------------------------------------------------------------
-- Day boundaries, once
-- ---------------------------------------------------------------------------

-- The same lesson migration 0028 learned for the day book: Vercel runs in UTC,
-- so a date range built in the Node process runs a Kolkata school's September
-- from 05:30 on the 1st to 05:30 on the 1st of October. Any report that filters
-- a `timestamptz` by a date the user typed needs the school's own boundaries,
-- and needs them computed here rather than in four separate report functions.
--
-- Half-open, so the final day is whole without a 23:59:59.999 fencepost, and it
-- stays correct across a DST change.
create or replace function public.report_day_bounds(p_from date, p_to date)
returns table (from_ts timestamptz, to_ts timestamptz)
language sql
stable
set search_path = public, extensions
as $$
  select
    (p_from::timestamp at time zone t.timezone),
    ((p_to + 1)::timestamp at time zone t.timezone)
  from public.tenants t
  where t.id = ( select public.current_tenant_id() )
$$;

revoke all on function public.report_day_bounds(date, date) from public, anon;
grant execute on function public.report_day_bounds(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------------

create or replace function public.report_fee_defaulters(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      b.admission_number,
      b.full_name          as student,
      b.section_label      as class,
      b.roll_number,
      b.charged + b.fines  as billed,
      b.discounts + b.write_offs as relieved,
      b.paid,
      b.balance            as outstanding,
      b.last_payment_at
    from public.fees_student_balances(
      public.report_param_uuid(p_params, 'section_id'),
      true,
      null
    ) b
    -- Default 0.01 rather than 0: a balance of exactly zero is not a
    -- defaulter, and floating a "minimum" of zero would list the whole school.
    where b.balance >= public.report_param_numeric(p_params, 'min_amount', 0.01)
    order by b.balance desc, b.full_name
  ) t
$$;

create or replace function public.report_fee_collection(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      d.occurred_at,
      d.receipt_number,
      d.admission_number,
      d.student_name as student,
      d.entry_type,
      d.method,
      abs(d.amount) as amount,
      d.reference,
      case when d.is_reversal then 'Reversal'
           when d.is_reversed then 'Reversed'
           else 'Settled' end as state
    from public.fees_day_book(
      public.report_param_date(p_params, 'from', current_date - 30),
      public.report_param_date(p_params, 'to', current_date)
    ) d
    order by d.occurred_at desc
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

-- Per-student totals over a range. The percentage rule matches the attendance
-- module's own screen exactly -- late counts as attended, and an excused day is
-- left out of the denominator rather than counted against the student -- because
-- two places computing "attendance %" differently is how a parent ends up with
-- two numbers and no explanation.
create or replace function public.report_attendance_summary(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      st.admission_number,
      (p.first_name || ' ' || p.last_name) as student,
      e.roll_number,
      (cl.name || ' ' || s.name) as class,
      count(ar.id) filter (where ar.status = 'present')::integer as present,
      count(ar.id) filter (where ar.status = 'late')::integer    as late,
      count(ar.id) filter (where ar.status = 'absent')::integer  as absent,
      count(ar.id) filter (where ar.status = 'excused')::integer as excused,
      case
        when count(ar.id) filter (where ar.status in ('present', 'late', 'absent')) = 0
          then null
        else round(
          100.0
          * count(ar.id) filter (where ar.status in ('present', 'late'))
          / count(ar.id) filter (where ar.status in ('present', 'late', 'absent')),
          1
        )
      end as attendance_pct
    from public.enrolments e
    join public.students st on st.id = e.student_id
    join public.people p on p.id = st.person_id
    join public.sections s on s.id = e.section_id
    join public.class_levels cl on cl.id = s.class_level_id
    -- A left join, so a student with no marks at all still appears with zeroes.
    -- Dropping them would quietly turn "nobody marked 7B in September" into
    -- "7B has perfect attendance".
    left join public.attendance_records ar
      on ar.enrolment_id = e.id
     and ar.period = 0
     and ar.attendance_date >= public.report_param_date(p_params, 'from', current_date - 30)
     and ar.attendance_date <= public.report_param_date(p_params, 'to', current_date)
    where e.status = 'active'
      and e.session_id = ( select public.current_session_id(public.current_tenant_id()) )
      and (
        public.report_param_uuid(p_params, 'section_id') is null
        or e.section_id = public.report_param_uuid(p_params, 'section_id')
      )
    group by st.admission_number, p.first_name, p.last_name, e.roll_number, cl.name, s.name
    order by cl.name, s.name, e.roll_number, p.first_name
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------

create or replace function public.report_student_roster(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      st.admission_number,
      (p.first_name || ' ' || p.last_name) as student,
      (cl.name || ' ' || s.name) as class,
      e.roll_number,
      p.gender,
      p.date_of_birth,
      p.phone as student_phone,
      g.guardian_name,
      g.relationship,
      g.guardian_phone
    from public.enrolments e
    join public.students st on st.id = e.student_id
    join public.people p on p.id = st.person_id
    join public.sections s on s.id = e.section_id
    join public.class_levels cl on cl.id = s.class_level_id
    -- One guardian per student, preferring the one marked primary. A roster
    -- with three rows for a child who has three contacts is a roster nobody can
    -- take a headcount from.
    left join lateral (
      select
        (gp.first_name || ' ' || gp.last_name) as guardian_name,
        gs.relationship,
        gp.phone as guardian_phone
      from public.guardian_student gs
      join public.guardians gu on gu.id = gs.guardian_id
      join public.people gp on gp.id = gu.person_id
      where gs.student_id = st.id
      order by gs.is_primary desc, gp.first_name
      limit 1
    ) g on true
    where e.session_id = ( select public.current_session_id(public.current_tenant_id()) )
      and e.status = coalesce(public.report_param_text(p_params, 'status', 'active'), 'active')
      and (
        public.report_param_uuid(p_params, 'section_id') is null
        or e.section_id = public.report_param_uuid(p_params, 'section_id')
      )
    order by cl.name, s.name, e.roll_number, p.first_name
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------

-- The estimate, not a charge. A daily-accruing debt cannot be one immutable
-- ledger row, so the fine is booked at return (migration 0026) and the running
-- amount before then is computed on the fly and stored nowhere. This report is
-- that computation, and the column is named `estimated_fine` so nobody mistakes
-- it for money owed on the ledger.
create or replace function public.report_library_overdue(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      b.title,
      b.author,
      b.isbn,
      m.membership_number,
      coalesce(
        (sp.first_name || ' ' || sp.last_name),
        (fp.first_name || ' ' || fp.last_name)
      ) as borrower,
      case when m.student_id is not null then 'Student' else 'Staff' end as borrower_type,
      st.admission_number,
      bi.issued_at,
      bi.due_at,
      (current_date - bi.due_at)::integer as days_overdue,
      round(
        (current_date - bi.due_at)
        -- The same coalesce chain as `library_return_book`, including its 2.00
        -- fallback. An estimate computed from a different rate than the charge
        -- would be worse than no estimate.
        * coalesce(
            (select (s.value ->> 'amount')::numeric
             from public.settings s
             where s.tenant_id = bi.tenant_id and s.key = 'library.fine_per_day'),
            2.00
          ),
        2
      ) as estimated_fine
    from public.book_issues bi
    join public.books b on b.id = bi.book_id
    join public.members m on m.id = bi.member_id
    left join public.students st on st.id = m.student_id
    left join public.people sp on sp.id = st.person_id
    left join public.staff sf on sf.id = m.staff_id
    left join public.people fp on fp.id = sf.person_id
    where bi.status = 'issued'
      and bi.due_at < current_date
      and (current_date - bi.due_at) >= public.report_param_numeric(p_params, 'min_days', 1)
    order by bi.due_at
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Timetable
-- ---------------------------------------------------------------------------

create or replace function public.report_teacher_load(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      l.employee_code,
      l.teacher_name,
      l.periods,
      l.sections,
      l.subjects
    from public.timetable_teacher_load() l
    where l.periods >= public.report_param_numeric(p_params, 'min_periods', 0)
    order by l.periods desc, l.employee_code
  ) t
$$;

create or replace function public.report_section_routine(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      case r.weekday
        when 1 then 'Monday'   when 2 then 'Tuesday' when 3 then 'Wednesday'
        when 4 then 'Thursday' when 5 then 'Friday'  when 6 then 'Saturday'
        else 'Sunday'
      end as day,
      r.period_number,
      r.starts_at,
      r.ends_at,
      r.subject_code,
      r.subject_name,
      r.teacher_name,
      r.room_name
    from public.timetable_for_section(
      public.report_param_uuid(p_params, 'section_id')
    ) r
    order by r.weekday, r.period_number
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create or replace function public.report_notification_deliveries(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      d.created_at,
      nt.name as event,
      d.channel,
      coalesce((p.first_name || ' ' || p.last_name), 'Unnamed account') as recipient,
      d.address,
      d.status,
      d.attempts,
      d.last_error,
      d.sent_at,
      (d.read_at is not null) as read
    from public.notification_deliveries d
    join public.notifications n
      on n.tenant_id = d.tenant_id and n.id = d.notification_id
    join reference.notification_types nt on nt.key = n.event_key
    left join public.user_profiles up on up.id = d.recipient_user_id
    left join public.people p on p.id = up.person_id
    cross join lateral public.report_day_bounds(
      public.report_param_date(p_params, 'from', current_date - 30),
      public.report_param_date(p_params, 'to', current_date)
    ) bounds
    where d.created_at >= bounds.from_ts
      and d.created_at < bounds.to_ts
      and (
        public.report_param_text(p_params, 'status') is null
        or d.status = public.report_param_text(p_params, 'status')
      )
      and (
        public.report_param_text(p_params, 'channel') is null
        or d.channel = public.report_param_text(p_params, 'channel')
      )
    order by d.created_at desc
  ) t
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Called through `report_run`, which is itself SECURITY INVOKER -- so these
-- must be executable by the caller, and every row still passes RLS.
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'report_fee_defaulters', 'report_fee_collection', 'report_attendance_summary',
    'report_student_roster', 'report_library_overdue', 'report_teacher_load',
    'report_section_routine', 'report_notification_deliveries'
  ] loop
    execute format('revoke all on function public.%I(jsonb) from public, anon', v_fn);
    execute format('grant execute on function public.%I(jsonb) to authenticated', v_fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The catalog
-- ---------------------------------------------------------------------------

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'fees.defaulters',
    'Fee defaulters',
    'Students with money outstanding, largest first. Reads the same balances the fee counter does.',
    'Fees', 'fees.view', 'report_fee_defaulters',
    '[
      {"name":"section_id","label":"Class","type":"section","required":false},
      {"name":"min_amount","label":"Minimum outstanding","type":"number","required":false}
    ]'::jsonb,
    '[
      {"key":"admission_number","label":"Admission no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"class","label":"Class","type":"text"},
      {"key":"roll_number","label":"Roll","type":"text"},
      {"key":"billed","label":"Billed","type":"money","align":"right"},
      {"key":"relieved","label":"Discount/write-off","type":"money","align":"right"},
      {"key":"paid","label":"Paid","type":"money","align":"right"},
      {"key":"outstanding","label":"Outstanding","type":"money","align":"right"},
      {"key":"last_payment_at","label":"Last paid","type":"date"}
    ]'::jsonb,
    10
  ),
  (
    'fees.collection',
    'Fee collection',
    'Every payment and refund that crossed the counter in a date range, with its receipt number.',
    'Fees', 'fees.view', 'report_fee_collection',
    '[
      {"name":"from","label":"From","type":"date","required":true},
      {"name":"to","label":"To","type":"date","required":true}
    ]'::jsonb,
    '[
      {"key":"occurred_at","label":"When","type":"datetime"},
      {"key":"receipt_number","label":"Receipt","type":"text"},
      {"key":"admission_number","label":"Admission no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"entry_type","label":"Type","type":"badge"},
      {"key":"method","label":"Method","type":"text"},
      {"key":"amount","label":"Amount","type":"money","align":"right"},
      {"key":"reference","label":"Reference","type":"text"},
      {"key":"state","label":"State","type":"badge"}
    ]'::jsonb,
    20
  ),
  (
    'attendance.summary',
    'Attendance summary',
    'Per-student totals over a date range. Late counts as attended; excused days are left out of the percentage.',
    'Attendance', 'attendance.view', 'report_attendance_summary',
    '[
      {"name":"section_id","label":"Class","type":"section","required":false},
      {"name":"from","label":"From","type":"date","required":true},
      {"name":"to","label":"To","type":"date","required":true}
    ]'::jsonb,
    '[
      {"key":"admission_number","label":"Admission no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"class","label":"Class","type":"text"},
      {"key":"roll_number","label":"Roll","type":"text"},
      {"key":"present","label":"Present","type":"number","align":"right"},
      {"key":"late","label":"Late","type":"number","align":"right"},
      {"key":"absent","label":"Absent","type":"number","align":"right"},
      {"key":"excused","label":"Excused","type":"number","align":"right"},
      {"key":"attendance_pct","label":"Attendance","type":"percent","align":"right"}
    ]'::jsonb,
    30
  ),
  (
    'students.roster',
    'Class roster',
    'Students with their guardian and contact numbers — the list a class teacher prints.',
    'Students', 'students.view', 'report_student_roster',
    '[
      {"name":"section_id","label":"Class","type":"section","required":false},
      {"name":"status","label":"Enrolment status","type":"select","required":false,
       "options":[{"value":"active","label":"Active"},{"value":"promoted","label":"Promoted"},
                  {"value":"repeated","label":"Repeated"},{"value":"transferred_out","label":"Transferred out"},
                  {"value":"withdrawn","label":"Withdrawn"}]}
    ]'::jsonb,
    '[
      {"key":"admission_number","label":"Admission no.","type":"text"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"class","label":"Class","type":"text"},
      {"key":"roll_number","label":"Roll","type":"text"},
      {"key":"gender","label":"Gender","type":"text"},
      {"key":"date_of_birth","label":"Date of birth","type":"date"},
      {"key":"guardian_name","label":"Guardian","type":"text"},
      {"key":"relationship","label":"Relationship","type":"text"},
      {"key":"guardian_phone","label":"Guardian phone","type":"text"},
      {"key":"student_phone","label":"Student phone","type":"text"}
    ]'::jsonb,
    40
  ),
  (
    'library.overdue',
    'Overdue books',
    'Books still out past their due date, with the fine as it stands today. An estimate — the charge is booked at return.',
    'Library', 'library.view', 'report_library_overdue',
    '[
      {"name":"min_days","label":"At least this many days late","type":"number","required":false}
    ]'::jsonb,
    '[
      {"key":"title","label":"Title","type":"text"},
      {"key":"author","label":"Author","type":"text"},
      {"key":"borrower","label":"Borrower","type":"text"},
      {"key":"borrower_type","label":"Type","type":"badge"},
      {"key":"membership_number","label":"Member no.","type":"text"},
      {"key":"admission_number","label":"Admission no.","type":"text"},
      {"key":"due_at","label":"Due","type":"date"},
      {"key":"days_overdue","label":"Days late","type":"number","align":"right"},
      {"key":"estimated_fine","label":"Estimated fine","type":"money","align":"right"}
    ]'::jsonb,
    50
  ),
  (
    'timetable.teacher_load',
    'Teaching load',
    'Periods a week per teacher, this session. The number that says whether a routine is finished.',
    'Timetable', 'academics.view', 'report_teacher_load',
    '[
      {"name":"min_periods","label":"At least this many periods","type":"number","required":false}
    ]'::jsonb,
    '[
      {"key":"employee_code","label":"Code","type":"text"},
      {"key":"teacher_name","label":"Teacher","type":"text"},
      {"key":"periods","label":"Periods","type":"number","align":"right"},
      {"key":"sections","label":"Classes","type":"number","align":"right"},
      {"key":"subjects","label":"Subjects","type":"number","align":"right"}
    ]'::jsonb,
    60
  ),
  (
    'timetable.section_routine',
    'Class routine',
    'One class''s week as a list — the printable form of the routine grid.',
    'Timetable', 'academics.view', 'report_section_routine',
    '[
      {"name":"section_id","label":"Class","type":"section","required":true}
    ]'::jsonb,
    '[
      {"key":"day","label":"Day","type":"text"},
      {"key":"period_number","label":"Period","type":"number","align":"right"},
      {"key":"starts_at","label":"From","type":"text"},
      {"key":"ends_at","label":"To","type":"text"},
      {"key":"subject_code","label":"Code","type":"text"},
      {"key":"subject_name","label":"Subject","type":"text"},
      {"key":"teacher_name","label":"Teacher","type":"text"},
      {"key":"room_name","label":"Room","type":"text"}
    ]'::jsonb,
    70
  ),
  (
    'notifications.deliveries',
    'Message deliveries',
    'Every copy of every message sent in a date range, and what became of it.',
    'Notifications', 'communication.view', 'report_notification_deliveries',
    '[
      {"name":"from","label":"From","type":"date","required":true},
      {"name":"to","label":"To","type":"date","required":true},
      {"name":"status","label":"Status","type":"select","required":false,
       "options":[{"value":"queued","label":"Queued"},{"value":"sending","label":"Sending"},
                  {"value":"sent","label":"Sent"},{"value":"failed","label":"Failed"},
                  {"value":"skipped","label":"Skipped"}]},
      {"name":"channel","label":"Channel","type":"select","required":false,
       "options":[{"value":"in_app","label":"In-app"},{"value":"email","label":"Email"},
                  {"value":"sms","label":"SMS"},{"value":"whatsapp","label":"WhatsApp"},
                  {"value":"push","label":"Push"}]}
    ]'::jsonb,
    '[
      {"key":"created_at","label":"When","type":"datetime"},
      {"key":"event","label":"Event","type":"text"},
      {"key":"recipient","label":"Recipient","type":"text"},
      {"key":"channel","label":"Channel","type":"badge"},
      {"key":"address","label":"Sent to","type":"text"},
      {"key":"status","label":"Status","type":"badge"},
      {"key":"attempts","label":"Attempts","type":"number","align":"right"},
      {"key":"sent_at","label":"Sent","type":"datetime"},
      {"key":"last_error","label":"Error","type":"text"}
    ]'::jsonb,
    80
  );
