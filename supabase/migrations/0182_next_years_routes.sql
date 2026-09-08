-- 0182 — Next year's routes, so next year's seats can exist at all.
--
-- `transport_routes` and `route_stops` are session-scoped (rule 2), and
-- `transport_assign_student` refuses a stop from another year with *"Route R1
-- belongs to a different academic session"*. So on 1 April a school with a
-- perfectly good bus service has **no routes**, and cannot assign a single
-- child until somebody retypes every route and every stop.
--
-- `academics_roll_forward_sections` (0051) already solved this shape for
-- classes, with the argument that generalises:
--
-- > Promotion cannot invent them -- a section carries a capacity and a class
-- > teacher, which are decisions -- but making an administrator retype twelve
-- > of them before they can even see a preview is the kind of friction that
-- > gets a product abandoned in June.
--
-- A route carries a fare, which is more of a decision than a capacity: fares
-- rise every year. Copying last year's is a **starting point somebody edits**,
-- not an answer, and that is why this is a button on the rollover screen rather
-- than something a promotion run does silently.
--
-- Two halves, and the second is why this is not one INSERT:
--
--   * routes are matched on `code`, which is what a school calls them;
--   * stops are copied into *every* receiving route whose code matches --
--     including one that already existed. A school that created next year's
--     "R1" by hand and then ran this would otherwise get a route with no stops
--     and no way to tell.
--
-- Both halves skip what is already there, so pressing the button twice is a
-- no-op rather than a duplicate. `SECURITY INVOKER`: both tables have admin
-- INSERT policies, so RLS decides, and this function only supplies atomicity.
--
-- And the third return value is the honest one. `route_stops` is unique on
-- `(route, sequence)` as well as on `(route, name)`, so a hand-built receiving
-- route with a *different* stop already at position 3 cannot take this one.
-- Renumbering it to the end would be worse than not copying it -- "the third
-- stop" is a fact about a trip, not a tie-break -- so it is skipped and
-- **counted**, and the screen says the number. A silent skip here is a child
-- waiting at a stop that is not on the driver's list.

create or replace function public.transport_roll_forward_routes(
  p_from_session_id uuid,
  p_to_session_id uuid
)
returns table (routes integer, stops integer, skipped integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_routes integer := 0;
  v_stops integer := 0;
  v_skipped integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_from_session_id = p_to_session_id then
    raise exception 'Pick two different sessions';
  end if;

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
$$;

revoke all on function public.transport_roll_forward_routes(uuid, uuid) from public, anon;
grant execute on function public.transport_roll_forward_routes(uuid, uuid) to authenticated;

comment on function public.transport_roll_forward_routes(uuid, uuid) is
  'Copies this year''s routes and stops into the receiving session, skipping '
  'anything already there. Fares come across as a starting point, not an '
  'answer -- see migration 0182.';
