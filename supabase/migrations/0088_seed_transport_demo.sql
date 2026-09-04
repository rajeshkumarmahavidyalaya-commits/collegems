-- ---------------------------------------------------------------------------
-- Phase 5.2 — demo transport
--
-- Two buses, two routes, graduated fares, and thirty children on them —
-- including the case the module was built for: two children in the same class
-- paying different transport fares because they board at different stops.
--
-- Written as direct inserts rather than through `transport_assign_student`,
-- which needs a signed-in caller: a migration has no JWT, so
-- `current_tenant_id()` would be null. The route's direction and the stop's
-- fare are copied here exactly as the function copies them.
-- ---------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
  v_session uuid;
  v_head uuid;
  v_bus1 uuid;
  v_bus2 uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_driver1 uuid;
  v_driver2 uuid;
  v_stop record;
  v_student record;
  v_stops_r1 uuid[];
  v_stops_r2 uuid[];
  v_i integer := 0;
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then
    return;
  end if;

  select id into v_session from public.academic_sessions
  where tenant_id = v_tenant and is_current limit 1;
  if v_session is null then
    return;
  end if;

  -- The fee head. `fee_heads.category` has carried 'transport' since 0021 --
  -- the column anticipated this module by sixty migrations.
  select id into v_head from public.fee_heads
  where tenant_id = v_tenant and category = 'transport' limit 1;

  if v_head is null then
    insert into public.fee_heads (tenant_id, code, name, description, category)
    values (v_tenant, 'TRANSPORT', 'Transport', 'Bus fare, charged by boarding point', 'transport')
    returning id into v_head;
  end if;

  select id into v_driver1 from public.staff where tenant_id = v_tenant order by created_at limit 1;
  select id into v_driver2 from public.staff where tenant_id = v_tenant order by created_at offset 1 limit 1;

  insert into public.vehicles (tenant_id, registration_number, model, capacity, driver_staff_id)
  values (v_tenant, 'RJ-14-AB-1234', 'Tata Starbus 40-seater', 40, v_driver1)
  on conflict (tenant_id, registration_number) do nothing;
  select id into v_bus1 from public.vehicles
  where tenant_id = v_tenant and registration_number = 'RJ-14-AB-1234';

  insert into public.vehicles (tenant_id, registration_number, model, capacity, driver_staff_id)
  values (v_tenant, 'RJ-14-CD-5678', 'Force Traveller 26-seater', 26, v_driver2)
  on conflict (tenant_id, registration_number) do nothing;
  select id into v_bus2 from public.vehicles
  where tenant_id = v_tenant and registration_number = 'RJ-14-CD-5678';

  -- R1 runs both ways; R2 is a morning-only feeder, which is what makes the
  -- direction rule in 0084 do visible work on the demo data.
  insert into public.transport_routes
    (tenant_id, session_id, code, name, direction, vehicle_id, vehicle_capacity, fee_head_id)
  values
    (v_tenant, v_session, 'R1', 'City Centre', 'both', v_bus1, 40, v_head)
  on conflict (tenant_id, session_id, code) do nothing;
  select id into v_r1 from public.transport_routes
  where tenant_id = v_tenant and session_id = v_session and code = 'R1';

  insert into public.transport_routes
    (tenant_id, session_id, code, name, direction, vehicle_id, vehicle_capacity, fee_head_id)
  values
    (v_tenant, v_session, 'R2', 'Ring Road (morning only)', 'pickup', v_bus2, 26, v_head)
  on conflict (tenant_id, session_id, code) do nothing;
  select id into v_r2 from public.transport_routes
  where tenant_id = v_tenant and session_id = v_session and code = 'R2';

  -- Fares rise with distance, which is the whole reason the fare is on the stop
  -- and not on the route.
  insert into public.route_stops
    (tenant_id, session_id, route_id, name, landmark, sequence, pickup_time, drop_time, monthly_fare)
  values
    (v_tenant, v_session, v_r1, 'Station Road', 'Opposite the post office', 1, '07:05', '15:20', 900),
    (v_tenant, v_session, v_r1, 'Sector 12', 'Water tank', 2, '07:18', '15:35', 1100),
    (v_tenant, v_session, v_r1, 'Model Town', 'Petrol pump', 3, '07:30', '15:50', 1300),
    (v_tenant, v_session, v_r1, 'Green Park', 'Community hall', 4, '07:42', '16:05', 1500)
  on conflict (tenant_id, route_id, name) do nothing;

  insert into public.route_stops
    (tenant_id, session_id, route_id, name, landmark, sequence, pickup_time, monthly_fare)
  values
    (v_tenant, v_session, v_r2, 'Bypass Chowk', 'Bus stand', 1, '06:55', 800),
    (v_tenant, v_session, v_r2, 'Industrial Area', 'Gate 3', 2, '07:12', 1000),
    (v_tenant, v_session, v_r2, 'Sunrise Colony', 'Temple', 3, '07:26', 1200)
  on conflict (tenant_id, route_id, name) do nothing;

  select array_agg(id order by sequence) into v_stops_r1
  from public.route_stops where route_id = v_r1;
  select array_agg(id order by sequence) into v_stops_r2
  from public.route_stops where route_id = v_r2;

  -- Thirty children, spread across both routes. Round-robin rather than by
  -- class, deliberately: it puts classmates on different stops at different
  -- fares, which is exactly the arrangement `fee_structures` cannot express.
  for v_student in
    select e.student_id
    from public.enrolments e
    where e.tenant_id = v_tenant and e.session_id = v_session and e.status = 'active'
      and not exists (
        select 1 from public.transport_assignments ta
        where ta.student_id = e.student_id and ta.status = 'active'
      )
    order by e.roll_number, e.student_id
    limit 30
  loop
    v_i := v_i + 1;

    if v_i % 3 = 0 then
      select * into v_stop from public.route_stops
      where id = v_stops_r2[1 + (v_i % array_length(v_stops_r2, 1))];

      insert into public.transport_assignments
        (tenant_id, session_id, student_id, route_id, stop_id,
         route_direction, direction, starts_on, monthly_fare)
      values
        (v_tenant, v_session, v_student.student_id, v_r2, v_stop.id,
         'pickup', 'pickup', current_date - 40, v_stop.monthly_fare);
    else
      select * into v_stop from public.route_stops
      where id = v_stops_r1[1 + (v_i % array_length(v_stops_r1, 1))];

      insert into public.transport_assignments
        (tenant_id, session_id, student_id, route_id, stop_id,
         route_direction, direction, starts_on, monthly_fare)
      values
        (v_tenant, v_session, v_student.student_id, v_r1, v_stop.id,
         'both', 'both', current_date - 40, v_stop.monthly_fare);
    end if;
  end loop;
end $$;
