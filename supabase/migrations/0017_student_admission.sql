-- Students module: atomic admission and update.
--
-- Admitting a student writes three rows -- people (the human), students (the
-- role they hold), and enrolments (their place this session). supabase-js
-- cannot open a transaction, so doing that as three client calls can leave a
-- person with no student record, or a student with no enrolment, if anything
-- fails midway. One function instead, per docs/modules/library.md.
--
-- SECURITY INVOKER (the default): these run as the calling admin, so the RLS
-- policies on people/students/enrolments still decide whether the write is
-- allowed. The function only adds atomicity, never privilege.

create or replace function public.admit_student(
  p_person jsonb,
  p_admission_number text,
  p_admission_date date default current_date,
  p_section_id uuid default null,
  p_roll_number text default null
)
returns public.students
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_person_id uuid;
  v_student public.students;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  insert into public.people (
    tenant_id, first_name, middle_name, last_name, date_of_birth, gender,
    blood_group, email, phone, address_line1, address_line2, city, state,
    postal_code, country
  )
  values (
    v_tenant_id,
    p_person ->> 'first_name',
    nullif(trim(coalesce(p_person ->> 'middle_name', '')), ''),
    p_person ->> 'last_name',
    (nullif(trim(coalesce(p_person ->> 'date_of_birth', '')), ''))::date,
    nullif(trim(coalesce(p_person ->> 'gender', '')), ''),
    nullif(trim(coalesce(p_person ->> 'blood_group', '')), ''),
    nullif(trim(coalesce(p_person ->> 'email', '')), '')::citext,
    nullif(trim(coalesce(p_person ->> 'phone', '')), ''),
    nullif(trim(coalesce(p_person ->> 'address_line1', '')), ''),
    nullif(trim(coalesce(p_person ->> 'address_line2', '')), ''),
    nullif(trim(coalesce(p_person ->> 'city', '')), ''),
    nullif(trim(coalesce(p_person ->> 'state', '')), ''),
    nullif(trim(coalesce(p_person ->> 'postal_code', '')), ''),
    coalesce(nullif(trim(coalesce(p_person ->> 'country', '')), ''), 'India')
  )
  returning id into v_person_id;

  insert into public.students (tenant_id, person_id, admission_number, admission_date, status)
  values (v_tenant_id, v_person_id, p_admission_number, coalesce(p_admission_date, current_date), 'active')
  returning * into v_student;

  -- Enrolment is optional at admission: a student can be admitted before a
  -- section is decided. The session is resolved here, never sent by the client.
  if p_section_id is not null then
    v_session_id := public.current_session_id(v_tenant_id);
    if v_session_id is null then
      raise exception 'No current academic session for this tenant';
    end if;

    insert into public.enrolments (tenant_id, session_id, student_id, section_id, roll_number, status)
    values (v_tenant_id, v_session_id, v_student.id, p_section_id,
            nullif(trim(coalesce(p_roll_number, '')), ''), 'active');
  end if;

  return v_student;
end;
$$;

create or replace function public.update_student(
  p_student_id uuid,
  p_person jsonb,
  p_admission_number text,
  p_admission_date date,
  p_status text,
  p_section_id uuid default null,
  p_roll_number text default null
)
returns public.students
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_person_id uuid;
  v_student public.students;
begin
  select * into v_student from public.students
  where id = p_student_id and tenant_id = v_tenant_id
  for update;

  if v_student.id is null then
    raise exception 'Student not found';
  end if;

  v_person_id := v_student.person_id;

  update public.people set
    first_name = p_person ->> 'first_name',
    middle_name = nullif(trim(coalesce(p_person ->> 'middle_name', '')), ''),
    last_name = p_person ->> 'last_name',
    date_of_birth = (nullif(trim(coalesce(p_person ->> 'date_of_birth', '')), ''))::date,
    gender = nullif(trim(coalesce(p_person ->> 'gender', '')), ''),
    blood_group = nullif(trim(coalesce(p_person ->> 'blood_group', '')), ''),
    email = nullif(trim(coalesce(p_person ->> 'email', '')), '')::citext,
    phone = nullif(trim(coalesce(p_person ->> 'phone', '')), ''),
    address_line1 = nullif(trim(coalesce(p_person ->> 'address_line1', '')), ''),
    address_line2 = nullif(trim(coalesce(p_person ->> 'address_line2', '')), ''),
    city = nullif(trim(coalesce(p_person ->> 'city', '')), ''),
    state = nullif(trim(coalesce(p_person ->> 'state', '')), ''),
    postal_code = nullif(trim(coalesce(p_person ->> 'postal_code', '')), '')
  where id = v_person_id;

  update public.students set
    admission_number = p_admission_number,
    admission_date = coalesce(p_admission_date, admission_date),
    status = coalesce(nullif(trim(coalesce(p_status, '')), ''), status)
  where id = p_student_id
  returning * into v_student;

  -- Moving a student between sections updates this session's enrolment
  -- rather than creating a second one -- the (tenant, session, student)
  -- unique index means one enrolment per year, by design.
  if p_section_id is not null then
    v_session_id := public.current_session_id(v_tenant_id);
    if v_session_id is null then
      raise exception 'No current academic session for this tenant';
    end if;

    insert into public.enrolments (tenant_id, session_id, student_id, section_id, roll_number, status)
    values (v_tenant_id, v_session_id, p_student_id, p_section_id,
            nullif(trim(coalesce(p_roll_number, '')), ''), 'active')
    on conflict (tenant_id, session_id, student_id) do update
      set section_id = excluded.section_id,
          roll_number = excluded.roll_number;
  end if;

  return v_student;
end;
$$;

revoke all on function public.admit_student(jsonb, text, date, uuid, text) from public, anon;
grant execute on function public.admit_student(jsonb, text, date, uuid, text) to authenticated;
revoke all on function public.update_student(uuid, jsonb, text, date, text, uuid, text) from public, anon;
grant execute on function public.update_student(uuid, jsonb, text, date, text, uuid, text) to authenticated;
