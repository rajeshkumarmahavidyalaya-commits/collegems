-- 0293: staff ride the same buses.
--
-- WPSchool's staff panel has a transport page; ours had no way to give a
-- teacher a seat at all. transport_assignments said `student_id not null`, so
-- a bus with 40 seats, 36 of them children and 4 teachers, could only be
-- recorded as a bus with 36.
--
-- The seat goes in the same table, not a second one, because the capacity
-- rule is about everybody on the bus: transport_assign_student_for already
-- counts every active row on the route under the route's advisory lock, and a
-- staff table beside it would be a second count free to disagree (rule 4's
-- "how many other rows exist" lives in one write path). So:
--
-- * a row names exactly one rider, a child or a member of staff;
-- * a staff seat is free, by CHECK. Charging it means a payroll deduction,
--   and a fare recorded with nothing to collect it would be a column recording
--   an intention with no executable half (0205's `trial_ends_on`, 0220's
--   discarded reason). When payroll learns the deduction, the CHECK goes;
-- * everything that asks about a child's seat already filters on student_id,
--   so it is untouched. The two readers that walk every seat and then look
--   for "the same rider next year" -- the renewal preview and the year-end
--   critic -- are narrowed to children, because a staff seat is renewed by
--   hand;
-- * leaving ends the seat (staff_exit), and a record with a seat is not
--   deletable (guard_staff_delete), exactly as for a child.

alter table public.transport_assignments alter column student_id drop not null;
alter table public.transport_assignments add column staff_id uuid;

alter table public.transport_assignments
  add constraint transport_assignments_one_rider_chk
  check (num_nonnulls(student_id, staff_id) = 1);

alter table public.transport_assignments
  add constraint transport_assignments_staff_free_chk
  check (staff_id is null or monthly_fare = 0);

alter table public.transport_assignments
  add constraint transport_assignments_staff_fkey
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id)
  on delete cascade;

create index transport_assignments_staff_idx
  on public.transport_assignments (tenant_id, staff_id)
  where staff_id is not null;

-- One seat at a time per member of staff, as for a child. The existing
-- exclusion compares student_id with =, and null = null is never true, so it
-- ignores staff rows; this is its twin.
alter table public.transport_assignments
  add constraint transport_assignments_staff_no_overlap
  exclude using gist (
    tenant_id with =, staff_id with =,
    daterange(starts_on, effective_ends_on, '[]') with &&
  ) where (status = 'active' and staff_id is not null);

-- A member of staff sees their own seat, whatever their role. Admin, teacher
-- and accountant already read every seat through "staff view
-- transport_assignments"; this is what a librarian, or anybody a college
-- adds, needs to see their own bus.
create policy "staff view own transport_assignments"
  on public.transport_assignments for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and staff_id is not null
    and staff_id = (select up.staff_id from public.user_profiles up
                    where up.id = (select auth.uid()))
  );

create or replace function public.transport_assign_staff_for(
  p_session_id uuid,
  p_staff_id uuid,
  p_stop_id uuid,
  p_direction text default 'both',
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_stop record;
  v_starts date;
  v_assigned integer;
  v_status text;
  v_name text;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select s.status, p.first_name || ' ' || p.last_name
  into v_status, v_name
  from public.staff s join public.people p on p.id = s.person_id
  where s.id = p_staff_id and s.tenant_id = v_tenant_id;

  if v_status is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;
  -- The door that stays shut after an ending (rule 12): somebody who has
  -- left is not given a seat.
  if v_status <> 'active' then
    raise exception '% is recorded as %, so they cannot be given a seat.', v_name, v_status;
  end if;

  select
    rs.id as stop_id, rs.name as stop_name,
    tr.id as route_id, tr.code as route_code, tr.name as route_name,
    tr.direction as route_direction, tr.session_id, tr.is_active,
    tr.vehicle_capacity, v.registration_number,
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

  v_starts := coalesce(p_starts_on, greatest(current_date, v_stop.session_starts_on));

  if p_ends_on is not null and p_ends_on < v_starts then
    raise exception 'The arrangement cannot end before it starts';
  end if;
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
  if v_stop.route_direction <> 'both' and p_direction <> v_stop.route_direction then
    raise exception 'Route % only does the % run, so it cannot be used for %',
      v_stop.route_code, v_stop.route_direction, p_direction;
  end if;

  -- The same lock and the same count as a child's seat: one bus, one number.
  perform pg_advisory_xact_lock(hashtextextended(v_stop.route_id::text, 0));

  if v_stop.vehicle_capacity is not null then
    select count(*)::integer into v_assigned
    from public.transport_assignments ta
    where ta.route_id = v_stop.route_id
      and ta.status = 'active'
      and daterange(ta.starts_on, ta.effective_ends_on, '[]')
          && daterange(v_starts, coalesce(p_ends_on, v_stop.session_ends_on), '[]');

    if v_assigned >= v_stop.vehicle_capacity then
      raise exception
        'Route % (%) seats % and % are already assigned for those dates. Free a seat or use another route.',
        v_stop.route_code, coalesce(v_stop.registration_number, 'no vehicle'),
        v_stop.vehicle_capacity, v_assigned;
    end if;
  end if;

  begin
    insert into public.transport_assignments (
      tenant_id, session_id, staff_id, route_id, stop_id,
      route_direction, direction, starts_on, ends_on, monthly_fare,
      session_starts_on, session_ends_on
    )
    values (
      v_tenant_id, v_stop.session_id, p_staff_id, v_stop.route_id, p_stop_id,
      v_stop.route_direction, p_direction, v_starts, p_ends_on, 0,
      v_stop.session_starts_on, v_stop.session_ends_on
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception
      '% already has a seat covering those dates. End the current one first.', v_name;
  end;

  return v_id;
end;
$$;

comment on function public.transport_assign_staff_for(uuid, uuid, uuid, text, date, date) is
  'Give a member of staff a seat on a route (0293): the child version''s checks and its capacity count under the same lock, the rider a member of staff, the fare 0. INVOKER: the admin write policy decides who may.';

create or replace function public.transport_assign_staff(
  p_staff_id uuid,
  p_stop_id uuid,
  p_direction text default 'both',
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_session_id uuid := public.current_session_id(public.current_tenant_id());
begin
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;
  return public.transport_assign_staff_for(
    v_session_id, p_staff_id, p_stop_id, p_direction, p_starts_on, p_ends_on);
end;
$$;

create or replace function public.transport_for_staff(p_staff_id uuid)
returns table (
  assignment_id uuid, route_code text, route_name text, stop_name text,
  landmark text, pickup_time time, drop_time time, direction text,
  starts_on date, ends_on date, effective_ends_on date, status text,
  registration_number text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    ta.id, tr.code, tr.name, rs.name, rs.landmark,
    rs.pickup_time, rs.drop_time, ta.direction,
    ta.starts_on, ta.ends_on, ta.effective_ends_on, ta.status, v.registration_number
  from public.transport_assignments ta
  join public.transport_routes tr on tr.id = ta.route_id
  join public.route_stops rs on rs.id = ta.stop_id
  left join public.vehicles v on v.id = tr.vehicle_id
  where ta.staff_id = p_staff_id
  order by ta.starts_on desc, ta.id
$$;

comment on function public.transport_for_staff(uuid) is
  'A member of staff''s seats, newest first (0293). INVOKER, so the policies decide who may read them.';

revoke all on function public.transport_assign_staff_for(uuid, uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_assign_staff_for(uuid, uuid, uuid, text, date, date) to authenticated;
revoke all on function public.transport_assign_staff(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.transport_assign_staff(uuid, uuid, text, date, date) to authenticated;
revoke all on function public.transport_for_staff(uuid) from public, anon;
grant execute on function public.transport_for_staff(uuid) to authenticated;

-- The manifest names staff riders too.
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
  left join public.transport_assignments ta
    on ta.stop_id = rs.id
   and ta.status = 'active'
   and ta.effective_ends_on >= current_date
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

-- A staff seat is renewed by hand, not by the children's renewal run.
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
      (tr.code || ' ' || chr(183) || ' ' || rs.name)::text as from_label,
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
        (dtr.code || ' ' || chr(183) || ' ' || drs.name)::text as to_label,
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
      -- A staff seat is not a child's to carry into next year (0293): it is
      -- renewed by hand, like the staff member's other arrangements.
      and ta.student_id is not null
  ),
  -- ---- hostel -------------------------------------------------------------
  -- A room is a physical thing, so the "target" is the same room. What can
  -- change is whether it is still in use.
  hostel as (
    select
      ha.student_id,
      (h.name || ' ' || chr(183) || ' ' || r.room_number)::text as from_label,
      ha.monthly_fare as from_fare,
      r.id as to_room_id,
      (h.name || ' ' || chr(183) || ' ' || r.room_number)::text as to_label,
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
      -- Children's seats only: a staff seat is renewed by hand (0293), and
      -- counting it here would report it unrenewed for ever.
      and ta.student_id is not null
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

-- Leaving ends the seat.
create or replace function public.staff_exit(
  p_staff_id uuid,
  p_reason text,
  p_left_on date default null,
  p_status text default 'terminated'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_on date := coalesce(p_left_on, current_date);
  v_name text;
  v_lessons integer := 0;
  v_sections integer := 0;
  v_subjects integer := 0;
  v_books integer := 0;
  v_library integer := 0;
  v_future_covers integer := 0;
  v_seats integer := 0;
  v_outstanding jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_status not in ('terminated', 'resigned', 'retired', 'inactive') then
    raise exception 'A member of staff leaves as terminated, resigned, retired or inactive -- not "%"', p_status;
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why they are leaving -- it is the only thing a record five years from now will have';
  end if;

  select (p.first_name || ' ' || p.last_name) into v_name
  from public.staff s join public.people p on p.id = s.person_id
  where s.id = p_staff_id;

  if v_name is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;

  -- 1. The timetable. Unassigned, not deleted: the class still happens.
  update public.timetable_entries
  set teacher_staff_id = null
  where teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_lessons = row_count;

  -- 2. Class-teacher duty. A section whose class teacher has left needs one,
  --    and `academics` already treats null as "not yet chosen".
  update public.sections
  set class_teacher_staff_id = null
  where class_teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_sections = row_count;

  -- 3. Subject assignments.
  update public.section_subjects
  set teacher_staff_id = null
  where teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_subjects = row_count;

  -- 4. The library membership, for the same reason it closes for a child:
  --    nothing else stops a book being issued to somebody who has left, and
  --    `library_issue_book` checks `members.status` rather than whether the
  --    person is still here.
  update public.members
  set status = 'expired'
  where staff_id = p_staff_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_library = row_count;

  -- 4b. A seat on the school bus (0293). Ended on the day they left rather
  --     than cancelled, so the record says they rode until then -- the same
  --     act student_end_relationships performs for a child. A seat that had
  --     not started yet is cancelled: there is nothing to keep.
  update public.transport_assignments
  set ends_on = v_on
  where staff_id = p_staff_id and tenant_id = v_tenant_id
    and status = 'active' and starts_on <= v_on and effective_ends_on > v_on;
  get diagnostics v_seats = row_count;

  update public.transport_assignments
  set status = 'cancelled', note = 'Left before this seat began'
  where staff_id = p_staff_id and tenant_id = v_tenant_id
    and status = 'active' and starts_on > v_on;

  -- 5. The employment record, last -- so a failure above leaves them visibly
  --    still employed rather than half-gone.
  update public.staff
  set status = p_status,
      date_of_leaving = coalesce(date_of_leaving, v_on),
      -- The one line 0192 was missing. `date_of_leaving` was always written;
      -- the reason the function refuses to run without had no column.
      exit_reason = trim(p_reason)
  where id = p_staff_id and tenant_id = v_tenant_id;

  -- ---- what this cannot end ------------------------------------------------

  select count(*) into v_books
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  where m.staff_id = p_staff_id and bi.status = 'issued';

  if v_books > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'library',
      'message', format(
        '%s still has %s library %s out, and any fine on them is a payroll '
        'deduction rather than a fee -- see the library module.',
        v_name, v_books, case when v_books = 1 then 'book' else 'books' end)
    );
  end if;

  -- Cover they were down to provide after today. Deliberately not cleared:
  -- `substitutions` records what was arranged, and rewriting it would erase a
  -- decision somebody made. Naming it lets the office re-arrange.
  select count(*) into v_future_covers
  from public.substitutions s
  where s.substitute_staff_id = p_staff_id
    and s.on_date > v_on;

  if v_future_covers > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'cover',
      'message', format(
        '%s is down to cover %s %s after %s. Those need re-arranging -- this '
        'has not touched them, because the roster is a record of what was '
        'decided.',
        v_name, v_future_covers,
        case when v_future_covers = 1 then 'class' else 'classes' end,
        to_char(v_on, 'FMDD Mon YYYY'))
    );
  end if;

  if v_lessons > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'timetable',
      'message', format(
        '%s %s now %s nobody teaching %s. They show on the cover list as '
        'unassigned until the timetable is redrawn.',
        v_lessons, case when v_lessons = 1 then 'lesson' else 'lessons' end,
        case when v_lessons = 1 then 'has' else 'have' end,
        case when v_lessons = 1 then 'it' else 'them' end)
    );
  end if;

  return jsonb_build_object(
    'staff_id', p_staff_id,
    'staff', v_name,
    'left_on', v_on,
    'status', p_status,
    'unassigned', jsonb_build_object(
      'lessons', v_lessons,
      'sections', v_sections,
      'subjects', v_subjects
    ),
    'closed', jsonb_build_object('library', v_library, 'transport', v_seats),
    'outstanding', v_outstanding
  );
end;
$$;

-- A member of staff with a seat is a record with history.
create or replace function public.guard_staff_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t constant uuid := old.tenant_id;
  v_found text[];
  v_name text;
begin
  if not exists (select 1 from public.tenants where id = t) then
    return old;
  end if;

  v_found := array_remove(array[
    public.count_phrase((select count(*) from public.payslips x where x.tenant_id = t and x.staff_id = old.id), 'payslip', 'payslips'),
    public.count_phrase((select count(*) from public.staff_attendance x where x.tenant_id = t and x.staff_id = old.id), 'attendance mark', 'attendance marks'),
    public.count_phrase((select count(*) from public.leave_requests x where x.tenant_id = t and x.staff_id = old.id), 'leave request', 'leave requests'),
    public.count_phrase((select count(*) from public.certificates x where x.tenant_id = t and x.staff_id = old.id), 'certificate', 'certificates'),
    public.count_phrase((select count(*) from public.substitutions x where x.tenant_id = t and (x.absent_staff_id = old.id or x.substitute_staff_id = old.id)), 'cover arrangement', 'cover arrangements'),
    public.count_phrase((select count(*) from public.book_issues b join public.members m on m.id = b.member_id where m.tenant_id = t and m.staff_id = old.id), 'library loan', 'library loans'),
    public.count_phrase((select count(*) from public.stock_movements x where x.tenant_id = t and x.issued_to_staff_id = old.id), 'store issue', 'store issues'),
    public.count_phrase((select count(*) from public.biometric_punches x where x.tenant_id = t and x.staff_id = old.id), 'attendance punch', 'attendance punches'),
    public.count_phrase((select count(*) from public.transport_assignments x where x.tenant_id = t and x.staff_id = old.id), 'bus seat', 'bus seats'),
    public.count_phrase((select count(*) from public.user_profiles x where x.tenant_id = t and x.staff_id = old.id), 'login', 'logins'),
    public.count_phrase((select count(*) from public.invitations x where x.tenant_id = t and x.staff_id = old.id and x.status = 'pending'), 'pending invitation', 'pending invitations')
  ], null);

  if coalesce(cardinality(v_found), 0) = 0 then
    return old;
  end if;

  select p.first_name || ' ' || p.last_name into v_name
  from public.people p where p.id = old.person_id;

  raise exception
    '% cannot be deleted: the school holds % for them. A record with history is kept -- record them as having left instead.',
    coalesce(v_name, 'This member of staff'), public.and_list(v_found)
    using errcode = 'P0001';
end;
$$;
