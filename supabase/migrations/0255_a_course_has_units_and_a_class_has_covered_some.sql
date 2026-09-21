-- 0255 — A course has units, and a class has covered some of them
--
-- Phase 3b's last self-contained gap. Measured: zero occurrences of a syllabus
-- anywhere. The word *curriculum* appears in this codebase and means
-- `section_subjects` — **which subjects a class studies** — and
-- `study_material` is files and links. Neither says what is *in* a subject, and
-- nothing anywhere records what has been taught.
--
-- So the question a college asks every term has no answer here:
--
-- > *The year is two-thirds gone. Is Grade 6 Science going to finish?*
--
-- ---------------------------------------------------------------------------
-- A syllabus is about a course; coverage is about a class
--
-- This is the whole shape of the module, and getting it backwards would be the
-- expensive mistake:
--
--     syllabus_units      (session, class_level, subject)   48 courses here
--     syllabus_progress   (section, unit)                   12 sections
--
-- Grade 6 Science has **one** syllabus however many sections study it — the
-- college teaches one course — and each section covers it at its own pace. It
-- is `fee_structures` keyed on `class_level` beside `enrolments` keyed on
-- `section`, which is the same distinction about money.
--
-- Writing the syllabus per *section* instead would mean twelve copies of one
-- document, free to disagree, and a head of department who edits one of them.
--
-- ---------------------------------------------------------------------------
-- Rule 4's device, used to make the two agree about the class
--
-- A progress row names a **section** and a **unit**, and they have to be about
-- the same class level — Grade 6 A cannot cover a unit of the Grade 2 syllabus.
-- That is a fact on two different parent tables, so no CHECK can reach it.
--
-- `class_level_id` is carried on the progress row and held against both:
--
--     foreign key (tenant_id, unit_id, class_level_id, subject_id)
--       references syllabus_units (tenant_id, id, class_level_id, subject_id)
--     foreign key (tenant_id, section_id, class_level_id)
--       references sections (tenant_id, id, class_level_id)
--
-- Two keys, and the agreement is a constraint rather than a check in every
-- writer. The unit side cascades, because moving a unit between class levels is
-- a correction to a plan; the section side does not, because a section's class
-- level changing while somebody has recorded teaching against it should be
-- **refused**, not quietly rewritten.
--
-- `subject_id` rides along in the same key — rule 4's *one key can carry two of
-- those at once*, as `marks.component_max_marks` carries an identity and a
-- value together. It is not decoration: **the write policy needs it.** A class
-- teacher of Grade 6 A who teaches English must not be able to declare Science
-- covered, and without the subject on the row a policy would have to reach into
-- `syllabus_units` to find out which subject it was looking at.
--
-- ---------------------------------------------------------------------------
-- Absence is "not covered", so there is no row for it
--
-- `syllabus_progress` holds a row only for a unit somebody has started or
-- finished. Pre-creating one per unit per section would be 48 courses × 12
-- sections × however many units of rows that all say *nothing has happened*,
-- and the first thing every reader would do is filter them out.
--
-- The cost is that a reader must count against `syllabus_units` rather than
-- against the progress table, which is exactly what the pace report does.

alter table public.sections
  add constraint sections_class_level_key unique (tenant_id, id, class_level_id);

comment on constraint sections_class_level_key on public.sections is
  'The key syllabus_progress.class_level_id is held against, so a section and '
  'the unit it has covered cannot disagree about which class this is.';

-- ---------------------------------------------------------------------------
-- The syllabus
-- ---------------------------------------------------------------------------

create table public.syllabus_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Rule 2, and here it is not merely convention: a syllabus is rewritten
  -- between years, and last year's is the record of what last year's children
  -- were taught.
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  class_level_id uuid not null references public.class_levels(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,

  -- Where it comes in the course. Not a sequence number anybody computes from:
  -- a syllabus is reordered, and `position` is what the reorder writes.
  position integer not null check (position >= 1),

  title text not null check (length(trim(title)) > 0),
  description text,

  -- How many lessons this unit is expected to take. The pace report weights by
  -- it, which is the difference between "8 of 20 units" and "8 of 20 units
  -- that happen to be the short ones". Defaults to 1, so a college that does
  -- not estimate gets a plain unit count rather than an error.
  planned_periods integer not null default 1 check (planned_periods >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The key a progress row's carried columns are held against. Four columns,
  -- because the row has to agree with its unit about the class *and* the
  -- subject, and one constraint says both.
  constraint syllabus_units_course_key unique (tenant_id, id, class_level_id, subject_id),

  -- One unit per position in a course. DEFERRABLE for the reason 0251 made
  -- `exam_seat_allocations_one_per_seat` deferrable: reordering swaps two
  -- values, a unique index is maintained as each row is written, and the first
  -- row collides with the second's old value. `initially immediate` means
  -- every ordinary write is checked exactly as before.
  constraint syllabus_units_one_per_position
    unique (tenant_id, session_id, class_level_id, subject_id, position)
    deferrable initially immediate
);

create index syllabus_units_course_idx
  on public.syllabus_units (tenant_id, session_id, class_level_id, subject_id, position);
create index syllabus_units_subject_idx
  on public.syllabus_units (tenant_id, subject_id);

create trigger set_updated_at before update on public.syllabus_units
  for each row execute function public.set_updated_at();
create trigger audit_syllabus_units
  after insert or update or delete on public.syllabus_units
  for each row execute function public.audit_row_change();

alter table public.syllabus_units enable row level security;

comment on table public.syllabus_units is
  'What is in a course: one ordered list per (session, class level, subject). '
  'One list however many sections study it — the college teaches one course, '
  'and each section covers it at its own pace in syllabus_progress.';

-- Who may read a syllabus, and the sentence that decides it:
--
--   **A syllabus is the college's course catalogue, not anybody's data.**
--
-- So staff read all of it on `academics.view` — and that is safe here for the
-- reason `0253` was not: the matrix says `academics.view` is held by the
-- administrator and the teacher and by **neither a parent nor a student**. A
-- tenant-wide policy is only as narrow as its permission, and this one was
-- checked against the matrix rather than against its own name.
create policy "staff view syllabus_units" on public.syllabus_units
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('academics.view') )
  );

-- A family reads **their own child's course**, which is a different question
-- and gets a different policy: row-scoped through the enrolment, never a
-- permission. What a child will be taught this year is exactly the thing a
-- guardian asks for in April, and this product has repeatedly turned out to
-- have no family-facing screen for something it already held.
create policy "students view own syllabus_units" on public.syllabus_units
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and exists (
      select 1 from public.enrolments en
      join public.sections sec on sec.id = en.section_id
      where en.student_id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
        and en.status = 'active'
        and en.session_id = syllabus_units.session_id
        and sec.class_level_id = syllabus_units.class_level_id
    )
  );

create policy "parents view own children syllabus_units" on public.syllabus_units
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and exists (
      select 1 from public.guardian_student gs
      join public.enrolments en on en.student_id = gs.student_id and en.status = 'active'
      join public.sections sec on sec.id = en.section_id
      where gs.guardian_id = (select up.guardian_id from public.user_profiles up where up.id = auth.uid())
        and en.session_id = syllabus_units.session_id
        and sec.class_level_id = syllabus_units.class_level_id
    )
  );

-- Writing the syllabus is course setup, like creating a class or assigning a
-- subject to one, so it is `academics.manage` and needs no new code. The
-- *teacher's* act — recording what was taught — is a different act by a
-- different person, and that is the one below that does.
create policy "academics office writes syllabus_units" on public.syllabus_units
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('academics.manage') )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('academics.manage') )
  );

-- ---------------------------------------------------------------------------
-- Does this member of staff teach that class?
-- ---------------------------------------------------------------------------

create or replace function public.staff_teaches(p_section_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, extensions
as $$
  -- The class teacher of a section, or anybody the routine puts in front of
  -- that section for that subject. SECURITY INVOKER on purpose: it reads
  -- `sections` and `timetable_entries`, both of which the caller can already
  -- read, so it narrows to the caller's own view rather than widening past it.
  select exists (
    select 1 from public.sections s
    where s.id = p_section_id
      and s.class_teacher_staff_id =
          (select up.staff_id from public.user_profiles up where up.id = auth.uid())
  ) or exists (
    select 1 from public.timetable_entries te
    where te.section_id = p_section_id
      and te.subject_id = p_subject_id
      and te.teacher_staff_id =
          (select up.staff_id from public.user_profiles up where up.id = auth.uid())
  )
$$;

revoke all on function public.staff_teaches(uuid, uuid) from public, anon;
grant execute on function public.staff_teaches(uuid, uuid) to authenticated;

comment on function public.staff_teaches(uuid, uuid) is
  'Whether the calling login is the class teacher of a section, or is '
  'timetabled to teach that subject to it. Used in the syllabus_progress write '
  'policy so a class teacher who teaches English cannot declare Science '
  'covered — which is the reason syllabus_progress carries subject_id at all.';

-- ---------------------------------------------------------------------------
-- What a class has covered
-- ---------------------------------------------------------------------------

create table public.syllabus_progress (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  section_id uuid not null,
  unit_id uuid not null,

  -- Carried, and held against both parents. See the header.
  class_level_id uuid not null,
  subject_id uuid not null,

  -- There is no 'pending'. A unit nobody has touched has no row, because
  -- 48 courses x 12 sections of rows saying *nothing has happened* is a table
  -- every reader starts by filtering out.
  status text not null check (status in ('in_progress', 'covered')),

  -- The day it was finished. Null while it is in progress, and required once
  -- it is not: a unit marked covered on no particular day cannot be compared
  -- with the calendar, which is the only thing the pace report does.
  covered_on date,

  -- Who said so. Not `created_by`, which is a login: this is the member of
  -- staff, and a login can be deleted while the fact stays true.
  recorded_by_staff_id uuid references public.staff(id) on delete set null,
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint syllabus_progress_one_per_unit unique (tenant_id, section_id, unit_id),

  constraint syllabus_progress_unit_fkey
    foreign key (tenant_id, unit_id, class_level_id, subject_id)
    references public.syllabus_units (tenant_id, id, class_level_id, subject_id)
    on update cascade on delete cascade,

  -- No cascade. A section's class level changing while somebody has recorded
  -- teaching against it is a mistake to refuse, not a rewrite to perform.
  constraint syllabus_progress_section_fkey
    foreign key (tenant_id, section_id, class_level_id)
    references public.sections (tenant_id, id, class_level_id),

  constraint syllabus_progress_covered_chk
    check ((status = 'covered') = (covered_on is not null))
);

create index syllabus_progress_section_idx
  on public.syllabus_progress (tenant_id, section_id, unit_id);
create index syllabus_progress_unit_idx
  on public.syllabus_progress (tenant_id, unit_id);
create index syllabus_progress_session_idx
  on public.syllabus_progress (tenant_id, session_id, covered_on desc);

create trigger set_updated_at before update on public.syllabus_progress
  for each row execute function public.set_updated_at();
create trigger audit_syllabus_progress
  after insert or update or delete on public.syllabus_progress
  for each row execute function public.audit_row_change();

alter table public.syllabus_progress enable row level security;

-- Staff read all of it, on the same permission and for the same reason as the
-- syllabus itself — neither a parent nor a student holds `academics.view`.
--
-- Whether one teacher should see another's pace is a real thing a college can
-- disagree about, and the answer is the matrix rather than a second policy: a
-- college that does not want it withholds `academics.view` from the teacher
-- role. **Families are deliberately not given this at all** — the syllabus is
-- what their child will be taught, and how far behind a class has fallen is a
-- conversation between a college and its staff.
create policy "staff view syllabus_progress" on public.syllabus_progress
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('academics.view') )
  );

create policy "teachers record their own coverage" on public.syllabus_progress
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('syllabus.track') )
    and (
      ( select public.role_has_permission('academics.manage') )
      or public.staff_teaches(section_id, subject_id)
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('syllabus.track') )
    and (
      ( select public.role_has_permission('academics.manage') )
      or public.staff_teaches(section_id, subject_id)
    )
  );

comment on table public.syllabus_progress is
  'One row per unit a section has started or finished. A unit nobody has '
  'touched has no row: absence is "not covered", which is why every reader '
  'counts against syllabus_units rather than against this table.';
comment on column public.syllabus_progress.subject_id is
  'Held equal to the unit''s by syllabus_progress_unit_fkey. It is on the row '
  'because the write policy compares it: a class teacher who teaches English '
  'must not be able to mark a Science unit covered.';

revoke truncate, trigger, references, maintain
  on public.syllabus_units, public.syllabus_progress
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The one new permission
-- ---------------------------------------------------------------------------
--
-- Writing the syllabus and recording what was taught are two acts by two
-- people, and a college has to be able to allow the second without the first —
-- `academics.manage` also creates classes, assigns subjects and rolls sections
-- forward, and handing a teacher all of that to let them tick off a unit is
-- `0213`'s finding repeated.
--
-- Granted by reading the matrix rather than by naming a role (`0213`'s rule):
-- whoever holds `homework.manage` today, which is the closest existing act —
-- a teacher doing something to their own class — and is the administrator and
-- the teacher here.
insert into reference.permissions (code, module, ability, description)
values ('syllabus.track', 'academics', 'track',
        'Record which syllabus units a class has covered');

insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, 'syllabus.track', true
from public.role_permissions rp
where rp.permission_code = 'homework.manage' and rp.allowed
on conflict do nothing;
