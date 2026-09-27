-- 0288: a record with history is kept, and a mistake can be removed.
--
-- Asked for as "there is no way to delete a teacher". Probed before building
-- one, in a rolled-back transaction as an administrator:
--
--   delete from students where id = <a child with a fee account>
--     -> 1 row; that child's ledger entries 4 -> 0, invoices 1 -> 0
--   delete from staff where id = <a teacher with payslips>
--     -> 1 row; payslips 3 -> 0, staff register 51 -> 0
--
-- The admin policies on `students`, `staff`, `sections` and `class_levels`
-- are FOR ALL, and almost every table that records a person's history hangs
-- off them ON DELETE CASCADE. Rule 6 makes `ledger_entries` append-only by
-- revoke -- and a referential action runs as the table owner, so the revoke
-- does not stop a cascade. No screen issued that delete; one PostgREST call
-- would have. Drawing a Delete button on top of that would have been drawing
-- it on top of a way to erase a family's fee account.
--
-- So, in this order:
--
-- 1. **A guard, not a button.** BEFORE DELETE triggers on `students`, `staff`,
--    `sections` and `class_levels` refuse when the row has history, naming
--    what, in a sentence. A trigger rather than a check in a function, because
--    a plain delete through PostgREST routes around any function (0205).
--    SECURITY DEFINER because an invoker counting rows counts the rows the
--    caller can see (0205's seat-limit lesson), and it filters by the row's
--    own tenant. Deleting a whole college (a tenant) is exempt: by the time
--    the cascade reaches these rows the tenant row is gone.
--
-- 2. **The mistake case is then safe to offer.** `staff_delete` and
--    `student_delete` remove a record that has no history -- a teacher added
--    twice, a child admitted into the wrong college -- and the person row
--    with it when they are nobody else here. A pending invitation naming them
--    is revoked first. A student's guardians who are left with no child, no
--    login and no invitation go too. Everything else is refused by the guard
--    with the sentence, and the screen offers "record leaving" instead.
--
-- 3. **Fourteen foreign keys could not do what they said.** Each is
--    `(tenant_id, x) ... ON DELETE SET NULL`, which nulls `tenant_id` too --
--    a NOT NULL column -- so deleting the parent failed with 23502. Found by
--    the probe above: deleting an empty class failed on `import_rows`. They
--    become `SET NULL (x)`, which is what each one meant.

-- ---------------------------------------------------------------------------
-- 3. The foreign keys first, so the functions below can rely on them
-- ---------------------------------------------------------------------------

alter table public.certificates drop constraint certificates_template_fkey,
  add constraint certificates_template_fkey foreign key (tenant_id, template_id)
  references public.certificate_templates (tenant_id, id) on delete set null (template_id);

alter table public.enquiries drop constraint enquiries_assigned_fkey,
  add constraint enquiries_assigned_fkey foreign key (tenant_id, assigned_staff_id)
  references public.staff (tenant_id, id) on delete set null (assigned_staff_id);

alter table public.enquiries drop constraint enquiries_class_level_fkey,
  add constraint enquiries_class_level_fkey foreign key (tenant_id, class_level_id)
  references public.class_levels (tenant_id, id) on delete set null (class_level_id);

alter table public.enquiries drop constraint enquiries_student_fkey,
  add constraint enquiries_student_fkey foreign key (tenant_id, converted_student_id)
  references public.students (tenant_id, id) on delete set null (converted_student_id);

alter table public.hostels drop constraint hostels_warden_fkey,
  add constraint hostels_warden_fkey foreign key (tenant_id, warden_staff_id)
  references public.staff (tenant_id, id) on delete set null (warden_staff_id);

alter table public.import_rows drop constraint import_rows_section_fkey,
  add constraint import_rows_section_fkey foreign key (tenant_id, section_id)
  references public.sections (tenant_id, id) on delete set null (section_id);

alter table public.import_rows drop constraint import_rows_student_fkey,
  add constraint import_rows_student_fkey foreign key (tenant_id, applied_student_id)
  references public.students (tenant_id, id) on delete set null (applied_student_id);

alter table public.inventory_items drop constraint inventory_items_category_fkey,
  add constraint inventory_items_category_fkey foreign key (tenant_id, category_id)
  references public.item_categories (tenant_id, id) on delete set null (category_id);

alter table public.stock_movements drop constraint stock_movements_staff_fkey,
  add constraint stock_movements_staff_fkey foreign key (tenant_id, issued_to_staff_id)
  references public.staff (tenant_id, id) on delete set null (issued_to_staff_id);

alter table public.transport_routes drop constraint transport_routes_vehicle_fkey,
  add constraint transport_routes_vehicle_fkey foreign key (tenant_id, vehicle_id, vehicle_capacity)
  references public.vehicles (tenant_id, id, capacity)
  on update cascade on delete set null (vehicle_id, vehicle_capacity);

alter table public.vehicles drop constraint vehicles_attendant_fkey,
  add constraint vehicles_attendant_fkey foreign key (tenant_id, attendant_staff_id)
  references public.staff (tenant_id, id) on delete set null (attendant_staff_id);

alter table public.vehicles drop constraint vehicles_driver_fkey,
  add constraint vehicles_driver_fkey foreign key (tenant_id, driver_staff_id)
  references public.staff (tenant_id, id) on delete set null (driver_staff_id);

alter table public.visitors drop constraint visitors_host_fkey,
  add constraint visitors_host_fkey foreign key (tenant_id, host_staff_id)
  references public.staff (tenant_id, id) on delete set null (host_staff_id);

alter table public.visitors drop constraint visitors_student_fkey,
  add constraint visitors_student_fkey foreign key (tenant_id, student_id)
  references public.students (tenant_id, id) on delete set null (student_id);

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------

-- "4 fee ledger entries", or null when there are none. Both forms are carried,
-- because English plurals are not derivable (rule 2's number agreement).
create or replace function public.count_phrase(p_n bigint, p_one text, p_many text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when coalesce(p_n, 0) = 0 then null
    when p_n = 1 then '1 ' || p_one
    else p_n || ' ' || p_many
  end
$$;

-- "a, b and c".
create or replace function public.and_list(p_items text[])
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when coalesce(cardinality(p_items), 0) = 0 then ''
    when cardinality(p_items) = 1 then p_items[1]
    else array_to_string(p_items[1:cardinality(p_items) - 1], ', ')
         || ' and ' || p_items[cardinality(p_items)]
  end
$$;

create or replace function public.guard_student_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t constant uuid := old.tenant_id;
  v_found text[];
  v_name text;
begin
  -- A whole college being removed: the tenant row is already gone.
  if not exists (select 1 from public.tenants where id = t) then
    return old;
  end if;

  v_found := array_remove(array[
    public.count_phrase((select count(*) from public.ledger_entries x where x.tenant_id = t and x.student_id = old.id), 'fee ledger entry', 'fee ledger entries'),
    public.count_phrase((select count(*) from public.invoices x where x.tenant_id = t and x.student_id = old.id), 'invoice', 'invoices'),
    public.count_phrase((select count(*) from public.attendance_records a join public.enrolments e on e.id = a.enrolment_id where e.tenant_id = t and e.student_id = old.id), 'attendance mark', 'attendance marks'),
    public.count_phrase((select count(*) from public.marks x where x.tenant_id = t and x.student_id = old.id), 'exam mark', 'exam marks'),
    public.count_phrase((select count(*) from public.exam_results x where x.tenant_id = t and x.student_id = old.id), 'exam result', 'exam results'),
    public.count_phrase((select count(*) from public.certificates x where x.tenant_id = t and x.student_id = old.id), 'certificate', 'certificates'),
    public.count_phrase((select count(*) from public.book_issues b join public.members m on m.id = b.member_id where m.tenant_id = t and m.student_id = old.id), 'library loan', 'library loans'),
    public.count_phrase((select count(*) from public.homework_submissions x where x.tenant_id = t and x.student_id = old.id and x.status <> 'pending'), 'homework submission', 'homework submissions'),
    public.count_phrase((select count(*) from public.stock_movements x where x.tenant_id = t and x.sold_to_student_id = old.id), 'store purchase', 'store purchases'),
    public.count_phrase((select count(*) from public.online_test_attempts x where x.tenant_id = t and x.student_id = old.id), 'online test sitting', 'online test sittings'),
    public.count_phrase((select count(*) from public.student_leave_requests x where x.tenant_id = t and x.student_id = old.id), 'leave request', 'leave requests'),
    public.count_phrase((select count(*) from public.hostel_allocations x where x.tenant_id = t and x.student_id = old.id), 'hostel booking', 'hostel bookings'),
    public.count_phrase((select count(*) from public.transport_assignments x where x.tenant_id = t and x.student_id = old.id), 'bus seat', 'bus seats'),
    public.count_phrase((select count(*) from public.student_concessions x where x.tenant_id = t and x.student_id = old.id), 'fee concession', 'fee concessions'),
    public.count_phrase((select count(*) from public.user_profiles x where x.tenant_id = t and x.student_id = old.id), 'login', 'logins'),
    public.count_phrase((select count(*) from public.invitations x where x.tenant_id = t and x.student_id = old.id and x.status = 'pending'), 'pending invitation', 'pending invitations')
  ], null);

  if coalesce(cardinality(v_found), 0) = 0 then
    return old;
  end if;

  select p.first_name || ' ' || p.last_name into v_name
  from public.people p where p.id = old.person_id;

  raise exception
    '% cannot be deleted: the school holds % for them. A record with history is kept -- record them as having left instead.',
    coalesce(v_name, 'This student'), public.and_list(v_found)
    using errcode = 'P0001';
end;
$$;

create or replace function public.guard_staff_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t constant uuid := old.tenant_id;
  v_found text[];
  v_name text;
begin
  if not exists (select 1 from public.tenants where id = t) then
    return old;
  end if;

  v_found := array_remove(array[
    public.count_phrase((select count(*) from public.payslips x where x.tenant_id = t and x.staff_id = old.id), 'payslip', 'payslips'),
    public.count_phrase((select count(*) from public.staff_attendance x where x.tenant_id = t and x.staff_id = old.id), 'attendance mark', 'attendance marks'),
    public.count_phrase((select count(*) from public.leave_requests x where x.tenant_id = t and x.staff_id = old.id), 'leave request', 'leave requests'),
    public.count_phrase((select count(*) from public.certificates x where x.tenant_id = t and x.staff_id = old.id), 'certificate', 'certificates'),
    public.count_phrase((select count(*) from public.substitutions x where x.tenant_id = t and (x.absent_staff_id = old.id or x.substitute_staff_id = old.id)), 'cover arrangement', 'cover arrangements'),
    public.count_phrase((select count(*) from public.book_issues b join public.members m on m.id = b.member_id where m.tenant_id = t and m.staff_id = old.id), 'library loan', 'library loans'),
    public.count_phrase((select count(*) from public.stock_movements x where x.tenant_id = t and x.issued_to_staff_id = old.id), 'store issue', 'store issues'),
    public.count_phrase((select count(*) from public.biometric_punches x where x.tenant_id = t and x.staff_id = old.id), 'attendance punch', 'attendance punches'),
    public.count_phrase((select count(*) from public.user_profiles x where x.tenant_id = t and x.staff_id = old.id), 'login', 'logins'),
    public.count_phrase((select count(*) from public.invitations x where x.tenant_id = t and x.staff_id = old.id and x.status = 'pending'), 'pending invitation', 'pending invitations')
  ], null);

  if coalesce(cardinality(v_found), 0) = 0 then
    return old;
  end if;

  select p.first_name || ' ' || p.last_name into v_name
  from public.people p where p.id = old.person_id;

  raise exception
    '% cannot be deleted: the school holds % for them. A record with history is kept -- record them as having left instead.',
    coalesce(v_name, 'This member of staff'), public.and_list(v_found)
    using errcode = 'P0001';
end;
$$;

create or replace function public.guard_section_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t constant uuid := old.tenant_id;
  v_found text[];
  v_label text;
begin
  if not exists (select 1 from public.tenants where id = t) then
    return old;
  end if;

  v_found := array_remove(array[
    public.count_phrase((select count(*) from public.enrolments x where x.tenant_id = t and x.section_id = old.id), 'child enrolled', 'children enrolled'),
    public.count_phrase((select count(*) from public.syllabus_progress x where x.tenant_id = t and x.section_id = old.id), 'syllabus record', 'syllabus records')
  ], null);

  if coalesce(cardinality(v_found), 0) = 0 then
    return old;
  end if;

  select cl.name || ' ' || old.name into v_label
  from public.class_levels cl where cl.id = old.class_level_id;

  raise exception
    '% cannot be deleted: it has % in it. Move the children to another section first; a section that has had children in it keeps its place in their records.',
    coalesce(v_label, 'This section'), public.and_list(v_found)
    using errcode = 'P0001';
end;
$$;

create or replace function public.guard_class_level_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t constant uuid := old.tenant_id;
  v_sections bigint;
begin
  if not exists (select 1 from public.tenants where id = t) then
    return old;
  end if;

  select count(*) into v_sections
  from public.sections s where s.tenant_id = t and s.class_level_id = old.id;

  if v_sections > 0 then
    raise exception
      '% cannot be deleted: it has %, in this year or an earlier one. Delete the sections first.',
      old.name, public.count_phrase(v_sections, 'section', 'sections')
      using errcode = 'P0001';
  end if;

  return old;
end;
$$;

revoke all on function public.guard_student_delete() from public, anon, authenticated;
revoke all on function public.guard_staff_delete() from public, anon, authenticated;
revoke all on function public.guard_section_delete() from public, anon, authenticated;
revoke all on function public.guard_class_level_delete() from public, anon, authenticated;

create trigger guard_student_delete before delete on public.students
  for each row execute function public.guard_student_delete();
create trigger guard_staff_delete before delete on public.staff
  for each row execute function public.guard_staff_delete();
create trigger guard_section_delete before delete on public.sections
  for each row execute function public.guard_section_delete();
create trigger guard_class_level_delete before delete on public.class_levels
  for each row execute function public.guard_class_level_delete();

comment on function public.guard_student_delete() is
  'Refuses to delete a student who has history (ledger, invoices, register, marks, ...), naming it (0288). A cascade would otherwise erase an append-only fee account.';
comment on function public.guard_staff_delete() is
  'Refuses to delete a member of staff who has history (payslips, register, leave, ...), naming it (0288).';
comment on function public.guard_section_delete() is
  'Refuses to delete a section that has had children enrolled in it (0288).';
comment on function public.guard_class_level_delete() is
  'Refuses to delete a class that still has sections (0288).';

-- ---------------------------------------------------------------------------
-- 2. Removing a mistake
-- ---------------------------------------------------------------------------

create or replace function public.staff_delete(p_staff_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_person uuid;
  v_name text;
  v_photo text;
  v_other_role boolean;
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('staff.manage') then
    raise exception 'Your role cannot delete staff records.';
  end if;

  select s.person_id, p.first_name || ' ' || p.last_name, p.photo_path
  into v_person, v_name, v_photo
  from public.staff s join public.people p on p.id = s.person_id
  where s.id = p_staff_id and s.tenant_id = v_tenant;

  if v_person is null then
    raise exception 'That member of staff does not exist.';
  end if;

  -- An invitation naming somebody who is being removed would otherwise
  -- mint a login for a record that no longer exists.
  update public.invitations set status = 'revoked'
  where tenant_id = v_tenant and staff_id = p_staff_id and status = 'pending';

  v_other_role := exists (select 1 from public.students where person_id = v_person)
               or exists (select 1 from public.guardians where person_id = v_person);

  -- The role row first, while the person row still names them: the guard on
  -- `staff` decides, and its sentence is the refusal. Then the person, when
  -- they are nobody else here.
  delete from public.staff where id = p_staff_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Nothing was deleted: only an administrator can delete a staff record.';
  end if;

  if not v_other_role then
    delete from public.people where id = v_person;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'name', v_name,
    -- The photograph belongs to the person; it goes only when they do.
    'photoPath', case when v_other_role then null else v_photo end
  );
end;
$$;

comment on function public.staff_delete(uuid) is
  'Remove a staff record entered by mistake -- one with no history. Anything with history is refused by guard_staff_delete with a sentence (0288).';

create or replace function public.student_delete(p_student_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_person uuid;
  v_name text;
  v_photo text;
  v_other_role boolean;
  v_guardians uuid[];
  v_removed integer := 0;
  v_rows integer;
  g record;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('students.manage') then
    raise exception 'Your role cannot delete student records.';
  end if;

  select s.person_id, p.first_name || ' ' || p.last_name, p.photo_path
  into v_person, v_name, v_photo
  from public.students s join public.people p on p.id = s.person_id
  where s.id = p_student_id and s.tenant_id = v_tenant;

  if v_person is null then
    raise exception 'That student does not exist.';
  end if;

  select coalesce(array_agg(gs.guardian_id), '{}') into v_guardians
  from public.guardian_student gs
  where gs.tenant_id = v_tenant and gs.student_id = p_student_id;

  update public.invitations set status = 'revoked'
  where tenant_id = v_tenant and student_id = p_student_id and status = 'pending';

  v_other_role := exists (select 1 from public.staff where person_id = v_person)
               or exists (select 1 from public.guardians where person_id = v_person);

  delete from public.students where id = p_student_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Nothing was deleted: only an administrator can delete a student record.';
  end if;

  if not v_other_role then
    delete from public.people where id = v_person;
  end if;

  -- Guardians entered with this child and left with nobody: no other child,
  -- no login, no invitation. They were part of the same mistake.
  for g in
    select gu.id, gu.person_id
    from public.guardians gu
    where gu.tenant_id = v_tenant
      and gu.id = any (v_guardians)
      and not exists (select 1 from public.guardian_student gs where gs.guardian_id = gu.id)
      and not exists (select 1 from public.user_profiles up where up.guardian_id = gu.id)
      and not exists (select 1 from public.invitations i where i.guardian_id = gu.id and i.status = 'pending')
  loop
    if exists (select 1 from public.staff where person_id = g.person_id)
       or exists (select 1 from public.students where person_id = g.person_id) then
      delete from public.guardians where id = g.id;
    else
      delete from public.people where id = g.person_id;
    end if;
    v_removed := v_removed + 1;
  end loop;

  return jsonb_build_object(
    'deleted', true,
    'name', v_name,
    'guardiansRemoved', v_removed,
    'photoPath', case when v_other_role then null else v_photo end
  );
end;
$$;

comment on function public.student_delete(uuid) is
  'Remove a student admitted by mistake -- one with no history -- and guardians left with no child. Anything with history is refused by guard_student_delete (0288).';

revoke all on function public.staff_delete(uuid) from public, anon;
grant execute on function public.staff_delete(uuid) to authenticated;
revoke all on function public.student_delete(uuid) from public, anon;
grant execute on function public.student_delete(uuid) to authenticated;
revoke all on function public.count_phrase(bigint, text, text) from public, anon;
grant execute on function public.count_phrase(bigint, text, text) to authenticated;
revoke all on function public.and_list(text[]) from public, anon;
grant execute on function public.and_list(text[]) to authenticated;
