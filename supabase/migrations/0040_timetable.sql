-- Phase 1.2 -- the class routine.
--
-- One row per (class, weekday, period). Everything interesting about this table
-- is a constraint rather than a column, because a timetable is defined by what
-- it refuses: a teacher cannot be in two rooms at once, a room cannot hold two
-- classes at once, and a class has one lesson per period.
--
-- Those three rules are unique indexes, not application checks and not a
-- trigger. A clash detected in TypeScript is a clash that two concurrent
-- requests can still create; a clash detected by a unique index cannot happen,
-- and the readable error message is built on top of it rather than instead of
-- it.
--
-- WHY NOT AN EXCLUSION CONSTRAINT
--
-- `docs/domain/erd.md` sketched this as exclusion constraints on
-- (teacher, weekday, slot, session) and (room, weekday, slot, session). That
-- would be right if periods were time *ranges* that could partially overlap.
-- They are not: a period is a `time_slots` row, and two lessons either occupy
-- the same slot or they do not. Equality-only exclusion constraints are just
-- unique indexes with a GiST index and no `on conflict` support, so this uses
-- the plain thing. If a school ever schedules by wall-clock ranges instead of
-- named periods, that is when the exclusion constraint earns its keep.

-- ---------------------------------------------------------------------------
-- "A period a lesson may be scheduled in", as a key
-- ---------------------------------------------------------------------------

-- Two facts about a slot disqualify it from the routine: it belongs to the exam
-- bell schedule, or it is a break. Both are properties of `time_slots`, and a
-- CHECK constraint cannot look at another table.
--
-- Rather than a trigger, the fact is materialised on `time_slots` and joined
-- into the foreign key. `timetable_entries` then carries a constant `true`
-- column whose only job is to make the composite FK unsatisfiable for an exam
-- period or a lunch break. The tenant is in the same key, so one constraint
-- enforces "same tenant, real lesson period" together.
alter table public.time_slots
  add column schedulable boolean
  generated always as (kind = 'class' and not is_break) stored;

comment on column public.time_slots.schedulable is
  'Generated: a lesson period, not an exam period and not a break. Exists to be '
  'the target of timetable_entries'' composite foreign key -- a CHECK cannot '
  'reach another table, and this makes the rule declarative instead of a trigger.';

alter table public.time_slots
  add constraint time_slots_schedulable_key unique (tenant_id, id, schedulable);

-- ---------------------------------------------------------------------------
-- The routine
-- ---------------------------------------------------------------------------

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Session-scoped per rule 2, carried directly: "this year's routine" is the
  -- only query anyone runs against this table.
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  section_id uuid not null,
  subject_id uuid not null,
  -- Nullable, and deliberately free to differ from `section_subjects`'
  -- assignment: a period covered by a substitute is still that section's
  -- mathematics lesson. Denormalised from the assignment rather than joined
  -- for, because the teacher clash index needs it on this row.
  teacher_staff_id uuid,
  -- Nullable: a school that teaches every subject in the home room has nothing
  -- to say here, and forcing it to invent a room would make the room clash
  -- index meaningless.
  class_room_id uuid,
  time_slot_id uuid not null,
  -- ISO numbering (1 = Monday .. 7 = Sunday), matching `weekends`,
  -- `extract(isodow ...)` and every other calendar column in this schema.
  weekday integer not null check (weekday between 1 and 7),
  -- Constant. See the comment on `time_slots.schedulable`.
  slot_schedulable boolean not null default true
    check (slot_schedulable),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Rule 1: one lesson per class per period. This is also what makes the grid
  -- an upsert target -- a cell holds one lesson, so saving into a filled cell
  -- replaces it rather than erroring.
  constraint timetable_entries_section_slot_key
    unique (tenant_id, session_id, section_id, weekday, time_slot_id),

  -- The subject must actually be on this section's curriculum this year, and
  -- this one constraint carries section, subject, tenant and session together.
  -- `on delete cascade`: unassigning a subject from a class removes its periods,
  -- which is the only coherent answer -- a routine entry for a subject the
  -- class no longer studies is not something anyone would want kept.
  constraint timetable_entries_assignment_fkey
    foreign key (tenant_id, session_id, section_id, subject_id)
    references public.section_subjects (tenant_id, session_id, section_id, subject_id)
    on delete cascade,

  constraint timetable_entries_teacher_fkey
    foreign key (tenant_id, teacher_staff_id)
    references public.staff (tenant_id, id)
    on delete set null (teacher_staff_id),

  constraint timetable_entries_room_fkey
    foreign key (tenant_id, class_room_id)
    references public.class_rooms (tenant_id, id)
    on delete set null (class_room_id),

  -- The composite that enforces "a real lesson period in my own tenant".
  constraint timetable_entries_slot_fkey
    foreign key (tenant_id, time_slot_id, slot_schedulable)
    references public.time_slots (tenant_id, id, schedulable)
    on delete cascade
);

-- Rule 2: a teacher is in one place at a time. Partial, because a period with
-- no teacher assigned yet is not a clash with every other unassigned period.
create unique index timetable_entries_teacher_clash
  on public.timetable_entries (tenant_id, session_id, teacher_staff_id, weekday, time_slot_id)
  where teacher_staff_id is not null;

-- Rule 3: a room holds one class at a time. Partial for the same reason.
create unique index timetable_entries_room_clash
  on public.timetable_entries (tenant_id, session_id, class_room_id, weekday, time_slot_id)
  where class_room_id is not null;

create index timetable_entries_tenant_idx on public.timetable_entries (tenant_id);
-- The grid query: one section's whole week.
create index timetable_entries_section_idx
  on public.timetable_entries (tenant_id, session_id, section_id, weekday);
-- The "my week" query.
create index timetable_entries_teacher_idx
  on public.timetable_entries (tenant_id, session_id, teacher_staff_id, weekday)
  where teacher_staff_id is not null;
create index timetable_entries_session_idx on public.timetable_entries (session_id);

create trigger set_updated_at before update on public.timetable_entries
  for each row execute function public.set_updated_at();
create trigger audit_timetable_entries
  after insert or update or delete on public.timetable_entries
  for each row execute function public.audit_row_change();

alter table public.timetable_entries enable row level security;

-- Everyone in the tenant reads it. A routine is the least secret thing a school
-- owns, and a student who cannot see their own timetable is a bug.
create policy "tenant members view timetable_entries" on public.timetable_entries
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

-- Writing is an office function, like `section_subjects`. A teacher who could
-- edit the routine could move themselves out of a period, which is a staffing
-- decision rather than a teaching one.
create policy "admins manage timetable_entries" on public.timetable_entries
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );
