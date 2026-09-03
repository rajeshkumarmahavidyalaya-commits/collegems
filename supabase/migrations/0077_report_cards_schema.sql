-- ---------------------------------------------------------------------------
-- Phase 3.2 — the report card
--
-- Phase 3.1 answered "what did this student score". A report card answers three
-- more questions, and each needs something the exam schema does not yet hold:
--
--   "where did she come in the class?"  -> a rank, which is a fact about the
--                                          whole cohort, not about her row
--   "what does her teacher say?"        -> a remark, written by a person
--   "how often was she here?"           -> an attendance summary
--
-- The third is a read model over `attendance_records` and needs no schema. The
-- first two are here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Rank
-- ---------------------------------------------------------------------------

-- Rank is derived, so the instinct is to compute it on every read. That is
-- wrong for the same reason `exam_results` exists at all: a card handed to a
-- parent in March must still read "4th of 38" in December, even after a
-- transfer-out shrinks the cohort or a correction moves somebody past her.
--
-- So it is frozen with the rest of the result, in the same row, written by the
-- same function, under the same rules snapshot.
alter table public.exam_results
  add column rank_in_cohort integer,
  add column cohort_size integer;

-- Null means "this school does not rank", which is a real answer -- some
-- schools have abolished it deliberately and a card must not invent one. When
-- there is a rank, the pair has to be coherent: 4th of 38, never 40th of 38.
alter table public.exam_results
  add constraint exam_results_rank_chk check (
    (rank_in_cohort is null and cohort_size is null)
    or (
      rank_in_cohort is not null and cohort_size is not null
      and cohort_size > 0
      and rank_in_cohort between 1 and cohort_size
    )
  );

comment on column public.exam_results.rank_in_cohort is
  'Position within the cohort the rules name (section or class level), frozen at publish. Null when the scheme does not rank.';
comment on column public.exam_results.cohort_size is
  'How many students the rank was taken over, frozen alongside it, so "4th" keeps its denominator when the roll changes.';

create index exam_results_rank_idx
  on public.exam_results (tenant_id, exam_id, rank_in_cohort)
  where rank_in_cohort is not null;

-- ---------------------------------------------------------------------------
-- Remarks
-- ---------------------------------------------------------------------------

-- The class teacher's sentence at the foot of the card. It is the only part of
-- a report card written by a human, and it must freeze at publish exactly like
-- the marks -- a remark that can be edited after the card went home is a remark
-- the school cannot stand behind.
--
-- That freeze is the CLAUDE.md device (rule 4, "...and it works for a POLICY"):
-- carry the parent's status on the child inside a composite key, and put it in
-- the policy. Publishing is still one UPDATE on `exams`; the cascade rewrites
-- every remark, and from that instant the write policies match nothing.
-- Unpublishing cascades back to 'draft' and reopens them, which is the correct
-- and only way to fix a typo -- visible in `audit_log` as a pair.
alter table public.exams
  add constraint exams_status_key unique (tenant_id, id, status);

create table public.exam_remarks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_id uuid not null,
  student_id uuid not null,
  -- Held equal to `exams.status` by the foreign key below. Never written by
  -- hand: the default covers the insert, and the cascade covers every change
  -- after it.
  exam_status text not null default 'draft',
  remark text not null,
  authored_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, exam_id, student_id),

  -- A remark is a sentence, not an essay: a card has one line for it, and a
  -- 4,000-character remark is a bug report about the screen, not a comment.
  constraint exam_remarks_remark_chk
    check (length(btrim(remark)) between 1 and 500),

  constraint exam_remarks_exam_fkey
    foreign key (tenant_id, exam_id, exam_status)
    references public.exams (tenant_id, id, status)
    on update cascade on delete cascade,

  constraint exam_remarks_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

create index exam_remarks_tenant_idx on public.exam_remarks (tenant_id);
create index exam_remarks_exam_idx on public.exam_remarks (tenant_id, exam_id);
create index exam_remarks_student_idx on public.exam_remarks (tenant_id, student_id);
create index exam_remarks_session_idx on public.exam_remarks (session_id);
create index exam_remarks_author_idx on public.exam_remarks (authored_by);

create trigger set_updated_at before update on public.exam_remarks
  for each row execute function public.set_updated_at();

create trigger audit_exam_remarks
  after insert or update or delete on public.exam_remarks
  for each row execute function public.audit_row_change();

alter table public.exam_remarks enable row level security;

create policy "staff view exam_remarks" on public.exam_remarks
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher')
  );

-- The family sees a remark only once the exam is published -- which is the
-- whole point of carrying `exam_status` here rather than joining `exams`.
create policy "students view own published exam_remarks" on public.exam_remarks
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and exam_status = 'published'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children published exam_remarks" on public.exam_remarks
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and exam_status = 'published'
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

create policy "admins manage draft exam_remarks" on public.exam_remarks
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
    and exam_status = 'draft'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
    and exam_status = 'draft'
  );

-- A remark is the class teacher's, not any teacher's. Marks use the finer
-- "teacher of this subject in this section" rule because marks belong to a
-- paper; a remark belongs to the child, and the person who knows the child is
-- the one who takes their register every morning.
create policy "class teachers manage own section draft exam_remarks" on public.exam_remarks
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exam_status = 'draft'
    and student_id in (
      select e.student_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() )
        and e.session_id = exam_remarks.session_id
        and e.status = 'active'
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exam_status = 'draft'
    and student_id in (
      select e.student_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = ( select auth.uid() )
        and e.session_id = exam_remarks.session_id
        and e.status = 'active'
    )
  );

comment on table public.exam_remarks is
  'One class-teacher sentence per student per exam. Writable only while the exam is a draft -- enforced by exam_status inside the composite foreign key, not by a trigger.';
comment on column public.exam_remarks.exam_status is
  'A copy of exams.status, held in step by an ON UPDATE CASCADE composite foreign key. It exists so the write policies can ask "is this exam still a draft" without reaching into another table.';
