-- 0185 — The renewal engine.
--
-- Five functions, and they are the promotion module's five with different
-- nouns: preview, start a run, override a row, apply, discard. That is
-- deliberate — rule 13 describes a shape, and a second bulk operation that
-- invented its own would be a second thing to learn.
--
-- Two things here are not in the promotion module, and both are the point:
--
--   1. **Apply calls the module's own write function.** Not an INSERT.
--      `transport_assign_student_for` and `hostel_allocate_for` (migration
--      0183) know that the route must be running, the child must be enrolled
--      *in the receiving year*, the bus must have a seat, the house must take
--      this child and the dates must fall inside the year. A renewal that
--      wrote rows directly would be a second implementation of all five, free
--      to disagree — rule 11's "wrap the module's own read path", applied to
--      writing.
--
--   2. **A row that fails keeps its reason and the run carries on.** The
--      import module's lesson: stopping at the first failure leaves the office
--      with half a bus and no list of who is missing. Each write sits in its
--      own exception block, so a refusal is caught, written to
--      `renewal_decisions.error`, and the next child is tried.
--
-- What the preview deliberately does **not** check is capacity. A bus seat and
-- a hostel bed are rules about *how many other rows exist*, and no query over
-- one row can see them (rule 4's second boundary) — so they are checked at
-- apply, under the advisory lock the write functions already take, and the
-- refusal arrives as a sentence with the numbers in it.

-- ---------------------------------------------------------------------------
-- The preview
--
-- Pure computation. Runs before a run exists, so an administrator can look at
-- what would happen before committing to it.
-- ---------------------------------------------------------------------------

create or replace function public.renewal_preview(
  p_from_session_id uuid,
  p_to_session_id uuid,
  p_kind text
)
returns table (
  student_id uuid,
  student_name text,
  admission_number text,
  from_label text,
  from_fare numeric,
  decision text,
  to_stop_id uuid,
  to_room_id uuid,
  to_label text,
  to_fare numeric,
  direction text,
  reason text
)
language sql
stable
set search_path = public, extensions
as $$
  with target as (
    select s.name from public.academic_sessions s where s.id = p_to_session_id
  ),
  -- ---- transport ----------------------------------------------------------
  transport as (
    select
      ta.student_id,
      (tr.code || ' · ' || rs.name)::text as from_label,
      ta.monthly_fare as from_fare,
      ta.direction,
      dest.stop_id as to_stop_id,
      dest.to_label,
      dest.monthly_fare as to_fare,
      dest.route_active,
      dest.route_direction
    from public.transport_assignments ta
    join public.transport_routes tr on tr.id = ta.route_id
    join public.route_stops rs on rs.id = ta.stop_id
    left join lateral (
      select
        drs.id as stop_id,
        drs.monthly_fare,
        (dtr.code || ' · ' || drs.name)::text as to_label,
        dtr.is_active as route_active,
        dtr.direction as route_direction
      from public.route_stops drs
      join public.transport_routes dtr on dtr.id = drs.route_id
      where dtr.session_id = p_to_session_id
        and dtr.code = tr.code
        and drs.name = rs.name
      limit 1
    ) dest on true
    where ta.session_id = p_from_session_id
      and ta.status = 'active'
      and p_kind = 'transport'
  ),
  -- ---- hostel -------------------------------------------------------------
  -- A room is a physical thing, so the "target" is the same room. What can
  -- change is whether it is still in use.
  hostel as (
    select
      ha.student_id,
      (h.name || ' · ' || r.room_number)::text as from_label,
      ha.monthly_fare as from_fare,
      r.id as to_room_id,
      (h.name || ' · ' || r.room_number)::text as to_label,
      r.monthly_fare as to_fare,
      (r.is_active and h.is_active) as room_usable
    from public.hostel_allocations ha
    join public.hostels h on h.id = ha.hostel_id
    join public.hostel_rooms r on r.id = ha.room_id
    where ha.session_id = p_from_session_id
      and ha.status = 'active'
      and p_kind = 'hostel'
  ),
  proposal as (
    select
      t.student_id, t.from_label, t.from_fare,
      t.to_stop_id, null::uuid as to_room_id, t.to_label, t.to_fare, t.direction,
      case
        when t.to_stop_id is null then 'no-target'
        when not t.route_active then 'route-closed'
        when t.route_direction <> 'both' and t.direction <> t.route_direction
          then 'direction'
        else 'ok'
      end as verdict
    from transport t
    union all
    select
      h.student_id, h.from_label, h.from_fare,
      null::uuid, h.to_room_id, h.to_label, h.to_fare, null::text,
      case when not h.room_usable then 'route-closed' else 'ok' end
    from hostel h
  )
  select
    rw.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    st.admission_number,
    rw.from_label,
    rw.from_fare,
    -- Everything that is not plainly renewable defaults to `skip`. The
    -- conservative reading (rule 12): a school that wants a child on the bus
    -- will say so, whereas one that gets it by accident finds out from an
    -- invoice.
    case
      when rw.verdict = 'ok' and enrolled.ok and not already.ok then 'renew'
      else 'skip'
    end::text,
    case when rw.verdict = 'ok' and enrolled.ok and not already.ok then rw.to_stop_id end,
    case when rw.verdict = 'ok' and enrolled.ok and not already.ok then rw.to_room_id end,
    rw.to_label,
    rw.to_fare,
    case when rw.verdict = 'ok' and enrolled.ok and not already.ok then rw.direction end,
    case
      when not enrolled.ok then
        format('Not enrolled in %s, so there is nobody to carry.', (select name from target))
      when already.ok then
        format('Already has one in %s.', (select name from target))
      when rw.verdict = 'no-target' then
        format('%s has no equivalent in %s.', rw.from_label, (select name from target))
      when rw.verdict = 'route-closed' then
        format('%s is not running in %s.', rw.to_label, (select name from target))
      when rw.verdict = 'direction' then
        format('%s only does one run in %s, so a %s arrangement cannot move across.',
               rw.to_label, (select name from target), rw.direction)
      when rw.to_fare is distinct from rw.from_fare then
        format('Same place, %s a month instead of %s.',
               to_char(rw.to_fare, 'FM999999990.00'), to_char(rw.from_fare, 'FM999999990.00'))
      else format('Same place, same %s a month.', to_char(rw.to_fare, 'FM999999990.00'))
    end::text
  from proposal rw
  join public.students st on st.id = rw.student_id
  join public.people p on p.id = st.person_id
  cross join lateral (
    select exists (
      select 1 from public.enrolments e
      where e.student_id = rw.student_id
        and e.session_id = p_to_session_id
        and e.status = 'active'
    ) as ok
  ) enrolled
  cross join lateral (
    select case p_kind
      when 'transport' then exists (
        select 1 from public.transport_assignments x
        where x.student_id = rw.student_id
          and x.session_id = p_to_session_id
          and x.status = 'active')
      else exists (
        select 1 from public.hostel_allocations x
        where x.student_id = rw.student_id
          and x.session_id = p_to_session_id
          and x.status = 'active')
    end as ok
  ) already
  order by p.first_name, p.last_name, st.admission_number
$$;

revoke all on function public.renewal_preview(uuid, uuid, text) from public, anon;
grant execute on function public.renewal_preview(uuid, uuid, text) to authenticated;

comment on function public.renewal_preview(uuid, uuid, text) is
  'What carrying this year''s arrangements into the receiving year would do. '
  'Pure: stores nothing. Capacity is deliberately not checked here -- it is a '
  'fact about other rows, so the write function checks it at apply.';

-- ---------------------------------------------------------------------------
-- Materialising a run
-- ---------------------------------------------------------------------------

create or replace function public.renewal_start_run(
  p_from_session_id uuid,
  p_to_session_id uuid,
  p_kind text
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can start a renewal run';
  end if;

  if p_kind not in ('transport', 'hostel') then
    raise exception 'A renewal run carries transport or hostel, not "%"', p_kind;
  end if;

  begin
    insert into public.renewal_runs (
      tenant_id, from_session_id, to_session_id, kind, created_by
    ) values (
      v_tenant_id, p_from_session_id, p_to_session_id, p_kind, auth.uid()
    )
    returning id into v_run_id;
  exception when unique_violation then
    -- `renewal_runs_one_live`. Two half-built previews of the same renewal
    -- disagree, and whichever is applied second silently wins.
    raise exception
      'There is already a run carrying % into that year. Apply or discard it first.', p_kind;
  end;

  insert into public.renewal_decisions (
    tenant_id, run_id, kind, student_id,
    from_label, from_fare, decision, to_stop_id, to_room_id, direction, reason
  )
  select
    v_tenant_id, v_run_id, p_kind, pv.student_id,
    pv.from_label, pv.from_fare, pv.decision,
    pv.to_stop_id, pv.to_room_id, pv.direction, pv.reason
  from public.renewal_preview(p_from_session_id, p_to_session_id, p_kind) pv;

  if not exists (select 1 from public.renewal_decisions d where d.run_id = v_run_id) then
    raise exception
      'Nothing to carry: no active % arrangement in the outgoing year.', p_kind;
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.renewal_start_run(uuid, uuid, text) from public, anon;
grant execute on function public.renewal_start_run(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Changing one row
--
-- The whole reason a preview is persisted rather than recomputed: the person
-- standing at the screen knows the three children the rules got wrong.
-- ---------------------------------------------------------------------------

create or replace function public.renewal_override(
  p_decision_id uuid,
  p_decision text,
  p_to_stop_id uuid default null,
  p_to_room_id uuid default null,
  p_direction text default null
)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row public.renewal_decisions;
  v_run public.renewal_runs;
  v_label text;
  v_ok boolean;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_row from public.renewal_decisions d where d.id = p_decision_id;
  if v_row.id is null then
    raise exception 'That row does not exist';
  end if;

  select * into v_run from public.renewal_runs r where r.id = v_row.run_id;
  if v_run.status <> 'draft' then
    raise exception 'This run is %, so its rows cannot be changed', v_run.status;
  end if;

  if p_decision not in ('renew', 'skip') then
    raise exception 'A row either renews or is skipped, not "%"', p_decision;
  end if;

  if p_decision = 'skip' then
    update public.renewal_decisions
    set decision = 'skip', to_stop_id = null, to_room_id = null, direction = null,
        reason = 'Skipped by hand.', is_override = true
    where id = p_decision_id;
    return;
  end if;

  if v_row.kind = 'transport' then
    -- The stop has to be one from the receiving year, or applying would fail
    -- with the module's own message after the run had already started. Better
    -- to refuse now, when somebody is looking at it.
    select (dtr.code || ' · ' || drs.name), dtr.session_id = v_run.to_session_id
    into v_label, v_ok
    from public.route_stops drs
    join public.transport_routes dtr on dtr.id = drs.route_id
    where drs.id = p_to_stop_id;

    if v_label is null then
      raise exception 'That stop does not exist';
    end if;
    if not v_ok then
      raise exception '% belongs to a different academic year', v_label;
    end if;

    update public.renewal_decisions
    set decision = 'renew',
        to_stop_id = p_to_stop_id,
        to_room_id = null,
        direction = coalesce(p_direction, v_row.direction, 'both'),
        reason = format('Set by hand: %s.', v_label),
        is_override = true
    where id = p_decision_id;
  else
    select (h.name || ' · ' || r.room_number) into v_label
    from public.hostel_rooms r
    join public.hostels h on h.id = r.hostel_id
    where r.id = p_to_room_id;

    if v_label is null then
      raise exception 'That room does not exist';
    end if;

    update public.renewal_decisions
    set decision = 'renew',
        to_room_id = p_to_room_id,
        to_stop_id = null,
        direction = null,
        reason = format('Set by hand: %s.', v_label),
        is_override = true
    where id = p_decision_id;
  end if;
end;
$$;

revoke all on function public.renewal_override(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.renewal_override(uuid, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Applying
-- ---------------------------------------------------------------------------

create or replace function public.renewal_apply(p_run_id uuid)
returns table (renewed integer, skipped integer, failed integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.renewal_runs;
  v_row record;
  v_id uuid;
  v_msg text;
  v_renewed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can apply a renewal run';
  end if;

  select * into v_run from public.renewal_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;

  if v_run.id is null then
    raise exception 'That renewal run does not exist';
  end if;

  if v_run.status <> 'draft' then
    raise exception 'This run is %, so it cannot be applied again', v_run.status;
  end if;

  for v_row in
    select * from public.renewal_decisions d
    where d.run_id = p_run_id and d.tenant_id = v_tenant_id
    order by d.created_at, d.id
  loop
    if v_row.decision = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_row.applied_id is not null then
      -- Idempotent: a retry after a timeout converges rather than doubling.
      v_renewed := v_renewed + 1;
      continue;
    end if;

    v_id := null;
    begin
      -- The module's own door, so every check it makes is made here too.
      if v_row.kind = 'transport' then
        v_id := public.transport_assign_student_for(
          v_run.to_session_id, v_row.student_id, v_row.to_stop_id, v_row.direction, null, null);
      else
        v_id := public.hostel_allocate_for(
          v_run.to_session_id, v_row.student_id, v_row.to_room_id, null, null);
      end if;

      update public.renewal_decisions
      set applied_id = v_id, error = null
      where id = v_row.id;
      v_renewed := v_renewed + 1;

    exception when others then
      -- Caught per row: the batch carries on and the reason is kept, so the
      -- office gets a list rather than half a bus.
      get stacked diagnostics v_msg = message_text;
      update public.renewal_decisions set error = v_msg where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.renewal_runs
  set status = 'applied', applied_at = now(), applied_by = auth.uid()
  where id = p_run_id;

  return query select v_renewed, v_skipped, v_failed;
end;
$$;

revoke all on function public.renewal_apply(uuid) from public, anon;
grant execute on function public.renewal_apply(uuid) to authenticated;

comment on function public.renewal_apply(uuid) is
  'Writes what the rows say, through the transport and hostel modules'' own '
  'write functions. A row that is refused keeps the refusal in `error` and the '
  'run carries on -- see migration 0185.';

create or replace function public.renewal_discard_run(p_run_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_status text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select status into v_status from public.renewal_runs
  where id = p_run_id and tenant_id = v_tenant_id;

  if v_status is null then
    raise exception 'That renewal run does not exist';
  end if;
  if v_status <> 'draft' then
    raise exception 'This run is %, so there is nothing to discard', v_status;
  end if;

  update public.renewal_runs set status = 'discarded' where id = p_run_id;
end;
$$;

revoke all on function public.renewal_discard_run(uuid) from public, anon;
grant execute on function public.renewal_discard_run(uuid) to authenticated;
