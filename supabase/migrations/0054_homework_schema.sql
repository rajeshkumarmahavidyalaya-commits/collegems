-- Phase 4.3 -- homework, submissions, and study material.
--
-- The first module whose value is mostly *files*, which is why migration 0053
-- had to come first. Nothing here stores a URL: every row carries an object
-- path, and every read goes through a signed URL issued after a permission
-- check in a server action. Rule 8, finally exercised.
--
-- WHY SUBMISSIONS ARE A TABLE AND NOT A FILE LIST
--
-- A submission exists before any file does. "Ravi has not handed it in" is a
-- fact the class teacher needs on Tuesday morning, and it cannot be represented
-- by the absence of a row -- absence is indistinguishable from a student who
-- was never set the work. So a submission row is created when the homework is
-- published, `status = 'pending'`, and files attach to it later.

-- ---------------------------------------------------------------------------
-- The assignment
-- ---------------------------------------------------------------------------

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  section_id uuid not null,
  subject_id uuid not null,
  title text not null,
  instructions text,
  assigned_on date not null default current_date,
  due_on date not null,
  -- Null means "not marked out of anything", which is most homework. A number
  -- turns the submission list into a marking screen.
  max_marks numeric(6, 2) check (max_marks is null or max_marks > 0),
  -- Some homework is "finish exercise 4 in your book". Pretending every
  -- assignment wants an upload produces a wall of permanently-pending
  -- submissions and teaches everyone to ignore the screen.
  collects_submissions boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  assigned_by_staff_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint homework_dates_chk check (due_on >= assigned_on),
  constraint homework_published_chk check (
    (status = 'published') = (published_at is not null)
  ),

  -- The same constraint the routine and the exam papers use: a subject can only
  -- be set to a class that has it on the curriculum, and this one key carries
  -- tenant, session, section and subject together.
  constraint homework_assignment_fkey
    foreign key (tenant_id, session_id, section_id, subject_id)
    references public.section_subjects (tenant_id, session_id, section_id, subject_id)
    on delete cascade,
  constraint homework_staff_fkey
    foreign key (tenant_id, assigned_by_staff_id)
    references public.staff (tenant_id, id) on delete set null (assigned_by_staff_id)
);

-- What `homework_files` and `homework_submissions` point at. `max_marks` is in
-- the key for the same reason it is on `marks`: it lets a CHECK on the child
-- compare against a value Postgres guarantees equals the parent's.
alter table public.homework add constraint homework_tenant_id_key unique (tenant_id, id);
alter table public.homework
  add constraint homework_max_marks_key unique (tenant_id, id, max_marks);

create index homework_tenant_idx on public.homework (tenant_id);
create index homework_section_idx
  on public.homework (tenant_id, session_id, section_id, due_on desc);
create index homework_subject_idx on public.homework (tenant_id, subject_id);
create index homework_session_idx on public.homework (session_id);

create trigger set_updated_at before update on public.homework
  for each row execute function public.set_updated_at();
create trigger audit_homework
  after insert or update or delete on public.homework
  for each row execute function public.audit_row_change();

alter table public.homework enable row level security;

create policy "admins manage homework" on public.homework
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- The subject teacher sets the homework, the same rule that decides who may
-- mark the paper. A teacher who could set homework for a class they do not
-- teach could also fill that class's evening.
create policy "subject teachers manage their homework" on public.homework
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exists (
      select 1 from public.section_subjects ss
      join public.user_profiles up on up.staff_id = ss.teacher_staff_id
      where ss.tenant_id = homework.tenant_id
        and ss.session_id = homework.session_id
        and ss.section_id = homework.section_id
        and ss.subject_id = homework.subject_id
        and up.id = ( select auth.uid() )
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exists (
      select 1 from public.section_subjects ss
      join public.user_profiles up on up.staff_id = ss.teacher_staff_id
      where ss.tenant_id = homework.tenant_id
        and ss.session_id = homework.session_id
        and ss.section_id = homework.section_id
        and ss.subject_id = homework.subject_id
        and up.id = ( select auth.uid() )
    )
  );

-- The class teacher reads everything set to their class without being able to
-- change it: they are the person a parent rings about "too much homework".
create policy "class teachers view their section homework" on public.homework
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and exists (
      select 1 from public.sections s
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where s.id = homework.section_id and up.id = ( select auth.uid() )
    )
  );

-- Families see published homework for their own class only. A draft is a
-- teacher still writing the question.
create policy "students view own published homework" on public.homework
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and status = 'published'
    and section_id in (
      select e.section_id from public.enrolments e
      where e.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
        and e.status = 'active'
    )
  );

create policy "parents view own children published homework" on public.homework
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'parent'
    and status = 'published'
    and section_id in (
      select e.section_id
      from public.enrolments e
      join public.guardian_student gs on gs.student_id = e.student_id
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() ) and e.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- Handing it in
-- ---------------------------------------------------------------------------

create table public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  homework_id uuid not null,
  student_id uuid not null,
  -- `pending` is created with the homework, so "not handed in" is a row rather
  -- than the absence of one.
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'graded', 'returned')),
  submitted_at timestamptz,
  note text,
  marks_obtained numeric(6, 2) check (marks_obtained >= 0),
  -- Denormalised from the parent and held equal to it by the composite key
  -- below, so the CHECK has a local column to compare against. Same trick as
  -- `marks.max_marks`; `on update cascade` also refuses to lower a homework's
  -- maximum below a mark already awarded.
  max_marks numeric(6, 2),
  feedback text,
  graded_by uuid references auth.users(id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, homework_id, student_id),

  constraint homework_submissions_marks_chk check (
    marks_obtained is null
    or (max_marks is not null and marks_obtained <= max_marks)
  ),
  -- A submitted piece of work has a time on it, and a pending one does not.
  -- Keeping the two in step means no code path can mark something handed in
  -- without recording when.
  constraint homework_submissions_submitted_chk check (
    (status = 'pending') = (submitted_at is null)
  ),
  constraint homework_submissions_graded_chk check (
    (status in ('graded', 'returned')) = (graded_at is not null)
  ),

  constraint homework_submissions_homework_fkey
    foreign key (tenant_id, homework_id, max_marks)
    references public.homework (tenant_id, id, max_marks)
    on update cascade on delete cascade,
  constraint homework_submissions_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);

alter table public.homework_submissions
  add constraint homework_submissions_tenant_id_key unique (tenant_id, id);

create index homework_submissions_tenant_idx on public.homework_submissions (tenant_id);
create index homework_submissions_homework_idx
  on public.homework_submissions (tenant_id, homework_id, status);
create index homework_submissions_student_idx
  on public.homework_submissions (tenant_id, student_id, status);
create index homework_submissions_session_idx on public.homework_submissions (session_id);

create trigger set_updated_at before update on public.homework_submissions
  for each row execute function public.set_updated_at();
create trigger audit_homework_submissions
  after insert or update or delete on public.homework_submissions
  for each row execute function public.audit_row_change();

alter table public.homework_submissions enable row level security;

create policy "admins manage homework_submissions" on public.homework_submissions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "subject teachers manage submissions to their homework" on public.homework_submissions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and homework_id in (
      select h.id
      from public.homework h
      join public.section_subjects ss
        on ss.tenant_id = h.tenant_id
       and ss.session_id = h.session_id
       and ss.section_id = h.section_id
       and ss.subject_id = h.subject_id
      join public.user_profiles up on up.staff_id = ss.teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'teacher'
    and homework_id in (
      select h.id
      from public.homework h
      join public.section_subjects ss
        on ss.tenant_id = h.tenant_id
       and ss.session_id = h.session_id
       and ss.section_id = h.section_id
       and ss.subject_id = h.subject_id
      join public.user_profiles up on up.staff_id = ss.teacher_staff_id
      where up.id = ( select auth.uid() )
    )
  );

-- NO student UPDATE policy, deliberately -- and this is the interesting bit.
--
-- The obvious design gives students an update policy on their own row and then
-- narrows the columns with a grant, exactly as migration 0039 did for
-- `notification_deliveries`. **That does not work here.** A column grant is
-- role-wide, and every user of this application is `authenticated`, so
-- `grant update (status, submitted_at, note)` would take `marks_obtained` and
-- `feedback` away from the teachers as well. The two cases look identical and
-- are not: there, nobody except recipients had UPDATE at all.
--
-- So students do not touch this table. `homework_submit` and
-- `homework_unsubmit` (migration 0055) are narrow SECURITY DEFINER functions
-- that set exactly three columns after checking the caller owns the row -- the
-- same shape as `notify_send`, for the same reason: when a table must be
-- writable by two roles with different column rights, the narrow way in beats
-- a policy that cannot express the difference.
create policy "students view own submissions" on public.homework_submissions
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'student'
    and student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
  );

create policy "parents view own children submissions" on public.homework_submissions
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

-- ---------------------------------------------------------------------------
-- The files
-- ---------------------------------------------------------------------------

-- One table, two parents, exactly one set -- the same shape as `members`
-- (a student *or* a staff member). A polymorphic `owner_type`/`owner_id` pair
-- would lose the foreign keys, and the foreign keys are what stop a file
-- outliving the thing it belongs to.
create table public.homework_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  homework_id uuid,
  submission_id uuid,
  -- The object path, never a URL. `{tenant_id}/{owner_id}/{uuid}-{name}`.
  storage_path text not null,
  bucket_id text not null check (bucket_id in ('study-material', 'homework-submissions')),
  file_name text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint homework_files_owner_chk check (
    (homework_id is null) <> (submission_id is null)
  ),
  -- One row per object. A duplicate would make deletion ambiguous and leave an
  -- orphan in the bucket.
  unique (bucket_id, storage_path),

  constraint homework_files_homework_fkey
    foreign key (tenant_id, homework_id)
    references public.homework (tenant_id, id) on delete cascade,
  constraint homework_files_submission_fkey
    foreign key (tenant_id, submission_id)
    references public.homework_submissions (tenant_id, id) on delete cascade
);

create index homework_files_tenant_idx on public.homework_files (tenant_id);
create index homework_files_homework_idx
  on public.homework_files (tenant_id, homework_id) where homework_id is not null;
create index homework_files_submission_idx
  on public.homework_files (tenant_id, submission_id) where submission_id is not null;

create trigger audit_homework_files
  after insert or update or delete on public.homework_files
  for each row execute function public.audit_row_change();

alter table public.homework_files enable row level security;

-- A file is readable by whoever can read the thing it hangs off. Expressed as
-- an EXISTS against the parent so there is one place the rule lives: adding a
-- reader to `homework` adds them here automatically.
create policy "readers of the parent read its files" on public.homework_files
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and (
      (homework_id is not null and exists (
        select 1 from public.homework h where h.id = homework_files.homework_id
      ))
      or (submission_id is not null and exists (
        select 1 from public.homework_submissions s where s.id = homework_files.submission_id
      ))
    )
  );

create policy "writers of the parent write its files" on public.homework_files
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and (
      ( select public.current_role_code() ) in ('admin', 'teacher')
      or (
        submission_id is not null
        and exists (
          select 1 from public.homework_submissions s
          where s.id = homework_files.submission_id
            and s.status in ('pending', 'submitted')
            and s.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
        )
      )
    )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and (
      ( select public.current_role_code() ) in ('admin', 'teacher')
      or (
        submission_id is not null
        and exists (
          select 1 from public.homework_submissions s
          where s.id = homework_files.submission_id
            and s.status in ('pending', 'submitted')
            and s.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Study material
-- ---------------------------------------------------------------------------

-- Deliberately flatter than homework: one item is one thing -- a PDF, or a
-- link to a video. Several files means several items, which is also how a
-- person thinks about a reading list.
create table public.study_material (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  -- Both nullable, and both meaningful: no section is "the whole school", no
  -- subject is "general". A revision timetable belongs to neither.
  section_id uuid,
  subject_id uuid,
  title text not null,
  description text,
  kind text not null default 'document' check (kind in ('document', 'video', 'link')),
  storage_path text,
  bucket_id text check (bucket_id is null or bucket_id = 'study-material'),
  file_name text,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  external_url text,
  is_published boolean not null default false,
  uploaded_by_staff_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A file or a link, never both and never neither. An item that is neither is
  -- a title with nothing behind it, which is worse than no item.
  constraint study_material_source_chk check (
    (storage_path is null) <> (external_url is null)
  ),
  constraint study_material_bucket_chk check (
    (storage_path is null) = (bucket_id is null)
  ),

  constraint study_material_section_fkey
    foreign key (tenant_id, section_id)
    references public.sections (tenant_id, id) on delete cascade,
  constraint study_material_subject_fkey
    foreign key (tenant_id, subject_id)
    references public.subjects (tenant_id, id) on delete restrict,
  constraint study_material_staff_fkey
    foreign key (tenant_id, uploaded_by_staff_id)
    references public.staff (tenant_id, id) on delete set null (uploaded_by_staff_id)
);

create index study_material_tenant_idx on public.study_material (tenant_id);
create index study_material_section_idx
  on public.study_material (tenant_id, session_id, section_id);
create index study_material_subject_idx on public.study_material (tenant_id, subject_id);
create index study_material_session_idx on public.study_material (session_id);

create trigger set_updated_at before update on public.study_material
  for each row execute function public.set_updated_at();
create trigger audit_study_material
  after insert or update or delete on public.study_material
  for each row execute function public.audit_row_change();

alter table public.study_material enable row level security;

create policy "staff manage study_material" on public.study_material
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher')
  );

-- Published material is readable by the class it is for, or by everybody when
-- it names no class. Unpublished is the teacher's draft shelf.
create policy "families view published study_material" on public.study_material
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and is_published
    and (
      section_id is null
      or section_id in (
        select e.section_id from public.enrolments e
        where e.status = 'active'
          and (
            e.student_id = ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
            or e.student_id in (
              select gs.student_id
              from public.guardian_student gs
              join public.user_profiles up on up.guardian_id = gs.guardian_id
              where up.id = ( select auth.uid() )
            )
          )
      )
    )
  );
