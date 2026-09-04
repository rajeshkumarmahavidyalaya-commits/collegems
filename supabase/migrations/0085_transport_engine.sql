-- ---------------------------------------------------------------------------
-- Phase 5.2 — the transport engine
-- ---------------------------------------------------------------------------

-- How full each bus is. The read model behind the routes screen, and the same
-- count the assign function checks against — one definition of "seats free",
-- not two that can disagree.
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
      and (ta.ends_on is null or ta.ends_on >= current_date)
  ) a on true
  where p_session_id is null or tr.session_id = p_session_id
  order by tr.code
$$;

revoke all on function public.transport_route_load(uuid) from public, anon;
grant execute on function public.transport_route_load(uuid) to authenticated;

-- Every stop a child could be assigned to, with the fare attached, so the
-- assign form can show "Sector 12 — 07:10 — ₹1,200/month" without three joins
-- in the browser.
create or replace function public.transport_stop_options(p_session_id uuid default null)
returns table (
  stop_id uuid,
  stop_name text,
  landmark text,
  sequence integer,
  pickup_time time,
  drop_time time,
  monthly_fare numeric,
  route_id uuid,
  route_code text,
  route_name text,
  route_direction text,
  route_is_active boolean,
  seats_free integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    rs.id, rs.name, rs.landmark, rs.sequence, rs.pickup_time, rs.drop_time,
    rs.monthly_fare,
    tr.id, tr.code, tr.name, tr.direction, tr.is_active,
    l.seats_free
  from public.route_stops rs
  join public.transport_routes tr on tr.id = rs.route_id
  left join lateral public.transport_route_load(tr.session_id) l on l.route_id = tr.id
  where p_session_id is null or tr.session_id = p_session_id
  order by tr.code, rs.sequence
$$;

revoke all on function public.transport_stop_options(uuid) from public, anon;
grant execute on function public.transport_stop_options(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assigning
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the admin policy on `transport_assignments` already decides
-- who may write one. What this adds is the three things a raw INSERT cannot —
-- resolving the route and the fare from the stop, a capacity rule that is a
-- fact about other rows, and sentences in place of constraint names.
--
-- The capacity check is the same genre as "debits equal credits": no CHECK can
-- see the other forty rows. It is checked here, under an advisory lock on the
-- route, because two clerks filling the last seat at the same moment would
-- otherwise both pass a check-then-insert.
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
    tr.vehicle_capacity, v.registration_number
  into v_stop
  from public.route_stops rs
  join public.transport_routes tr on tr.id = rs.route_id
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
      and daterange(ta.starts_on, ta.ends_on, '[]')
          && daterange(v_starts, p_ends_on, '[]');

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
      route_direction, direction, starts_on, ends_on, monthly_fare
    )
    values (
      v_tenant_id, v_stop.session_id, p_student_id, v_stop.route_id, p_stop_id,
      v_stop.route_direction, p_direction, v_starts, p_ends_on, v_stop.monthly_fare
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

revoke all on function public.transport_assign_student(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_assign_student(uuid, uuid, text, date, date) to authenticated;

-- Ending an arrangement is not deleting it: the child rode the bus, and an
-- invoice may already refer to it. Closing the range is what frees the seat and
-- what stops the fare being billed next month.
create or replace function public.transport_end_assignment(
  p_assignment_id uuid,
  p_ends_on date default null
)
returns date
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_ends date := coalesce(p_ends_on, current_date);
  v_starts date;
begin
  select starts_on into v_starts
  from public.transport_assignments where id = p_assignment_id;

  if v_starts is null then
    raise exception 'That transport arrangement does not exist';
  end if;

  if v_ends < v_starts then
    raise exception 'An arrangement cannot end before it started (% is before %)', v_ends, v_starts;
  end if;

  update public.transport_assignments
  set ends_on = v_ends
  where id = p_assignment_id;

  return v_ends;
end;
$$;

revoke all on function public.transport_end_assignment(uuid, date) from public, anon;
grant execute on function public.transport_end_assignment(uuid, date) to authenticated;

-- Cancelling is for the arrangement that should never have existed -- a wrong
-- stop typed at the desk. It leaves the row (and its audit trail) but takes it
-- out of the exclusion constraint's partial index, so the child can be
-- reassigned for the same dates immediately.
create or replace function public.transport_cancel_assignment(
  p_assignment_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_rows integer;
begin
  update public.transport_assignments
  set status = 'cancelled',
      note = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_assignment_id and status = 'active';

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'That arrangement does not exist, or has already been cancelled';
  end if;

  return true;
end;
$$;

revoke all on function public.transport_cancel_assignment(uuid, text) from public, anon;
grant execute on function public.transport_cancel_assignment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The manifest
-- ---------------------------------------------------------------------------

-- Stop by stop, who gets on, and a number to ring when they are not there. This
-- is the screen the module exists for; everything else is bookkeeping around
-- it. Bounded by the route, per rule 7.
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
   and (ta.ends_on is null or ta.ends_on >= current_date)
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

revoke all on function public.transport_manifest(uuid) from public, anon;
grant execute on function public.transport_manifest(uuid) to authenticated;

-- One child's arrangement, for the family's own screen. RLS decides whether
-- there is a row; there is no `where tenant_id =` doing security work here.
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
    ta.starts_on, ta.ends_on, ta.status, v.registration_number
  from public.transport_assignments ta
  join public.transport_routes tr on tr.id = ta.route_id
  join public.route_stops rs on rs.id = ta.stop_id
  left join public.vehicles v on v.id = tr.vehicle_id
  where ta.student_id = p_student_id
  order by ta.starts_on desc
$$;

revoke all on function public.transport_for_student(uuid) from public, anon;
grant execute on function public.transport_for_student(uuid) to authenticated;
