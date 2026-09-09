-- 0194 -- The staff roster: a correct write path nobody could call.
--
-- `staff_exit` was built in `0176`, refined in `0180`, given library and
-- timetable guards in `0191`, and has never been reachable from the
-- application. There is no `/staff` screen at all: no roster, no way to add a
-- member of staff, and no surface for recording that one has left. Everything
-- HR does -- the register, leave, salary, payroll -- is built on top of a table
-- the app can only read in dropdowns.
--
-- Rule 6 already names this failure about the fee counter: *a correct write
-- path nobody can call is not a fix*. The guards `0191` put on
-- `timetable_set_entry` and `substitution_arrange` refuse a member of staff
-- whose status no screen in this product can currently set.
--
-- ---------------------------------------------------------------------------
-- Where the gate is, and why it is not the page
--
-- RLS on `staff` is deliberately role-wide: after `0193` every one of admin,
-- teacher, accountant and librarian may read the employment record. So
-- "an accountant may not open the staff roster" is a rule only
-- `role_permissions` expresses -- and rule 4 says where it is checked:
--
--   > `report_run` checks it *inside the function that produces the data*, not
--   > in the UI.
--
-- `staff_roster` and `staff_record` do the same. A `hasPermission()` call on
-- the page would be a second answer to the question, and would not apply to
-- anybody holding a JWT and calling PostgREST directly.

-- The check itself, which until now has been written out by hand in
-- `report_run`, `dashboard_summary` and `checks_run`. A fourth copy is where a
-- rule quietly starts to differ from itself, so it becomes a function here.
-- The three existing copies are deliberately **not** rewritten in this
-- migration: each is load-bearing authorization, and changing one is a probe of
-- that function's own behaviour as several roles rather than a tidy-up. See
-- `docs/modules/staff.md`.
create or replace function public.role_has_permission(p_code text)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.role_permissions rp
    join public.roles ro on ro.id = rp.role_id
    where rp.tenant_id = ( select public.current_tenant_id() )
      and ro.code = ( select public.current_role_code() )
      and rp.permission_code = p_code
      and rp.allowed
  )
$$;

comment on function public.role_has_permission(text) is
  'Whether the calling role holds a permission in the matrix. SECURITY INVOKER '
  'and read through RLS, like every other read here. The matrix gates what a '
  'role may *do*; RLS still decides which rows they see, and neither stands in '
  'for the other.';

revoke all on function public.role_has_permission(text) from public, anon;
grant execute on function public.role_has_permission(text) to authenticated;


-- ---------------------------------------------------------------------------
-- The roster.
--
-- Bounded per rule 7 -- 50 rows by default, 200 at most -- with the true total
-- returned alongside, so a page that shows 50 of 15 says which. A school with
-- four hundred staff is a large school; a response with four hundred rows in it
-- is a bug.

create or replace function public.staff_roster(
  p_search text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  staff_id uuid,
  employee_code text,
  full_name text,
  designation text,
  department text,
  date_of_joining date,
  date_of_leaving date,
  status text,
  phone text,
  email text,
  lessons integer,
  class_teacher_of integer,
  total_count bigint
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_limit integer := greatest(least(coalesce(p_limit, 50), 200), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_session_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('staff.view') then
    raise exception 'Your role cannot open the staff list';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);

  -- No `where tenant_id =` anywhere below: this is SECURITY INVOKER, so the
  -- policies on `staff` and `people` are what stop it crossing a tenant.
  return query
  select
    s.id,
    s.employee_code,
    (p.first_name || ' ' || p.last_name)::text,
    s.designation,
    s.department,
    s.date_of_joining,
    s.date_of_leaving,
    s.status,
    p.phone,
    p.email::text,
    ( select count(*)::integer from public.timetable_entries e
      where e.teacher_staff_id = s.id and e.session_id = v_session_id ),
    ( select count(*)::integer from public.sections sec
      where sec.class_teacher_staff_id = s.id ),
    count(*) over ()::bigint
  from public.staff s
  join public.people p on p.id = s.person_id
  where (p_status is null or s.status = p_status)
    and (
      v_search is null
      or s.employee_code ilike '%' || v_search || '%'
      or s.designation ilike '%' || v_search || '%'
      or coalesce(s.department, '') ilike '%' || v_search || '%'
      or (p.first_name || ' ' || p.last_name) ilike '%' || v_search || '%'
    )
  -- A tiebreak on the id, because paging an export over a sort that is not
  -- unique returns an arbitrary slice each time (rule 7).
  order by p.first_name, p.last_name, s.id
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.staff_roster(text, text, integer, integer) from public, anon;
grant execute on function public.staff_roster(text, text, integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- One member of staff, as one document.
--
-- The dashboard's shape (rule 11): a page that would otherwise be six round
-- trips, assembled in Postgres, gated once. Every count here is an aggregate,
-- so the response does not grow with the school.

create or replace function public.staff_record(p_staff_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row record;
  v_doc jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('staff.view') then
    raise exception 'Your role cannot open a staff record';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);

  select s.*, p.first_name, p.middle_name, p.last_name, p.date_of_birth,
         p.gender, p.blood_group, p.email, p.phone, p.address_line1,
         p.address_line2, p.city, p.state, p.postal_code
  into v_row
  from public.staff s
  join public.people p on p.id = s.person_id
  where s.id = p_staff_id;

  if v_row.id is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;

  v_doc := jsonb_build_object(
    'staff', jsonb_build_object(
      'id', v_row.id,
      'employee_code', v_row.employee_code,
      'designation', v_row.designation,
      'department', v_row.department,
      'date_of_joining', v_row.date_of_joining,
      'date_of_leaving', v_row.date_of_leaving,
      'status', v_row.status
    ),
    'person', jsonb_build_object(
      'first_name', v_row.first_name,
      'middle_name', v_row.middle_name,
      'last_name', v_row.last_name,
      'full_name', v_row.first_name || ' ' || v_row.last_name,
      'date_of_birth', v_row.date_of_birth,
      'gender', v_row.gender,
      'blood_group', v_row.blood_group,
      'email', v_row.email,
      'phone', v_row.phone,
      'address_line1', v_row.address_line1,
      'address_line2', v_row.address_line2,
      'city', v_row.city,
      'state', v_row.state,
      'postal_code', v_row.postal_code
    ),
    -- What they are responsible for. A leaver reads zero on all three,
    -- because `staff_exit` unassigned them -- which is the point, and is why
    -- the screen shows the numbers next to the leaving date rather than
    -- instead of it.
    'teaching', jsonb_build_object(
      'lessons', ( select count(*)::integer from public.timetable_entries e
                   where e.teacher_staff_id = p_staff_id
                     and e.session_id = v_session_id ),
      'class_teacher_of', coalesce((
        select jsonb_agg(jsonb_build_object('id', sec.id, 'label', cl.name || ' ' || sec.name)
                         order by cl.sequence, sec.name)
        from public.sections sec
        join public.class_levels cl on cl.id = sec.class_level_id
        where sec.class_teacher_staff_id = p_staff_id
      ), '[]'::jsonb),
      'subjects', ( select count(*)::integer from public.section_subjects ss
                    where ss.teacher_staff_id = p_staff_id )
    ),
    'library', (
      select jsonb_build_object(
        'membership_number', m.membership_number,
        'status', m.status,
        'books_out', ( select count(*)::integer from public.book_issues bi
                       where bi.member_id = m.id and bi.status = 'issued' )
      )
      from public.members m where m.staff_id = p_staff_id limit 1
    ),
    'away_today', public.staff_is_away(current_date, p_staff_id)
  );

  return v_doc;
end;
$$;

revoke all on function public.staff_record(uuid) from public, anon;
grant execute on function public.staff_record(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Adding somebody, and correcting their details.
--
-- Both `SECURITY INVOKER`: `admins manage staff` and `admins manage people` are
-- the enforcement, and the permission check is here for the *message*, as the
-- conventions say. Two tables in one statement is the reason these are
-- functions at all -- supabase-js cannot open a transaction, so a person
-- created and then a staff row that fails leaves an orphan nobody sees.

create or replace function public.staff_admit(
  p_person jsonb,
  p_employee_code text,
  p_designation text,
  p_department text default null,
  p_date_of_joining date default current_date,
  p_person_id uuid default null
)
returns public.staff
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_person_id uuid := p_person_id;
  v_staff public.staff;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('staff.manage') then
    raise exception 'Your role cannot add a member of staff';
  end if;

  if coalesce(length(trim(p_employee_code)), 0) = 0 then
    raise exception 'An employee code is required';
  end if;

  if coalesce(length(trim(p_designation)), 0) = 0 then
    raise exception 'A designation is required -- it is what the payroll and the timetable both read';
  end if;

  -- Rule 5: a person and a member of staff are not the same record. Somebody
  -- who is already a guardian here keeps one `people` row and gains a staff
  -- one, which is what makes "a teacher whose child is in Class 4"
  -- representable rather than duplicated.
  if v_person_id is null then
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
  end if;

  begin
    insert into public.staff (
      tenant_id, person_id, employee_code, designation, department,
      date_of_joining, status
    )
    values (
      v_tenant_id, v_person_id, trim(p_employee_code), trim(p_designation),
      nullif(trim(coalesce(p_department, '')), ''),
      coalesce(p_date_of_joining, current_date), 'active'
    )
    returning * into v_staff;
  exception when unique_violation then
    -- Two different collisions, and telling them apart is the difference
    -- between "pick another code" and "they are already on the staff".
    if exists (select 1 from public.staff s
               where s.tenant_id = v_tenant_id and s.person_id = v_person_id) then
      raise exception 'That person is already on the staff list';
    end if;
    raise exception 'Employee code % is already used by somebody else', trim(p_employee_code);
  end;

  if v_staff.id is null then
    raise exception 'You may not add a member of staff';
  end if;

  return v_staff;
end;
$$;

revoke all on function public.staff_admit(jsonb, text, text, text, date, uuid) from public, anon;
grant execute on function public.staff_admit(jsonb, text, text, text, date, uuid) to authenticated;


create or replace function public.staff_update(
  p_staff_id uuid,
  p_person jsonb,
  p_employee_code text,
  p_designation text,
  p_department text default null,
  p_date_of_joining date default null
)
returns public.staff
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_person_id uuid;
  v_staff public.staff;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('staff.manage') then
    raise exception 'Your role cannot edit a staff record';
  end if;

  select s.person_id into v_person_id from public.staff s where s.id = p_staff_id;
  if v_person_id is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;

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

  begin
    -- `status` and `date_of_leaving` are deliberately not here. Setting the
    -- word alone is the bug `0174` closed for students and `0176` for staff:
    -- an ending is nine relationships, not a flag, so it belongs to
    -- `staff_exit` and to nothing else. An edit form that offered a status
    -- dropdown would be a second way to write it, and the quieter one.
    update public.staff set
      employee_code = trim(p_employee_code),
      designation = trim(p_designation),
      department = nullif(trim(coalesce(p_department, '')), ''),
      date_of_joining = coalesce(p_date_of_joining, date_of_joining)
    where id = p_staff_id
    returning * into v_staff;
  exception when unique_violation then
    raise exception 'Employee code % is already used by somebody else', trim(p_employee_code);
  end;

  if v_staff.id is null then
    raise exception 'You may not edit this staff record';
  end if;

  return v_staff;
end;
$$;

revoke all on function public.staff_update(uuid, jsonb, text, text, text, date) from public, anon;
grant execute on function public.staff_update(uuid, jsonb, text, text, text, date) to authenticated;
