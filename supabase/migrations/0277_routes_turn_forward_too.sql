-- 0277: routes and stops only copy into a later year, too.
--
-- 0276 gave "forward" one definition, `academics_require_later_year`, and put
-- it in front of every write that takes a year pair. A sweep of the functions
-- whose arguments name a receiving year found one more writer without it:
-- `transport_roll_forward_routes` refused only a pair that was the same year,
-- so the renewal launcher -- which defaulted to last year until 0276 -- could
-- copy this year's routes, stops and fares into 2024-2025. The two previews in
-- the same sweep write nothing, and the runs that write from them are guarded.
--
-- The body is 0182's with only that check changed.

create or replace function public.transport_roll_forward_routes(p_from_session_id uuid, p_to_session_id uuid)
returns table(routes integer, stops integer, skipped integer)
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_routes integer := 0;
  v_stops integer := 0;
  v_skipped integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  perform public.academics_require_later_year(p_from_session_id, p_to_session_id);

  -- The vehicle and its capacity come across as they are: a bus is a physical
  -- thing, not a session-scoped one, and the composite key to `vehicles` keeps
  -- the copy in step if the licensed capacity is ever corrected.
  insert into public.transport_routes (
    tenant_id, session_id, code, name, direction,
    vehicle_id, vehicle_capacity, fee_head_id, is_active
  )
  select
    tr.tenant_id, p_to_session_id, tr.code, tr.name, tr.direction,
    tr.vehicle_id, tr.vehicle_capacity, tr.fee_head_id, tr.is_active
  from public.transport_routes tr
  where tr.tenant_id = v_tenant_id
    and tr.session_id = p_from_session_id
    and not exists (
      select 1 from public.transport_routes existing
      where existing.tenant_id = tr.tenant_id
        and existing.session_id = p_to_session_id
        and existing.code = tr.code
    );

  get diagnostics v_routes = row_count;

  -- Stops go onto every matching receiving route, not only the ones just
  -- created. A route somebody added by hand would otherwise have no stops, and
  -- a route with no stops is a route nobody can be assigned to -- the same
  -- failure this migration exists to prevent, one level down.
  with candidate as (
    select
      rs.tenant_id, dest.id as dest_route_id, rs.name, rs.landmark,
      rs.sequence, rs.pickup_time, rs.drop_time,
      -- Last year's fare, deliberately. It is the number a school edits, and
      -- carrying nothing would mean retyping every one of them.
      rs.monthly_fare
    from public.route_stops rs
    join public.transport_routes src
      on src.id = rs.route_id and src.session_id = p_from_session_id
    join public.transport_routes dest
      on dest.tenant_id = src.tenant_id
     and dest.session_id = p_to_session_id
     and dest.code = src.code
    where rs.tenant_id = v_tenant_id
      and not exists (
        select 1 from public.route_stops existing
        where existing.tenant_id = rs.tenant_id
          and existing.route_id = dest.id
          and existing.name = rs.name
      )
  ),
  copied as (
    insert into public.route_stops (
      tenant_id, session_id, route_id, name, landmark,
      sequence, pickup_time, drop_time, monthly_fare
    )
    select
      c.tenant_id, p_to_session_id, c.dest_route_id, c.name, c.landmark,
      c.sequence, c.pickup_time, c.drop_time, c.monthly_fare
    from candidate c
    -- The position has to be free. See the header: renumbering to the end
    -- would put a child at the wrong point of somebody's morning.
    where not exists (
      select 1 from public.route_stops taken
      where taken.tenant_id = c.tenant_id
        and taken.route_id = c.dest_route_id
        and taken.sequence = c.sequence
    )
    returning 1
  )
  select
    (select count(*) from copied)::integer,
    ((select count(*) from candidate) - (select count(*) from copied))::integer
  into v_stops, v_skipped;

  return query select v_routes, v_stops, v_skipped;
end;
$function$;
