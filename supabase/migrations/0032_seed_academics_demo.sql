-- Demo subjects, rooms and subject assignments, so the academics screens and
-- everything downstream of them (routine, marks, homework) are never designed
-- against six empty tables.
--
-- Assignments are deterministic -- teachers are dealt round-robin by a stable
-- ordering, not at random -- so a rebuild produces the same timetable inputs.

do $$
declare
  v_tenant_id uuid;
  v_session_id uuid;
begin
  select id into v_tenant_id from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant_id is null then
    raise notice 'Demo tenant not present; skipping academics seed.';
    return;
  end if;

  select id into v_session_id
  from public.academic_sessions
  where tenant_id = v_tenant_id and is_current
  limit 1;

  if v_session_id is null then
    raise notice 'No current session; skipping academics seed.';
    return;
  end if;

  insert into public.subjects (tenant_id, name, code, kind) values
    (v_tenant_id, 'English',           'ENG',  'theory'),
    (v_tenant_id, 'Hindi',             'HIN',  'theory'),
    (v_tenant_id, 'Mathematics',       'MATH', 'theory'),
    (v_tenant_id, 'Science',           'SCI',  'theory'),
    (v_tenant_id, 'Social Studies',    'SST',  'theory'),
    (v_tenant_id, 'Computer Science',  'CS',   'practical'),
    (v_tenant_id, 'Physical Education','PE',   'practical'),
    (v_tenant_id, 'Art & Craft',       'ART',  'practical')
  on conflict (tenant_id, code) do nothing;

  -- One room per section, named after the section it usually sits in.
  insert into public.class_rooms (tenant_id, name, capacity)
  select v_tenant_id,
         'Room ' || cl.name || '-' || s.name,
         greatest(s.capacity, 40)
  from public.sections s
  join public.class_levels cl on cl.id = s.class_level_id
  where s.tenant_id = v_tenant_id and s.session_id = v_session_id
  on conflict (tenant_id, name) do nothing;

  -- Every section studies every subject, with teachers dealt round-robin.
  -- Both sides are numbered in CTEs and joined on the modulo: a window function
  -- is not allowed in OFFSET, and computing the rank up front is clearer than
  -- a correlated subquery would have been anyway.
  --
  -- The `greatest(count(*), 1)` keeps the modulo defined at a school that has
  -- entered no staff yet; the left join then leaves `teacher_staff_id` null,
  -- which the schema permits on purpose.
  insert into public.section_subjects
    (tenant_id, session_id, section_id, subject_id, teacher_staff_id)
  with teachers as (
    select st.id, (row_number() over (order by st.employee_code) - 1) as n
    from public.staff st
    where st.tenant_id = v_tenant_id and st.status = 'active'
  ),
  pairs as (
    select
      s.id as section_id,
      subj.id as subject_id,
      (row_number() over (order by s.id, subj.code) - 1) as n
    from public.sections s
    cross join public.subjects subj
    where s.tenant_id = v_tenant_id
      and s.session_id = v_session_id
      and subj.tenant_id = v_tenant_id
      and subj.is_active
  )
  select v_tenant_id, v_session_id, p.section_id, p.subject_id, t.id
  from pairs p
  left join teachers t
    on t.n = p.n % (select greatest(count(*), 1) from teachers)
  on conflict (tenant_id, session_id, section_id, subject_id) do nothing;

  raise notice 'Academics seeded';
end $$;
