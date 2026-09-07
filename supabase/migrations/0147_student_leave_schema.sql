-- ---------------------------------------------------------------------------
-- Student leave — closing the loop the absence notice opened
-- ---------------------------------------------------------------------------
--
-- Migration 0141 built a schedule that texts a parent the evening their child
-- was marked absent. It works, and on its own it is rude: a family that told
-- the school on Monday that their daughter has chickenpox gets a text every
-- evening for a week saying she was absent.
--
-- The missing half is a way for the family to say so, and the rule the pair
-- makes is worth more than either:
--
-- > **A module that sends must ask the module that knows.** Otherwise a school
-- > spends its SMS credit telling parents things the parents told the school.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- **Approving leave does not write attendance rows.** The obvious shortcut is to
-- stamp `excused` across the range at the moment of approval, and it is wrong
-- twice over: it writes the future (the register is taken daily, by a person,
-- and a child on approved leave who turns up must be marked present), and it
-- makes `attendance_records` say something no teacher marked. The register stays
-- the record of what was observed.
--
-- Instead the fact travels two ways, both of them reads:
--
--   * the **marking screen** shows "on approved leave" beside the child, so the
--     teacher marks `excused` knowingly;
--   * the **absence notice** consults leave before it sends, and counts the ones
--     it skipped.
--
-- A leave approved *after* the register was taken does not retrospectively
-- change it. That is correct, and it is the school's to re-mark if they want to
-- -- an approval quietly rewriting yesterday's register is exactly the kind of
-- edit an attendance record must not permit.

create table public.student_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null,

  starts_on date not null,
  ends_on date not null,

  -- Why, in the family's words. Not an enum of reasons: a school that wants
  -- to count "sick days" can, and a school that does not should not be made to
  -- classify a bereavement.
  kind text not null default 'other'
    check (kind in ('sick', 'planned', 'emergency', 'other')),
  reason text not null,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'refused', 'cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,

  -- Who asked. A parent applying for their child and a class teacher recording
  -- what a parent said at the gate are both real, and telling them apart is
  -- the difference between a request and a record.
  applied_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint student_leave_range_chk check (ends_on >= starts_on),
  constraint student_leave_decided_chk check (
    (status in ('approved', 'refused')) = (decided_at is not null)
  ),
  constraint student_leave_reason_chk check (length(trim(reason)) >= 3),

  constraint student_leave_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

alter table public.student_leave_requests
  add constraint student_leave_requests_tenant_id_key unique (tenant_id, id);

create index student_leave_tenant_idx
  on public.student_leave_requests (tenant_id, starts_on desc);
create index student_leave_student_idx
  on public.student_leave_requests (tenant_id, student_id);
create index student_leave_live_idx
  on public.student_leave_requests (tenant_id, status) where status in ('pending', 'approved');

-- **No two live requests for one child over the same days.** A CHECK cannot see
-- a second row and an application that queries first and inserts second is a
-- race, so this is the exclusion constraint CLAUDE.md names -- the same shape
-- staff leave already uses.
--
-- Partial on `pending`/`approved`, so a refused or cancelled request does not
-- block re-applying for the same dates. A family whose first note was refused
-- for want of detail must be able to send a better one.
create extension if not exists btree_gist;

alter table public.student_leave_requests
  add constraint student_leave_no_overlap
  exclude using gist (
    tenant_id with =,
    student_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status in ('pending', 'approved'));

create trigger set_updated_at before update on public.student_leave_requests
  for each row execute function public.set_updated_at();
create trigger audit_student_leave_requests
  after insert or update or delete on public.student_leave_requests
  for each row execute function public.audit_row_change();

alter table public.student_leave_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Who may see and do what
-- ---------------------------------------------------------------------------

create policy "admins manage student leave" on public.student_leave_requests
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- A class teacher sees, and decides, the leave of the children in their own
-- section -- the same boundary the attendance register already draws. Not every
-- teacher: a leave note names an illness, and "who teaches this child" is a
-- wider circle than "who is responsible for them".
create policy "class teachers view their section's leave" on public.student_leave_requests
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and student_id in (
      select e.student_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() ) and e.status = 'active'
    )
  );

create policy "class teachers decide their section's leave" on public.student_leave_requests
  for update to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and student_id in (
      select e.student_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() ) and e.status = 'active'
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
  );

create policy "guardians view their children's leave" on public.student_leave_requests
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

create policy "students view their own leave" on public.student_leave_requests
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and student_id in (
      select up.student_id from public.user_profiles up
      where up.id = ( select auth.uid() ) and up.student_id is not null
    )
  );

-- A family may *ask*. Applying is an insert; deciding is not, and there is no
-- update policy here for a guardian or a student at all.
create policy "guardians apply for their children" on public.student_leave_requests
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and status = 'pending'
    and decided_at is null
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

-- ---------------------------------------------------------------------------
-- The columns a family may touch, and the ones they may not
-- ---------------------------------------------------------------------------
--
-- This is the `homework_submissions` case from CLAUDE.md rule 4, not the
-- `notification_deliveries` one: **two parties need different columns on the
-- same row.** A family sets the dates and the reason; a teacher sets the status
-- and the note. A role-wide `GRANT` narrowing the columns would break one to
-- protect the other, because every user of this application is `authenticated`.
--
-- So the narrower party -- the family -- has **no UPDATE policy at all**, and
-- reaches the row through `student_leave_cancel`, a definer function that sets
-- exactly one column after checking the caller is a guardian of that child.
-- The absence of the policy is the mechanism. A later migration that tidily
-- "adds the missing update policy" hands every parent the power to approve
-- their own child's leave, so the absence is commented here, where it would be
-- added.

comment on table public.student_leave_requests is
  'A family asks; a class teacher or an administrator decides. There is '
  'deliberately no UPDATE policy for guardians or students -- they cancel '
  'through student_leave_cancel, which sets one column. Adding a policy here '
  'would let a parent approve their own child''s leave.';
