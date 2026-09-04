-- ---------------------------------------------------------------------------
-- Dormitory
--
-- The same shape as transport, one level in: a hostel has rooms, a room has
-- beds and a fare, and a child occupies one for a stretch of the year. It is
-- deliberately built second, because it is the test of whether the billing
-- change transport forced was a one-off patch or an architecture:
-- `fees_billable_lines` gains a third source and nothing else moves.
--
-- It is also where the composite-key device runs out, and that boundary is
-- worth writing down. See `hostel_allocations` below.
-- ---------------------------------------------------------------------------

create table public.hostels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  -- Who it takes. `mixed` is a real answer, not a fallback -- a junior
  -- boarding house often is.
  kind text not null default 'mixed'
    check (kind in ('boys', 'girls', 'mixed')),
  warden_staff_id uuid,
  address text,
  -- Which head a room's fare posts to, the same rules-as-data as a transport
  -- route. Null means the hostel is not charged for here.
  fee_head_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, name),

  constraint hostels_warden_fkey
    foreign key (tenant_id, warden_staff_id)
    references public.staff (tenant_id, id) on delete set null,
  constraint hostels_fee_head_fkey
    foreign key (tenant_id, fee_head_id)
    references public.fee_heads (tenant_id, id) on delete restrict
);

alter table public.hostels add constraint hostels_tenant_id_key unique (tenant_id, id);
-- Carried onto the room and then onto the allocation, so "this room is in this
-- hostel" is a foreign key rather than a hope.
alter table public.hostels add constraint hostels_kind_key unique (tenant_id, id, kind);

create index hostels_tenant_idx on public.hostels (tenant_id);
create index hostels_warden_idx on public.hostels (tenant_id, warden_staff_id);
create index hostels_fee_head_idx on public.hostels (tenant_id, fee_head_id);

create trigger set_updated_at before update on public.hostels
  for each row execute function public.set_updated_at();
create trigger audit_hostels
  after insert or update or delete on public.hostels
  for each row execute function public.audit_row_change();

alter table public.hostels enable row level security;

create policy "tenant members view hostels" on public.hostels
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage hostels" on public.hostels
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
-- Rooms
-- ---------------------------------------------------------------------------

-- `beds` is the capacity and the fare is per child, not per room: two children
-- sharing a double each pay the double rate. A school charging by room type
-- sets the same number on every room of that type, which is configuration
-- rather than a special case -- the same reasoning as a flat transport fare.
create table public.hostel_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  hostel_id uuid not null,
  room_number text not null,
  floor text,
  beds integer not null check (beds > 0 and beds <= 40),
  monthly_fare numeric(10, 2) not null default 0 check (monthly_fare >= 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, hostel_id, room_number),

  constraint hostel_rooms_hostel_fkey
    foreign key (tenant_id, hostel_id)
    references public.hostels (tenant_id, id) on delete cascade
);

alter table public.hostel_rooms
  add constraint hostel_rooms_hostel_key unique (tenant_id, id, hostel_id);
alter table public.hostel_rooms
  add constraint hostel_rooms_beds_key unique (tenant_id, id, beds);

create index hostel_rooms_tenant_idx on public.hostel_rooms (tenant_id);
create index hostel_rooms_hostel_idx on public.hostel_rooms (tenant_id, hostel_id, room_number);

create trigger set_updated_at before update on public.hostel_rooms
  for each row execute function public.set_updated_at();
create trigger audit_hostel_rooms
  after insert or update or delete on public.hostel_rooms
  for each row execute function public.audit_row_change();

alter table public.hostel_rooms enable row level security;

create policy "tenant members view hostel_rooms" on public.hostel_rooms
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage hostel_rooms" on public.hostel_rooms
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
-- Allocations
-- ---------------------------------------------------------------------------

-- Which child sleeps where, between which dates.
--
-- Three rules, and the third is the interesting one because it is the first in
-- this codebase the composite-key device **cannot** reach.
--
--   1. **A room must be in the hostel the allocation names** -- the identity
--      form of the device, exactly as a transport stop is held on its route.
--   2. **A child cannot occupy two beds at once** -- a GiST exclusion
--      constraint over the date range, partial on `active`.
--   3. **A boys' hostel takes only boys.** This one is checked in
--      `hostel_allocate` and *not* declaratively, and the reason is structural:
--      the device carries a column from **one** parent table into a child's
--      composite key. A student's gender is not on `students`; it is on
--      `people`, one further join away. Reaching it would mean denormalising
--      gender onto `students` and keeping it in step -- a second copy of a fact
--      that already has an owner, to enforce a rule a school may well want to
--      relax (a warden's own child, a sibling pair, a school that does not
--      classify at all).
--
--      So the boundary is worth stating plainly: **the composite-key trick
--      reaches exactly one table.** A fact two joins away is a function check
--      with a readable message, or nothing.
create table public.hostel_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null,
  hostel_id uuid not null,
  room_id uuid not null,
  starts_on date not null,
  ends_on date,
  status text not null default 'active'
    check (status in ('active', 'cancelled')),
  -- Frozen at allocation, deliberately not cascaded: revising a room's fare in
  -- October must not restate an invoice raised in July. Same instinct as
  -- `transport_assignments.monthly_fare`.
  monthly_fare numeric(10, 2) not null check (monthly_fare >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hostel_allocations_range_chk
    check (ends_on is null or ends_on >= starts_on),

  constraint hostel_allocations_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,

  constraint hostel_allocations_hostel_fkey
    foreign key (tenant_id, hostel_id)
    references public.hostels (tenant_id, id) on delete restrict,

  -- Rule 1.
  constraint hostel_allocations_room_in_hostel_fkey
    foreign key (tenant_id, room_id, hostel_id)
    references public.hostel_rooms (tenant_id, id, hostel_id)
    on update cascade on delete restrict
);

-- Rule 2.
alter table public.hostel_allocations
  add constraint hostel_allocations_no_overlap
  exclude using gist (
    tenant_id with =,
    student_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status = 'active');

create index hostel_allocations_tenant_idx on public.hostel_allocations (tenant_id);
create index hostel_allocations_room_idx
  on public.hostel_allocations (tenant_id, room_id) where status = 'active';
create index hostel_allocations_student_idx
  on public.hostel_allocations (tenant_id, student_id);
create index hostel_allocations_session_idx on public.hostel_allocations (session_id);
create index hostel_allocations_hostel_idx on public.hostel_allocations (tenant_id, hostel_id);

create trigger set_updated_at before update on public.hostel_allocations
  for each row execute function public.set_updated_at();
create trigger audit_hostel_allocations
  after insert or update or delete on public.hostel_allocations
  for each row execute function public.audit_row_change();

alter table public.hostel_allocations enable row level security;

create policy "staff view hostel_allocations" on public.hostel_allocations
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'accountant')
  );

create policy "students view own hostel_allocations" on public.hostel_allocations
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children hostel_allocations" on public.hostel_allocations
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

create policy "admins manage hostel_allocations" on public.hostel_allocations
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

comment on table public.hostel_allocations is
  'Which student occupies which bed, between which dates. The room is held in its hostel by a composite foreign key; two live allocations for one child are refused by a GiST exclusion constraint. The gender rule is checked in hostel_allocate instead, because the fact it depends on lives two tables away -- see the migration header.';
