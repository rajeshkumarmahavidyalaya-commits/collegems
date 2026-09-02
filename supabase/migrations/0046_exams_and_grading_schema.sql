-- Phase 3.1 -- exams, marks, and grading rules as data.
--
-- The single most common way a school ERP fails its second customer is
-- hardcoding the first customer's grading rules. "Best five of six", "grace up
-- to five marks in one subject", "theory and practical weighted 70/30",
-- "an additional subject can replace a failed compulsory one" -- every school
-- has a different combination, and every one of them is a `if`-statement
-- somebody wrote for one school in 2019.
--
-- So none of it is code. `grading_schemes.rules` is JSONB, and migration 0047's
-- engine evaluates it. Adding a school whose rules differ is a row, not a
-- release.
--
-- WHAT IS STORED AND WHAT IS COMPUTED
--
--   marks          raw facts. What the student scored. Nothing derived.
--   exam_results   the frozen answer, written once at publish.
--
-- Between those two, everything -- grace, best-of-N, optional-subject
-- substitution, aggregate, grade -- is computed on demand while the exam is a
-- draft. That is what lets a school fix a scheme and see the whole cohort
-- change. Publishing freezes it, because a report card handed to a parent must
-- not silently change when somebody edits a grade band two years later. Same
-- instinct as the fees ledger: derived while it is provisional, immutable once
-- it matters.
--
-- Grace marks are deliberately NOT a column on `marks`. Grace is a rule, not a
-- fact -- storing it per row would mean the same student's grace changes
-- meaning when the scheme changes, and two sources of truth for "why did this
-- 32 become a pass".

-- ---------------------------------------------------------------------------
-- Exam periods, as a foreign-key-able fact
-- ---------------------------------------------------------------------------

-- `time_slots` already separates the exam bell schedule from the lesson one by
-- `kind`. The routine used a generated `schedulable` column to make "a lesson
-- period" a foreign key; the datesheet needs the mirror image, so `kind` itself
-- becomes part of a unique key.
alter table public.time_slots
  add constraint time_slots_kind_key unique (tenant_id, id, kind);

-- ---------------------------------------------------------------------------
-- The rules
-- ---------------------------------------------------------------------------

create table public.grading_schemes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  -- The whole engine's input. Shape and evaluation order are documented in
  -- migration 0047 and in docs/modules/exams.md; validated by
  -- `grading_scheme_problems()` rather than by a check constraint, because a
  -- half-finished scheme should be savable and a broken one should be
  -- explainable in sentences.
  rules jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.grading_schemes
  add constraint grading_schemes_tenant_id_key unique (tenant_id, id);

create index grading_schemes_tenant_idx on public.grading_schemes (tenant_id);
-- At most one default per tenant. A partial unique index rather than a trigger
-- that clears the others, so "which scheme applies when nobody chose" has
-- exactly one answer at all times, including mid-transaction.
create unique index grading_schemes_one_default
  on public.grading_schemes (tenant_id) where is_default;

create trigger set_updated_at before update on public.grading_schemes
  for each row execute function public.set_updated_at();
create trigger audit_grading_schemes
  after insert or update or delete on public.grading_schemes
  for each row execute function public.audit_row_change();

alter table public.grading_schemes enable row level security;

create policy "tenant members view grading_schemes" on public.grading_schemes
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage grading_schemes" on public.grading_schemes
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
-- The exam
-- ---------------------------------------------------------------------------

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  name text not null,
  kind text not null default 'term'
    check (kind in ('unit', 'term', 'half_yearly', 'annual', 'practical', 'other')),
  starts_on date,
  ends_on date,
  grading_scheme_id uuid,
  -- `draft` means results are computed live and visible to staff only.
  -- `published` means they are frozen in `exam_results` and visible to the
  -- family. There is no third state: "locked" would be a status that means the
  -- same thing as published and invites a second, weaker kind of published.
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, session_id, name),
  constraint exams_range_chk check (ends_on is null or starts_on is null or ends_on >= starts_on),
  -- A published exam has a timestamp and a draft does not. Keeping these in
  -- step with a constraint means no code path can publish without recording
  -- when, which is the only thing that makes the freeze auditable.
  constraint exams_published_chk check (
    (status = 'published') = (published_at is not null)
  ),

  constraint exams_grading_scheme_fkey
    foreign key (tenant_id, grading_scheme_id)
    references public.grading_schemes (tenant_id, id) on delete restrict
);

alter table public.exams add constraint exams_tenant_id_key unique (tenant_id, id);

create index exams_tenant_idx on public.exams (tenant_id);
create index exams_session_idx on public.exams (tenant_id, session_id, starts_on desc);
create index exams_scheme_idx on public.exams (tenant_id, grading_scheme_id);

create trigger set_updated_at before update on public.exams
  for each row execute function public.set_updated_at();
create trigger audit_exams
  after insert or update or delete on public.exams
  for each row execute function public.audit_row_change();

alter table public.exams enable row level security;

create policy "tenant members view exams" on public.exams
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage exams" on public.exams
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
-- The papers
-- ---------------------------------------------------------------------------

-- One row per (exam, class, subject): the paper that class sits, with its own
-- maximum, its own pass mark, and its own weight in the aggregate.
create table public.exam_subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_id uuid not null,
  section_id uuid not null,
  subject_id uuid not null,
  max_marks numeric(6, 2) not null check (max_marks > 0),
  pass_marks numeric(6, 2) not null default 0 check (pass_marks >= 0),
  -- Weight in a weighted aggregate. A school that wants a straight mean leaves
  -- every weight at 1, which is the same arithmetic.
  weight numeric(6, 3) not null default 1 check (weight > 0),
  -- An additional subject, which a scheme may allow to replace a failed
  -- compulsory one. Never counted in the aggregate unless it is substituted in.
  is_optional boolean not null default false,
  exam_date date,
  time_slot_id uuid,
  -- Constant, so the composite key below can say "an exam period, not a lesson
  -- period" -- the mirror of the routine's `slot_schedulable`.
  slot_kind text not null default 'exam' check (slot_kind = 'exam'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, exam_id, section_id, subject_id),
  constraint exam_subjects_pass_chk check (pass_marks <= max_marks),

  constraint exam_subjects_exam_fkey
    foreign key (tenant_id, exam_id)
    references public.exams (tenant_id, id) on delete cascade,

  -- The same constraint the routine uses: the subject must actually be on this
  -- class's curriculum this year, and this one key carries tenant, session,
  -- section and subject together.
  constraint exam_subjects_assignment_fkey
    foreign key (tenant_id, session_id, section_id, subject_id)
    references public.section_subjects (tenant_id, session_id, section_id, subject_id)
    on delete cascade,

  constraint exam_subjects_slot_fkey
    foreign key (tenant_id, time_slot_id, slot_kind)
    references public.time_slots (tenant_id, id, kind) on delete set null (time_slot_id)
);

-- What `marks` points at. `max_marks` is in the key on purpose -- see the
-- comment on `marks.max_marks`.
alter table public.exam_subjects
  add constraint exam_subjects_max_marks_key unique (tenant_id, id, max_marks);

create index exam_subjects_tenant_idx on public.exam_subjects (tenant_id);
create index exam_subjects_exam_idx on public.exam_subjects (tenant_id, exam_id, section_id);
create index exam_subjects_session_idx on public.exam_subjects (session_id);
create index exam_subjects_subject_idx on public.exam_subjects (tenant_id, subject_id);

create trigger set_updated_at before update on public.exam_subjects
  for each row execute function public.set_updated_at();
create trigger audit_exam_subjects
  after insert or update or delete on public.exam_subjects
  for each row execute function public.audit_row_change();

alter table public.exam_subjects enable row level security;

create policy "tenant members view exam_subjects" on public.exam_subjects
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage exam_subjects" on public.exam_subjects
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
-- The marks
-- ---------------------------------------------------------------------------

create table public.marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_subject_id uuid not null,
  student_id uuid not null,
  -- Null means "not entered yet", which is a different thing from zero and from
  -- absent. A result sheet has to be able to say "three papers still to mark".
  marks_obtained numeric(6, 2) check (marks_obtained >= 0),
  is_absent boolean not null default false,
  remarks text,
  entered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, exam_subject_id, student_id),

  -- A CHECK cannot reach another table, and `max_marks` lives on
  -- `exam_subjects`. The routine solved the boolean version of this with a
  -- generated column; this is the same trick generalised to a *value*:
  -- denormalise `max_marks` onto the row, put it in the composite foreign key,
  -- and the CHECK below then has a local column it can compare against that
  -- Postgres guarantees equals the parent's.
  --
  -- `on update cascade` keeps it in step. It also means lowering a paper's
  -- maximum below a mark already awarded is refused -- the cascade rewrites the
  -- child, the CHECK re-evaluates, and it fails. That is the correct answer,
  -- not a side effect.
  max_marks numeric(6, 2) not null,
  constraint marks_within_max_chk
    check (marks_obtained is null or marks_obtained <= max_marks),
  -- An absent student has no mark. Allowing both would leave "absent, scored
  -- 40" representable, and something downstream would eventually average it in.
  constraint marks_absent_chk check (not (is_absent and marks_obtained is not null)),

  constraint marks_exam_subject_fkey
    foreign key (tenant_id, exam_subject_id, max_marks)
    references public.exam_subjects (tenant_id, id, max_marks)
    on update cascade on delete cascade,

  constraint marks_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create index marks_tenant_idx on public.marks (tenant_id);
create index marks_paper_idx on public.marks (tenant_id, exam_subject_id);
create index marks_student_idx on public.marks (tenant_id, student_id);
create index marks_session_idx on public.marks (session_id);

create trigger set_updated_at before update on public.marks
  for each row execute function public.set_updated_at();
create trigger audit_marks
  after insert or update or delete on public.marks
  for each row execute function public.audit_row_change();

alter table public.marks enable row level security;

create policy "admins manage marks" on public.marks
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- The finer-grained rule the academic structure was built to unlock. Attendance
-- still uses "class teacher sees their section", because taking a register is a
-- whole-class act. Marking a paper is not: the mathematics teacher marks
-- mathematics, and has no business editing the history marks of the same class.
create policy "subject teachers manage their marks" on public.marks
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exam_subject_id in (
      select es.id
      from public.exam_subjects es
      join public.section_subjects ss
        on ss.tenant_id = es.tenant_id
       and ss.session_id = es.session_id
       and ss.section_id = es.section_id
       and ss.subject_id = es.subject_id
      join public.user_profiles up on up.staff_id = ss.teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exam_subject_id in (
      select es.id
      from public.exam_subjects es
      join public.section_subjects ss
        on ss.tenant_id = es.tenant_id
       and ss.session_id = es.session_id
       and ss.section_id = es.section_id
       and ss.subject_id = es.subject_id
      join public.user_profiles up on up.staff_id = ss.teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  );

-- A class teacher reads the whole sheet without being able to write outside
-- their own subject: they have to sign the report card, so they must be able to
-- see whether it is finished.
create policy "class teachers view their section marks" on public.marks
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exam_subject_id in (
      select es.id
      from public.exam_subjects es
      join public.sections s on s.id = es.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  );

-- Families see marks only once the exam is published. Before that a half-marked
-- paper is not a result, and a parent refreshing a page watching a number
-- change is the sort of thing that ends in a phone call.
create policy "students view own published marks" on public.marks
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    and exam_subject_id in (
      select es.id from public.exam_subjects es
      join public.exams e on e.id = es.exam_id
      where e.status = 'published'
    )
  );

create policy "parents view own children published marks" on public.marks
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
    and exam_subject_id in (
      select es.id from public.exam_subjects es
      join public.exams e on e.id = es.exam_id
      where e.status = 'published'
    )
  );

-- ---------------------------------------------------------------------------
-- The frozen answer
-- ---------------------------------------------------------------------------

-- Written once, by `exams_publish`. Not a cache: the numbers here are what the
-- report card said, and they stay that way even if the scheme is edited or a
-- mark is corrected afterwards. Correcting a published result means
-- unpublishing, which is an explicit, audited act.
create table public.exam_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_id uuid not null,
  student_id uuid not null,
  total_marks numeric(8, 2) not null,
  max_marks numeric(8, 2) not null,
  percentage numeric(6, 3) not null,
  grade text,
  grade_point numeric(4, 2),
  result text not null check (result in ('pass', 'fail', 'incomplete')),
  subjects_counted integer not null default 0,
  subjects_failed integer not null default 0,
  -- The per-subject working, exactly as the engine produced it: which subject
  -- got grace, which was substituted, which was dropped by best-of-N. Without
  -- it, "why is this 61%" is unanswerable a year later.
  detail jsonb not null default '{}'::jsonb,
  -- The rules as they stood at publish. The scheme row can be edited; this
  -- cannot, so a reprint matches the original.
  rules_snapshot jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (tenant_id, exam_id, student_id),

  constraint exam_results_exam_fkey
    foreign key (tenant_id, exam_id)
    references public.exams (tenant_id, id) on delete cascade,
  constraint exam_results_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create index exam_results_tenant_idx on public.exam_results (tenant_id);
create index exam_results_exam_idx on public.exam_results (tenant_id, exam_id);
create index exam_results_student_idx on public.exam_results (tenant_id, student_id);
create index exam_results_session_idx on public.exam_results (session_id);

create trigger audit_exam_results
  after insert or update or delete on public.exam_results
  for each row execute function public.audit_row_change();

alter table public.exam_results enable row level security;

-- No INSERT, UPDATE or DELETE policy for anyone. `exams_publish` and
-- `exams_unpublish` are the only writers, and they are SECURITY DEFINER with
-- their own admin check -- the same shape as `notify_send`, and for the same
-- reason: a table whose whole value is being trustworthy should not be
-- hand-writable by the people it describes.
create policy "staff view exam_results" on public.exam_results
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'accountant')
  );

create policy "students view own exam_results" on public.exam_results
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children exam_results" on public.exam_results
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
