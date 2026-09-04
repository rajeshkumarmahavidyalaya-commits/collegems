-- ---------------------------------------------------------------------------
-- Dormitory — the engine, and a third source of invoice lines
-- ---------------------------------------------------------------------------

-- How full each room is. One definition of "beds free", used by the screen and
-- by the allocate function, so the two cannot disagree.
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
      and (a.ends_on is null or a.ends_on >= current_date)
  ) o on true
  where p_hostel_id is null or r.hostel_id = p_hostel_id
  order by h.name, r.room_number
$$;

revoke all on function public.hostel_occupancy(uuid) from public, anon;
grant execute on function public.hostel_occupancy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Allocating
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the admin policy on `hostel_allocations` still decides who
-- may write one. What this adds is the three things a raw INSERT cannot -- the
-- fare copied from the room, a bed count that is a fact about other rows, and
-- the gender rule that no constraint in this schema can reach.
--
-- The gender check is the honest exception. The composite-key device carries a
-- column from one parent into a child's key; a student's gender is on `people`,
-- one join beyond `students`. Denormalising it would put a second copy of a
-- fact that already has an owner into the schema, to enforce a rule a school
-- may want to relax. So it is checked here, with a message, and `mixed` and an
-- unrecorded gender both pass -- refusing to place a child because nobody typed
-- their gender would be the wrong failure.
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

  if p_ends_on is not null and p_ends_on < v_starts then
    raise exception 'The stay cannot end before it starts';
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
    and daterange(a.starts_on, a.ends_on, '[]') && daterange(v_starts, p_ends_on, '[]');

  if v_occupied >= v_room.beds then
    raise exception
      'Room % in % has % bed(s) and % are taken for those dates. Free one, or choose another room.',
      v_room.room_number, v_room.hostel_name, v_room.beds, v_occupied;
  end if;

  begin
    insert into public.hostel_allocations (
      tenant_id, session_id, student_id, hostel_id, room_id,
      starts_on, ends_on, monthly_fare
    )
    values (
      v_tenant_id, v_session_id, p_student_id, v_room.hostel_id, v_room.room_id,
      v_starts, p_ends_on, v_room.monthly_fare
    )
    returning id into v_id;
  exception when exclusion_violation then
    raise exception
      'That child already has a room for those dates. End the current stay first.';
  end;

  return v_id;
end;
$$;

revoke all on function public.hostel_allocate(uuid, uuid, date, date) from public, anon;
grant execute on function public.hostel_allocate(uuid, uuid, date, date) to authenticated;

create or replace function public.hostel_release(
  p_allocation_id uuid,
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
  from public.hostel_allocations where id = p_allocation_id;

  if v_starts is null then
    raise exception 'That allocation does not exist';
  end if;
  if v_ends < v_starts then
    raise exception 'A stay cannot end before it started (% is before %)', v_ends, v_starts;
  end if;

  update public.hostel_allocations set ends_on = v_ends where id = p_allocation_id;
  return v_ends;
end;
$$;

revoke all on function public.hostel_release(uuid, date) from public, anon;
grant execute on function public.hostel_release(uuid, date) to authenticated;

create or replace function public.hostel_cancel_allocation(
  p_allocation_id uuid,
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
  update public.hostel_allocations
  set status = 'cancelled', note = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_allocation_id and status = 'active';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'That allocation does not exist, or has already been cancelled';
  end if;
  return true;
end;
$$;

revoke all on function public.hostel_cancel_allocation(uuid, text) from public, anon;
grant execute on function public.hostel_cancel_allocation(uuid, text) to authenticated;

-- The warden's register: room by room, who is in it, and a number to ring.
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
   and (a.ends_on is null or a.ends_on >= current_date)
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

revoke all on function public.hostel_register(uuid) from public, anon;
grant execute on function public.hostel_register(uuid) to authenticated;

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
  status text,
  warden_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.id, h.name, h.kind, r.room_number, r.floor, a.monthly_fare,
    a.starts_on, a.ends_on, a.status,
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
-- The third billing source
-- ---------------------------------------------------------------------------

-- Transport forced `fees_billable_lines` to stop treating `fee_structures` as
-- the only source of invoice lines. This is the test of whether that was a
-- patch or an architecture: a hostel fare is keyed on a room, exactly as a bus
-- fare is keyed on a stop, and adding it is one function plus one `union all`.
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
    and (a.ends_on is null or a.ends_on >= coalesce(p_as_of, current_date))
$$;

revoke all on function public.hostel_fee_lines(uuid, date) from public, anon;
grant execute on function public.hostel_fee_lines(uuid, date) to authenticated;

create or replace function public.fees_billable_lines(
  p_student_id uuid,
  p_instalment_id uuid default null,
  p_as_of date default null,
  p_fee_head_ids uuid[] default null
)
returns table (
  fee_head_id uuid,
  description text,
  amount numeric,
  source text
)
language sql
stable
set search_path = public, extensions
as $$
  with period as (
    select fi.collects, fi.period_start, fi.due_date
    from public.fee_instalments fi
    where fi.id = p_instalment_id
  ),
  as_of as (
    select coalesce(
      p_as_of,
      (select coalesce(period_start, due_date) from period),
      current_date
    ) as d
  )
  select fs.fee_head_id, fh.name::text, fs.amount, 'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    and fs.class_level_id = (
      select s.class_level_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      where e.student_id = p_student_id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
      limit 1
    )
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where fs.frequency = any (pp.collects))
    )

  union all

  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, (select d from as_of)) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )

  union all

  -- A hostel fare is monthly by construction, like a bus fare.
  select hl.fee_head_id, hl.description, hl.amount, 'hostel'::text
  from public.hostel_fee_lines(p_student_id, (select d from as_of)) hl
  join public.fee_heads fh on fh.id = hl.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or hl.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )
$$;

revoke all on function public.fees_billable_lines(uuid, uuid, date, uuid[]) from public, anon;
grant execute on function public.fees_billable_lines(uuid, uuid, date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The conflict detector, generalised
-- ---------------------------------------------------------------------------

-- `transport_billing_conflicts()` was right about transport and wrong about
-- its own name the moment a second per-student source existed. One definition
-- covering every source replaces it, so a school adding hostels gets the same
-- warning without anybody remembering to write a second detector.
drop function if exists public.transport_billing_conflicts();

create or replace function public.fees_billing_conflicts()
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  with per_student as (
    select tr.fee_head_id, tr.session_id, 'route ' || tr.code as label
    from public.transport_routes tr
    where tr.fee_head_id is not null and tr.is_active
    union all
    select h.fee_head_id, fi.session_id, 'hostel ' || h.name
    from public.hostels h
    cross join lateral (
      select s.id as session_id from public.academic_sessions s
      where s.tenant_id = h.tenant_id
    ) fi
    where h.fee_head_id is not null and h.is_active
  )
  select (
    'Class ' || cl.name || ' has a "' || fh.name || '" fee of ' ||
    to_char(fs.amount, 'FM999999990.00') ||
    ' in its fee structure, and ' || count(distinct ps.label) ||
    case when count(distinct ps.label) = 1 then ' other source charges'
         else ' other sources charge' end ||
    ' against the same head (' || string_agg(distinct ps.label, ', ') ||
    '). Any child in that class using one is billed twice. Remove the class-level charge, or point them at a different head.'
  )::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  join public.class_levels cl on cl.id = fs.class_level_id
  join per_student ps
    on ps.fee_head_id = fs.fee_head_id
   and ps.session_id = fs.session_id
  where fs.amount > 0
  group by cl.name, fh.name, fs.amount
  order by cl.name
$$;

revoke all on function public.fees_billing_conflicts() from public, anon;
grant execute on function public.fees_billing_conflicts() to authenticated;

comment on function public.fees_billing_conflicts() is
  'Sentences, not error codes: where a fee head is charged both by a class-level fee structure and by a per-student source (a transport route, a hostel), every child in that class using it is billed twice. Deliberately not a constraint -- a school mid-migration may legitimately have both for a while.';
