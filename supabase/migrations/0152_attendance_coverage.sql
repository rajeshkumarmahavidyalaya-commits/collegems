-- ---------------------------------------------------------------------------
-- Which days the register was never taken
-- ---------------------------------------------------------------------------
--
-- This codebase says, in four places, that an attendance percentage is **over
-- what was marked, never over the calendar** -- a register half taken must read
-- as half taken, not as a school half empty. That rule is right, and it has a
-- blind spot which has been open since the attendance module shipped:
--
-- > The rule that stops a percentage lying is the same rule that hides the
-- > register nobody took. Those need **two numbers, not one changed one.**
--
-- 94% attendance over eleven marked days in a forty-day term is not a good
-- month; it is twenty-nine days nobody wrote down, and the percentage cannot
-- say so however it is computed. So this adds the second number, and leaves
-- every existing percentage exactly as it was.
--
-- `holidays` and `weekends` have existed since migration 0031 and are editable
-- on `/academics`, but nothing in student attendance ever read them. Staff
-- attendance did, through `hr_working_days`, which is why a payslip already
-- prorates correctly and a class register does not know Republic Day exists.

-- ---------------------------------------------------------------------------
-- The school's calendar, one row per day
-- ---------------------------------------------------------------------------
--
-- `SECURITY INVOKER`, so a school sees its own closures and no others. Bounded
-- by its range and capped, per rule 7 -- a caller asking for a century gets a
-- year and the cap is stated rather than silently applied.
--
-- **This must agree with `hr_working_days`**, which counts the same thing for
-- payroll. It is a second reader rather than a wrapper because that function
-- returns a count and this needs a day and a reason, and `tests/attendance/`
-- pins the two together over a range. The eventual tidy is to make the payroll
-- one a wrapper over this; it is not done here because it is load-bearing in
-- proration and this migration is not the place to move it.

create or replace function public.attendance_calendar(
  p_from date,
  p_to date
)
returns table (day date, is_working boolean, reason text)
language sql
stable
set search_path = public, extensions
as $$
  select
    d.day::date,
    not (coalesce(weekend.closed, false) or closure.name is not null) as is_working,
    case
      when closure.name is not null then closure.name
      when coalesce(weekend.closed, false) then 'Weekly holiday'
    end as reason
  from generate_series(
    p_from,
    -- A year at a time. Somebody asking for a decade gets a year and the
    -- report says its bound; an unbounded generate_series in a request handler
    -- is exactly what rule 7 is about.
    least(p_to, p_from + 400),
    interval '1 day'
  ) as d(day)
  left join lateral (
    -- A weekday with no row at all counts as teaching. That is the same
    -- reading `hr_working_days` takes, and it is the forgiving one: a school
    -- that has configured nothing has a six-day week, not a closed one.
    select true as closed
    from public.weekends w
    where w.weekday = extract(isodow from d.day)::integer
      and not w.is_teaching
    limit 1
  ) weekend on true
  left join lateral (
    select h.name
    from public.holidays h
    where d.day::date between h.starts_on and h.ends_on
    order by h.starts_on
    limit 1
  ) closure on true
$$;

revoke all on function public.attendance_calendar(date, date) from public, anon;
grant execute on function public.attendance_calendar(date, date) to authenticated;

comment on function public.attendance_calendar(date, date) is
  'One row per day: whether the school is open and, when it is not, why. '
  'Capped at 400 days. Must agree with hr_working_days, and a test pins them.';

-- ---------------------------------------------------------------------------
-- What a section actually wrote down
-- ---------------------------------------------------------------------------

create or replace function public.attendance_coverage(
  p_from date,
  p_to date,
  p_section_id uuid default null
)
returns table (
  section_id uuid,
  section_label text,
  working_days integer,
  days_marked integer,
  days_missing integer,
  coverage_percent numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with days as (
    select c.day from public.attendance_calendar(p_from, p_to) c where c.is_working
  ),
  sections as (
    select
      s.id,
      (cl.name || ' ' || s.name)::text as label
    from public.sections s
    join public.class_levels cl on cl.id = s.class_level_id
    where s.session_id = public.current_session_id(public.current_tenant_id())
      and (p_section_id is null or s.id = p_section_id)
  ),
  marked as (
    select distinct e.section_id, ar.attendance_date
    from public.attendance_records ar
    join public.enrolments e on e.id = ar.enrolment_id
    where ar.attendance_date between p_from and least(p_to, p_from + 400)
  )
  select
    sec.id,
    sec.label,
    (select count(*) from days)::integer,
    count(m.attendance_date)::integer,
    ((select count(*) from days) - count(m.attendance_date))::integer,
    case
      when (select count(*) from days) = 0 then null
      else round(100.0 * count(m.attendance_date) / (select count(*) from days), 1)
    end
  from sections sec
  left join marked m
    on m.section_id = sec.id
   and m.attendance_date in (select day from days)
  group by sec.id, sec.label
  -- Worst covered first: the list is read to find the class nobody has been
  -- taking a register for.
  order by 6 nulls last, sec.label
$$;

revoke all on function public.attendance_coverage(date, date, uuid) from public, anon;
grant execute on function public.attendance_coverage(date, date, uuid) to authenticated;

comment on function public.attendance_coverage(date, date, uuid) is
  'Working days against days a register exists for, per section. The number '
  'every attendance percentage in this codebase deliberately cannot express.';

-- ---------------------------------------------------------------------------
-- ...and which days, exactly
-- ---------------------------------------------------------------------------
--
-- One row per class per unmarked working day. Deliberately not a truncated
-- list inside the coverage function: "and 12 more" is the shape that makes an
-- auditor ask for a spreadsheet, and a report catalog exists precisely so the
-- long answer does not need a screen.

create or replace function public.report_attendance_gaps(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    select
      public.report_param_date(
        p_params, 'from', (public.mobile_today() - 30)) as from_date,
      public.report_param_date(p_params, 'to', public.mobile_today()) as to_date
  ),
  days as (
    select c.day, c.reason
    from bounds b, public.attendance_calendar(b.from_date, b.to_date) c
    where c.is_working
  ),
  sections as (
    select s.id, (cl.name || ' ' || s.name)::text as label, cl.sequence
    from public.sections s
    join public.class_levels cl on cl.id = s.class_level_id
    where s.session_id = public.current_session_id(public.current_tenant_id())
      and (
        public.report_param_uuid(p_params, 'section') is null
        or s.id = public.report_param_uuid(p_params, 'section')
      )
  ),
  marked as (
    select distinct e.section_id, ar.attendance_date
    from public.attendance_records ar
    join public.enrolments e on e.id = ar.enrolment_id, bounds b
    where ar.attendance_date between b.from_date and b.to_date
  )
  select to_jsonb(t)
  from (
    select
      sec.label as section,
      d.day as missing_on,
      to_char(d.day, 'FMDay') as weekday
    from sections sec
    cross join days d
    where not exists (
      select 1 from marked m
      where m.section_id = sec.id and m.attendance_date = d.day
    )
    order by d.day desc, sec.sequence, sec.label
  ) t
$$;

revoke all on function public.report_attendance_gaps(jsonb) from public, anon;
grant execute on function public.report_attendance_gaps(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'attendance.gaps',
    'Registers never taken',
    'One row per class per school day with no register at all. The complement to the attendance percentage, which is deliberately over what was marked and therefore cannot show a day nobody marked. Weekends and holidays are excluded.',
    'Attendance', 'attendance.view', 'report_attendance_gaps',
    '[
      {"name":"from","label":"From","type":"date","required":false},
      {"name":"to","label":"To","type":"date","required":false},
      {"name":"section","label":"Class","type":"section","required":false}
    ]'::jsonb,
    '[
      {"key":"section","label":"Class","type":"text"},
      {"key":"missing_on","label":"No register on","type":"date"},
      {"key":"weekday","label":"Day","type":"text"}
    ]'::jsonb,
    36
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  module = excluded.module,
  required_permission = excluded.required_permission,
  function_name = excluded.function_name,
  parameters = excluded.parameters,
  columns = excluded.columns,
  sort_order = excluded.sort_order;
