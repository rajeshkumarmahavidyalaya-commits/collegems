-- 0344: Staff ratings -- the reference's "Staff Rating" (Class, Subject,
-- Teacher, Student Feedback, Average Rating).
--
-- A student rates the teacher of each subject they are taught this year, 1 to
-- 5, with a sentence if they want. One rating per student per subject per
-- teacher per year, which they may change; `section_subjects` (year, class,
-- subject, teacher) is what decides whom they may rate.
--
-- Who writes and who reads, and why each is shaped as it is:
--
--   * A student writes only through `staff_rate`, a narrow definer, and has
--     **no write policy at all** (the homework_submit shape). It takes the
--     section-subject row, checks the caller is a student enrolled in that
--     class this year and that the row has a teacher, and stamps the year,
--     the class, the subject and the teacher from the row -- so a student can
--     rate only a teacher who teaches them, only this year, and cannot choose
--     whom a rating is about. A later migration that tidily "adds the missing
--     student insert policy" would let a student rate any teacher in any year.
--   * A student reads their own ratings (policy), and their own teachers
--     through `staff_rating_my_teachers`, a definer projecting the subject,
--     the teacher's name and their own rating -- the student cannot read
--     `people` for staff, and would otherwise see a blank (0222's lesson).
--   * The administrator reads every rating and may remove one (an abusive
--     sentence); never writes one.
--   * **A teacher reads none**, including their own. Who said what about a
--     teacher, read by that teacher, is a decision for each college and a
--     retaliation risk for the student; the administrator sees the summary.
--     Giving teachers an anonymous average of their own is a later decision,
--     made in a function that projects no student, never a policy.
--
-- `staff_rating_summary` is the reference's list: per class, subject and
-- teacher this year, the number of ratings, how many carry a sentence, and
-- the average. INVOKER over the administrator's policy.

begin;

create table public.staff_ratings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  session_id uuid not null references public.academic_sessions (id),
  section_id uuid not null,
  subject_id uuid not null,
  staff_id uuid not null,
  student_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  feedback text check (feedback is null or length(btrim(feedback)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, student_id, subject_id, staff_id),
  constraint staff_ratings_section_fkey foreign key (tenant_id, section_id)
    references public.sections (tenant_id, id) on delete cascade,
  constraint staff_ratings_subject_fkey foreign key (tenant_id, subject_id)
    references public.subjects (tenant_id, id) on delete cascade,
  constraint staff_ratings_staff_fkey foreign key (tenant_id, staff_id)
    references public.staff (tenant_id, id) on delete cascade,
  constraint staff_ratings_student_fkey foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade
);
create index staff_ratings_summary_idx on public.staff_ratings (tenant_id, session_id, section_id, subject_id, staff_id);
create index staff_ratings_student_idx on public.staff_ratings (student_id);
create index staff_ratings_staff_idx on public.staff_ratings (staff_id);
create index staff_ratings_subject_idx on public.staff_ratings (subject_id);
create index staff_ratings_section_idx on public.staff_ratings (section_id);
create index staff_ratings_session_idx on public.staff_ratings (session_id);

comment on table public.staff_ratings is
  'A student''s rating (1-5) and feedback for the teacher of a subject they are taught, one per year. Students write through staff_rate only; teachers read none (0344).';

create trigger set_updated_at before update on public.staff_ratings
  for each row execute function public.set_updated_at();
create trigger audit_staff_ratings after insert or update or delete on public.staff_ratings
  for each row execute function public.audit_row_change();

alter table public.staff_ratings enable row level security;

create policy "admins view staff ratings" on public.staff_ratings
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');
-- The administrator may take an abusive rating down; nobody edits one.
create policy "admins remove staff ratings" on public.staff_ratings
  for delete to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');
create policy "students view their own ratings" on public.staff_ratings
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and student_id in (
      select up.student_id from public.user_profiles up
      where up.id = (select auth.uid()) and up.student_id is not null
    )
  );
-- No INSERT or UPDATE policy for anybody, deliberately: a student writes
-- through staff_rate, which decides whom the rating is about.

create function public.staff_rate(p_section_subject_id uuid, p_rating integer, p_feedback text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_student uuid;
  v_ss public.section_subjects;
  v_feedback text := nullif(btrim(coalesce(p_feedback, '')), '');
  v_id uuid;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  -- Tenant by hand in every read: no policy runs in here.
  select up.student_id into v_student from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant;
  if v_student is null then
    raise exception 'Only a student rates their teachers.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'A rating is from 1 to 5.' using errcode = '22023';
  end if;
  if v_feedback is not null and length(v_feedback) > 1000 then
    raise exception 'Feedback is at most 1,000 characters.' using errcode = '22023';
  end if;

  select ss.* into v_ss from public.section_subjects ss
  where ss.id = p_section_subject_id and ss.tenant_id = v_tenant;
  if v_ss.id is null
     or v_ss.session_id is distinct from (
       select s.id from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current)
     or not exists (
       select 1 from public.enrolments e
       where e.tenant_id = v_tenant and e.student_id = v_student
         and e.section_id = v_ss.section_id and e.session_id = v_ss.session_id
         and e.status = 'active')
  then
    raise exception 'You can rate only the teachers of your own class this year.' using errcode = '42501';
  end if;
  if v_ss.teacher_staff_id is null then
    raise exception 'This subject has no teacher yet, so there is nobody to rate.' using errcode = '22023';
  end if;

  insert into public.staff_ratings
    (tenant_id, session_id, section_id, subject_id, staff_id, student_id, rating, feedback)
  values
    (v_tenant, v_ss.session_id, v_ss.section_id, v_ss.subject_id, v_ss.teacher_staff_id, v_student, p_rating, v_feedback)
  on conflict (tenant_id, session_id, student_id, subject_id, staff_id)
  do update set rating = excluded.rating, feedback = excluded.feedback
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'rating', p_rating);
end;
$$;

comment on function public.staff_rate(uuid, integer, text) is
  'A student rates the teacher of a subject in their own class this year, or changes their rating. DEFINER because students have no write policy on staff_ratings, on purpose; the year, class, subject and teacher come from the section_subjects row, never from the caller (0344).';

create function public.staff_rating_my_teachers()
returns table (
  section_subject_id uuid,
  subject_name text,
  teacher_name text,
  rating smallint,
  feedback text,
  rated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_student uuid;
  v_session uuid;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  select up.student_id into v_student from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant;
  if v_student is null then
    raise exception 'Only a student rates their teachers.' using errcode = '42501';
  end if;
  select s.id into v_session from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current;

  return query
    select ss.id,
           sub.name,
           nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
           r.rating,
           r.feedback,
           r.updated_at
    from public.enrolments e
    join public.section_subjects ss
      on ss.tenant_id = v_tenant and ss.section_id = e.section_id and ss.session_id = e.session_id
    join public.subjects sub on sub.id = ss.subject_id and sub.tenant_id = v_tenant
    left join public.staff st on st.id = ss.teacher_staff_id and st.tenant_id = v_tenant
    left join public.people p on p.id = st.person_id and p.tenant_id = v_tenant
    left join public.staff_ratings r
      on r.tenant_id = v_tenant and r.session_id = ss.session_id and r.student_id = v_student
     and r.subject_id = ss.subject_id and r.staff_id = ss.teacher_staff_id
    where e.tenant_id = v_tenant and e.student_id = v_student
      and e.session_id = v_session and e.status = 'active'
      and ss.teacher_staff_id is not null
    order by sub.name, ss.id;
end;
$$;

comment on function public.staff_rating_my_teachers() is
  'The calling student''s subjects this year with each teacher''s name and the student''s own rating. DEFINER: a student cannot read people for staff; projects nothing about anybody else (0344).';

revoke all on function public.staff_rate(uuid, integer, text) from public, anon;
revoke all on function public.staff_rating_my_teachers() from public, anon;
grant execute on function public.staff_rate(uuid, integer, text) to authenticated;
grant execute on function public.staff_rating_my_teachers() to authenticated;

create function public.staff_rating_summary()
returns table (
  section_id uuid,
  subject_id uuid,
  staff_id uuid,
  class_name text,
  section_name text,
  subject_name text,
  teacher_name text,
  ratings bigint,
  with_feedback bigint,
  average_rating numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select r.section_id, r.subject_id, r.staff_id,
         cl.name, sec.name, sub.name,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
         count(*), count(r.feedback), round(avg(r.rating), 2)
  from public.staff_ratings r
  join public.sections sec on sec.id = r.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  join public.subjects sub on sub.id = r.subject_id
  left join public.staff st on st.id = r.staff_id
  left join public.people p on p.id = st.person_id
  where r.session_id = public.current_session_id(public.current_tenant_id())
  group by r.section_id, r.subject_id, r.staff_id, cl.name, cl.sequence, sec.name, sub.name, p.first_name, p.last_name
  order by cl.sequence, sec.name, sub.name, r.staff_id;
$$;

comment on function public.staff_rating_summary() is
  'This year''s ratings per class, subject and teacher: how many, how many with a sentence, and the average. INVOKER over the administrator''s policy, so it answers nobody else (0344).';

commit;
