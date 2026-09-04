-- Dormitory: the matrix's half, and demo data.
--
-- The same line transport draws: **running the hostel is not the same as
-- putting a child in a bed.** A warden manages rooms; the admissions desk
-- places children.

insert into reference.permissions (code, module, ability, description) values
  ('hostel.view', 'hostel', 'view', 'View hostels, rooms and the warden''s register'),
  ('hostel.manage', 'hostel', 'manage', 'Create and edit hostels, rooms and fares'),
  ('hostel.allocate', 'hostel', 'allocate', 'Place a student in a room, or move them out')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'hostel.view'
from public.roles r
where r.code in ('admin', 'teacher', 'accountant', 'parent', 'student')
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('hostel.manage'), ('hostel.allocate')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- Demo
-- ---------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
  v_session uuid;
  v_head uuid;
  v_boys uuid;
  v_girls uuid;
  v_warden1 uuid;
  v_warden2 uuid;
  v_room record;
  v_student record;
  v_placed integer := 0;
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then return; end if;

  select id into v_session from public.academic_sessions
  where tenant_id = v_tenant and is_current limit 1;
  if v_session is null then return; end if;

  -- Its own head, not the transport one: two per-student sources sharing a head
  -- would land a family one line that means two things.
  select id into v_head from public.fee_heads
  where tenant_id = v_tenant and category = 'hostel' limit 1;

  if v_head is null then
    insert into public.fee_heads (tenant_id, code, name, description, category)
    values (v_tenant, 'HOSTEL', 'Hostel', 'Boarding, charged by room', 'hostel')
    returning id into v_head;
  end if;

  select id into v_warden1 from public.staff where tenant_id = v_tenant order by created_at offset 2 limit 1;
  select id into v_warden2 from public.staff where tenant_id = v_tenant order by created_at offset 3 limit 1;

  insert into public.hostels (tenant_id, name, kind, warden_staff_id, fee_head_id)
  values (v_tenant, 'Tagore House', 'boys', v_warden1, v_head)
  on conflict (tenant_id, name) do nothing;
  select id into v_boys from public.hostels where tenant_id = v_tenant and name = 'Tagore House';

  insert into public.hostels (tenant_id, name, kind, warden_staff_id, fee_head_id)
  values (v_tenant, 'Nivedita House', 'girls', v_warden2, v_head)
  on conflict (tenant_id, name) do nothing;
  select id into v_girls from public.hostels where tenant_id = v_tenant and name = 'Nivedita House';

  -- Fares vary by room, not by hostel: a four-bed dormitory costs less per
  -- child than a two-bed room, which is the same reasoning as a stop-based bus
  -- fare and the reason the fare lives on the room.
  insert into public.hostel_rooms (tenant_id, hostel_id, room_number, floor, beds, monthly_fare)
  values
    (v_tenant, v_boys, 'A-101', 'Ground', 4, 3200),
    (v_tenant, v_boys, 'A-102', 'Ground', 4, 3200),
    (v_tenant, v_boys, 'A-201', 'First', 2, 4500),
    (v_tenant, v_girls, 'B-101', 'Ground', 4, 3200),
    (v_tenant, v_girls, 'B-102', 'Ground', 3, 3800),
    (v_tenant, v_girls, 'B-201', 'First', 2, 4500)
  on conflict (tenant_id, hostel_id, room_number) do nothing;

  -- Placed the way the function would: gender matched, beds counted, fare
  -- copied from the room.
  for v_room in
    select r.id, r.beds, r.monthly_fare, h.id as hostel_id, h.kind
    from public.hostel_rooms r
    join public.hostels h on h.id = r.hostel_id
    where r.tenant_id = v_tenant
    order by h.name, r.room_number
  loop
    v_placed := 0;

    for v_student in
      select e.student_id
      from public.enrolments e
      join public.students st on st.id = e.student_id
      join public.people p on p.id = st.person_id
      where e.tenant_id = v_tenant
        and e.session_id = v_session
        and e.status = 'active'
        and (
          (v_room.kind = 'boys' and p.gender = 'male')
          or (v_room.kind = 'girls' and p.gender = 'female')
          or v_room.kind = 'mixed'
        )
        and not exists (
          select 1 from public.hostel_allocations a
          where a.student_id = e.student_id and a.status = 'active'
        )
      order by st.admission_number
      limit greatest(v_room.beds - 1, 1)
    loop
      insert into public.hostel_allocations (
        tenant_id, session_id, student_id, hostel_id, room_id,
        starts_on, monthly_fare
      )
      values (
        v_tenant, v_session, v_student.student_id, v_room.hostel_id, v_room.id,
        (select start_date from public.academic_sessions where id = v_session),
        v_room.monthly_fare
      );
      v_placed := v_placed + 1;
    end loop;
  end loop;
end $$;
