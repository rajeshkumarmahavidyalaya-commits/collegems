-- ---------------------------------------------------------------------------
-- Exam components -- a paper that is marked in more than one sitting
-- ---------------------------------------------------------------------------
--
-- Migration 0046's own header named "theory and practical weighted 70/30" as an
-- example of the sort of rule a school ERP must not hardcode, and then did not
-- build it: a paper had one maximum and one mark. Every real board splits at
-- least some papers -- CBSE class 10 science is theory 80 + internal 20,
-- a language is written + oral, a vocational subject is written + practical +
-- project -- and a school with those papers cannot use a system that stores one
-- number per subject.
--
-- WHERE THE SPLIT LIVES
--
-- A component is a child of the *paper*, not of the subject and not of the
-- exam. Class 9 A may sit a science paper split 70/30 while class 9 B sits the
-- same subject unsplit in a unit test; `exam_subjects` is already keyed on
-- (exam, section, subject), so that is the only place the split can be true.
--
-- WHERE THE MARK LIVES
--
-- In `marks`, on the same row shape as before, with a nullable
-- `exam_component_id`. The alternative -- a second `component_marks` table --
-- would duplicate six RLS policies whose whole content is "the mathematics
-- teacher marks mathematics", and would put the paper's total in two places at
-- once. It is not stored anywhere: **a paper's total is a sum, never a column**,
-- which is rule 6's lesson from `book_issues.fine_paid` applied to marks.
--
-- So a paper is in one of two states:
--
--   no components -> exactly one mark row per student, component null
--   components    -> one mark row per student per component, component not null
--
-- and the engine reads whichever matches the paper's own structure. A row of
-- the other kind, left behind by a paper that was split after being marked, is
-- ignored rather than added in -- and `exams_problems()` says so in a sentence,
-- per rule 12's "criticise the document in Postgres, not in the browser".

-- ---------------------------------------------------------------------------
-- The paper's session, as a foreign-key-able fact
-- ---------------------------------------------------------------------------

-- A component carries `session_id` directly, per rule 2. Rather than trusting
-- the writer to copy the paper's, put it in the key: one composite foreign key
-- then enforces "same tenant, same session, real paper" together.
alter table public.exam_subjects
  add constraint exam_subjects_session_id_key unique (tenant_id, session_id, id);

-- ---------------------------------------------------------------------------
-- The components
-- ---------------------------------------------------------------------------

create table public.exam_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_subject_id uuid not null,
  -- Short, and what appears as a column heading on the marks grid: TH, PR, IA.
  code text not null check (btrim(code) <> '' and length(code) <= 8),
  name text not null check (btrim(name) <> ''),
  -- The component's own maximum. These must add up to the paper's maximum --
  -- a rule about several rows, so it is checked in `exams_set_components`
  -- under a lock, with the numbers in the message, per the "no constraint sees
  -- a second row" rule. `exams_problems()` re-states it for a paper edited
  -- around the function.
  max_marks numeric(6, 2) not null check (max_marks > 0),
  -- A component minimum -- "you must get 25 of 70 in the theory paper however
  -- well you did in the practical". Zero, the default, means the component has
  -- no minimum of its own and only the paper's pass mark applies. Whether a
  -- shortfall here fails the paper is a *scheme* decision, not a schema one:
  -- see `components.must_pass_each` in migration 0110.
  pass_marks numeric(6, 2) not null default 0 check (pass_marks >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, exam_subject_id, code),
  constraint exam_components_pass_chk check (pass_marks <= max_marks),

  constraint exam_components_paper_fkey
    foreign key (tenant_id, session_id, exam_subject_id)
    references public.exam_subjects (tenant_id, session_id, id) on delete cascade
);

-- What a mark points at. Both `exam_subject_id` and `max_marks` are in the key
-- on purpose, and one foreign key from `marks` then carries two facts at once:
-- the component belongs to the paper the mark is against (the *identity* use of
-- the device, as on `transport_assignments.route_id`), and the local
-- `component_max_marks` equals the component's own maximum (the *value* use, as
-- on `marks.max_marks`).
alter table public.exam_components
  add constraint exam_components_paper_max_key
  unique (tenant_id, exam_subject_id, id, max_marks);

create index exam_components_tenant_idx on public.exam_components (tenant_id);
create index exam_components_paper_idx
  on public.exam_components (tenant_id, exam_subject_id, position, code);
create index exam_components_session_idx on public.exam_components (session_id);

create trigger set_updated_at before update on public.exam_components
  for each row execute function public.set_updated_at();
create trigger audit_exam_components
  after insert or update or delete on public.exam_components
  for each row execute function public.audit_row_change();

alter table public.exam_components enable row level security;

-- Everybody who can see a paper can see its parts: a student's own report card
-- prints them, and a class teacher checking a sheet needs to know what the
-- columns are. Writing them is an administrator's act, exactly as adding the
-- paper is -- a subject teacher marks the paper they were given, they do not
-- decide it is worth 70 instead of 100.
create policy "tenant members view exam_components" on public.exam_components
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage exam_components" on public.exam_components
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
-- A mark can now be against a component
-- ---------------------------------------------------------------------------

alter table public.marks
  add column exam_component_id uuid,
  add column component_max_marks numeric(6, 2);

-- Postgres skips a MATCH SIMPLE foreign key entirely when any of its columns is
-- null, which is what lets the same column pair mean "no component" -- but only
-- if the two travel together. Without this, a row could carry a maximum with no
-- component to have come from, and the ceiling below would be silently wrong.
alter table public.marks
  add constraint marks_component_pair_chk
  check ((exam_component_id is null) = (component_max_marks is null));

alter table public.marks
  add constraint marks_component_fkey
  foreign key (tenant_id, exam_subject_id, exam_component_id, component_max_marks)
  references public.exam_components (tenant_id, exam_subject_id, id, max_marks)
  on update cascade on delete cascade;

-- The ceiling is the component's where there is one. `on update cascade` above
-- means lowering a component's maximum below a mark already awarded is refused
-- -- the cascade rewrites the child and this check re-evaluates -- which is the
-- same refusal `marks.max_marks` already gives for a whole paper.
alter table public.marks drop constraint marks_within_max_chk;
alter table public.marks
  add constraint marks_within_max_chk
  check (marks_obtained is null or marks_obtained <= coalesce(component_max_marks, max_marks));

-- One mark per student per paper becomes one per student per paper *per
-- component*, with the old rule kept for the unsplit case as a partial index on
-- the same columns. Two partial indexes rather than one over
-- coalesce(exam_component_id, id): `on conflict` needs an index it can name.
alter table public.marks drop constraint marks_tenant_id_exam_subject_id_student_id_key;

create unique index marks_one_per_paper
  on public.marks (tenant_id, exam_subject_id, student_id)
  where exam_component_id is null;

create unique index marks_one_per_component
  on public.marks (tenant_id, exam_subject_id, student_id, exam_component_id)
  where exam_component_id is not null;

create index marks_component_idx
  on public.marks (tenant_id, exam_component_id) where exam_component_id is not null;

comment on column public.marks.exam_component_id is
  'Null for a paper marked as a whole; set for one part of a split paper. The paper''s total is the sum of its component rows and is never stored.';
