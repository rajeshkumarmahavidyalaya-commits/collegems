-- Phase 4.3, part 3 -- publishing, handing in, and marking.
--
-- The one idea worth stating: **publishing creates a row per student.** "Ravi
-- has not handed it in" is a fact the class teacher needs on Tuesday morning,
-- and the absence of a row cannot express it -- absence is indistinguishable
-- from a child who was never set the work.

-- ---------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the subject-teacher policies on `homework` and
-- `homework_submissions` decide which class this caller may set work for, and
-- the function only adds atomicity -- publishing and creating the roll must not
-- half-happen.
create or replace function public.homework_publish(p_homework_id uuid)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_homework public.homework;
  v_created integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_homework from public.homework h
  where h.id = p_homework_id and h.tenant_id = v_tenant_id;

  if v_homework.id is null then
    raise exception 'That homework does not exist';
  end if;

  if v_homework.status = 'published' then
    raise exception 'This homework is already published';
  end if;

  update public.homework
  set status = 'published', published_at = now()
  where id = p_homework_id;

  -- Homework that collects nothing gets no roll: a wall of permanently-pending
  -- rows for "finish exercise 4 in your book" teaches everybody to ignore the
  -- screen.
  if v_homework.collects_submissions then
    insert into public.homework_submissions (
      tenant_id, session_id, homework_id, student_id, status, max_marks
    )
    select
      v_tenant_id, v_homework.session_id, v_homework.id, en.student_id,
      'pending', v_homework.max_marks
    from public.enrolments en
    where en.tenant_id = v_tenant_id
      and en.session_id = v_homework.session_id
      and en.section_id = v_homework.section_id
      and en.status = 'active'
    on conflict (tenant_id, homework_id, student_id) do nothing;

    get diagnostics v_created = row_count;
  end if;

  return v_created;
end;
$$;

revoke all on function public.homework_publish(uuid) from public, anon;
grant execute on function public.homework_publish(uuid) to authenticated;

-- Refuses once anything has been handed in. Unpublishing then would either
-- destroy work a child did, or leave submissions hanging off homework nobody
-- can see -- and there is no third answer that is not a lie.
create or replace function public.homework_unpublish(p_homework_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_submitted integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select count(*) into v_submitted
  from public.homework_submissions s
  where s.homework_id = p_homework_id
    and s.tenant_id = v_tenant_id
    and s.status <> 'pending';

  if v_submitted > 0 then
    raise exception
      '% % already been handed in, so this cannot go back to a draft. Edit it in place instead.',
      v_submitted,
      case when v_submitted = 1 then 'piece of work has' else 'pieces of work have' end;
  end if;

  delete from public.homework_submissions s
  where s.homework_id = p_homework_id and s.tenant_id = v_tenant_id;

  update public.homework
  set status = 'draft', published_at = null
  where id = p_homework_id and tenant_id = v_tenant_id;
end;
$$;

revoke all on function public.homework_unpublish(uuid) from public, anon;
grant execute on function public.homework_unpublish(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Handing it in
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, and the reason is worth reading before copying this
-- elsewhere. `homework_submissions` must be updatable by two roles with
-- *different column rights*: a teacher may write `marks_obtained` and
-- `feedback`, a student may not. RLS cannot express that -- a policy chooses
-- rows, not columns -- and the column-grant trick that fixed
-- `notification_deliveries` in migration 0039 does not apply either, because a
-- grant is role-wide and every user here is `authenticated`.
--
-- So the student has no UPDATE policy at all, and this function is the whole of
-- what they may do: three columns, on their own row, before it is marked.
create or replace function public.homework_submit(
  p_homework_id uuid,
  p_note text default null
)
returns public.homework_submissions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_student_id uuid;
  v_homework public.homework;
  v_submission public.homework_submissions;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select up.student_id into v_student_id
  from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant_id;

  if v_student_id is null then
    raise exception 'Only a student can hand work in';
  end if;

  select * into v_homework from public.homework h
  where h.id = p_homework_id and h.tenant_id = v_tenant_id and h.status = 'published';

  if v_homework.id is null then
    raise exception 'That homework does not exist';
  end if;

  if not v_homework.collects_submissions then
    raise exception 'This homework is not collected online';
  end if;

  select * into v_submission from public.homework_submissions s
  where s.homework_id = p_homework_id
    and s.student_id = v_student_id
    and s.tenant_id = v_tenant_id;

  if v_submission.id is null then
    raise exception 'You were not set this homework';
  end if;

  -- Once it is marked it stops being theirs to change. Getting it back is a
  -- conversation with the teacher, not a button.
  if v_submission.status in ('graded', 'returned') then
    raise exception 'This has already been marked, so it cannot be changed';
  end if;

  update public.homework_submissions
  set status = 'submitted',
      submitted_at = coalesce(submitted_at, now()),
      note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = v_submission.id
  returning * into v_submission;

  return v_submission;
end;
$$;

revoke all on function public.homework_submit(uuid, text) from public, anon;
grant execute on function public.homework_submit(uuid, text) to authenticated;

create or replace function public.homework_unsubmit(p_homework_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_student_id uuid;
  v_submission public.homework_submissions;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select up.student_id into v_student_id
  from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant_id;

  if v_student_id is null then
    raise exception 'Only a student can take work back';
  end if;

  select * into v_submission from public.homework_submissions s
  where s.homework_id = p_homework_id
    and s.student_id = v_student_id
    and s.tenant_id = v_tenant_id;

  if v_submission.id is null then
    raise exception 'You were not set this homework';
  end if;

  if v_submission.status in ('graded', 'returned') then
    raise exception 'This has already been marked, so it cannot be taken back';
  end if;

  update public.homework_submissions
  set status = 'pending', submitted_at = null
  where id = v_submission.id;
end;
$$;

revoke all on function public.homework_unsubmit(uuid) from public, anon;
grant execute on function public.homework_unsubmit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Marking
-- ---------------------------------------------------------------------------

-- INVOKER, unlike the two above: a teacher legitimately has UPDATE on every
-- column of this table through the subject-teacher policy, so the function adds
-- nothing but a readable refusal and a single round trip.
create or replace function public.homework_grade(
  p_submission_id uuid,
  p_marks numeric default null,
  p_feedback text default null,
  p_return boolean default true
)
returns public.homework_submissions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_submission public.homework_submissions;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_submission from public.homework_submissions s
  where s.id = p_submission_id and s.tenant_id = v_tenant_id;

  if v_submission.id is null then
    raise exception 'That submission does not exist';
  end if;

  if p_marks is not null then
    if v_submission.max_marks is null then
      raise exception 'This homework is not marked out of anything, so a mark cannot be recorded';
    end if;
    if p_marks < 0 or p_marks > v_submission.max_marks then
      raise exception 'A mark must be between 0 and %', v_submission.max_marks;
    end if;
  end if;

  update public.homework_submissions
  set marks_obtained = p_marks,
      feedback = nullif(trim(coalesce(p_feedback, '')), ''),
      -- `returned` means the child can see the mark; `graded` means the teacher
      -- has marked it but is not showing it yet. Both carry a timestamp, which
      -- the check constraint enforces.
      status = case when p_return then 'returned' else 'graded' end,
      graded_by = auth.uid(),
      graded_at = now(),
      -- Marking something that was never handed in is a real thing -- a child
      -- who did it on paper -- so this fills the gap the constraint would
      -- otherwise refuse.
      submitted_at = coalesce(v_submission.submitted_at, now())
  where id = p_submission_id
  returning * into v_submission;

  return v_submission;
end;
$$;

revoke all on function public.homework_grade(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.homework_grade(uuid, numeric, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The marking list: everyone who was set the work, whether or not they did it.
create or replace function public.homework_submission_sheet(p_homework_id uuid)
returns table (
  submission_id uuid,
  student_id uuid,
  admission_number text,
  student_name text,
  roll_number text,
  status text,
  submitted_at timestamptz,
  note text,
  marks_obtained numeric,
  max_marks numeric,
  feedback text,
  file_count integer,
  is_late boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.id,
    s.student_id,
    st.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    en.roll_number,
    s.status,
    s.submitted_at,
    s.note,
    s.marks_obtained,
    s.max_marks,
    s.feedback,
    (select count(*)::integer from public.homework_files f where f.submission_id = s.id),
    -- Late is derived, never stored: the due date can move, and a stored flag
    -- would then be a fact about a deadline that no longer exists.
    (s.submitted_at is not null and s.submitted_at::date > h.due_on)
  from public.homework_submissions s
  join public.homework h on h.id = s.homework_id
  join public.students st on st.id = s.student_id
  join public.people p on p.id = st.person_id
  left join public.enrolments en
    on en.student_id = s.student_id and en.session_id = h.session_id and en.status = 'active'
  where s.homework_id = p_homework_id
  order by en.roll_number nulls last, p.first_name
$$;

revoke all on function public.homework_submission_sheet(uuid) from public, anon;
grant execute on function public.homework_submission_sheet(uuid) to authenticated;

-- What a child (or their parent) sees: everything set to them, with where they
-- have got to. `p_student_id` defaults to the caller's own record, so a student
-- passes nothing and cannot point this at a classmate.
create or replace function public.homework_for_student(
  p_student_id uuid default null,
  p_include_done boolean default true
)
returns table (
  homework_id uuid,
  submission_id uuid,
  title text,
  instructions text,
  subject_name text,
  subject_code text,
  section_label text,
  assigned_on date,
  due_on date,
  collects_submissions boolean,
  status text,
  submitted_at timestamptz,
  marks_obtained numeric,
  max_marks numeric,
  feedback text,
  attachment_count integer,
  submission_file_count integer,
  is_overdue boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with target as (
    select coalesce(
      p_student_id,
      ( select up.student_id from public.user_profiles up where up.id = ( select auth.uid() ) )
    ) as student_id
  )
  select
    h.id,
    s.id,
    h.title,
    h.instructions,
    sub.name,
    sub.code,
    (cl.name || ' ' || sec.name)::text,
    h.assigned_on,
    h.due_on,
    h.collects_submissions,
    coalesce(s.status, 'pending'),
    s.submitted_at,
    s.marks_obtained,
    s.max_marks,
    s.feedback,
    (select count(*)::integer from public.homework_files f where f.homework_id = h.id),
    (select count(*)::integer from public.homework_files f where f.submission_id = s.id),
    (h.due_on < current_date and coalesce(s.status, 'pending') = 'pending' and h.collects_submissions)
  from public.homework h
  cross join target t
  join public.subjects sub on sub.id = h.subject_id
  join public.sections sec on sec.id = h.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  join public.enrolments en
    on en.student_id = t.student_id
   and en.session_id = h.session_id
   and en.section_id = h.section_id
   and en.status = 'active'
  left join public.homework_submissions s
    on s.homework_id = h.id and s.student_id = t.student_id
  where h.status = 'published'
    and (p_include_done or coalesce(s.status, 'pending') = 'pending')
  order by h.due_on, h.title
$$;

revoke all on function public.homework_for_student(uuid, boolean) from public, anon;
grant execute on function public.homework_for_student(uuid, boolean) to authenticated;
