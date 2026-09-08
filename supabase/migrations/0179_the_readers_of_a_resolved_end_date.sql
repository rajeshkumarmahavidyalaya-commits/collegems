-- 0179 — The readers of a resolved end date.
--
-- Migration 0178 put the boundary on the row. This is every function that was
-- asking `ends_on is null or ends_on >= <date>` and therefore treating a null
-- as "for ever", rewritten to ask `effective_ends_on >= <date>` instead.
--
-- Eleven call sites, which is the argument for the constraint rather than
-- against it: the fix is mechanical *because* the row now knows the answer.
-- Had this been done by teaching each reader about `session_id`, each would
-- have needed its own join, its own `current_session_id()` call, and its own
-- decision about what to do when the caller passed an `as_of` in a different
-- year -- which is exactly where `fees_concession_lines` already went wrong.
--
-- Three functions change more than a predicate:
--
--   * `transport_assign_student` and `hostel_allocate` now bound the proposed
--     range too. `daterange(v_starts, p_ends_on, '[]')` with a null end
--     overlapped every existing row, so the capacity check counted last year's
--     riders against this year's bus. Both sides are resolved now.
--   * `fees_concession_lines` drops its `current_session_id()` filter. It was
--     a second mechanism for the fact the row now carries, and the two
--     disagreed: the function takes an `as_of` date and then answered for
--     whichever year happened to be current, so a back-dated invoice raised
--     after a rollover credited nothing.
--
-- And two write functions gain a sentence apiece. The CHECK from 0178 is the
-- enforcement; the sentence exists because the school it catches is one whose
-- current session has run out underneath it, and *"violates check constraint
-- hostel_allocations_within_session_chk"* does not tell a warden to roll the
-- year forward.


-- ---- transport ----------------------------------------------------------

create or replace function public.transport_assign_student(
  p_student_id uuid,
  p_stop_id uuid,
  p_direction text default 'both',
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_stop record;
  v_starts date := coalesce(p_starts_on, current_date);
  v_assigned integer;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_ends_on is not null and p_ends_on < v_starts then
    raise exception 'The arrangement cannot end before it starts';
  end if;

  select
    rs.id as stop_id, rs.name as stop_name, rs.monthly_fare,
    tr.id as route_id, tr.code as route_code, tr.name as route_name,
    tr.direction as route_direction, tr.session_id, tr.is_active,
    tr.vehicle_capacity, v.registration_number,
    -- The year's own dates, so the arrangement can be bounded by it (0178).
    s.name as session_name, s.start_date as session_starts_on,
    s.end_date as session_ends_on
  into v_stop
  from public.route_stops rs
  join public.transport_routes tr on tr.id = rs.route_id
  join public.academic_sessions s on s.id = tr.session_id
  left join public.vehicles v on v.id = tr.vehicle_id
  where rs.id = p_stop_id;

  if v_stop.stop_id is null then
    raise exception 'That stop does not exist';
  end if;

  if not v_stop.is_active then
    raise exception 'Route % (%) is not running, so nobody can be assigned to it',
      v_stop.route_code, v_stop.route_name;
  end if;

  if v_stop.session_id <> public.current_session_id(v_tenant_id) then
    raise exception 'Route % belongs to a different academic session', v_stop.route_code;
  end if;

  if not exists (
    select 1 from public.enrolments e
    where e.student_id = p_student_id
      and e.session_id = v_stop.session_id
      and e.status = 'active'
  ) then
    raise exception 'That student is not enrolled in this session';
  end if;

  -- The constraint added in 0178 enforces this; the sentence is here because
  -- the school it actually catches is one whose current session has run out
  -- underneath it, and "violates check constraint
  -- transport_assignments_within_session_chk" does not say to roll the year
  -- forward. Found live: a hostel bed dated 4 September 2026 on a session that
  -- ended on 31 March.
  if v_starts < v_stop.session_starts_on or v_starts > v_stop.session_ends_on then
    raise exception
      'A seat starting % would fall outside % (% to %). Start the new academic year first.',
      to_char(v_starts, 'FMDD Mon YYYY'), v_stop.session_name,
      to_char(v_stop.session_starts_on, 'FMDD Mon YYYY'),
      to_char(v_stop.session_ends_on, 'FMDD Mon YYYY');
  end if;

  if p_ends_on is not null and p_ends_on > v_stop.session_ends_on then
    raise exception
      'An arrangement belongs to one year. % ends on %, so this one cannot run to %.',
      v_stop.session_name, to_char(v_stop.session_ends_on, 'FMDD Mon YYYY'),
      to_char(p_ends_on, 'FMDD Mon YYYY');
  end if;

  -- The CHECK added in 0084 enforces this. The message is here because
  -- "violates check constraint transport_assignments_direction_chk" is not
  -- something to show somebody at an admissions desk.
  if v_stop.route_direction <> 'both' and p_direction <> v_stop.route_direction then
    raise exception 'Route % only does the % run, so it cannot be used for %',
      v_stop.route_code, v_stop.route_direction, p_direction;
  end if;

  -- Serialise the count and the insert per route, so the last seat cannot be
  -- sold twice.
  perform pg_advisory_xact_lock(hashtextextended(v_stop.route_id::text, 0));

  if v_stop.vehicle_capacity is not null then
    select count(*)::integer into v_assigned
    from public.transport_assignments ta
    where ta.route_id = v_stop.route_id
      and ta.status = 'active'
      -- Both sides resolved: an open-ended seat runs to the end of its year,
      -- not for ever, so last year's riders no longer fill this year's bus.
      and daterange(ta.starts_on, ta.effective_ends_on, '[]')
          && daterange(v_starts, coalesce(p_ends_on, v_stop.session_ends_on), '[]');

    if v_assigned >= v_stop.vehicle_capacity then
      raise exception
        'Route % (%) seats % and % are already assigned for those dates. Free a seat or use another route.',
        v_stop.route_code,
        coalesce(v_stop.registration_number, 'no vehicle'),
        v_stop.vehicle_capacity,
        v_assigned;
    end if;
  end if;

  begin
    insert into public.transport_assignments (
      tenant_id, session_id, student_id, route_id, stop_id,
      route_direction, direction, starts_on, ends_on, monthly_fare,
      session_starts_on, session_ends_on
    )
    values (
      v_tenant_id, v_stop.session_id, p_student_id, v_stop.route_id, p_stop_id,
      v_stop.route_direction, p_direction, v_starts, p_ends_on, v_stop.monthly_fare,
      v_stop.session_starts_on, v_stop.session_ends_on
    )
    returning id into v_id;
  exception when exclusion_violation then
    -- 23P01, from `transport_assignments_no_overlap`.
    raise exception
      'That child already has a transport arrangement covering those dates. End the current one first.';
  end;

  return v_id;
end;
$$;


create or replace function public.transport_route_load(p_session_id uuid default null)
returns table (
  route_id uuid,
  code text,
  name text,
  direction text,
  is_active boolean,
  vehicle_id uuid,
  registration_number text,
  capacity integer,
  driver_name text,
  stop_count integer,
  assigned integer,
  seats_free integer,
  monthly_revenue numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select
    tr.id,
    tr.code,
    tr.name,
    tr.direction,
    tr.is_active,
    tr.vehicle_id,
    v.registration_number,
    tr.vehicle_capacity,
    (dp.first_name || ' ' || dp.last_name)::text,
    (select count(*)::integer from public.route_stops rs where rs.route_id = tr.id),
    coalesce(a.assigned, 0)::integer,
    -- Null, not zero, when no bus is attached: "no seats free" and "we have not
    -- said which bus runs this yet" are different answers and a screen that
    -- shows 0 for both is lying about one of them.
    case when tr.vehicle_capacity is null then null
         else (tr.vehicle_capacity - coalesce(a.assigned, 0))::integer end,
    coalesce(a.revenue, 0)
  from public.transport_routes tr
  left join public.vehicles v on v.id = tr.vehicle_id
  left join public.staff d on d.id = v.driver_staff_id
  left join public.people dp on dp.id = d.person_id
  left join lateral (
    select count(*) as assigned, sum(ta.monthly_fare) as revenue
    from public.transport_assignments ta
    where ta.route_id = tr.id
      and ta.status = 'active'
      and ta.effective_ends_on >= current_date
  ) a on true
  where p_session_id is null or tr.session_id = p_session_id
  order by tr.code
$$;


create or replace function public.transport_manifest(p_route_id uuid)
returns table (
  sequence integer,
  stop_id uuid,
  stop_name text,
  landmark text,
  pickup_time time,
  drop_time time,
  student_id uuid,
  student_name text,
  admission_number text,
  section_label text,
  direction text,
  guardian_name text,
  guardian_phone text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    rs.sequence,
    rs.id,
    rs.name,
    rs.landmark,
    rs.pickup_time,
    rs.drop_time,
    ta.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    st.admission_number,
    (cl.name || ' ' || sec.name)::text,
    ta.direction,
    (gp.first_name || ' ' || gp.last_name)::text,
    gp.phone
  from public.route_stops rs
  left join public.transport_assignments ta
    on ta.stop_id = rs.id
   and ta.status = 'active'
   and ta.effective_ends_on >= current_date
  left join public.students st on st.id = ta.student_id
  left join public.people p on p.id = st.person_id
  left join public.enrolments en
    on en.student_id = ta.student_id
   and en.session_id = ta.session_id
   and en.status = 'active'
  left join public.sections sec on sec.id = en.section_id
  left join public.class_levels cl on cl.id = sec.class_level_id
  -- The primary guardian, and only the primary: a manifest with three numbers
  -- per child is a manifest nobody reads on a roadside.
  left join lateral (
    select gpp.first_name, gpp.last_name, gpp.phone
    from public.guardian_student gs
    join public.guardians g on g.id = gs.guardian_id
    join public.people gpp on gpp.id = g.person_id
    where gs.student_id = ta.student_id
    order by gs.is_primary desc
    limit 1
  ) gp on true
  where rs.route_id = p_route_id
  order by rs.sequence, p.first_name
$$;


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
    and ta.effective_ends_on >= coalesce(p_as_of, current_date)
$$;


-- ---- hostel -------------------------------------------------------------

create or replace function public.hostel_allocate(
  p_student_id uuid,
  p_room_id uuid,
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_session record;
  v_room record;
  v_gender text;
  v_starts date := coalesce(p_starts_on, current_date);
  v_occupied integer;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  select name, start_date, end_date into v_session
  from public.academic_sessions where id = v_session_id;

  if p_ends_on is not null and p_ends_on < v_starts then
    raise exception 'The stay cannot end before it starts';
  end if;

  -- See the note in `transport_assign_student`: the constraint added in 0178
  -- enforces this, and this sentence is what a warden reads instead of it.
  if v_starts < v_session.start_date or v_starts > v_session.end_date then
    raise exception
      'A stay starting % would fall outside % (% to %). Start the new academic year first.',
      to_char(v_starts, 'FMDD Mon YYYY'), v_session.name,
      to_char(v_session.start_date, 'FMDD Mon YYYY'),
      to_char(v_session.end_date, 'FMDD Mon YYYY');
  end if;

  if p_ends_on is not null and p_ends_on > v_session.end_date then
    raise exception
      'A stay belongs to one year. % ends on %, so this one cannot run to %.',
      v_session.name, to_char(v_session.end_date, 'FMDD Mon YYYY'),
      to_char(p_ends_on, 'FMDD Mon YYYY');
  end if;

  select
    r.id as room_id, r.room_number, r.beds, r.monthly_fare, r.is_active as room_active,
    h.id as hostel_id, h.name as hostel_name, h.kind, h.is_active as hostel_active
  into v_room
  from public.hostel_rooms r
  join public.hostels h on h.id = r.hostel_id
  where r.id = p_room_id;

  if v_room.room_id is null then
    raise exception 'That room does not exist';
  end if;
  if not v_room.hostel_active then
    raise exception '% is closed, so nobody can be placed in it', v_room.hostel_name;
  end if;
  if not v_room.room_active then
    raise exception 'Room % is out of use', v_room.room_number;
  end if;

  if not exists (
    select 1 from public.enrolments e
    where e.student_id = p_student_id
      and e.session_id = v_session_id
      and e.status = 'active'
  ) then
    raise exception 'That student is not enrolled in this session';
  end if;

  if v_room.kind <> 'mixed' then
    select p.gender into v_gender
    from public.students s
    join public.people p on p.id = s.person_id
    where s.id = p_student_id;

    -- An unrecorded gender is not a refusal: the office often places a child
    -- before the form comes back, and blocking that would push the work onto
    -- paper.
    if v_gender in ('male', 'female') then
      if (v_room.kind = 'boys' and v_gender <> 'male')
         or (v_room.kind = 'girls' and v_gender <> 'female') then
        raise exception '% is a % hostel, so this student cannot be placed there',
          v_room.hostel_name, v_room.kind;
      end if;
    end if;
  end if;

  -- Serialise the count and the insert per room, so the last bed cannot be
  -- allocated twice. Same reasoning as a bus seat.
  perform pg_advisory_xact_lock(hashtextextended(v_room.room_id::text, 0));

  select count(*)::integer into v_occupied
  from public.hostel_allocations a
  where a.room_id = v_room.room_id
    and a.status = 'active'
    -- Resolved on both sides, so a bed held open-ended last year is free for
    -- this year's intake instead of occupied for ever (0178).
    and daterange(a.starts_on, a.effective_ends_on, '[]')
        && daterange(v_starts, coalesce(p_ends_on, v_session.end_date), '[]');

  if v_occupied >= v_room.beds then
    raise exception
      'Room % in % has % bed(s) and % are taken for those dates. Free one, or choose another room.',
      v_room.room_number, v_room.hostel_name, v_room.beds, v_occupied;
  end if;

  begin
    insert into public.hostel_allocations (
      tenant_id, session_id, student_id, hostel_id, room_id,
      starts_on, ends_on, monthly_fare,
      session_starts_on, session_ends_on
    )
    values (
      v_tenant_id, v_session_id, p_student_id, v_room.hostel_id, v_room.room_id,
      v_starts, p_ends_on, v_room.monthly_fare,
      v_session.start_date, v_session.end_date
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception
      'That child already has a room for those dates. End the current stay first.';
  end;

  return v_id;
end;
$$;


create or replace function public.hostel_occupancy(p_hostel_id uuid default null)
returns table (
  room_id uuid,
  hostel_id uuid,
  hostel_name text,
  hostel_kind text,
  room_number text,
  floor text,
  beds integer,
  occupied integer,
  beds_free integer,
  monthly_fare numeric,
  is_active boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    r.id, h.id, h.name, h.kind, r.room_number, r.floor,
    r.beds,
    coalesce(o.occupied, 0)::integer,
    (r.beds - coalesce(o.occupied, 0))::integer,
    r.monthly_fare,
    r.is_active and h.is_active
  from public.hostel_rooms r
  join public.hostels h on h.id = r.hostel_id
  left join lateral (
    select count(*) as occupied
    from public.hostel_allocations a
    where a.room_id = r.id
      and a.status = 'active'
      and a.effective_ends_on >= current_date
  ) o on true
  where p_hostel_id is null or r.hostel_id = p_hostel_id
  order by h.name, r.room_number
$$;


create or replace function public.hostel_register(p_hostel_id uuid)
returns table (
  room_id uuid,
  room_number text,
  floor text,
  beds integer,
  allocation_id uuid,
  student_id uuid,
  student_name text,
  admission_number text,
  section_label text,
  starts_on date,
  ends_on date,
  guardian_name text,
  guardian_phone text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    r.id, r.room_number, r.floor, r.beds,
    a.id, a.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    st.admission_number,
    (cl.name || ' ' || sec.name)::text,
    a.starts_on, a.ends_on,
    (gp.first_name || ' ' || gp.last_name)::text,
    gp.phone
  from public.hostel_rooms r
  left join public.hostel_allocations a
    on a.room_id = r.id
   and a.status = 'active'
   and a.effective_ends_on >= current_date
  left join public.students st on st.id = a.student_id
  left join public.people p on p.id = st.person_id
  left join public.enrolments en
    on en.student_id = a.student_id
   and en.session_id = a.session_id
   and en.status = 'active'
  left join public.sections sec on sec.id = en.section_id
  left join public.class_levels cl on cl.id = sec.class_level_id
  left join lateral (
    select gpp.first_name, gpp.last_name, gpp.phone
    from public.guardian_student gs
    join public.guardians g on g.id = gs.guardian_id
    join public.people gpp on gpp.id = g.person_id
    where gs.student_id = a.student_id
    order by gs.is_primary desc
    limit 1
  ) gp on true
  where r.hostel_id = p_hostel_id
  order by r.room_number, p.first_name
$$;


create or replace function public.hostel_fee_lines(
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
    h.fee_head_id,
    ('Hostel - ' || h.name || ' room ' || r.room_number)::text,
    a.monthly_fare
  from public.hostel_allocations a
  join public.hostels h on h.id = a.hostel_id
  join public.hostel_rooms r on r.id = a.room_id
  where a.student_id = p_student_id
    and a.status = 'active'
    and a.monthly_fare > 0
    and h.fee_head_id is not null
    and a.starts_on <= coalesce(p_as_of, current_date)
    and a.effective_ends_on >= coalesce(p_as_of, current_date)
$$;


-- ---- concessions --------------------------------------------------------

create or replace function public.concession_award(
  p_student_id uuid,
  p_concession_id uuid,
  p_reason text,
  p_ends_on date default null
)
returns public.student_concessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.student_concessions;
  v_name text;
  v_session record;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session';
  end if;

  select name, end_date into v_session
  from public.academic_sessions where id = v_session_id;

  -- An award is for a year. Running one past the year's end would make next
  -- year's bill quietly cheaper for a family nobody re-awarded (0178).
  if p_ends_on is not null and p_ends_on > v_session.end_date then
    raise exception
      'An award runs for one year. % ends on %, so this one cannot run to %. Award it again next year.',
      v_session.name, to_char(v_session.end_date, 'FMDD Mon YYYY'),
      to_char(p_ends_on, 'FMDD Mon YYYY');
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this concession was granted -- a discount with no reason is the one an auditor asks about';
  end if;

  select name into v_name from public.fee_concessions
  where id = p_concession_id and is_active;
  if v_name is null then
    raise exception 'No such concession, or it is no longer offered';
  end if;

  begin
    insert into public.student_concessions (
      tenant_id, session_id, student_id, concession_id,
      reason, ends_on, granted_by, session_ends_on
    )
    values (
      v_tenant_id, v_session_id, p_student_id, p_concession_id,
      trim(p_reason), p_ends_on, ( select auth.uid() ), v_session.end_date
    )
    returning * into v_row;
  exception when unique_violation then
    raise exception '% is already awarded to this student for this year. Revoke it first if the terms have changed.', v_name;
  end;

  if v_row.id is null then
    raise exception 'You may not award concessions';
  end if;

  return v_row;
end;
$$;


create or replace function public.fees_concession_lines(
  p_student_id uuid,
  p_charges jsonb,
  p_as_of date default null
)
returns table (
  award_id uuid,
  concession_id uuid,
  code text,
  name text,
  amount numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with as_of as (select coalesce(p_as_of, current_date) as d),
  -- What the concession is being taken off. Passed in rather than recomputed,
  -- so a preview and an invoice cannot disagree about the charge -- the same
  -- reason `fees_billable_lines` is consulted by both.
  charged as (
    select
      (c.key)::uuid as fee_head_id,
      (c.value)::numeric as amount
    from jsonb_each_text(coalesce(p_charges, '{}'::jsonb)) c
  ),
  total as (select coalesce(sum(amount), 0) as gross from charged),
  live as (
    select
      sc.id as award_id,
      fc.id as concession_id,
      fc.code,
      fc.name,
      fc.kind,
      fc.value,
      fc.max_amount,
      fc.priority,
      -- Only the heads this concession applies to. Null means all of them.
      coalesce(
        (select sum(ch.amount) from charged ch
          where fc.fee_head_ids is null or ch.fee_head_id = any (fc.fee_head_ids)),
        0
      ) as base
    from public.student_concessions sc
    join public.fee_concessions fc
      on fc.id = sc.concession_id and fc.tenant_id = sc.tenant_id
    cross join as_of a
    where sc.student_id = p_student_id
      and sc.status = 'active'
      and fc.is_active
      and sc.granted_on <= a.d
      and sc.effective_ends_on >= a.d
  ),
  -- Step 2 and 3: percentages, each against the original base, each capped.
  pct as (
    select
      l.*,
      least(
        round(l.base * l.value / 100.0, 2),
        coalesce(l.max_amount, 1e18)
      ) as raw
    from live l
    where l.kind = 'percentage'
  ),
  pct_total as (select coalesce(sum(raw), 0) as taken from pct),
  -- Step 4: fixed amounts, against what the percentages left.
  amt as (
    select
      l.*,
      least(l.value, greatest((select gross from total) - (select taken from pct_total), 0)) as raw
    from live l
    where l.kind = 'amount'
  ),
  combined as (
    select award_id, concession_id, code, name, priority, raw from pct
    union all
    select award_id, concession_id, code, name, priority, raw from amt
  ),
  -- Step 5: the running total, so the cap falls on whichever concession
  -- crosses the line rather than on all of them proportionally. Ordered, which
  -- is what makes "priority" mean something.
  ordered as (
    select
      c.*,
      coalesce(sum(c.raw) over (
        order by c.priority, c.code
        rows between unbounded preceding and 1 preceding
      ), 0) as taken_before
    from combined c
  )
  select
    o.award_id,
    o.concession_id,
    o.code::text,
    o.name::text,
    round(
      least(o.raw, greatest((select gross from total) - o.taken_before, 0)),
      2
    ) as amount
  from ordered o
  where round(least(o.raw, greatest((select gross from total) - o.taken_before, 0)), 2) > 0
  order by o.priority, o.code
$$;


-- ---- leaving ------------------------------------------------------------

create or replace function public.student_exit(
  p_student_id uuid,
  p_reason text,
  p_left_on date default null,
  p_status text default 'transferred'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_on date := coalesce(p_left_on, current_date);
  v_name text;
  v_enrolments integer := 0;
  v_transport integer := 0;
  v_hostel integer := 0;
  v_concessions integer := 0;
  v_books integer := 0;
  v_balance numeric := 0;
  v_outstanding jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_status not in ('transferred', 'alumni', 'expelled', 'inactive') then
    raise exception 'A child leaves as transferred, alumni, expelled or inactive -- not "%"', p_status;
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this child is leaving -- it is the only thing a record five years from now will have';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);

  select (p.first_name || ' ' || p.last_name) into v_name
  from public.students st join public.people p on p.id = st.person_id
  where st.id = p_student_id;

  if v_name is null then
    raise exception 'No such student, or you cannot see them';
  end if;

  -- 1. The enrolment. `withdrawn` rather than `transferred_out` unless the
  --    school said transfer, because the two mean different things to whoever
  --    reads a class list next year.
  update public.enrolments
  set status = case when p_status = 'transferred' then 'transferred_out' else 'withdrawn' end
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_enrolments = row_count;

  -- 2. The bus seat. Ended, not cancelled -- see the header.
  --
  --    Two statements, because "ended" and "cancelled" are not a style choice.
  --    A child who rode the bus until today has that ended on today; a child
  --    booked onto next year's bus never rode it, and an `ends_on` before
  --    `starts_on` is refused by the range CHECK anyway. That second case only
  --    became reachable once an arrangement could belong to a year that has
  --    not started (0178), and it would have raised 23514 in the middle of an
  --    exit.
  update public.transport_assignments
  set ends_on = v_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= v_on
    and effective_ends_on > v_on;
  get diagnostics v_transport = row_count;

  update public.transport_assignments
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > v_on;

  -- 3. The hostel bed, which also frees it for somebody else.
  update public.hostel_allocations
  set ends_on = v_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= v_on
    and effective_ends_on > v_on;
  get diagnostics v_hostel = row_count;

  update public.hostel_allocations
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > v_on;

  -- 4. Concessions. A discount on a bill nobody will raise is harmless, but it
  --    keeps the child on the concessions register and in its cost total, which
  --    is a number a bursar reports to a board.
  update public.student_concessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = ( select auth.uid() ),
      revoke_reason = format('Left the school on %s', to_char(v_on, 'FMDD Mon YYYY'))
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_concessions = row_count;

  -- 5. The status itself, last, so a failure above leaves the child visibly
  --    still here rather than half-gone.
  update public.students
  set status = p_status
  where id = p_student_id and tenant_id = v_tenant_id;

  -- ---- what could not be ended --------------------------------------------

  select count(*) into v_books
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  where m.student_id = p_student_id and bi.status = 'issued';

  if v_books > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'library',
      'message', format(
        '%s still has %s library %s out. Leaving does not return them.',
        v_name, v_books, case when v_books = 1 then 'book' else 'books' end)
    );
  end if;

  select coalesce(b.balance, 0) into v_balance
  from public.fees_student_balances() b
  where b.student_id = p_student_id;

  if coalesce(v_balance, 0) > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'balance',
      'message', format(
        '%s owes %s. Whether that is chased, written off or withholds a '
        'certificate is the school''s to decide -- this has not touched it.',
        v_name, to_char(v_balance, 'FM999999990.00'))
    );
  end if;

  return jsonb_build_object(
    'student_id', p_student_id,
    'student', v_name,
    'left_on', v_on,
    'status', p_status,
    'closed', jsonb_build_object(
      'enrolments', v_enrolments,
      'transport', v_transport,
      'hostel', v_hostel,
      'concessions', v_concessions
    ),
    'outstanding', v_outstanding
  );
end;
$$;


create or replace function public.student_exit_problems()
returns table (student_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  select
    st.id,
    'warning'::text,
    format(
      '%s %s is marked %s but %s. They will keep being billed.',
      p.first_name, p.last_name, st.status,
      array_to_string(array_remove(array[
        case when exists (select 1 from public.enrolments e
                          where e.student_id = st.id and e.status = 'active')
             then 'is still enrolled' end,
        -- `> current_date`, not `>=`: an assignment ending today is one that
        -- has been ended. See this migration's header.
        case when exists (select 1 from public.transport_assignments ta
                          where ta.student_id = st.id and ta.status = 'active'
                            and ta.effective_ends_on > current_date)
             then 'still has a bus seat' end,
        case when exists (select 1 from public.hostel_allocations ha
                          where ha.student_id = st.id and ha.status = 'active'
                            and ha.effective_ends_on > current_date)
             then 'still has a hostel bed' end
      ], null), ' and ')
    )
  from public.students st
  join public.people p on p.id = st.person_id
  where st.status in ('transferred', 'alumni', 'expelled')
    and (
      exists (select 1 from public.enrolments e
              where e.student_id = st.id and e.status = 'active')
      or exists (select 1 from public.transport_assignments ta
                 where ta.student_id = st.id and ta.status = 'active'
                   and ta.effective_ends_on > current_date)
      or exists (select 1 from public.hostel_allocations ha
                 where ha.student_id = st.id and ha.status = 'active'
                   and ha.effective_ends_on > current_date)
    )

  union all

  select
    st.id,
    'warning'::text,
    format(
      '%s %s is active but has no enrolment this year, so they appear on no '
      'register. Re-enrol them, or record that they have left.',
      p.first_name, p.last_name
    )
  from public.students st
  join public.people p on p.id = st.person_id
  where st.status = 'active'
    and not exists (
      select 1 from public.enrolments e
      where e.student_id = st.id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
    )

  order by 2, 3
$$;


-- ---- the two family screens ----------------------------------------------
--
-- A return type cannot be widened by `create or replace`, and two bodies is
-- where one of them quietly stops being updated -- so these are dropped and
-- recreated rather than duplicated under a new name. The added column is
-- additive for `mobile_student`, which embeds the row wholesale
-- (CLAUDE.md rule 14).

drop function if exists public.transport_for_student(uuid);

create or replace function public.transport_for_student(p_student_id uuid)
returns table (
  assignment_id uuid,
  route_code text,
  route_name text,
  stop_name text,
  landmark text,
  pickup_time time,
  drop_time time,
  direction text,
  monthly_fare numeric,
  starts_on date,
  ends_on date,
  effective_ends_on date,
  status text,
  registration_number text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    ta.id, tr.code, tr.name, rs.name, rs.landmark,
    rs.pickup_time, rs.drop_time, ta.direction, ta.monthly_fare,
    ta.starts_on, ta.ends_on, ta.effective_ends_on, ta.status, v.registration_number
  from public.transport_assignments ta
  join public.transport_routes tr on tr.id = ta.route_id
  join public.route_stops rs on rs.id = ta.stop_id
  left join public.vehicles v on v.id = tr.vehicle_id
  where ta.student_id = p_student_id
  order by ta.starts_on desc
$$;

revoke all on function public.transport_for_student(uuid) from public, anon;
grant execute on function public.transport_for_student(uuid) to authenticated;

drop function if exists public.hostel_for_student(uuid);

create or replace function public.hostel_for_student(p_student_id uuid)
returns table (
  allocation_id uuid,
  hostel_name text,
  hostel_kind text,
  room_number text,
  floor text,
  monthly_fare numeric,
  starts_on date,
  ends_on date,
  effective_ends_on date,
  status text,
  warden_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.id, h.name, h.kind, r.room_number, r.floor, a.monthly_fare,
    a.starts_on, a.ends_on, a.effective_ends_on, a.status,
    (wp.first_name || ' ' || wp.last_name)::text
  from public.hostel_allocations a
  join public.hostels h on h.id = a.hostel_id
  join public.hostel_rooms r on r.id = a.room_id
  left join public.staff w on w.id = h.warden_staff_id
  left join public.people wp on wp.id = w.person_id
  where a.student_id = p_student_id
  order by a.starts_on desc
$$;

revoke all on function public.hostel_for_student(uuid) from public, anon;
grant execute on function public.hostel_for_student(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The critic
--
-- Bounding an arrangement to its year makes a question askable that was not
-- askable before: **what ends with this year that nobody has renewed?**
--
-- It is deliberately not asked all year round. A bus seat that ends in March
-- is not a problem in July, and a check that is red for eleven months is a
-- check people learn to ignore (CLAUDE.md rule 12). It speaks in the last six
-- weeks of the year and after it, and it goes quiet the moment the
-- arrangements exist in the receiving session -- so a school that has already
-- rolled forward is told nothing.
-- ---------------------------------------------------------------------------

create or replace function public.academics_session_problems()
returns table (severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with cur as (
    select s.* from public.academic_sessions s
    where s.tenant_id = public.current_tenant_id() and s.is_current
    limit 1
  ),
  nxt as (
    select s.* from public.academic_sessions s, cur
    where s.tenant_id = cur.tenant_id and s.start_date > cur.end_date
    order by s.start_date
    limit 1
  ),
  -- Only inside the window where somebody can do something about it.
  due as (select 1 from cur where current_date >= cur.end_date - 42)
  select 'warning'::text, format(
    'The current session %s ended on %s. Until a new year is made current, '
    'nothing can be dated today -- a bus seat, a hostel bed and a concession '
    'all have to fall inside their own year.',
    cur.name, to_char(cur.end_date, 'FMDD Mon YYYY'))
  from cur where current_date > cur.end_date

  union all
  select 'warning'::text, format(
    '%s ends on %s and there is no later session to roll into. Create it '
    'before the year turns.',
    cur.name, to_char(cur.end_date, 'FMDD Mon YYYY'))
  from cur where exists (select 1 from due) and not exists (select 1 from nxt)

  union all
  select 'info'::text, format(
    '%s bus %s end with %s and %s not been renewed for %s.',
    x.n, case when x.n = 1 then 'seat' else 'seats' end,
    cur.name, case when x.n = 1 then 'has' else 'have' end, nxt.name)
  from cur, nxt, due, lateral (
    select count(*)::integer as n
    from public.transport_assignments ta
    where ta.session_id = cur.id
      and ta.status = 'active'
      and not exists (
        select 1 from public.transport_assignments nt
        where nt.student_id = ta.student_id
          and nt.session_id = nxt.id
          and nt.status = 'active')
  ) x
  where x.n > 0

  union all
  select 'info'::text, format(
    '%s hostel %s end with %s and %s not been renewed for %s.',
    x.n, case when x.n = 1 then 'bed' else 'beds' end,
    cur.name, case when x.n = 1 then 'has' else 'have' end, nxt.name)
  from cur, nxt, due, lateral (
    select count(*)::integer as n
    from public.hostel_allocations ha
    where ha.session_id = cur.id
      and ha.status = 'active'
      and not exists (
        select 1 from public.hostel_allocations nh
        where nh.student_id = ha.student_id
          and nh.session_id = nxt.id
          and nh.status = 'active')
  ) x
  where x.n > 0

  union all
  select 'info'::text, format(
    '%s fee %s end with %s. An award is granted by a person for a reason, so '
    'none of them carries itself into %s.',
    x.n, case when x.n = 1 then 'concession' else 'concessions' end,
    cur.name, nxt.name)
  from cur, nxt, due, lateral (
    select count(*)::integer as n
    from public.student_concessions sc
    where sc.session_id = cur.id
      and sc.status = 'active'
      and not exists (
        select 1 from public.student_concessions nc
        where nc.student_id = sc.student_id
          and nc.session_id = nxt.id
          and nc.status = 'active')
  ) x
  where x.n > 0
$$;

revoke all on function public.academics_session_problems() from public, anon;
grant execute on function public.academics_session_problems() to authenticated;

comment on function public.academics_session_problems() is
  'What is about to be left behind by a rollover, in sentences. Silent until '
  'six weeks before the year ends, and silent again once the arrangements '
  'exist in the receiving session.';
