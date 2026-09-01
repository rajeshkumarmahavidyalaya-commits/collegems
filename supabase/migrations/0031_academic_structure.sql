-- Phase 1.1 -- the academic structure the rest of Phase 1 and 3 stand on.
--
-- `class_levels` and `sections` already existed from the foundation migration.
-- What was missing is everything a timetable, an exam or a marks register needs
-- to refer to: what is taught, who teaches it, in which room, in which period,
-- and on which days the school is actually open.
--
-- Scoping, deliberately, is not uniform:
--
--   subjects, class_rooms, time_slots, weekends   tenant-scoped
--   section_subjects, holidays                    session-scoped as well
--
-- A subject, a room and a bell schedule outlive an academic year; who teaches
-- Grade 6B mathematics does not, and neither does a holiday calendar. Rule 2
-- asks for `session_id` on transactional tables, and those two are the
-- transactional ones here.

-- ---------------------------------------------------------------------------
-- Parent keys, so children can carry composite tenant-safe foreign keys
-- ---------------------------------------------------------------------------

-- Migration 0024 established why: foreign key checks are not subject to RLS, so
-- a single-column reference happily accepts another tenant's id.
alter table public.sections add constraint sections_tenant_id_key unique (tenant_id, id);
alter table public.staff add constraint staff_tenant_id_key unique (tenant_id, id);

-- ---------------------------------------------------------------------------
-- What is taught
-- ---------------------------------------------------------------------------

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text not null,
  kind text not null default 'theory' check (kind in ('theory', 'practical')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

alter table public.subjects add constraint subjects_tenant_id_key unique (tenant_id, id);
create index subjects_tenant_idx on public.subjects (tenant_id);

create trigger set_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();
create trigger audit_subjects
  after insert or update or delete on public.subjects
  for each row execute function public.audit_row_change();

alter table public.subjects enable row level security;

create policy "tenant members view subjects" on public.subjects
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage subjects" on public.subjects
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
-- Where it is taught
-- ---------------------------------------------------------------------------

create table public.class_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  capacity integer not null default 40 check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.class_rooms add constraint class_rooms_tenant_id_key unique (tenant_id, id);
create index class_rooms_tenant_idx on public.class_rooms (tenant_id);

create trigger set_updated_at before update on public.class_rooms
  for each row execute function public.set_updated_at();
create trigger audit_class_rooms
  after insert or update or delete on public.class_rooms
  for each row execute function public.audit_row_change();

alter table public.class_rooms enable row level security;

create policy "tenant members view class_rooms" on public.class_rooms
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage class_rooms" on public.class_rooms
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
-- When
-- ---------------------------------------------------------------------------

-- Two bell schedules, not one: exam periods are longer than lesson periods in
-- every school that runs both, so `kind` separates them and the routine grid
-- and the exam scheduler each read their own.
create table public.time_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'class' check (kind in ('class', 'exam')),
  period_number integer not null check (period_number > 0),
  label text,
  starts_at time not null,
  ends_at time not null,
  is_break boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, period_number),
  constraint time_slots_order_chk check (ends_at > starts_at)
);

alter table public.time_slots add constraint time_slots_tenant_id_key unique (tenant_id, id);
create index time_slots_tenant_idx on public.time_slots (tenant_id);
create index time_slots_lookup_idx on public.time_slots (tenant_id, kind, period_number);

create trigger set_updated_at before update on public.time_slots
  for each row execute function public.set_updated_at();
create trigger audit_time_slots
  after insert or update or delete on public.time_slots
  for each row execute function public.audit_row_change();

alter table public.time_slots enable row level security;

create policy "tenant members view time_slots" on public.time_slots
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage time_slots" on public.time_slots
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- Which weekdays the school teaches on. ISO numbering (1 = Monday .. 7 =
-- Sunday), matching `extract(isodow ...)`, so the attendance seed and every
-- future calendar query agree without a translation table in someone's head.
create table public.weekends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 7),
  is_teaching boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, weekday)
);

create index weekends_tenant_idx on public.weekends (tenant_id);

create trigger set_updated_at before update on public.weekends
  for each row execute function public.set_updated_at();
create trigger audit_weekends
  after insert or update or delete on public.weekends
  for each row execute function public.audit_row_change();

alter table public.weekends enable row level security;

create policy "tenant members view weekends" on public.weekends
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage weekends" on public.weekends
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- A closure spans a range rather than one row per day: "Diwali break, 20th to
-- 24th" is one thing a school decides, and storing five rows makes editing it
-- five edits and an inconsistency waiting to happen.
create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holidays_range_chk check (ends_on >= starts_on)
);

create index holidays_tenant_idx on public.holidays (tenant_id);
create index holidays_session_idx on public.holidays (session_id);
create index holidays_range_idx on public.holidays (tenant_id, session_id, starts_on, ends_on);

create trigger set_updated_at before update on public.holidays
  for each row execute function public.set_updated_at();
create trigger audit_holidays
  after insert or update or delete on public.holidays
  for each row execute function public.audit_row_change();

alter table public.holidays enable row level security;

create policy "tenant members view holidays" on public.holidays
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage holidays" on public.holidays
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
-- Who teaches what, where
-- ---------------------------------------------------------------------------

-- The join that the prompt pack calls "Assign Subject", and the thing every
-- later module reads: a section's subject list drives marks entry, homework and
-- the routine grid. Session-scoped, because the assignment is for one year.
create table public.section_subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  section_id uuid not null,
  subject_id uuid not null,
  -- Nullable: a subject can be on the curriculum before a teacher is assigned
  -- to it, and a school should not have to invent one to save the row.
  teacher_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, section_id, subject_id),

  constraint section_subjects_section_id_fkey
    foreign key (tenant_id, section_id)
    references public.sections (tenant_id, id) on delete cascade,
  constraint section_subjects_subject_id_fkey
    foreign key (tenant_id, subject_id)
    references public.subjects (tenant_id, id) on delete restrict,
  constraint section_subjects_teacher_fkey
    foreign key (tenant_id, teacher_staff_id)
    references public.staff (tenant_id, id) on delete set null (teacher_staff_id)
);

create index section_subjects_tenant_idx on public.section_subjects (tenant_id);
create index section_subjects_section_idx
  on public.section_subjects (tenant_id, session_id, section_id);
create index section_subjects_teacher_idx
  on public.section_subjects (tenant_id, teacher_staff_id) where teacher_staff_id is not null;
create index section_subjects_subject_idx on public.section_subjects (tenant_id, subject_id);
create index section_subjects_session_idx on public.section_subjects (session_id);

create trigger set_updated_at before update on public.section_subjects
  for each row execute function public.set_updated_at();
create trigger audit_section_subjects
  after insert or update or delete on public.section_subjects
  for each row execute function public.audit_row_change();

alter table public.section_subjects enable row level security;

create policy "tenant members view section_subjects" on public.section_subjects
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage section_subjects" on public.section_subjects
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
-- Is the school open?
-- ---------------------------------------------------------------------------

-- One answer, in one place. Attendance, the routine grid and any future
-- calendar all need it, and three implementations of "is this a working day"
-- is three chances to disagree about a holiday.
create or replace function public.academics_is_teaching_day(p_date date)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  with ctx as (
    select public.current_tenant_id() as tenant_id,
           public.current_session_id(public.current_tenant_id()) as session_id
  )
  select
    -- A weekday with no row configured counts as teaching: a school that has
    -- not filled this in yet should not find its whole calendar closed.
    coalesce(
      (select w.is_teaching from public.weekends w
       cross join ctx
       where w.tenant_id = ctx.tenant_id and w.weekday = extract(isodow from p_date)),
      true
    )
    and not exists (
      select 1 from public.holidays h
      cross join ctx
      where h.tenant_id = ctx.tenant_id
        and h.session_id = ctx.session_id
        and p_date between h.starts_on and h.ends_on
    )
$$;

revoke all on function public.academics_is_teaching_day(date) from public, anon;
grant execute on function public.academics_is_teaching_day(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Defaults, so a new school is not staring at six empty tables
-- ---------------------------------------------------------------------------

-- Monday to Saturday taught, Sunday not -- the Indian norm, and editable.
insert into public.weekends (tenant_id, weekday, is_teaching)
select t.id, d.weekday, d.weekday <> 7
from public.tenants t
cross join (select generate_series(1, 7) as weekday) d
on conflict (tenant_id, weekday) do nothing;

-- A conventional eight-period day with a break after the fourth.
insert into public.time_slots (tenant_id, kind, period_number, label, starts_at, ends_at, is_break)
select t.id, 'class', s.period_number, s.label, s.starts_at::time, s.ends_at::time, s.is_break
from public.tenants t
cross join (values
  (1, 'Period 1', '08:00', '08:45', false),
  (2, 'Period 2', '08:45', '09:30', false),
  (3, 'Period 3', '09:30', '10:15', false),
  (4, 'Period 4', '10:15', '11:00', false),
  (5, 'Break',    '11:00', '11:20', true),
  (6, 'Period 5', '11:20', '12:05', false),
  (7, 'Period 6', '12:05', '12:50', false),
  (8, 'Period 7', '12:50', '13:35', false)
) as s(period_number, label, starts_at, ends_at, is_break)
on conflict (tenant_id, kind, period_number) do nothing;
