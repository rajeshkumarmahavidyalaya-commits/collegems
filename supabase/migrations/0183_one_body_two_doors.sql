-- 0183 — One body, two doors: a write that can name its year.
--
-- Renewing a bus seat or a hostel bed for the coming year has to write into a
-- session that is not the current one. A school prepares the rollover in March;
-- `is_current` flips in April, deliberately and separately (see
-- `docs/modules/promotion.md`). So both write functions refuse the work:
--
--   * `transport_assign_student` compares the stop's session to
--     `current_session_id()` and raises *"Route R1 belongs to a different
--     academic session"*;
--   * `hostel_allocate` does not take a session at all -- it allocates into
--     whichever one is current, which is the wrong year by construction.
--
-- The answer is the shape CLAUDE.md rule 6 already names, from `notify_send` /
-- `notify_send_for`: **one body, two doors**, never a copy, because a copy is
-- where a check quietly stops being applied in one of them.
--
-- And rule 6 states exactly when that split is safe:
--
-- > That split is only safe where the invoker version's protection is a tenant
-- > or role check, not a row-ownership one.
--
-- It is safe here. Neither function is protected by row ownership: both are
-- `SECURITY INVOKER`, both write tables whose INSERT policy is tenant-wide and
-- admin-only, and both do their own explicit checks (the route is running, the
-- child is enrolled *in that session*, the bus has a seat, the house takes this
-- child, the dates fall inside the year). Parameterising the session changes
-- which year is written, not who may write it -- and the enrolment check is
-- what stops somebody renewing a child into a year they are not in.
--
-- One behaviour changes for both doors, and it is the change that makes March
-- work:
--
-- > The default start date is now **the later of today and the year's own first
-- > day**, not today.
--
-- Inside the current year that is still simply today. For a year that has not
-- begun it is 1 April, which is the only date that satisfies the boundary
-- CHECK from migration 0178 -- and the only date a person would have typed.

create or replace function public.transport_assign_student_for(
  p_session_id uuid,
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
  v_starts date;
  v_assigned integer;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
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

  if v_stop.session_id <> p_session_id then
    raise exception 'Route % belongs to a different academic session', v_stop.route_code;
  end if;

  -- The default start is the later of today and the year's first day, which is
  -- what makes an arrangement preparable in March for a year beginning in
  -- April. Inside the current year it is still simply today.
  v_starts := coalesce(p_starts_on, greatest(current_date, v_stop.session_starts_on));

  if p_ends_on is not null and p_ends_on < v_starts then
    raise exception 'The arrangement cannot end before it starts';
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

create or replace function public.hostel_allocate_for(
  p_session_id uuid,
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
  v_starts date;
  v_occupied integer;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := p_session_id;
  if v_session_id is null then
    raise exception 'No academic session given';
  end if;

  select name, start_date, end_date into v_session
  from public.academic_sessions where id = v_session_id;

  if v_session.name is null then
    raise exception 'That academic session does not exist';
  end if;

  -- See `transport_assign_student_for`: the later of today and the year's own
  -- first day, so a bed can be booked in March for a year starting in April.
  v_starts := coalesce(p_starts_on, greatest(current_date, v_session.start_date));

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

-- ---------------------------------------------------------------------------
-- The public doors
--
-- Thin wrappers, so every caller in the application is unchanged and there is
-- exactly one body to keep correct. Note that these are *not* narrower: an
-- administrator could always call the underlying work directly. What they are
-- is **defaulted** -- "this year" is what a person at a desk means, and having
-- to name the session for the ordinary case is how the ordinary case gets it
-- wrong.
-- ---------------------------------------------------------------------------

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
  v_session_id uuid := public.current_session_id(public.current_tenant_id());
begin
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  return public.transport_assign_student_for(
    v_session_id, p_student_id, p_stop_id, p_direction, p_starts_on, p_ends_on
  );
end;
$$;

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
  v_session_id uuid := public.current_session_id(public.current_tenant_id());
begin
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  return public.hostel_allocate_for(v_session_id, p_student_id, p_room_id, p_starts_on, p_ends_on);
end;
$$;

revoke all on function public.transport_assign_student_for(uuid, uuid, uuid, text, date, date)
  from public, anon;
grant execute on function public.transport_assign_student_for(uuid, uuid, uuid, text, date, date)
  to authenticated;
revoke all on function public.hostel_allocate_for(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function public.hostel_allocate_for(uuid, uuid, uuid, date, date) to authenticated;
revoke all on function public.transport_assign_student(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_assign_student(uuid, uuid, text, date, date) to authenticated;
revoke all on function public.hostel_allocate(uuid, uuid, date, date) from public, anon;
grant execute on function public.hostel_allocate(uuid, uuid, date, date) to authenticated;

comment on function public.transport_assign_student_for(uuid, uuid, uuid, text, date, date) is
  'Assign a child a seat in a named academic year. The door the renewal run '
  'uses; `transport_assign_student` is the same body defaulted to this year.';
comment on function public.hostel_allocate_for(uuid, uuid, uuid, date, date) is
  'Allocate a bed in a named academic year. The door the renewal run uses; '
  '`hostel_allocate` is the same body defaulted to this year.';
