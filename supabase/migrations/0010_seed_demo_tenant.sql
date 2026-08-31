-- Demo tenant seed: one tenant, one current session, standard roles +
-- permission matrix, 6 grade levels x 2 sections, teaching/support staff,
-- and ~300 students with guardians and current-session enrolments.
-- Generated programmatically (not hand-written rows) so it's reproducible
-- and easy to re-run against a fresh project. Contains no credentials --
-- the demo admin login is created separately, outside version control.

do $$
declare
  v_tenant_id uuid;
  v_session_id uuid;
  v_admin_role_id uuid;
  v_teacher_role_id uuid;
  v_student_role_id uuid;
  v_parent_role_id uuid;
  v_accountant_role_id uuid;
  v_librarian_role_id uuid;

  male_first text[] := array['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan','Rohan','Karan','Aryan','Dhruv','Kabir','Rudra','Yash','Om','Shaurya','Atharv','Devansh','Harsh','Kunal','Manav','Nikhil'];
  female_first text[] := array['Ananya','Diya','Saanvi','Aadhya','Kiara','Myra','Anika','Navya','Ira','Sara','Riya','Pari','Aditi','Ishita','Meera','Tara','Zara','Anaya','Kavya','Siya','Priya','Nisha','Pooja','Simran','Tanvi'];
  surnames text[] := array['Sharma','Verma','Gupta','Singh','Kumar','Yadav','Mishra','Pandey','Tiwari','Chauhan','Rathore','Joshi','Agarwal','Bansal','Saxena','Rai','Chaudhary','Dubey','Tripathi','Srivastava'];
  cities text[] := array['Lucknow','Kanpur','Varanasi','Prayagraj','Agra','Meerut','Gorakhpur','Bareilly'];
  blood_groups text[] := array['A+','A-','B+','B-','AB+','AB-','O+','O-'];
  grade_names text[] := array['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'];
  teacher_designations text[] := array['Primary Teacher','TGT','PGT','Subject Teacher'];

  v_class_level_id uuid;
  v_person_id uuid;
  v_staff_id uuid;
  v_guardian_id uuid;
  v_student_id uuid;
  v_section_id uuid;

  grade_seq int;
  letter text;
  i int;
  n int;
  fname text;
  lname text;
  gender text;
  dob date;
  admission_no text;
  employee_no text;

  guardian_count int;
  guardian_relationship text;
  guardian_gender text;
  guardian_fname text;

  target_section record;
begin
  ------------------------------------------------------------------
  -- Tenant, session, roles
  ------------------------------------------------------------------
  insert into public.tenants (name, slug, timezone)
  values ('Rajesh Kumar Mahavidyalaya', 'rajesh-kumar-mahavidyalaya', 'Asia/Kolkata')
  returning id into v_tenant_id;

  insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
  values (v_tenant_id, '2025-2026', date '2025-04-01', date '2026-03-31', true)
  returning id into v_session_id;

  insert into public.roles (tenant_id, code, name) values
    (v_tenant_id, 'admin', 'Administrator'),
    (v_tenant_id, 'teacher', 'Teacher'),
    (v_tenant_id, 'student', 'Student'),
    (v_tenant_id, 'parent', 'Parent'),
    (v_tenant_id, 'accountant', 'Accountant'),
    (v_tenant_id, 'librarian', 'Librarian');

  select id into v_admin_role_id from public.roles where tenant_id = v_tenant_id and code = 'admin';
  select id into v_teacher_role_id from public.roles where tenant_id = v_tenant_id and code = 'teacher';
  select id into v_student_role_id from public.roles where tenant_id = v_tenant_id and code = 'student';
  select id into v_parent_role_id from public.roles where tenant_id = v_tenant_id and code = 'parent';
  select id into v_accountant_role_id from public.roles where tenant_id = v_tenant_id and code = 'accountant';
  select id into v_librarian_role_id from public.roles where tenant_id = v_tenant_id and code = 'librarian';

  -- Permission matrix: admin gets everything; other roles get a sensible subset.
  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_admin_role_id, code from reference.permissions;

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_teacher_role_id, code from reference.permissions
  where code in (
    'students.view', 'guardians.view', 'academics.view',
    'attendance.view', 'attendance.mark', 'exams.view', 'exams.grade',
    'homework.view', 'homework.manage', 'library.view', 'reports.view'
  );

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_accountant_role_id, code from reference.permissions
  where code in ('students.view', 'fees.view', 'fees.collect', 'reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_librarian_role_id, code from reference.permissions
  where code in ('students.view', 'library.view', 'library.manage', 'library.issue', 'library.return', 'reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_student_role_id, code from reference.permissions
  where code in ('homework.view', 'library.view', 'exams.view', 'attendance.view', 'fees.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant_id, v_parent_role_id, code from reference.permissions
  where code in ('homework.view', 'library.view', 'exams.view', 'attendance.view', 'fees.view');

  ------------------------------------------------------------------
  -- Tenant defaults
  ------------------------------------------------------------------
  insert into public.settings (tenant_id, key, value) values
    (v_tenant_id, 'currency', '"INR"'::jsonb),
    (v_tenant_id, 'academic_year_start_month', '4'::jsonb),
    (v_tenant_id, 'contact_email', '"info@rajeshkumarmahavidyalaya.example"'::jsonb);

  ------------------------------------------------------------------
  -- Class levels + sections (6 grades x 2 sections = 12 sections)
  ------------------------------------------------------------------
  create temporary table tmp_sections (
    id uuid primary key,
    grade_seq int not null,
    letter text not null,
    headcount int not null default 0
  ) on commit drop;

  for grade_seq in 1..6 loop
    insert into public.class_levels (tenant_id, name, sequence)
    values (v_tenant_id, grade_names[grade_seq], grade_seq)
    returning id into v_class_level_id;

    foreach letter in array array['A', 'B'] loop
      insert into public.sections (tenant_id, class_level_id, session_id, name, capacity)
      values (v_tenant_id, v_class_level_id, v_session_id, letter, 40)
      returning id into v_section_id;

      insert into tmp_sections (id, grade_seq, letter) values (v_section_id, grade_seq, letter);
    end loop;
  end loop;

  ------------------------------------------------------------------
  -- Staff: 1 admin/principal, 1 accountant, 1 librarian, 12 class teachers
  ------------------------------------------------------------------
  n := 0;

  -- Admin / principal (this becomes the demo login).
  n := n + 1;
  insert into public.people (tenant_id, first_name, last_name, date_of_birth, gender, email, phone, city, state, country)
  values (v_tenant_id, 'Rajesh', 'Kumar', date '1978-03-14', 'male', 'rajeshkumarmahavidyalaya@gmail.com', '+919415000001', 'Lucknow', 'Uttar Pradesh', 'India')
  returning id into v_person_id;

  employee_no := 'EMP-' || lpad(n::text, 3, '0');
  insert into public.staff (tenant_id, person_id, employee_code, designation, department, date_of_joining, status)
  values (v_tenant_id, v_person_id, employee_no, 'Principal / System Administrator', 'Administration', date '2015-06-01', 'active')
  returning id into v_staff_id;

  -- Accountant
  n := n + 1;
  fname := female_first[1 + (n % array_length(female_first, 1))];
  lname := surnames[1 + (n % array_length(surnames, 1))];
  insert into public.people (tenant_id, first_name, last_name, date_of_birth, gender, email, phone, city, state, country)
  values (v_tenant_id, fname, lname, date '1985-07-22', 'female', lower(fname || '.' || lname || '@rajeshkumarmahavidyalaya.example'), '+9194150000' || lpad(n::text, 2, '0'), 'Lucknow', 'Uttar Pradesh', 'India')
  returning id into v_person_id;

  employee_no := 'EMP-' || lpad(n::text, 3, '0');
  insert into public.staff (tenant_id, person_id, employee_code, designation, department, date_of_joining, status)
  values (v_tenant_id, v_person_id, employee_no, 'Accountant', 'Accounts', date '2018-06-01', 'active');

  -- Librarian
  n := n + 1;
  fname := male_first[1 + (n % array_length(male_first, 1))];
  lname := surnames[1 + (n % array_length(surnames, 1))];
  insert into public.people (tenant_id, first_name, last_name, date_of_birth, gender, email, phone, city, state, country)
  values (v_tenant_id, fname, lname, date '1988-01-10', 'male', lower(fname || '.' || lname || '@rajeshkumarmahavidyalaya.example'), '+9194150000' || lpad(n::text, 2, '0'), 'Lucknow', 'Uttar Pradesh', 'India')
  returning id into v_person_id;

  employee_no := 'EMP-' || lpad(n::text, 3, '0');
  insert into public.staff (tenant_id, person_id, employee_code, designation, department, date_of_joining, status)
  values (v_tenant_id, v_person_id, employee_no, 'Librarian', 'Library', date '2019-06-01', 'active');

  -- One class teacher per section.
  for target_section in select * from tmp_sections order by grade_seq, letter loop
    n := n + 1;
    if n % 2 = 0 then
      gender := 'female';
      fname := female_first[1 + (n % array_length(female_first, 1))];
    else
      gender := 'male';
      fname := male_first[1 + (n % array_length(male_first, 1))];
    end if;
    lname := surnames[1 + (n % array_length(surnames, 1))];

    insert into public.people (tenant_id, first_name, last_name, date_of_birth, gender, email, phone, city, state, country)
    values (
      v_tenant_id, fname, lname,
      current_date - ((25 + (n % 15)) * interval '1 year'),
      gender,
      lower(fname || '.' || lname || n || '@rajeshkumarmahavidyalaya.example'),
      '+9194150000' || lpad(n::text, 2, '0'),
      cities[1 + (n % array_length(cities, 1))], 'Uttar Pradesh', 'India'
    )
    returning id into v_person_id;

    employee_no := 'EMP-' || lpad(n::text, 3, '0');
    insert into public.staff (tenant_id, person_id, employee_code, designation, department, date_of_joining, status)
    values (v_tenant_id, v_person_id, employee_no, teacher_designations[1 + (n % array_length(teacher_designations, 1))], grade_names[target_section.grade_seq], date '2020-06-01', 'active')
    returning id into v_staff_id;

    update public.sections set class_teacher_staff_id = v_staff_id where id = target_section.id;
  end loop;

  ------------------------------------------------------------------
  -- ~300 students, round-robined across the 12 sections (25 each),
  -- each with 1-2 guardians.
  ------------------------------------------------------------------
  for i in 1..300 loop
    select * into target_section from tmp_sections order by headcount asc, grade_seq, letter limit 1;

    if i % 2 = 0 then
      gender := 'female';
      fname := female_first[1 + (i % array_length(female_first, 1))];
    else
      gender := 'male';
      fname := male_first[1 + (i % array_length(male_first, 1))];
    end if;
    lname := surnames[1 + (i % array_length(surnames, 1))];

    -- Age band matches the grade (Grade 1 ~ age 6 ... Grade 6 ~ age 11).
    dob := current_date - ((5 + target_section.grade_seq) * interval '1 year') - ((i % 300) * interval '1 day');

    admission_no := 'SOS-2025-' || lpad(i::text, 4, '0');

    insert into public.people (tenant_id, first_name, last_name, date_of_birth, gender, blood_group, city, state, country)
    values (v_tenant_id, fname, lname, dob, gender, blood_groups[1 + (i % array_length(blood_groups, 1))], cities[1 + (i % array_length(cities, 1))], 'Uttar Pradesh', 'India')
    returning id into v_person_id;

    insert into public.students (tenant_id, person_id, admission_number, admission_date, status)
    values (v_tenant_id, v_person_id, admission_no, date '2025-04-01', 'active')
    returning id into v_student_id;

    insert into public.enrolments (tenant_id, session_id, student_id, section_id, roll_number, status, enrolled_at)
    values (v_tenant_id, v_session_id, v_student_id, target_section.id, lpad((target_section.headcount + 1)::text, 2, '0'), 'active', date '2025-04-01');

    update tmp_sections set headcount = headcount + 1 where id = target_section.id;

    -- Guardians: 85% get father + mother, 15% get a single guardian.
    if (i % 100) < 85 then
      guardian_count := 2;
    else
      guardian_count := 1;
    end if;

    if guardian_count = 2 then
      guardian_fname := male_first[1 + ((i + 3) % array_length(male_first, 1))];
      insert into public.people (tenant_id, first_name, last_name, gender, phone, email, city, state, country)
      values (v_tenant_id, guardian_fname, lname, 'male', '+9198' || lpad(((i * 7) % 100000000)::text, 8, '0'), lower(guardian_fname || '.' || lname || i || '@example.com'), cities[1 + (i % array_length(cities, 1))], 'Uttar Pradesh', 'India')
      returning id into v_person_id;
      insert into public.guardians (tenant_id, person_id, occupation) values (v_tenant_id, v_person_id, 'Private Service') returning id into v_guardian_id;
      insert into public.guardian_student (tenant_id, guardian_id, student_id, relationship, is_primary, can_pickup)
      values (v_tenant_id, v_guardian_id, v_student_id, 'father', true, true);

      guardian_fname := female_first[1 + ((i + 5) % array_length(female_first, 1))];
      insert into public.people (tenant_id, first_name, last_name, gender, phone, email, city, state, country)
      values (v_tenant_id, guardian_fname, lname, 'female', '+9197' || lpad(((i * 11) % 100000000)::text, 8, '0'), lower(guardian_fname || '.' || lname || i || '@example.com'), cities[1 + (i % array_length(cities, 1))], 'Uttar Pradesh', 'India')
      returning id into v_person_id;
      insert into public.guardians (tenant_id, person_id, occupation) values (v_tenant_id, v_person_id, 'Homemaker') returning id into v_guardian_id;
      insert into public.guardian_student (tenant_id, guardian_id, student_id, relationship, is_primary, can_pickup)
      values (v_tenant_id, v_guardian_id, v_student_id, 'mother', false, true);
    else
      if i % 2 = 0 then
        guardian_relationship := 'mother';
        guardian_gender := 'female';
        guardian_fname := female_first[1 + ((i + 5) % array_length(female_first, 1))];
      else
        guardian_relationship := 'father';
        guardian_gender := 'male';
        guardian_fname := male_first[1 + ((i + 3) % array_length(male_first, 1))];
      end if;
      insert into public.people (tenant_id, first_name, last_name, gender, phone, email, city, state, country)
      values (v_tenant_id, guardian_fname, lname, guardian_gender, '+9196' || lpad(((i * 13) % 100000000)::text, 8, '0'), lower(guardian_fname || '.' || lname || i || '@example.com'), cities[1 + (i % array_length(cities, 1))], 'Uttar Pradesh', 'India')
      returning id into v_person_id;
      insert into public.guardians (tenant_id, person_id, occupation) values (v_tenant_id, v_person_id, 'Self-employed') returning id into v_guardian_id;
      insert into public.guardian_student (tenant_id, guardian_id, student_id, relationship, is_primary, can_pickup)
      values (v_tenant_id, v_guardian_id, v_student_id, guardian_relationship, true, true);
    end if;
  end loop;

  ------------------------------------------------------------------
  -- Pending invitation for the demo admin login (see 0005's
  -- handle_new_auth_user trigger). The matching auth.users row is
  -- created separately, outside version control, with a generated password.
  ------------------------------------------------------------------
  insert into public.invitations (tenant_id, email, role_id, staff_id, status)
  select v_tenant_id, 'rajeshkumarmahavidyalaya@gmail.com', v_admin_role_id, s.id, 'pending'
  from public.staff s
  where s.tenant_id = v_tenant_id and s.employee_code = 'EMP-001';

  raise notice 'Seeded tenant % with session %', v_tenant_id, v_session_id;
end;
$$;
