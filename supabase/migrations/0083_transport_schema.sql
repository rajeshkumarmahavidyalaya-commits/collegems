-- ---------------------------------------------------------------------------
-- Phase 5.2 — transport
--
-- Buses, the stops they call at, and which child boards where. The module looks
-- like reference data and is not: it is the first place in this codebase where
-- **a fee depends on something other than a class level**, and that turns out
-- to be the whole design.
--
-- `fee_structures` answers "what does a child in Class 6 pay". Transport asks a
-- different question -- "what does a child who boards at Sector 12 pay" -- and
-- two children sitting next to each other in the same class pay different
-- fares. See migration 0084; this one is the shape.
-- ---------------------------------------------------------------------------

-- `fee_heads` predates the convention that every table carries a
-- `(tenant_id, id)` unique key for composite foreign keys to point at. A route
-- names the head its fare posts to, and that reference has to be tenant-safe --
-- foreign key checks are not subject to RLS, so a bare `references
-- fee_heads(id)` would let one tenant's route point at another's head.
alter table public.fee_heads
  add constraint fee_heads_tenant_id_key unique (tenant_id, id);

-- ---------------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------------

-- Not session-scoped, deliberately, and the only table here that is not: a bus
-- is a physical object the school owns across years, while a route is an
-- arrangement made for one of them.
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  registration_number text not null,
  model text,
  -- Seats, not passengers: the number the vehicle is licensed to carry, which
  -- is what an inspector reads off the door and what the capacity check below
  -- compares against.
  capacity integer not null check (capacity > 0 and capacity <= 200),
  driver_staff_id uuid,
  attendant_staff_id uuid,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, registration_number),

  constraint vehicles_driver_fkey
    foreign key (tenant_id, driver_staff_id)
    references public.staff (tenant_id, id) on delete set null,
  constraint vehicles_attendant_fkey
    foreign key (tenant_id, attendant_staff_id)
    references public.staff (tenant_id, id) on delete set null
);

alter table public.vehicles add constraint vehicles_tenant_id_key unique (tenant_id, id);
alter table public.vehicles
  add constraint vehicles_capacity_key unique (tenant_id, id, capacity);

create index vehicles_tenant_idx on public.vehicles (tenant_id);
create index vehicles_driver_idx on public.vehicles (tenant_id, driver_staff_id);
create index vehicles_attendant_idx on public.vehicles (tenant_id, attendant_staff_id);

create trigger set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();
create trigger audit_vehicles
  after insert or update or delete on public.vehicles
  for each row execute function public.audit_row_change();

alter table public.vehicles enable row level security;

create policy "tenant members view vehicles" on public.vehicles
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage vehicles" on public.vehicles
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------

-- **A route is a trip, not a bus.** The distinction decides how capacity is
-- counted: one vehicle that runs a morning trip and an afternoon trip has forty
-- seats twice, not forty seats shared. Modelling a route as the trip makes
-- "does this bus have room" a question about one route, which is both true and
-- countable.
--
-- Session-scoped per rule 2: next year's routes are next year's rows, and last
-- year's remain readable exactly as they were run.
create table public.transport_routes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  code text not null,
  name text not null,
  direction text not null default 'both'
    check (direction in ('pickup', 'drop', 'both')),
  vehicle_id uuid,
  -- Carried here rather than looked up, so the capacity check is a comparison
  -- against a local column and cannot disagree with the vehicle it names.
  -- `on update cascade` means raising or lowering a bus's licensed capacity
  -- rewrites every route that uses it, in one statement.
  vehicle_capacity integer,
  -- Which fee head a fare posts to. Rules-as-data, per rule 12: a school with
  -- separate "Bus fee" and "Van fee" heads says so with two rows, not with a
  -- branch, and a school with one head points every route at it.
  fee_head_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, session_id, code),

  constraint transport_routes_vehicle_chk
    check ((vehicle_id is null) = (vehicle_capacity is null)),

  constraint transport_routes_vehicle_fkey
    foreign key (tenant_id, vehicle_id, vehicle_capacity)
    references public.vehicles (tenant_id, id, capacity)
    on update cascade on delete set null,

  constraint transport_routes_fee_head_fkey
    foreign key (tenant_id, fee_head_id)
    references public.fee_heads (tenant_id, id) on delete restrict
);

alter table public.transport_routes
  add constraint transport_routes_tenant_id_key unique (tenant_id, id);
-- Carried into the stop and the assignment below, so "this stop is on a route
-- from this year" and "this child is assigned to a route from this year" are
-- both foreign keys rather than hopes. Assigning a child to last year's route
-- is exactly the mistake a session rollover invites.
alter table public.transport_routes
  add constraint transport_routes_session_key unique (tenant_id, id, session_id);

create index transport_routes_tenant_idx on public.transport_routes (tenant_id);
create index transport_routes_session_idx on public.transport_routes (tenant_id, session_id);
create index transport_routes_vehicle_idx on public.transport_routes (tenant_id, vehicle_id);
create index transport_routes_fee_head_idx on public.transport_routes (tenant_id, fee_head_id);

create trigger set_updated_at before update on public.transport_routes
  for each row execute function public.set_updated_at();
create trigger audit_transport_routes
  after insert or update or delete on public.transport_routes
  for each row execute function public.audit_row_change();

alter table public.transport_routes enable row level security;

create policy "tenant members view transport_routes" on public.transport_routes
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage transport_routes" on public.transport_routes
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Stops
-- ---------------------------------------------------------------------------

-- The fare lives here, not on the route, because that is where the money
-- actually varies: a child boarding two kilometres out pays less than one
-- boarding twelve, on the same bus, in the same class. A school that charges a
-- flat fare per route sets the same number on every stop, which is a
-- configuration rather than a special case.
create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  route_id uuid not null,
  name text not null,
  landmark text,
  -- Order along the trip. Unique per route, so "third stop" is a fact rather
  -- than a tie broken by whichever row the planner happens to return first.
  sequence integer not null check (sequence > 0),
  pickup_time time,
  drop_time time,
  monthly_fare numeric(10, 2) not null default 0 check (monthly_fare >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, route_id, sequence),
  unique (tenant_id, route_id, name),

  constraint route_stops_route_fkey
    foreign key (tenant_id, route_id, session_id)
    references public.transport_routes (tenant_id, id, session_id)
    on update cascade on delete cascade
);

-- The key an assignment points at. It is what makes "this child's stop is on
-- this child's route" a foreign key rather than a trigger -- see below.
alter table public.route_stops
  add constraint route_stops_route_key unique (tenant_id, id, route_id);

create index route_stops_tenant_idx on public.route_stops (tenant_id);
create index route_stops_route_idx on public.route_stops (tenant_id, route_id, sequence);
create index route_stops_session_idx on public.route_stops (session_id);

create trigger set_updated_at before update on public.route_stops
  for each row execute function public.set_updated_at();
create trigger audit_route_stops
  after insert or update or delete on public.route_stops
  for each row execute function public.audit_row_change();

alter table public.route_stops enable row level security;

create policy "tenant members view route_stops" on public.route_stops
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage route_stops" on public.route_stops
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------

-- Which child boards where, and between which dates.
--
-- Two rules here that no CHECK can see, each getting the device CLAUDE.md
-- prescribes for it:
--
--   1. **A child's stop must be on the child's route.** That is a fact about
--      another table, so the route is denormalised onto the assignment and the
--      pair is a composite foreign key into `route_stops (tenant_id, id,
--      route_id)`. A stop on a different route simply has no matching key. This
--      is the fourth use of the device in the codebase and the first where the
--      carried column is an **identity** rather than a flag (time_slots) or a
--      value (marks) or a status (payslips).
--
--   2. **A child cannot be on two buses at once.** That is a fact about another
--      row, so it is a GiST exclusion constraint over the date range, made
--      partial on `status = 'active'` so a cancelled arrangement stops blocking
--      a new one.
create table public.transport_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null,
  route_id uuid not null,
  stop_id uuid not null,
  direction text not null default 'both'
    check (direction in ('pickup', 'drop', 'both')),
  starts_on date not null,
  -- Open-ended by default: most arrangements run to the end of the year and
  -- nobody types a date for that.
  ends_on date,
  status text not null default 'active'
    check (status in ('active', 'cancelled')),
  -- Frozen at assignment, the same instinct as `exam_results`: the stop's fare
  -- may be revised in October, and an invoice raised in July was raised at July's
  -- number. `on update cascade` is deliberately NOT used here -- unlike the
  -- vehicle's capacity, this copy is a historical fact, not a mirror.
  monthly_fare numeric(10, 2) not null check (monthly_fare >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transport_assignments_range_chk
    check (ends_on is null or ends_on >= starts_on),

  constraint transport_assignments_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,

  constraint transport_assignments_route_fkey
    foreign key (tenant_id, route_id, session_id)
    references public.transport_routes (tenant_id, id, session_id)
    on update cascade on delete restrict,

  -- Rule 1, above.
  constraint transport_assignments_stop_on_route_fkey
    foreign key (tenant_id, stop_id, route_id)
    references public.route_stops (tenant_id, id, route_id)
    on update cascade on delete restrict
);

-- Rule 2, above. `daterange(..., '[]')` is inclusive at both ends, and a null
-- `ends_on` makes the range unbounded, which is exactly what an open-ended
-- arrangement means.
alter table public.transport_assignments
  add constraint transport_assignments_no_overlap
  exclude using gist (
    tenant_id with =,
    student_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status = 'active');

create index transport_assignments_tenant_idx on public.transport_assignments (tenant_id);
create index transport_assignments_route_idx
  on public.transport_assignments (tenant_id, route_id) where status = 'active';
create index transport_assignments_stop_idx on public.transport_assignments (tenant_id, stop_id);
create index transport_assignments_student_idx
  on public.transport_assignments (tenant_id, student_id);
create index transport_assignments_session_idx on public.transport_assignments (session_id);

create trigger set_updated_at before update on public.transport_assignments
  for each row execute function public.set_updated_at();
create trigger audit_transport_assignments
  after insert or update or delete on public.transport_assignments
  for each row execute function public.audit_row_change();

alter table public.transport_assignments enable row level security;

create policy "staff view transport_assignments" on public.transport_assignments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'accountant')
  );

-- A family may see their own arrangement -- which stop, at what time, on which
-- bus -- because it is the answer to "where do I put my child in the morning".
create policy "students view own transport_assignments" on public.transport_assignments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children transport_assignments" on public.transport_assignments
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

create policy "admins manage transport_assignments" on public.transport_assignments
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

comment on table public.transport_assignments is
  'Which student boards at which stop, between which dates. The stop is held on the student''s own route by a composite foreign key, and two live arrangements for one child are refused by a GiST exclusion constraint, not by application code.';
comment on column public.transport_assignments.monthly_fare is
  'The stop''s fare as it stood when the arrangement was made. Deliberately not cascaded: revising a stop''s fare in October must not restate an invoice raised in July.';
comment on column public.transport_routes.vehicle_capacity is
  'A copy of vehicles.capacity, held in step by ON UPDATE CASCADE, so the seat count is a local column the capacity check can compare against.';
