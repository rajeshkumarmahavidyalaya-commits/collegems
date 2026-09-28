-- 0296: a route in one form, the bus list on the right day, and who rides what.
--
-- Three things a transport office does every week, each made one step:
--
-- 1. `transport_route_create(route, first_stop)`. A new route took two
--    dialogs: create the route, open it, add a stop with its fare. WPSchool's
--    "Add New Route" takes the name, the fare and the vehicle in one form, and
--    a route with no stop cannot carry anybody. Two client calls are not a
--    transaction (a route with no stop is left behind when the second fails),
--    so it is one INVOKER function: the route and stop policies decide who
--    may, exactly as they did for the two separate inserts.
--
-- 2. `transport_manifest` listed a seat from the day it was made rather than
--    the day it starts, and compared against `current_date`, which is UTC. A
--    seat booked on Friday to start next month was on today's list; after
--    18:30 IST the list was already tomorrow's. It asks `mobile_today()`, the
--    school's day, on both ends now. Same return type, so `create or replace`
--    keeps the grants.
--
-- 3. `report_transport_riders`: who rides which bus on a day, filterable by
--    route, vehicle, class, section and children or staff. A catalogue row
--    (rule 11), not a screen. Gated on transport.assign, the permission that
--    acts on it: assignments are row-owned for a family, so a report gated on
--    transport.view would answer a parent with their own child and call it the
--    school's bus list (0295's rule, and 0200's before it).

create or replace function public.transport_route_create(
  p_route jsonb,
  p_first_stop jsonb default null
)
returns uuid
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_tenant   uuid := public.current_tenant_id();
  v_session  uuid;
  v_vehicle  uuid := nullif(p_route ->> 'vehicle_id', '')::uuid;
  v_capacity integer;
  v_fare     numeric;
  v_id       uuid;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  v_session := public.current_session_id(v_tenant);
  if v_session is null then
    raise exception 'There is no current academic session.';
  end if;

  -- The vehicle's own seat count, copied so the capacity rule has a local
  -- column; read here rather than trusted from the form.
  if v_vehicle is not null then
    select v.capacity into v_capacity from public.vehicles v where v.id = v_vehicle;
    if not found then
      raise exception 'That vehicle does not exist.';
    end if;
  end if;

  -- An INSERT whose policy refuses raises; no row count to check (rule 6).
  insert into public.transport_routes (
    tenant_id, session_id, code, name, direction,
    vehicle_id, vehicle_capacity, fee_head_id, is_active)
  values (
    v_tenant, v_session,
    btrim(p_route ->> 'code'), btrim(p_route ->> 'name'),
    coalesce(nullif(p_route ->> 'direction', ''), 'both'),
    v_vehicle, v_capacity,
    nullif(p_route ->> 'fee_head_id', '')::uuid,
    coalesce((p_route ->> 'is_active')::boolean, true))
  returning id into v_id;

  if p_first_stop is not null
     and length(btrim(coalesce(p_first_stop ->> 'name', ''))) > 0 then
    v_fare := nullif(p_first_stop ->> 'monthly_fare', '')::numeric;
    if v_fare is null or v_fare < 0 then
      raise exception 'Give the first stop a monthly fare, or 0 if it is free.';
    end if;
    insert into public.route_stops (
      tenant_id, session_id, route_id, name, sequence, pickup_time, monthly_fare)
    values (
      v_tenant, v_session, v_id, btrim(p_first_stop ->> 'name'), 1,
      nullif(p_first_stop ->> 'pickup_time', '')::time, v_fare);
  end if;

  return v_id;
end;
$$;

comment on function public.transport_route_create(jsonb, jsonb) is
  'A new route and, optionally, its first stop with its fare, in one transaction (0296). INVOKER: the route and stop write policies decide who may.';

revoke all on function public.transport_route_create(jsonb, jsonb) from public, anon;
grant execute on function public.transport_route_create(jsonb, jsonb) to authenticated;

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
    -- A staff rider (0293) has no admission number and no class: the list
    -- carries their employee code and says "Staff", and student_id stays
    -- null, which is how a reader tells the two apart.
    coalesce(st.admission_number, sf.employee_code),
    case when ta.staff_id is not null
         then ('Staff' || coalesce(' ' || chr(183) || ' ' || sf.designation, ''))::text
         else (cl.name || ' ' || sec.name)::text end,
    ta.direction,
    (gp.first_name || ' ' || gp.last_name)::text,
    gp.phone
  from public.route_stops rs
  -- Today's riders, on the school's day (0296): a seat that starts next month
  -- is not on this morning's bus, and UTC's date is not the school's.
  left join public.transport_assignments ta
    on ta.stop_id = rs.id
   and ta.status = 'active'
   and ta.starts_on <= public.mobile_today()
   and ta.effective_ends_on >= public.mobile_today()
  left join public.students st on st.id = ta.student_id
  left join public.staff sf on sf.id = ta.staff_id
  left join public.people p on p.id = coalesce(st.person_id, sf.person_id)
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

create or replace function public.report_transport_riders(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t) - 'sort_rider'
  from (
    select
      ta.student_id,
      r.code as route,
      v.registration_number as vehicle,
      rs.name as stop,
      to_char(rs.pickup_time, 'HH24:MI') as pickup,
      (p.first_name || coalesce(' ' || p.last_name, '')) as rider,
      case when ta.staff_id is not null then 'staff' else 'student' end as rider_kind,
      coalesce(st.admission_number, sf.employee_code) as reference,
      case when ta.staff_id is not null then sf.designation
           else cl.name || ' ' || sec.name end as class,
      ta.direction,
      ta.monthly_fare,
      ta.starts_on,
      ta.effective_ends_on as ends_on,
      (p.first_name || coalesce(' ' || p.last_name, '')) as sort_rider,
      rs.sequence as stop_sequence,
      ta.id as assignment_id
    from public.transport_assignments ta
    join public.transport_routes r on r.id = ta.route_id
    join public.route_stops rs on rs.id = ta.stop_id
    left join public.vehicles v on v.id = r.vehicle_id
    left join public.students st on st.id = ta.student_id
    left join public.staff sf on sf.id = ta.staff_id
    join public.people p on p.id = coalesce(st.person_id, sf.person_id)
    left join public.enrolments en
      on en.student_id = ta.student_id
     and en.session_id = ta.session_id
     and en.status = 'active'
    left join public.sections sec on sec.id = en.section_id
    left join public.class_levels cl on cl.id = sec.class_level_id
    where ta.status = 'active'
      and ta.starts_on <= public.report_param_date(p_params, 'on', public.mobile_today())
      and ta.effective_ends_on >= public.report_param_date(p_params, 'on', public.mobile_today())
      and (public.report_param_uuid(p_params, 'route_id') is null
           or ta.route_id = public.report_param_uuid(p_params, 'route_id'))
      and (public.report_param_uuid(p_params, 'vehicle_id') is null
           or r.vehicle_id = public.report_param_uuid(p_params, 'vehicle_id'))
      and (public.report_param_uuid(p_params, 'section_id') is null
           or en.section_id = public.report_param_uuid(p_params, 'section_id'))
      and (public.report_param_uuid(p_params, 'class_level_id') is null
           or sec.class_level_id = public.report_param_uuid(p_params, 'class_level_id'))
      and (public.report_param_text(p_params, 'rider') is null
           or (public.report_param_text(p_params, 'rider') = 'staff') = (ta.staff_id is not null))
    -- A total order (rule 7's export note): the id breaks a tie between two
    -- riders with one name at one stop.
    order by r.code, rs.sequence, (ta.staff_id is not null), sort_rider, ta.id
  ) t
$$;

comment on function public.report_transport_riders(jsonb) is
  'Who rides which bus on a day, filterable by route, vehicle, class, section and children or staff (0296). INVOKER; catalogued on transport.assign because assignments are row-owned for a family.';

revoke all on function public.report_transport_riders(jsonb) from public, anon;
grant execute on function public.report_transport_riders(jsonb) to authenticated;

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values (
  'transport.riders',
  'Who rides which bus',
  'Every child and member of staff on a school bus on a day, route by route and stop by stop, with the vehicle, the pickup time and the fare. Filter by route, vehicle, class or section, or show only staff.',
  'Transport',
  'transport.assign',
  'report_transport_riders',
  '[
     {"name": "on", "type": "date", "label": "On", "required": false},
     {"name": "route_id", "type": "route", "label": "Route", "required": false},
     {"name": "vehicle_id", "type": "vehicle", "label": "Vehicle", "required": false},
     {"name": "class_level_id", "type": "class_level", "label": "Class", "required": false},
     {"name": "section_id", "type": "section", "label": "Section", "required": false},
     {"name": "rider", "type": "select", "label": "Riders", "required": false,
      "options": [
        {"value": "student", "label": "Children"},
        {"value": "staff", "label": "Staff"}
      ]}
   ]'::jsonb,
  '[
     {"key": "route", "type": "text", "label": "Route"},
     {"key": "vehicle", "type": "text", "label": "Vehicle"},
     {"key": "stop", "type": "text", "label": "Stop"},
     {"key": "pickup", "type": "text", "label": "Pickup"},
     {"key": "rider", "type": "text", "label": "Rider", "href": "/students/{student_id}"},
     {"key": "rider_kind", "type": "badge", "label": "Kind"},
     {"key": "reference", "type": "text", "label": "Adm. no. / code"},
     {"key": "class", "type": "text", "label": "Class / role"},
     {"key": "direction", "type": "badge", "label": "Runs"},
     {"key": "monthly_fare", "type": "money", "label": "Fare", "align": "right"},
     {"key": "starts_on", "type": "date", "label": "From"},
     {"key": "ends_on", "type": "date", "label": "Until"}
   ]'::jsonb,
  75,
  'staff'
)
on conflict (key) do nothing;
