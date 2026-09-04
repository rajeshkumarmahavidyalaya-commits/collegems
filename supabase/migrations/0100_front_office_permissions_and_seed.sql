-- Front office: the matrix's half, and demo data.
--
-- RLS already restricts every table here to `admin` and `accountant` -- an
-- enquiry holds a child's date of birth and a family's phone number before
-- either has any relationship with the school, so teachers and families have no
-- business in it. These codes draw the line RLS does not: **taking an enquiry
-- is not the same as admitting a child.** A receptionist logs calls all day and
-- should not be able to create students.

insert into reference.permissions (code, module, ability, description) values
  ('frontoffice.view', 'frontoffice', 'view', 'View enquiries and the visitor register'),
  ('frontoffice.manage', 'frontoffice', 'manage', 'Record enquiries, follow-ups and visitor passes'),
  ('frontoffice.admit', 'frontoffice', 'admit', 'Turn an enquiry into an admitted student')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('frontoffice.view'), ('frontoffice.manage')) as p(code)
where r.code in ('admin', 'accountant')
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'frontoffice.admit'
from public.roles r
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- Demo: a funnel with every stage in it, including the losses
-- ---------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
  v_session uuid;
  v_staff uuid;
  v_class uuid;
  v_seq integer := 0;
  v_actor uuid;
  v_row record;
  v_id uuid;
  v_names text[][] := array[
    array['Aarav', 'Khanna', 'Sunita Khanna', 'mother', '+919800002001', 'phone', 'new'],
    array['Ishita', 'Malhotra', 'Rakesh Malhotra', 'father', '+919800002002', 'website', 'contacted'],
    array['Kabir', 'Sethi', 'Neha Sethi', 'mother', '+919800002003', 'walk_in', 'visited'],
    array['Anaya', 'Kapoor', 'Vikram Kapoor', 'father', '+919800002004', 'referral', 'applied'],
    array['Vihaan', 'Grover', 'Pooja Grover', 'mother', '+919800002005', 'advertisement', 'contacted'],
    array['Myra', 'Bhatia', 'Arjun Bhatia', 'father', '+919800002006', 'phone', 'lost'],
    array['Reyansh', 'Chopra', 'Divya Chopra', 'mother', '+919800002007', 'walk_in', 'new'],
    array['Saanvi', 'Anand', 'Mohit Anand', 'father', '+919800002008', 'website', 'visited']
  ];
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then return; end if;

  select id into v_session from public.academic_sessions
  where tenant_id = v_tenant and is_current limit 1;
  if v_session is null then return; end if;

  if exists (select 1 from public.enquiries where tenant_id = v_tenant) then
    return;
  end if;

  select id into v_staff from public.staff where tenant_id = v_tenant order by created_at limit 1;
  select id into v_class from public.class_levels
  where tenant_id = v_tenant order by sequence limit 1;

  -- `visitors_checked_out_by_chk` pairs the timestamp with the person, so a
  -- signed-out pass needs an actor. Looked up rather than hardcoded: a data
  -- migration must not carry a generated id.
  select id into v_actor from public.user_profiles where tenant_id = v_tenant limit 1;

  for i in 1 .. array_length(v_names, 1) loop
    v_seq := v_seq + 1;

    insert into public.enquiries (
      tenant_id, session_id, enquiry_number,
      applicant_first_name, applicant_last_name,
      class_level_id, contact_name, contact_phone, relationship,
      source, status, assigned_staff_id,
      next_follow_up_on, lost_reason, notes
    )
    values (
      v_tenant, v_session, 'ENQ-' || to_char(v_seq, 'FM0000'),
      v_names[i][1], v_names[i][2],
      v_class, v_names[i][3], v_names[i][5], v_names[i][4],
      v_names[i][6], v_names[i][7], v_staff,
      -- A spread of follow-up dates, some overdue, because "who have we not
      -- rung back" is the question the board exists to answer.
      case when v_names[i][7] = 'lost' then null
           else current_date + ((i % 5) - 2) end,
      case when v_names[i][7] = 'lost' then 'Chose a school closer to home' else null end,
      null
    )
    returning id into v_id;

    -- Everything past `new` was contacted at least once, and the log is what
    -- says so.
    if v_names[i][7] <> 'new' then
      insert into public.enquiry_follow_ups (tenant_id, enquiry_id, channel, note, outcome, happened_at)
      values (
        v_tenant, v_id, 'phone',
        'Called back, explained the fee structure and the bus routes.',
        'contacted', now() - ((i || ' days')::interval)
      );
    end if;

    if v_names[i][7] in ('visited', 'applied') then
      insert into public.enquiry_follow_ups (tenant_id, enquiry_id, channel, note, outcome, happened_at)
      values (
        v_tenant, v_id, 'visit',
        'Toured the school with the class teacher; asked about the hostel.',
        'visited', now() - (((i - 1) || ' days')::interval)
      );
    end if;
  end loop;

  -- Two people currently in the building, one already signed out, so the
  -- register has both states in it.
  insert into public.visitors (
    tenant_id, session_id, pass_number, visitor_name, phone, organisation,
    purpose, host_staff_id, checked_in_at, checked_out_at, checked_out_by
  )
  values
    (v_tenant, v_session, 'VP-0001', 'Sunita Khanna', '+919800002001', null,
     'Admission enquiry for her son', v_staff, now() - interval '3 hours',
     now() - interval '2 hours', v_actor),
    (v_tenant, v_session, 'VP-0002', 'Ramesh Iyer', '+919800002101', 'Iyer Stationers',
     'Delivering examination stationery', v_staff, now() - interval '40 minutes', null, null),
    (v_tenant, v_session, 'VP-0003', 'Dr Meera Rao', '+919800002102', 'City Clinic',
     'Annual health check-up', v_staff, now() - interval '20 minutes', null, null);
end $$;
