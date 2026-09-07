-- ---------------------------------------------------------------------------
-- The substitution roster
-- ---------------------------------------------------------------------------
--
-- Every school does this before assembly, on paper, every morning: three
-- teachers are away, forty periods have nobody in front of them, and somebody
-- with a printed timetable works out who is free. It is the last link in a
-- chain this codebase already has all the other parts of -- `leave_requests`
-- knows who is away, `timetable_entries` knows what they were going to teach,
-- and nothing joined the two.
--
-- WHERE THE COMPOSITE-KEY DEVICE STOPS, FOR THE SECOND TIME
--
-- CLAUDE.md names one boundary already: the device carries a column from
-- exactly one parent table, so a fact two joins away needs a function check.
-- This module found the other one, and it is not about distance.
--
-- The obvious design is a composite foreign key tying the substitution to the
-- lesson *and* its teacher:
--
--   foreign key (tenant_id, timetable_entry_id, teacher_staff_id)
--   references timetable_entries (tenant_id, id, teacher_staff_id)
--
-- It does not work, and neither answer to `on update` is right:
--
--   * **with `on update cascade`** -- reassigning Monday period 3 to Mr Rao
--     next term rewrites last October's substitution to say *Mr Rao* was
--     away. The record of a day silently becomes a lie about it.
--   * **without the cascade** -- the same reassignment is *refused*, because
--     old substitution rows still point at the old teacher. A school cannot
--     change its timetable because of what happened in October.
--
-- > **The composite-key device ties a child to its parent's *current* state.
-- > A row that records what was true on a day is not that child.** Freeze the
-- > values and check them in the write function instead.
--
-- So `absent_staff_id` and `time_slot_id` are frozen copies here, not keys into
-- the timetable, and `substitution_arrange` checks them at the moment of
-- arranging. What the frozen `time_slot_id` *is* used for is the one guard that
-- has to be a constraint rather than a check -- see below.

alter table public.timetable_entries
  add constraint timetable_entries_tenant_id_key unique (tenant_id, id);

create table public.substitutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,

  on_date date not null,

  -- Which lesson. The only live link to the timetable, and it cascades on
  -- delete: a lesson that no longer exists has no arrangement to remember.
  timetable_entry_id uuid not null,

  -- Frozen at the moment of arranging. See the header: these are a record of a
  -- morning, not a view of the timetable as it stands today.
  absent_staff_id uuid not null,
  time_slot_id uuid not null,

  -- Null is a real and common answer: "nobody is free, the class is merged
  -- into 5B" or "supervised study". A row with no substitute is an
  -- arrangement, not a gap -- the gap is the *absence* of a row, and
  -- conflating the two would make the morning list wrong in the direction that
  -- leaves a class unattended.
  substitute_staff_id uuid,
  note text,

  arranged_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One arrangement per lesson per day. Two people arranging cover at the same
  -- moment must have one of them lose here, in the database, rather than both
  -- believing they have covered it.
  unique (timetable_entry_id, on_date),

  constraint substitutions_entry_fkey
    foreign key (tenant_id, timetable_entry_id)
    references public.timetable_entries (tenant_id, id) on delete cascade,
  constraint substitutions_absent_fkey
    foreign key (tenant_id, absent_staff_id)
    references public.staff (tenant_id, id),
  constraint substitutions_substitute_fkey
    foreign key (tenant_id, substitute_staff_id)
    references public.staff (tenant_id, id),

  -- Somebody cannot cover for themselves. Obvious, and exactly the sort of
  -- thing a tired person clicks at half past seven in the morning.
  constraint substitutions_not_self check (
    substitute_staff_id is null or substitute_staff_id <> absent_staff_id
  )
);

alter table public.substitutions
  add constraint substitutions_tenant_id_key unique (tenant_id, id);

create index substitutions_day_idx on public.substitutions (tenant_id, on_date);
create index substitutions_absent_idx on public.substitutions (tenant_id, absent_staff_id, on_date);
create index substitutions_substitute_idx
  on public.substitutions (tenant_id, substitute_staff_id, on_date)
  where substitute_staff_id is not null;

-- **The guard that has to be a constraint.** A substitute in two classrooms at
-- once is the single mistake this module exists to prevent, and it is a fact
-- about a second row -- no CHECK can see it, and a query-then-insert is a race
-- between two people doing the roster together. Partial, because any number of
-- lessons may be left with no substitute in the same period.
--
-- This is what the frozen `time_slot_id` is for: the period a lesson was
-- *arranged* in, which is the period the substitute actually stood in.
create unique index substitutions_one_class_per_period
  on public.substitutions (tenant_id, on_date, time_slot_id, substitute_staff_id)
  where substitute_staff_id is not null;

create trigger set_updated_at before update on public.substitutions
  for each row execute function public.set_updated_at();
create trigger audit_substitutions
  after insert or update or delete on public.substitutions
  for each row execute function public.audit_row_change();

alter table public.substitutions enable row level security;

-- Every member of staff reads the roster: the whole point is that a teacher
-- walking in at eight can see they are covering 7B period 2. Arranging it is
-- the office's.
create policy "staff view substitutions" on public.substitutions
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "admins arrange substitutions" on public.substitutions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

comment on table public.substitutions is
  'One arrangement per lesson per day. `absent_staff_id` and `time_slot_id` are '
  'frozen copies rather than keys into the timetable: a record of a morning '
  'must not be rewritten by next term''s timetable edit, and must not prevent '
  'one. See migration 0155''s header.';

-- ---------------------------------------------------------------------------
-- Is this person away?
-- ---------------------------------------------------------------------------
--
-- Two sources, and both are needed. Approved leave is what the school knows in
-- advance; the register is what happened. A teacher who did not turn up and
-- never applied for leave still leaves five periods uncovered, and a teacher
-- `on_duty` at a district meeting is working -- just not here.
--
-- `SECURITY INVOKER`: `leave_requests` and `staff_attendance` both carry
-- policies, and the roster is arranged by an administrator who can read both.

create or replace function public.staff_is_away(p_date date, p_staff_id uuid)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select
    exists (
      select 1 from public.leave_requests lr
      where lr.staff_id = p_staff_id
        and lr.status = 'approved'
        and p_date between lr.starts_on and lr.ends_on
    )
    or exists (
      select 1 from public.staff_attendance sa
      where sa.staff_id = p_staff_id
        and sa.attendance_date = p_date
        -- `half_day` is deliberately not here: half a day is a conversation,
        -- not a roster entry, and marking it away would put four periods on
        -- the list that their own teacher is standing in front of.
        and sa.status in ('absent', 'on_leave', 'on_duty')
    )
$$;

revoke all on function public.staff_is_away(date, uuid) from public, anon;
grant execute on function public.staff_is_away(date, uuid) to authenticated;

comment on function public.staff_is_away(date, uuid) is
  'Approved leave or a register that says absent, on leave or on duty. Both '
  'sources matter: leave is what the school knew in advance, the register is '
  'what happened.';
