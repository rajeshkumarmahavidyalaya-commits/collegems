-- 0329: Attendance by month and attendance by subject.
--
-- The reference's View Attendance asks two questions of a class: by month
-- (Class, Section or All Sections, Month) and by subject (the same, and a
-- subject). This product could answer neither from the screen an
-- administrator reaches: its attendance report read one class and a date
-- range, and nothing recorded attendance per subject at all.
--
-- 1. A subject register is its own table, `subject_attendance_records`, not
--    a column on `attendance_records`. Twelve functions read the daily
--    register as one row per child per day -- the dashboard, the coverage
--    report, the evening absence notice, the report card's attendance line
--    -- and a subject row beside it would be counted by every one of them as
--    a second day. A lecture register is a different observation (rule 12:
--    a record of an observation is written only by the act of observing), so
--    it gets its own rows, and the daily register means what it meant.
--
-- 2. Who may take it is the one place it differs from the daily register.
--    The daily register is the class teacher's, and RLS says so. A subject
--    is taught by the teacher on section_subjects, who may not be the class
--    teacher and may read no enrolment in that class (0304: a subject
--    teacher reads roll 25, sheet 0). So the table has read policies only and
--    the write is `mark_subject_attendance`, a definer that answers only an
--    administrator, the class teacher or the teacher of that subject in that
--    class, filters by tenant by hand, and resolves the year by tenant by
--    hand (0273: academics_session_for_date relies on RLS, and inside a
--    definer it would answer with any college's year). The absence of a
--    write policy is the mechanism; do not add one.
--
-- 3. `attendance_month_sheet` is the by-month question over the daily
--    register: one row per child, the month's marks keyed by day, and the
--    four totals. INVOKER, so a class teacher sees their own class and an
--    administrator every class, by the same policies on enrolments and on
--    attendance_records -- both sides narrowed by the same policy, which is
--    what makes the sheet honest (0201). Gated on attendance.view inside.
--
-- 4. `attendance_subject_month_sheet` is the by-subject question, and it is
--    a definer for the reason in 2: the person most likely to ask it is a
--    subject teacher, who can read neither the roll nor (through RLS) the
--    names. It answers, for each section asked about, only a caller who
--    could take that register, and refuses in a sentence when none
--    qualifies, rather than returning an empty sheet that reads like a class
--    nobody missed.

begin;

-- ---------------------------------------------------------------------------
-- 1. The subject register

create table public.subject_attendance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  session_id uuid not null references public.academic_sessions (id),
  section_id uuid not null,
  subject_id uuid not null,
  enrolment_id uuid not null,
  attendance_date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'excused')),
  note text check (note is null or length(note) <= 500),
  marked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subject_attendance_section_fkey foreign key (tenant_id, section_id)
    references public.sections (tenant_id, id),
  constraint subject_attendance_subject_fkey foreign key (tenant_id, subject_id)
    references public.subjects (tenant_id, id),
  constraint subject_attendance_enrolment_fkey foreign key (tenant_id, enrolment_id)
    references public.enrolments (tenant_id, id),
  unique (tenant_id, section_id, subject_id, attendance_date, enrolment_id)
);

create index subject_attendance_enrolment_idx on public.subject_attendance_records (enrolment_id);
create index subject_attendance_session_idx on public.subject_attendance_records (session_id);

comment on table public.subject_attendance_records is
  'One child''s attendance in one subject''s class on one day (0329). Separate from attendance_records, the daily register, so nothing that counts days counts a lecture. Written only by mark_subject_attendance.';

create trigger set_updated_at before update on public.subject_attendance_records
  for each row execute function public.set_updated_at();
create trigger audit_subject_attendance_records after insert or update or delete on public.subject_attendance_records
  for each row execute function public.audit_row_change();

alter table public.subject_attendance_records enable row level security;

-- Read policies only. Every write is mark_subject_attendance, because the
-- subject teacher cannot read the enrolments a write policy would test.
create policy "staff roles view subject attendance" on public.subject_attendance_records
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = any (array['admin', 'accountant']));

create policy "teachers view subject attendance they take" on public.subject_attendance_records
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'teacher'
         and exists (
           select 1
           from public.user_profiles up
           join public.sections s on s.id = subject_attendance_records.section_id
           where up.id = (select auth.uid())
             and up.staff_id is not null
             and (s.class_teacher_staff_id = up.staff_id
                  or exists (
                    select 1 from public.section_subjects ss
                    where ss.section_id = subject_attendance_records.section_id
                      and ss.subject_id = subject_attendance_records.subject_id
                      and ss.session_id = subject_attendance_records.session_id
                      and ss.teacher_staff_id = up.staff_id))));

create policy "parents view own children subject attendance" on public.subject_attendance_records
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'parent'
         and enrolment_id in (
           select e.id
           from public.enrolments e
           join public.guardian_student gs on gs.student_id = e.student_id
           join public.user_profiles up on up.guardian_id = gs.guardian_id
           where up.id = (select auth.uid())));

create policy "students view own subject attendance" on public.subject_attendance_records
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'student'
         and enrolment_id in (
           select e.id from public.enrolments e
           where e.student_id = (select up.student_id from public.user_profiles up where up.id = (select auth.uid()))));

-- Whether the caller may take, or read, one subject's register in one
-- section: an administrator, the class teacher, or the subject's teacher
-- there. Internal to the two definers below; nobody holding a JWT calls it.
create or replace function public.subject_register_may(p_tenant uuid, p_section_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.current_role_code() = 'admin'
      or exists (
        select 1
        from public.user_profiles up
        join public.sections s on s.id = p_section_id and s.tenant_id = p_tenant
        where up.id = auth.uid()
          and up.tenant_id = p_tenant
          and up.staff_id is not null
          and (s.class_teacher_staff_id = up.staff_id
               or exists (
                 select 1 from public.section_subjects ss
                 where ss.tenant_id = p_tenant
                   and ss.section_id = s.id
                   and ss.session_id = s.session_id
                   and ss.subject_id = p_subject_id
                   and ss.teacher_staff_id = up.staff_id)))
$$;

revoke all on function public.subject_register_may(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.mark_subject_attendance(
  p_section_id uuid,
  p_subject_id uuid,
  p_date date,
  p_entries jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_section public.sections;
  v_subject text;
  v_year uuid;
  v_year_name text;
  v_class_year text;
  v_bad text;
  v_written integer;
begin
  if v_tenant is null then
    raise exception 'No tenant in session' using errcode = '42501';
  end if;
  if p_date is null or p_date > current_date then
    raise exception 'Cannot mark attendance for a future date.';
  end if;

  -- Tenant by hand in every read: no policy runs in here.
  select * into v_section from public.sections s where s.id = p_section_id and s.tenant_id = v_tenant;
  if v_section.id is null then
    raise exception 'That class cannot be found.';
  end if;
  select sub.name into v_subject from public.subjects sub where sub.id = p_subject_id and sub.tenant_id = v_tenant;
  if v_subject is null then
    raise exception 'That subject cannot be found.';
  end if;
  if not exists (
    select 1 from public.section_subjects ss
    where ss.tenant_id = v_tenant and ss.section_id = v_section.id
      and ss.session_id = v_section.session_id and ss.subject_id = p_subject_id
  ) then
    raise exception '% is not taught in this class this year. Add it to the class under Subjects first.', v_subject;
  end if;

  if not public.subject_register_may(v_tenant, v_section.id, p_subject_id) then
    raise exception 'Only an administrator, the class teacher or the teacher of % in this class can take its register.', v_subject
      using errcode = '42501';
  end if;
  if public.current_role_code() <> 'admin' and not public.role_has_permission('attendance.mark') then
    raise exception 'Taking a register needs attendance.mark, which your role does not hold.' using errcode = '42501';
  end if;

  -- The year the date falls in, for this college (0198), by tenant by hand.
  select a.id, a.name into v_year, v_year_name from public.academic_sessions a
  where a.tenant_id = v_tenant and p_date between a.start_date and a.end_date
  limit 1;
  if v_year is null then
    raise exception 'No academic year covers %. Add the year under Academic years, or check the date.', to_char(p_date, 'FMDD Mon YYYY');
  end if;
  if v_year <> v_section.session_id then
    select a.name into v_class_year from public.academic_sessions a where a.id = v_section.session_id;
    raise exception '% falls in %, and this class belongs to %. Choose this year''s class, or check the date.',
      to_char(p_date, 'FMDD Mon YYYY'), v_year_name, v_class_year;
  end if;

  select string_agg(distinct coalesce(e ->> 'status', 'nothing'), ', ')
  into v_bad
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  where coalesce(e ->> 'status', '') not in ('present', 'absent', 'late', 'excused');
  if v_bad is not null then
    raise exception 'A mark is present, absent, late or excused, not %.', v_bad using errcode = '22023';
  end if;

  with entries as (
    select (e ->> 'enrolment_id')::uuid as enrolment_id,
           e ->> 'status' as status,
           nullif(trim(coalesce(e ->> 'note', '')), '') as note
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  ),
  valid as (
    select en.* from entries en
    join public.enrolments enr on enr.id = en.enrolment_id
    where enr.tenant_id = v_tenant
      and enr.section_id = v_section.id
      and enr.session_id = v_section.session_id
  ),
  upserted as (
    insert into public.subject_attendance_records
      (tenant_id, session_id, section_id, subject_id, enrolment_id, attendance_date, status, note, marked_by)
    select v_tenant, v_section.session_id, v_section.id, p_subject_id, v.enrolment_id, p_date, v.status, v.note, auth.uid()
    from valid v
    on conflict (tenant_id, section_id, subject_id, attendance_date, enrolment_id) do update
      set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by
    returning 1
  )
  select count(*) into v_written from upserted;

  return v_written;
end;
$$;

comment on function public.mark_subject_attendance(uuid, uuid, date, jsonb) is
  'Take one subject''s register for one class on one day (0329). Definer: answers an administrator, the class teacher or that subject''s teacher there; tenant and year resolved by hand. Returns rows written.';

revoke all on function public.mark_subject_attendance(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.mark_subject_attendance(uuid, uuid, date, jsonb) to authenticated;

-- One subject's register on one day, with the roll, for the marking screen.
-- Definer for the same reason: a subject teacher cannot read the roll.
create or replace function public.subject_register(p_section_id uuid, p_subject_id uuid, p_date date)
returns table (enrolment_id uuid, student_id uuid, admission_number text, student_name text, roll_number text, status text, note text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_section public.sections;
begin
  if v_tenant is null then
    raise exception 'No tenant in session' using errcode = '42501';
  end if;
  select * into v_section from public.sections s where s.id = p_section_id and s.tenant_id = v_tenant;
  if v_section.id is null then
    raise exception 'That class cannot be found.';
  end if;
  if not public.subject_register_may(v_tenant, v_section.id, p_subject_id) then
    raise exception 'You can take a subject register only for a class you teach.' using errcode = '42501';
  end if;

  return query
    select e.id, e.student_id, st.admission_number,
           trim(p.first_name || ' ' || coalesce(p.last_name, ''))::text,
           e.roll_number, r.status, r.note
    from public.enrolments e
    join public.students st on st.id = e.student_id and st.tenant_id = v_tenant
    join public.people p on p.id = st.person_id and p.tenant_id = v_tenant
    left join public.subject_attendance_records r
      on r.tenant_id = v_tenant and r.enrolment_id = e.id and r.section_id = v_section.id
     and r.subject_id = p_subject_id and r.attendance_date = p_date
    where e.tenant_id = v_tenant
      and e.section_id = v_section.id
      and e.session_id = v_section.session_id
      and e.status = 'active'
    order by e.roll_number nulls last, p.first_name, e.id;
end;
$$;

comment on function public.subject_register(uuid, uuid, date) is
  'One class''s roll with each child''s mark in one subject on one day, for the subject register screen (0329). Definer, answering only somebody who may take that register.';

revoke all on function public.subject_register(uuid, uuid, date) from public, anon;
grant execute on function public.subject_register(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. By month, over the daily register

create or replace function public.attendance_month_sheet(p_class_level_id uuid, p_section_id uuid, p_month date)
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  roll_number text,
  section_name text,
  marks jsonb,
  present integer,
  absent integer,
  late integer,
  excused integer
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_from date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_to date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month - 1 day')::date;
begin
  if public.current_tenant_id() is null then
    raise exception 'No tenant in session' using errcode = '42501';
  end if;
  if not public.role_has_permission('attendance.view') then
    raise exception 'The attendance report needs attendance.view, which your role does not hold.' using errcode = '42501';
  end if;
  if p_class_level_id is null then
    raise exception 'Choose a class.' using errcode = '22023';
  end if;

  return query
  with secs as (
    select s.id, s.name
    from public.sections s
    join public.academic_sessions a on a.id = s.session_id
    where s.class_level_id = p_class_level_id
      and (p_section_id is null or s.id = p_section_id)
      and a.start_date <= v_to and a.end_date >= v_from
  ),
  roll as (
    select e.id as enrolment_id, e.student_id, e.roll_number, secs.name as section_name
    from public.enrolments e
    join secs on secs.id = e.section_id
  ),
  marks as (
    select ar.enrolment_id,
           jsonb_object_agg(extract(day from ar.attendance_date)::int::text, ar.status) as m,
           count(*) filter (where ar.status = 'present')::int as p,
           count(*) filter (where ar.status = 'absent')::int as ab,
           count(*) filter (where ar.status = 'late')::int as l,
           count(*) filter (where ar.status = 'excused')::int as ex
    from public.attendance_records ar
    join roll r on r.enrolment_id = ar.enrolment_id
    where ar.attendance_date between v_from and v_to
      and ar.period = 0
    group by ar.enrolment_id
  )
  select r.student_id, st.admission_number,
         trim(p.first_name || ' ' || coalesce(p.last_name, ''))::text,
         r.roll_number, r.section_name,
         coalesce(mk.m, '{}'::jsonb),
         coalesce(mk.p, 0), coalesce(mk.ab, 0), coalesce(mk.l, 0), coalesce(mk.ex, 0)
  from roll r
  join public.students st on st.id = r.student_id
  join public.people p on p.id = st.person_id
  left join marks mk on mk.enrolment_id = r.enrolment_id
  order by r.section_name, r.roll_number nulls last, p.first_name, r.student_id;
end;
$$;

comment on function public.attendance_month_sheet(uuid, uuid, date) is
  'Attendance by month: each child of a class (one section, or all with a null section), the month''s daily marks keyed by day, and the four totals (0329). INVOKER over the daily register''s policies; refuses without attendance.view.';

revoke all on function public.attendance_month_sheet(uuid, uuid, date) from public, anon;
grant execute on function public.attendance_month_sheet(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. By subject

create or replace function public.attendance_subject_month_sheet(
  p_class_level_id uuid,
  p_section_id uuid,
  p_subject_id uuid,
  p_month date
)
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  roll_number text,
  section_name text,
  marks jsonb,
  present integer,
  absent integer,
  late integer,
  excused integer
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_from date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_to date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month - 1 day')::date;
  v_wide boolean;
  v_sections uuid[];
begin
  if v_tenant is null then
    raise exception 'No tenant in session' using errcode = '42501';
  end if;
  if p_class_level_id is null or p_subject_id is null then
    raise exception 'Choose a class and a subject.' using errcode = '22023';
  end if;

  -- An administrator or an accountant holding attendance.view reads every
  -- section, as the daily register's policy lets them; anybody else only the
  -- sections whose register they could take.
  v_wide := public.current_role_code() = any (array['admin', 'accountant'])
            and public.role_has_permission('attendance.view');

  select array_agg(s.id)
  into v_sections
  from public.sections s
  join public.academic_sessions a on a.id = s.session_id and a.tenant_id = v_tenant
  where s.tenant_id = v_tenant
    and s.class_level_id = p_class_level_id
    and (p_section_id is null or s.id = p_section_id)
    and a.start_date <= v_to and a.end_date >= v_from
    and (v_wide or public.subject_register_may(v_tenant, s.id, p_subject_id));

  if v_sections is null then
    raise exception 'You can see a subject''s attendance only for a class you teach it in.' using errcode = '42501';
  end if;

  return query
  with roll as (
    select e.id as enrolment_id, e.student_id, e.roll_number, s.name as section_name
    from public.enrolments e
    join public.sections s on s.id = e.section_id and s.tenant_id = v_tenant
    where e.tenant_id = v_tenant
      and e.section_id = any (v_sections)
      and exists (
        select 1 from public.section_subjects ss
        where ss.tenant_id = v_tenant and ss.section_id = e.section_id
          and ss.session_id = e.session_id and ss.subject_id = p_subject_id)
  ),
  marks as (
    select r2.enrolment_id,
           jsonb_object_agg(extract(day from r2.attendance_date)::int::text, r2.status) as m,
           count(*) filter (where r2.status = 'present')::int as p,
           count(*) filter (where r2.status = 'absent')::int as ab,
           count(*) filter (where r2.status = 'late')::int as l,
           count(*) filter (where r2.status = 'excused')::int as ex
    from public.subject_attendance_records r2
    where r2.tenant_id = v_tenant
      and r2.subject_id = p_subject_id
      and r2.section_id = any (v_sections)
      and r2.attendance_date between v_from and v_to
    group by r2.enrolment_id
  )
  select r.student_id, st.admission_number,
         trim(p.first_name || ' ' || coalesce(p.last_name, ''))::text,
         r.roll_number, r.section_name,
         coalesce(mk.m, '{}'::jsonb),
         coalesce(mk.p, 0), coalesce(mk.ab, 0), coalesce(mk.l, 0), coalesce(mk.ex, 0)
  from roll r
  join public.students st on st.id = r.student_id and st.tenant_id = v_tenant
  join public.people p on p.id = st.person_id and p.tenant_id = v_tenant
  left join marks mk on mk.enrolment_id = r.enrolment_id
  order by r.section_name, r.roll_number nulls last, p.first_name, r.student_id;
end;
$$;

comment on function public.attendance_subject_month_sheet(uuid, uuid, uuid, date) is
  'Attendance by subject: each child of a class taking the subject, the month''s subject-register marks keyed by day, and the four totals (0329). Definer, because a subject teacher cannot read the roll; answers only the sections the caller could take that register in, or every section for an administrator or accountant holding attendance.view.';

revoke all on function public.attendance_subject_month_sheet(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.attendance_subject_month_sheet(uuid, uuid, uuid, date) to authenticated;

commit;
