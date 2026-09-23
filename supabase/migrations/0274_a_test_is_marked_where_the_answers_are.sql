-- ---------------------------------------------------------------------------
-- A test is marked where the answers are
-- ---------------------------------------------------------------------------
--
-- Online tests: multiple-choice questions set by a subject teacher for one
-- class, taken in the browser against a clock, and marked by Postgres the
-- moment they are submitted. Measured first: zero quiz, question or attempt
-- tables, and "online exam" the last Phase 3b gap.
--
-- The whole design follows from one fact: **the answer key is on the same row
-- as the question, and RLS cannot restrict columns** (rule 4). A policy that let
-- a student read a question would hand them `correct_option` with it. So:
--
-- 1. **`online_test_questions` has no student or family policy at all.** The
--    absence is the mechanism -- a later migration that tidily "adds the missing
--    select policy" publishes the answer key to every child in the class. A
--    student reaches the questions only through `online_test_start`, a definer
--    that projects prompt, options and marks and never the key, and only once
--    the test is open, published, and the caller is enrolled in its class.
--
-- 2. **Two parties need different rights on an attempt**, so it is the
--    `homework_submit` shape (rule 4): the student writes through definer
--    functions that set exactly the columns a sitting may set, and nobody holding
--    a JWT may write the table directly -- revoked, the stronger shape of rule 6,
--    because a policy that let a student update their own attempt would let them
--    write their own `score`.
--
-- 3. **Marking happens once, in one function.** `online_test_score` is the only
--    place that compares an answer with the key; `online_test_submit` freezes
--    its result onto the attempt with the maximum beside it, and the teacher's
--    results read the same function for a sitting that ran out of time without
--    being submitted. Two graders would be two answers (rule 11).
--
-- And rule 4's composite-key device, twice:
--
--  - **questions carry the test's status** (`test_status`, held equal by the
--    key, `on update cascade`), and the write policies require 'draft' -- so
--    publishing is one UPDATE on the test and from that instant nobody can change
--    a question or its key. Marks awarded against a key that later moved would
--    be a mark nobody can explain.
--  - **attempts carry it too, with a CHECK that it is 'published'.** Taking a
--    test back to draft after somebody has started it rewrites their attempt
--    through the cascade, the CHECK fails, and the unpublish is refused -- the
--    same refusal as lowering a paper's maximum below a mark already awarded.
--    A plain UPDATE through PostgREST meets it too, which a check in the write
--    function alone could not promise (0205's lesson).
--
-- The clock: a sitting's `due_at` is frozen when it starts -- the duration from
-- then, or the test's close, whichever is sooner -- so reopening the page does
-- not reset it, and moving the close later does not lengthen a sitting already
-- running. Saves and the submission are accepted for two minutes past it, for
-- a network, and not after: a late submission is marked on what was saved in
-- time, and says so.
--
-- Not built, and named: question banks and shuffling, more than one correct
-- option, free-text answers (those need a person to mark them, which is
-- homework), negative marking, retakes, a mobile contract block, and an
-- announcement when a test is published.

begin;

-- ------------------------------------------------------------ permissions --

insert into reference.permissions (code, module, ability, description) values
  ('onlinetests.view', 'onlinetests', 'view', 'See online tests, sit them, and see the marks'),
  ('onlinetests.manage', 'onlinetests', 'manage', 'Write, publish and read the results of online tests');

-- Existing colleges: whoever may see and set homework may see and set tests.
insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, 'onlinetests.view', true
from public.role_permissions rp
where rp.permission_code = 'homework.view' and rp.allowed
on conflict do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code, allowed)
select rp.tenant_id, rp.role_id, 'onlinetests.manage', true
from public.role_permissions rp
where rp.permission_code = 'homework.manage' and rp.allowed
on conflict do nothing;

-- A college founded tomorrow (0269).
insert into reference.role_permission_defaults (role_code, permission_code) values
  ('teacher', 'onlinetests.view'),
  ('teacher', 'onlinetests.manage'),
  ('student', 'onlinetests.view'),
  ('parent', 'onlinetests.view');

-- ------------------------------------------------- the courses I teach --

-- `live_class_courses()` (0272) answered "which courses may I set work for" and
-- nothing about it was live-class-specific. Tests are its second consumer, and
-- the second consumer decides the unit of work: the definition moves here and
-- the old name wraps it, so the two screens cannot come to disagree.
create or replace function public.teaching_courses()
returns table (
  session_id uuid,
  session_name text,
  section_id uuid,
  subject_id uuid,
  label text,
  teacher_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    ss.session_id,
    a.name,
    ss.section_id,
    ss.subject_id,
    cl.name || ' ' || s.name || ' -- ' || sub.name,
    sd.full_name
  from public.section_subjects ss
  join public.academic_sessions a on a.id = ss.session_id
  join public.sections s on s.id = ss.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = ss.subject_id
  join public.tenants t on t.id = ss.tenant_id
  left join public.staff_directory() sd on sd.staff_id = ss.teacher_staff_id
  where a.end_date >= (now() at time zone coalesce(t.timezone, 'Asia/Kolkata'))::date
    and (
      ( select public.current_role_code() ) = 'admin'
      or (( select public.current_role_code() ) = 'teacher'
          and exists (select 1 from public.user_profiles up
                      where up.id = ( select auth.uid() )
                        and up.staff_id is not null
                        and up.staff_id = ss.teacher_staff_id))
    )
  order by a.start_date, cl.sequence, s.name, sub.name, ss.id
$$;

comment on function public.teaching_courses() is
  'The courses the caller may set work for: every year that has not ended (a '
  'date question, not the is_current flag), and the write policies'' own '
  'predicate for whose. INVOKER. The definition behind live_class_courses and '
  'the online tests. Migration 0274.';

revoke all on function public.teaching_courses() from public, anon;
grant execute on function public.teaching_courses() to authenticated;

-- `create or replace` keeps its grants (0267).
create or replace function public.live_class_courses()
returns table (
  session_id uuid,
  session_name text,
  section_id uuid,
  subject_id uuid,
  label text,
  teacher_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select * from public.teaching_courses()
$$;

-- ------------------------------------------------------------------ tests --

create table public.online_tests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  section_id uuid not null,
  subject_id uuid not null,
  teacher_staff_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  instructions text check (instructions is null or length(instructions) <= 2000),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 5 and 300),
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- Whether a student may see the key, question by question, once the test has
  -- closed for everybody. Never before: the class is still sitting it.
  reveal_answers boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, id),
  -- The keys the two children carry (rule 4's device).
  constraint online_tests_status_key unique (tenant_id, id, status),
  constraint online_tests_sitting_key unique (tenant_id, id, session_id, status),

  -- This class studies this subject this year.
  constraint online_tests_course_fkey
    foreign key (tenant_id, session_id, section_id, subject_id)
    references public.section_subjects (tenant_id, session_id, section_id, subject_id)
    on delete cascade,
  constraint online_tests_teacher_fkey
    foreign key (tenant_id, teacher_staff_id)
    references public.staff (tenant_id, id) on delete set null (teacher_staff_id),

  constraint online_tests_window_chk
    check (closes_at > opens_at and closes_at <= opens_at + interval '60 days')
);

create index online_tests_when_idx on public.online_tests (tenant_id, opens_at);

create trigger set_updated_at before update on public.online_tests
  for each row execute function public.set_updated_at();
create trigger audit_online_tests after insert or update or delete on public.online_tests
  for each row execute function public.audit_row_change();

alter table public.online_tests enable row level security;

create policy "admins manage online tests" on public.online_tests
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin'))
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'admin'));

create policy "subject teachers manage their online tests" on public.online_tests
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.section_subjects ss
           join public.user_profiles up on up.staff_id = ss.teacher_staff_id
           where ss.tenant_id = online_tests.tenant_id
             and ss.session_id = online_tests.session_id
             and ss.section_id = online_tests.section_id
             and ss.subject_id = online_tests.subject_id
             and up.id = ( select auth.uid() )))
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'teacher')
              and exists (
                select 1 from public.section_subjects ss
                join public.user_profiles up on up.staff_id = ss.teacher_staff_id
                where ss.tenant_id = online_tests.tenant_id
                  and ss.session_id = online_tests.session_id
                  and ss.section_id = online_tests.section_id
                  and ss.subject_id = online_tests.subject_id
                  and up.id = ( select auth.uid() )));

create policy "class teachers view their section online tests" on public.online_tests
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.sections s
           join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
           where s.id = online_tests.section_id and up.id = ( select auth.uid() )));

-- A family sees a test once it is published, never a draft.
create policy "students view own published online tests" on public.online_tests
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'student')
         and status = 'published'
         and section_id in (
           select e.section_id from public.enrolments e
           where e.student_id = ( select up.student_id from public.user_profiles up
                                  where up.id = ( select auth.uid() ))
             and e.status = 'active'));

create policy "parents view own children published online tests" on public.online_tests
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'parent')
         and status = 'published'
         and section_id in (
           select e.section_id from public.enrolments e
           join public.guardian_student gs on gs.student_id = e.student_id
           join public.user_profiles up on up.guardian_id = gs.guardian_id
           where up.id = ( select auth.uid() ) and e.status = 'active'));

-- -------------------------------------------------------------- questions --

create table public.online_test_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  test_id uuid not null,
  -- Held equal to the test's status by the key below; the write policies
  -- require 'draft', so publishing freezes every question in one UPDATE.
  test_status text not null default 'draft',
  position integer not null check (position between 1 and 200),
  prompt text not null check (length(btrim(prompt)) between 1 and 2000),
  options jsonb not null
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  -- The key. Zero-based into `options`. Never readable by a student: see the
  -- policies below, and the note on their absence.
  correct_option integer not null check (correct_option >= 0),
  marks numeric(6, 2) not null default 1 check (marks > 0 and marks <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, id),
  constraint online_test_questions_position_key unique (test_id, position),
  constraint online_test_questions_key_in_range_chk
    check (correct_option < jsonb_array_length(options)),
  constraint online_test_questions_test_fkey
    foreign key (tenant_id, test_id, test_status)
    references public.online_tests (tenant_id, id, status)
    on update cascade on delete cascade
);

create trigger set_updated_at before update on public.online_test_questions
  for each row execute function public.set_updated_at();
create trigger audit_online_test_questions after insert or update or delete on public.online_test_questions
  for each row execute function public.audit_row_change();

alter table public.online_test_questions enable row level security;

-- There is deliberately NO policy here for a student or a parent. The key is a
-- column of this row, a policy grants whole rows (rule 4), and a student who
-- could read a question could read its answer. They reach the questions through
-- online_test_start, which projects everything but the key. Do not "add the
-- missing select policy".

create policy "admins read online test questions" on public.online_test_questions
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin'));

create policy "admins write draft online test questions" on public.online_test_questions
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin')
         and test_status = 'draft')
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'admin')
              and test_status = 'draft');

create policy "subject teachers read their online test questions" on public.online_test_questions
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.online_tests t
           join public.section_subjects ss
             on ss.tenant_id = t.tenant_id and ss.session_id = t.session_id
            and ss.section_id = t.section_id and ss.subject_id = t.subject_id
           join public.user_profiles up on up.staff_id = ss.teacher_staff_id
           where t.id = online_test_questions.test_id and up.id = ( select auth.uid() )));

create policy "subject teachers write their draft online test questions" on public.online_test_questions
  for all to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and test_status = 'draft'
         and exists (
           select 1 from public.online_tests t
           join public.section_subjects ss
             on ss.tenant_id = t.tenant_id and ss.session_id = t.session_id
            and ss.section_id = t.section_id and ss.subject_id = t.subject_id
           join public.user_profiles up on up.staff_id = ss.teacher_staff_id
           where t.id = online_test_questions.test_id and up.id = ( select auth.uid() )))
  with check ((tenant_id = ( select public.current_tenant_id() ))
              and (( select public.current_role_code() ) = 'teacher')
              and test_status = 'draft'
              and exists (
                select 1 from public.online_tests t
                join public.section_subjects ss
                  on ss.tenant_id = t.tenant_id and ss.session_id = t.session_id
                 and ss.section_id = t.section_id and ss.subject_id = t.subject_id
                join public.user_profiles up on up.staff_id = ss.teacher_staff_id
                where t.id = online_test_questions.test_id and up.id = ( select auth.uid() )));

-- --------------------------------------------------------------- attempts --

create table public.online_test_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  test_id uuid not null,
  -- Always 'published': a sitting exists only for a published test, and taking
  -- the test back to draft would cascade here and fail this CHECK.
  test_status text not null default 'published' check (test_status = 'published'),
  student_id uuid not null,
  started_at timestamptz not null default now(),
  -- Frozen at the start: the duration from then, or the close if sooner.
  due_at timestamptz not null,
  -- { question_id: chosen option index }. Only ever written by the functions
  -- below, which keep only this test's questions and in-range choices.
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  saved_at timestamptz,
  submitted_at timestamptz,
  -- Frozen at submission, with the maximum beside it (rule 12's denominator).
  score numeric(8, 2),
  max_score numeric(8, 2),
  -- True when the submission arrived after the clock and was marked on what had
  -- been saved in time rather than on what it carried.
  submitted_late boolean not null default false,

  unique (tenant_id, id),
  constraint online_test_attempts_once unique (test_id, student_id),
  constraint online_test_attempts_due_chk check (due_at > started_at),
  constraint online_test_attempts_marked_chk
    check ((submitted_at is null) = (score is null) and (score is null) = (max_score is null)),
  constraint online_test_attempts_score_chk
    check (score is null or (score >= 0 and score <= max_score)),
  constraint online_test_attempts_test_fkey
    foreign key (tenant_id, test_id, session_id, test_status)
    references public.online_tests (tenant_id, id, session_id, status)
    on update cascade on delete restrict,
  constraint online_test_attempts_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete restrict
);

create index online_test_attempts_student_idx on public.online_test_attempts (tenant_id, student_id);

create trigger audit_online_test_attempts after insert or update or delete on public.online_test_attempts
  for each row execute function public.audit_row_change();

alter table public.online_test_attempts enable row level security;

create policy "admins view online test attempts" on public.online_test_attempts
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'admin'));

create policy "subject teachers view attempts at their online tests" on public.online_test_attempts
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.online_tests t
           join public.section_subjects ss
             on ss.tenant_id = t.tenant_id and ss.session_id = t.session_id
            and ss.section_id = t.section_id and ss.subject_id = t.subject_id
           join public.user_profiles up on up.staff_id = ss.teacher_staff_id
           where t.id = online_test_attempts.test_id and up.id = ( select auth.uid() )));

create policy "class teachers view their section online test attempts" on public.online_test_attempts
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'teacher')
         and exists (
           select 1 from public.online_tests t
           join public.sections s on s.id = t.section_id
           join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
           where t.id = online_test_attempts.test_id and up.id = ( select auth.uid() )));

create policy "students view own online test attempts" on public.online_test_attempts
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'student')
         and student_id = ( select up.student_id from public.user_profiles up
                            where up.id = ( select auth.uid() )));

create policy "parents view own children online test attempts" on public.online_test_attempts
  for select to authenticated
  using ((tenant_id = ( select public.current_tenant_id() ))
         and (( select public.current_role_code() ) = 'parent')
         and student_id in (
           select gs.student_id from public.guardian_student gs
           join public.user_profiles up on up.guardian_id = gs.guardian_id
           where up.id = ( select auth.uid() )));

-- Nobody holding a JWT writes a sitting directly. A student who could update
-- their own attempt could write their own score; the functions below set
-- exactly the columns a sitting may set.
revoke insert, update, delete on public.online_test_attempts from authenticated, anon;

-- ------------------------------------------------ the one marking function --

-- Internal: called only by the definers below. Revoked from everybody holding a
-- JWT, because it reads the key.
create or replace function public.online_test_score(p_test_id uuid, p_answers jsonb)
returns table (score numeric, max_score numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(q.marks) filter (
      where jsonb_typeof(p_answers -> q.id::text) = 'number'
        and (p_answers ->> q.id::text) = q.correct_option::text
    ), 0)::numeric,
    coalesce(sum(q.marks), 0)::numeric
  from public.online_test_questions q
  where q.test_id = p_test_id
$$;

revoke all on function public.online_test_score(uuid, jsonb) from public, anon, authenticated;

-- Internal: what a sitting student is shown. Everything but the key.
create or replace function public.online_test_paper(p_attempt_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'test', jsonb_build_object(
      'id', t.id, 'title', t.title, 'instructions', t.instructions,
      'opens_at', t.opens_at, 'closes_at', t.closes_at,
      'duration_minutes', t.duration_minutes, 'reveal_answers', t.reveal_answers),
    'attempt', jsonb_build_object(
      'id', a.id, 'started_at', a.started_at, 'due_at', a.due_at,
      'saved_at', a.saved_at, 'submitted_at', a.submitted_at,
      'score', a.score, 'max_score', a.max_score, 'submitted_late', a.submitted_late),
    'answers', a.answers,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'position', q.position, 'prompt', q.prompt,
               'options', q.options, 'marks', q.marks)
             order by q.position)
      from public.online_test_questions q
      where q.test_id = t.id), '[]'::jsonb)
  )
  from public.online_test_attempts a
  join public.online_tests t on t.id = a.test_id and t.tenant_id = a.tenant_id
  where a.id = p_attempt_id
$$;

revoke all on function public.online_test_paper(uuid) from public, anon, authenticated;

-- Internal: keep only this test's questions and in-range choices.
create or replace function public.online_test_clean_answers(p_test_id uuid, p_answers jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(q.id::text, (p_answers ->> q.id::text)::integer), '{}'::jsonb)
  from public.online_test_questions q
  where q.test_id = p_test_id
    and jsonb_typeof(p_answers) = 'object'
    and jsonb_typeof(p_answers -> q.id::text) = 'number'
    and (p_answers ->> q.id::text) ~ '^[0-9]{1,2}$'
    and (p_answers ->> q.id::text)::integer < jsonb_array_length(q.options)
$$;

revoke all on function public.online_test_clean_answers(uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------- sitting a test --

-- Who is sitting, and which sitting. One sentence for every reason a test is
-- not the caller's, so the functions are not a way to ask which tests exist in
-- which class. Filters by tenant by hand: no policy runs inside a definer.
create or replace function public.online_test_my_sitting(p_test_id uuid)
returns table (test_id uuid, student_id uuid, attempt_id uuid, tenant_id uuid, timezone text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_student uuid;
  v_test public.online_tests;
begin
  if v_tenant is null or not ( select public.role_has_permission('onlinetests.view') ) then
    raise exception 'Your role may not sit online tests.' using errcode = '42501';
  end if;

  select up.student_id into v_student
  from public.user_profiles up
  where up.id = ( select auth.uid() ) and up.tenant_id = v_tenant;
  if v_student is null then
    raise exception 'Only the student sitting a test can open it.' using errcode = '42501';
  end if;

  select * into v_test
  from public.online_tests t
  where t.id = p_test_id and t.tenant_id = v_tenant and t.status = 'published'
    and exists (
      select 1 from public.enrolments e
      where e.tenant_id = v_tenant and e.student_id = v_student
        and e.section_id = t.section_id and e.session_id = t.session_id
        and e.status = 'active');
  if v_test.id is null then
    raise exception 'This test is not one you can sit.' using errcode = '42501';
  end if;

  return query
  select v_test.id, v_student, a.id, v_tenant, coalesce(tn.timezone, 'Asia/Kolkata')
  from public.tenants tn
  left join public.online_test_attempts a
    on a.test_id = v_test.id and a.student_id = v_student and a.tenant_id = v_tenant
  where tn.id = v_tenant;
end;
$$;

revoke all on function public.online_test_my_sitting(uuid) from public, anon, authenticated;

-- Internal: mark a sitting and freeze the mark. Idempotent on a sitting that is
-- already marked.
create or replace function public.online_test_finish(p_attempt_id uuid, p_answers jsonb, p_late boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.online_test_attempts;
  v_score numeric;
  v_max numeric;
  v_count integer;
begin
  select * into v_attempt from public.online_test_attempts a where a.id = p_attempt_id;
  if v_attempt.submitted_at is not null then
    return;
  end if;

  select s.score, s.max_score into v_score, v_max
  from public.online_test_score(v_attempt.test_id, p_answers) s;

  update public.online_test_attempts a
     set answers = p_answers,
         submitted_at = now(),
         score = v_score,
         max_score = v_max,
         submitted_late = p_late
   where a.id = p_attempt_id and a.submitted_at is null;
  get diagnostics v_count = row_count;
  -- Zero means a second tab marked it a moment ago, which is the same outcome.
  if v_count > 1 then
    raise exception 'Marked more than one sitting.';
  end if;
end;
$$;

revoke all on function public.online_test_finish(uuid, jsonb, boolean) from public, anon, authenticated;

-- Start (or reopen) a sitting and return the paper. Starting is the only way to
-- see the questions, so reading them starts the clock -- which is why the list
-- screen reads the test row and never the paper.
create or replace function public.online_test_start(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_test public.online_tests;
  v_attempt public.online_test_attempts;
begin
  select * into v_me from public.online_test_my_sitting(p_test_id);
  select * into v_test from public.online_tests t where t.id = v_me.test_id;

  if v_me.attempt_id is null then
    if now() < v_test.opens_at then
      raise exception 'This test opens at %.',
        to_char(v_test.opens_at at time zone v_me.timezone, 'FMDD Mon YYYY, HH24:MI');
    end if;
    if now() >= v_test.closes_at then
      raise exception 'This test closed at %, and you had not started it.',
        to_char(v_test.closes_at at time zone v_me.timezone, 'FMDD Mon YYYY, HH24:MI');
    end if;
    if not exists (select 1 from public.online_test_questions q where q.test_id = v_test.id) then
      raise exception 'This test has no questions yet. Tell your teacher.';
    end if;

    insert into public.online_test_attempts (tenant_id, session_id, test_id, student_id, due_at)
    values (v_me.tenant_id, v_test.session_id, v_test.id, v_me.student_id,
            least(now() + make_interval(mins => v_test.duration_minutes), v_test.closes_at))
    on conflict (test_id, student_id) do nothing;
  end if;

  select * into v_attempt
  from public.online_test_attempts a
  where a.test_id = v_test.id and a.student_id = v_me.student_id and a.tenant_id = v_me.tenant_id;

  -- A sitting that ran out without being submitted is marked now, on what was
  -- saved in time.
  if v_attempt.submitted_at is null and now() > v_attempt.due_at + interval '2 minutes' then
    perform public.online_test_finish(v_attempt.id, v_attempt.answers, true);
  end if;

  return public.online_test_paper(v_attempt.id);
end;
$$;

revoke all on function public.online_test_start(uuid) from public, anon;
grant execute on function public.online_test_start(uuid) to authenticated;

create or replace function public.online_test_save(p_test_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_attempt public.online_test_attempts;
  v_count integer;
begin
  select * into v_me from public.online_test_my_sitting(p_test_id);
  if v_me.attempt_id is null then
    raise exception 'You have not started this test.';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Send the answers as an object of question and choice.' using errcode = '22023';
  end if;

  select * into v_attempt from public.online_test_attempts a where a.id = v_me.attempt_id;
  if v_attempt.submitted_at is not null then
    raise exception 'This test is already submitted.';
  end if;
  if now() > v_attempt.due_at + interval '2 minutes' then
    raise exception 'Time is up. The answers saved before % are the ones that count.',
      to_char(v_attempt.due_at at time zone v_me.timezone, 'HH24:MI');
  end if;

  update public.online_test_attempts a
     set answers = public.online_test_clean_answers(v_attempt.test_id, p_answers),
         saved_at = now()
   where a.id = v_attempt.id and a.submitted_at is null;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Your answers could not be saved. Reload the page and try again.';
  end if;

  return jsonb_build_object('saved_at', now(), 'due_at', v_attempt.due_at);
end;
$$;

revoke all on function public.online_test_save(uuid, jsonb) from public, anon;
grant execute on function public.online_test_save(uuid, jsonb) to authenticated;

create or replace function public.online_test_submit(p_test_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_attempt public.online_test_attempts;
  v_late boolean;
begin
  select * into v_me from public.online_test_my_sitting(p_test_id);
  if v_me.attempt_id is null then
    raise exception 'You have not started this test.';
  end if;

  select * into v_attempt from public.online_test_attempts a where a.id = v_me.attempt_id;
  if v_attempt.submitted_at is null then
    v_late := now() > v_attempt.due_at + interval '2 minutes';
    perform public.online_test_finish(
      v_attempt.id,
      case when v_late or p_answers is null then v_attempt.answers
           else public.online_test_clean_answers(v_attempt.test_id, p_answers) end,
      v_late);
  end if;

  select * into v_attempt from public.online_test_attempts a where a.id = v_me.attempt_id;
  return jsonb_build_object(
    'score', v_attempt.score, 'max_score', v_attempt.max_score,
    'submitted_at', v_attempt.submitted_at, 'submitted_late', v_attempt.submitted_late);
end;
$$;

revoke all on function public.online_test_submit(uuid, jsonb) from public, anon;
grant execute on function public.online_test_submit(uuid, jsonb) to authenticated;

-- The key, question by question -- only once the test has closed for everybody,
-- only if the teacher allows it, and only to somebody who sat it.
create or replace function public.online_test_review(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_test public.online_tests;
  v_attempt public.online_test_attempts;
begin
  select * into v_me from public.online_test_my_sitting(p_test_id);
  select * into v_test from public.online_tests t where t.id = v_me.test_id;
  if v_me.attempt_id is null then
    raise exception 'You did not sit this test.';
  end if;
  if now() < v_test.closes_at then
    raise exception 'The answers are shown after the test closes at %, when everybody has finished.',
      to_char(v_test.closes_at at time zone v_me.timezone, 'FMDD Mon YYYY, HH24:MI');
  end if;
  if not v_test.reveal_answers then
    raise exception 'Your teacher has chosen not to show the answers for this test.';
  end if;

  select * into v_attempt from public.online_test_attempts a where a.id = v_me.attempt_id;
  if v_attempt.submitted_at is null then
    perform public.online_test_finish(v_attempt.id, v_attempt.answers, true);
    select * into v_attempt from public.online_test_attempts a where a.id = v_me.attempt_id;
  end if;

  return jsonb_build_object(
    'score', v_attempt.score, 'max_score', v_attempt.max_score,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'position', q.position, 'prompt', q.prompt,
               'options', q.options, 'marks', q.marks,
               'correct_option', q.correct_option,
               'chosen', case when jsonb_typeof(v_attempt.answers -> q.id::text) = 'number'
                              then (v_attempt.answers ->> q.id::text)::integer end)
             order by q.position)
      from public.online_test_questions q
      where q.test_id = v_test.id), '[]'::jsonb));
end;
$$;

revoke all on function public.online_test_review(uuid) from public, anon;
grant execute on function public.online_test_review(uuid) to authenticated;

-- ------------------------------------------------ what the teacher calls --

create or replace function public.online_test_create(p_test jsonb)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_section public.sections;
  v_session public.academic_sessions;
  v_subject uuid;
  v_teacher uuid;
  v_tz text;
  v_title text := btrim(coalesce(p_test ->> 'title', ''));
  v_instructions text := nullif(btrim(coalesce(p_test ->> 'instructions', '')), '');
  v_opens timestamptz;
  v_closes timestamptz;
  v_minutes integer;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if not ( select public.role_has_permission('onlinetests.manage') ) then
    raise exception 'Your role may not set online tests. That needs the "onlinetests.manage" permission.';
  end if;

  select * into v_section from public.sections s where s.id = (p_test ->> 'section_id')::uuid;
  if v_section.id is null then
    raise exception 'Choose a class.';
  end if;
  v_subject := (p_test ->> 'subject_id')::uuid;

  select ss.teacher_staff_id into v_teacher
  from public.section_subjects ss
  where ss.tenant_id = v_tenant_id and ss.session_id = v_section.session_id
    and ss.section_id = v_section.id and ss.subject_id = v_subject;
  if not found then
    raise exception 'That class does not study that subject this year.';
  end if;

  -- The policy's question, asked first for the message (0257): an INSERT whose
  -- WITH CHECK fails raises a sentence nobody should read. The policy decides.
  if ( select public.current_role_code() ) <> 'admin' and not exists (
    select 1 from public.user_profiles up
    where up.id = ( select auth.uid() ) and up.staff_id is not null and up.staff_id = v_teacher
  ) then
    raise exception 'Only the teacher of this subject for this class, or an administrator, can set its tests.';
  end if;

  if v_title = '' or length(v_title) > 120 then
    raise exception 'Give the test a title of up to 120 characters.';
  end if;
  if v_instructions is not null and length(v_instructions) > 2000 then
    raise exception 'Keep the instructions under 2,000 characters.';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_tenant_id;
  begin
    v_opens := ((p_test ->> 'opens_on')::date + (p_test ->> 'opens_at')::time) at time zone coalesce(v_tz, 'Asia/Kolkata');
    v_closes := ((p_test ->> 'closes_on')::date + (p_test ->> 'closes_at')::time) at time zone coalesce(v_tz, 'Asia/Kolkata');
    v_minutes := (p_test ->> 'minutes')::integer;
  exception when others then
    raise exception 'Give when the test opens and closes, and how many minutes a student has.';
  end;
  if v_opens is null or v_closes is null or v_minutes is null then
    raise exception 'Give when the test opens and closes, and how many minutes a student has.';
  end if;
  if v_minutes < 5 or v_minutes > 300 then
    raise exception 'A student can be given between 5 minutes and 5 hours.';
  end if;
  if v_closes <= v_opens then
    raise exception 'The test must close after it opens.';
  end if;
  if v_closes > v_opens + interval '60 days' then
    raise exception 'A test can stay open for at most 60 days.';
  end if;
  if v_closes <= now() then
    raise exception 'That test would already be closed. Choose a close that has not passed.';
  end if;

  -- Rule 2: the test belongs to its class's year.
  select * into v_session from public.academic_sessions a where a.id = v_section.session_id;
  if (v_opens at time zone coalesce(v_tz, 'Asia/Kolkata'))::date not between v_session.start_date and v_session.end_date then
    raise exception '% falls outside %, the year this class belongs to. Choose a date inside it, or the class in the right year.',
      to_char(v_opens at time zone coalesce(v_tz, 'Asia/Kolkata'), 'FMDD Mon YYYY'), v_session.name;
  end if;

  insert into public.online_tests (
    tenant_id, session_id, section_id, subject_id, teacher_staff_id,
    title, instructions, opens_at, closes_at, duration_minutes, reveal_answers
  )
  values (
    v_tenant_id, v_section.session_id, v_section.id, v_subject, v_teacher,
    v_title, v_instructions, v_opens, v_closes, v_minutes,
    coalesce((p_test ->> 'reveal_answers')::boolean, true)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.online_test_create(jsonb) from public, anon;
grant execute on function public.online_test_create(jsonb) to authenticated;

-- A question, validated here so the office reads a sentence rather than a
-- CHECK's name. `p_question ->> 'id'` present means edit.
create or replace function public.online_test_save_question(p_test_id uuid, p_question jsonb)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_test public.online_tests;
  v_prompt text := btrim(coalesce(p_question ->> 'prompt', ''));
  v_options jsonb;
  v_correct integer;
  v_marks numeric;
  v_id uuid := nullif(p_question ->> 'id', '')::uuid;
  v_count integer;
begin
  select * into v_test from public.online_tests t where t.id = p_test_id;
  if v_test.id is null then
    raise exception 'That test is not one you can change.';
  end if;
  -- The write policy's question, asked first for the message: an INSERT whose
  -- WITH CHECK fails raises a sentence nobody should read (0257).
  if not ( select public.role_has_permission('onlinetests.manage') )
     or (( select public.current_role_code() ) <> 'admin' and not exists (
       select 1 from public.section_subjects ss
       join public.user_profiles up on up.staff_id = ss.teacher_staff_id
       where ss.tenant_id = v_test.tenant_id and ss.session_id = v_test.session_id
         and ss.section_id = v_test.section_id and ss.subject_id = v_test.subject_id
         and up.id = ( select auth.uid() ))) then
    raise exception 'Only the teacher of this subject for this class, or an administrator, can write its questions.';
  end if;
  if v_test.status <> 'draft' then
    raise exception 'This test is published, so its questions are fixed. Take it back to draft to change them -- possible only until somebody starts it.';
  end if;

  if v_prompt = '' or length(v_prompt) > 2000 then
    raise exception 'Write the question, in up to 2,000 characters.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(btrim(o)) order by n), '[]'::jsonb) into v_options
  from jsonb_array_elements_text(
         case when jsonb_typeof(p_question -> 'options') = 'array' then p_question -> 'options' else '[]'::jsonb end
       ) with ordinality as x(o, n)
  where btrim(o) <> '';
  if jsonb_array_length(v_options) < 2 or jsonb_array_length(v_options) > 6 then
    raise exception 'Give between two and six options.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_options) o where length(o) > 300) then
    raise exception 'Keep each option under 300 characters.';
  end if;
  if (select count(distinct lower(o)) from jsonb_array_elements_text(v_options) o) <> jsonb_array_length(v_options) then
    raise exception 'Two options say the same thing. Make each one different.';
  end if;

  begin
    v_correct := (p_question ->> 'correct_option')::integer;
    v_marks := coalesce((p_question ->> 'marks')::numeric, 1);
  exception when others then
    raise exception 'Choose the right answer, and give the marks as a number.';
  end;
  if v_correct is null or v_correct < 0 or v_correct >= jsonb_array_length(v_options) then
    raise exception 'Choose which option is the right answer.';
  end if;
  if v_marks <= 0 or v_marks > 100 then
    raise exception 'A question is worth more than 0 and at most 100 marks.';
  end if;

  if v_id is null then
    insert into public.online_test_questions (tenant_id, test_id, position, prompt, options, correct_option, marks)
    values (
      v_test.tenant_id, v_test.id,
      coalesce((select max(q.position) from public.online_test_questions q where q.test_id = v_test.id), 0) + 1,
      v_prompt, v_options, v_correct, v_marks)
    returning id into v_id;
  else
    update public.online_test_questions q
       set prompt = v_prompt, options = v_options, correct_option = v_correct, marks = v_marks
     where q.id = v_id and q.test_id = v_test.id;
    -- An UPDATE no policy matches writes nothing and raises nothing (rule 6).
    get diagnostics v_count = row_count;
    if v_count <> 1 then
      raise exception 'That question cannot be changed: the test is published, or it is not yours.';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.online_test_save_question(uuid, jsonb) from public, anon;
grant execute on function public.online_test_save_question(uuid, jsonb) to authenticated;

create or replace function public.online_test_delete_question(p_question_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  delete from public.online_test_questions q where q.id = p_question_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That question cannot be removed: the test is published, or it is not yours.';
  end if;
end;
$$;

revoke all on function public.online_test_delete_question(uuid) from public, anon;
grant execute on function public.online_test_delete_question(uuid) to authenticated;

create or replace function public.online_test_publish(p_test_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_test public.online_tests;
  v_count integer;
begin
  select * into v_test from public.online_tests t where t.id = p_test_id;
  if v_test.id is null then
    raise exception 'That test is not one you can publish.';
  end if;
  if not exists (select 1 from public.online_test_questions q where q.test_id = v_test.id) then
    raise exception 'Add at least one question before publishing.';
  end if;
  if v_test.closes_at <= now() then
    raise exception 'This test has already closed. Move its close later first.';
  end if;

  update public.online_tests t set status = 'published' where t.id = v_test.id and t.status = 'draft';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That test is already published, or is not one you can publish.';
  end if;
end;
$$;

revoke all on function public.online_test_publish(uuid) from public, anon;
grant execute on function public.online_test_publish(uuid) to authenticated;

create or replace function public.online_test_unpublish(p_test_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_started integer;
  v_count integer;
begin
  -- The cascade into online_test_attempts refuses this anyway (its CHECK); the
  -- count is asked first so the refusal is a sentence with the number in it.
  select count(*) into v_started from public.online_test_attempts a where a.test_id = p_test_id;
  if v_started > 0 then
    raise exception '% already started this test, so its questions and key are fixed. Set a new test instead.',
      case when v_started = 1 then '1 student has' else v_started || ' students have' end;
  end if;

  update public.online_tests t set status = 'draft' where t.id = p_test_id and t.status = 'published';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That test is already a draft, or is not one you can change.';
  end if;
end;
$$;

revoke all on function public.online_test_unpublish(uuid) from public, anon;
grant execute on function public.online_test_unpublish(uuid) to authenticated;

create or replace function public.online_test_delete(p_test_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_started integer;
  v_count integer;
begin
  select count(*) into v_started from public.online_test_attempts a where a.test_id = p_test_id;
  if v_started > 0 then
    raise exception '% sat this test, and their marks are a record. It cannot be deleted.',
      case when v_started = 1 then '1 student' else v_started || ' students' end;
  end if;

  delete from public.online_tests t where t.id = p_test_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'That test is not one you can delete.';
  end if;
end;
$$;

revoke all on function public.online_test_delete(uuid) from public, anon;
grant execute on function public.online_test_delete(uuid) to authenticated;

-- ---------------------------------------------------------------- results --

-- The class list with each student's sitting, and how each question went.
--
-- SECURITY DEFINER, and gated in its own body, because the honest roster is not
-- reachable by an invoker: a subject teacher who is not the class teacher reads
-- no enrolments of that section (`teachers view own section enrolments` is the
-- class teacher's), so an invoker would list nobody as "not started" -- the
-- not-exists lie (rule 4). So it filters by tenant itself and asks the write
-- policy's question for who: an administrator, the course's teacher, or the
-- class teacher. Refuses, never returns empty.
create or replace function public.online_test_results(p_test_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_test public.online_tests;
begin
  select * into v_test from public.online_tests t where t.id = p_test_id and t.tenant_id = v_tenant;
  if v_test.id is null
     or not ( select public.role_has_permission('onlinetests.manage') )
     or not (
       ( select public.current_role_code() ) = 'admin'
       or (( select public.current_role_code() ) = 'teacher' and exists (
             select 1 from public.user_profiles up
             where up.id = ( select auth.uid() ) and up.tenant_id = v_tenant and up.staff_id is not null
               and (up.staff_id in (
                      select ss.teacher_staff_id from public.section_subjects ss
                      where ss.tenant_id = v_tenant and ss.session_id = v_test.session_id
                        and ss.section_id = v_test.section_id and ss.subject_id = v_test.subject_id)
                    or up.staff_id = (select s.class_teacher_staff_id from public.sections s
                                      where s.id = v_test.section_id and s.tenant_id = v_tenant))))
     ) then
    raise exception 'Only the teacher of this test, the class teacher or an administrator can see its results.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'rows', coalesce((
      with roster as (
        select e.student_id from public.enrolments e
        where e.tenant_id = v_tenant and e.section_id = v_test.section_id
          and e.session_id = v_test.session_id and e.status = 'active'
        union
        select a.student_id from public.online_test_attempts a
        where a.tenant_id = v_tenant and a.test_id = v_test.id
      )
      select jsonb_agg(jsonb_build_object(
               'student_id', st.id,
               'admission_number', st.admission_number,
               'name', btrim(p.first_name || ' ' || coalesce(p.last_name, '')),
               'state', case
                 when a.id is null then 'not_started'
                 when a.submitted_at is not null then 'submitted'
                 when now() > a.due_at + interval '2 minutes' then 'lapsed'
                 else 'in_progress' end,
               'started_at', a.started_at,
               'submitted_at', a.submitted_at,
               'submitted_late', coalesce(a.submitted_late, false),
               -- A sitting that ran out unsubmitted is marked on what was saved,
               -- by the same function a submission uses; `provisional` says so.
               'score', coalesce(a.score, case when a.id is not null and a.submitted_at is null
                                                    and now() > a.due_at + interval '2 minutes'
                                               then (select s.score from public.online_test_score(v_test.id, a.answers) s) end),
               'max_score', coalesce(a.max_score, (select s.max_score from public.online_test_score(v_test.id, '{}'::jsonb) s)),
               'provisional', a.id is not null and a.submitted_at is null)
             order by p.first_name, p.last_name, st.admission_number, st.id)
      from roster r
      join public.students st on st.id = r.student_id and st.tenant_id = v_tenant
      join public.people p on p.id = st.person_id and p.tenant_id = v_tenant
      left join public.online_test_attempts a
        on a.test_id = v_test.id and a.student_id = st.id and a.tenant_id = v_tenant
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'position', q.position, 'prompt', q.prompt,
               'answered', (select count(*) from public.online_test_attempts a
                            where a.test_id = v_test.id and a.submitted_at is not null
                              and jsonb_typeof(a.answers -> q.id::text) = 'number'),
               'correct', (select count(*) from public.online_test_attempts a
                           where a.test_id = v_test.id and a.submitted_at is not null
                             and (a.answers ->> q.id::text) = q.correct_option::text))
             order by q.position)
      from public.online_test_questions q
      where q.test_id = v_test.id and q.tenant_id = v_tenant
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.online_test_results(uuid) from public, anon;
grant execute on function public.online_test_results(uuid) to authenticated;

-- The list screen: every test the caller can see, with counts. INVOKER, so the
-- tests are exactly the ones RLS gives the caller and the sitting count is the
-- sittings the caller may see -- for a teacher, all of their own tests'.
create or replace function public.online_tests_list()
returns table (
  id uuid,
  title text,
  status text,
  opens_at timestamptz,
  closes_at timestamptz,
  duration_minutes integer,
  reveal_answers boolean,
  section_id uuid,
  class_label text,
  subject_name text,
  timezone text,
  question_count integer,
  total_marks numeric,
  sittings integer,
  submitted integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    t.id, t.title, t.status, t.opens_at, t.closes_at, t.duration_minutes, t.reveal_answers,
    t.section_id,
    cl.name || ' ' || s.name,
    sub.name,
    coalesce(tn.timezone, 'Asia/Kolkata'),
    (select count(*)::integer from public.online_test_questions q where q.test_id = t.id),
    (select coalesce(sum(q.marks), 0) from public.online_test_questions q where q.test_id = t.id),
    (select count(*)::integer from public.online_test_attempts a where a.test_id = t.id),
    (select count(*)::integer from public.online_test_attempts a where a.test_id = t.id and a.submitted_at is not null)
  from public.online_tests t
  join public.sections s on s.id = t.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = t.subject_id
  join public.tenants tn on tn.id = t.tenant_id
  where t.closes_at > now() - interval '120 days'
  order by t.opens_at desc, t.id
$$;

comment on function public.online_tests_list() is
  'Online tests the caller can see (RLS), opened in the last 120 days or later, '
  'newest first, with question, mark and sitting counts. For a family the '
  'question count comes back 0 -- they read no questions -- which is why the '
  'screen shows the duration and not the count to them. Migration 0274.';

revoke all on function public.online_tests_list() from public, anon;
grant execute on function public.online_tests_list() to authenticated;

commit;
