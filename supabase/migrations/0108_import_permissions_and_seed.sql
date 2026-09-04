-- Bulk import: the matrix's half, and a draft waiting to be corrected.
--
-- RLS restricts both tables to `admin` — an import file holds children's dates
-- of birth before any of them is a student. The matrix draws the one line RLS
-- does not: **preparing an import is not the same as applying it.** Somebody
-- can spend an afternoon cleaning a spreadsheet without being the person who
-- creates two hundred students.

insert into reference.permissions (code, module, ability, description) values
  ('import.view', 'import', 'view', 'View import runs and their rows'),
  ('import.prepare', 'import', 'prepare', 'Upload a file and correct its rows'),
  ('import.apply', 'import', 'apply', 'Write an import into the school''s records')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('import.view'), ('import.prepare'), ('import.apply')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- A draft with the four mistakes every real file has
-- ---------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
  v_session uuid;
  v_section uuid;
  v_existing text;
  v_run uuid;
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then return; end if;

  select id into v_session from public.academic_sessions
  where tenant_id = v_tenant and is_current limit 1;
  if v_session is null then return; end if;

  if exists (select 1 from public.import_runs where tenant_id = v_tenant) then
    return;
  end if;

  select s.id into v_section
  from public.sections s
  join public.class_levels cl on cl.id = s.class_level_id
  where s.tenant_id = v_tenant and s.session_id = v_session
  order by cl.sequence, s.name
  limit 1;

  select admission_number into v_existing
  from public.students where tenant_id = v_tenant order by admission_number limit 1;

  insert into public.import_runs (tenant_id, session_id, file_name, row_count, created_by)
  values (v_tenant, v_session, 'new-admissions-april.csv', 6, null)
  returning id into v_run;

  -- Two rows that are fine, and four that are wrong in the four ways a real
  -- spreadsheet is wrong: a blank name, a duplicate inside the file, a
  -- collision with somebody already admitted, and a class nobody could match.
  insert into public.import_rows (
    tenant_id, run_id, line_number, first_name, last_name, admission_number,
    section_id, gender, date_of_birth, guardian_name, guardian_phone
  )
  values
    (v_tenant, v_run, 1, 'Aarav',  'Khanna',    'ADM-2026-001', v_section, 'male',   '2015-06-12', 'Sunita Khanna', '+919800002001'),
    (v_tenant, v_run, 2, 'Ishita', 'Malhotra',  'ADM-2026-002', v_section, 'female', '2015-08-03', 'Rakesh Malhotra', '+919800002002'),
    (v_tenant, v_run, 3, '',       'Sethi',     'ADM-2026-003', v_section, 'male',   '2015-02-19', null, null),
    (v_tenant, v_run, 4, 'Anaya',  'Kapoor',    'ADM-2026-002', v_section, 'female', '2015-11-30', null, null),
    (v_tenant, v_run, 5, 'Vihaan', 'Grover',    v_existing,     v_section, 'male',   '2015-01-08', null, null),
    (v_tenant, v_run, 6, 'Myra',   'Bhatia',    'ADM-2026-006', null,      'female', '2015-09-21', 'Arjun Bhatia', null);

  -- Judged immediately, so the screen opens with the problems already listed
  -- rather than waiting for somebody to press a button first.
  perform public.import_validate_run(v_run);
end $$;
