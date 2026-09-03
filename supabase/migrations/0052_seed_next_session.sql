-- Next year's session, and its classes.
--
-- Promotion needs somewhere to promote *to*, and `sections` are session-scoped
-- -- next year's 6B is a different row from this year's. Without this the
-- promotion screen's only honest answer would be "every student is held,
-- because the receiving session has no classes", which demonstrates the failure
-- mode rather than the feature.
--
-- Deliberately NOT current. Making it current is a separate, deliberate act:
-- every other module reads whichever session is current, so flipping it is how
-- a school says "the new year has started", not something a seed should decide.
--
-- No promotion run is seeded. A run holds live decisions about named children,
-- and inventing one would mean a migration acting as an administrator it is not
-- -- `promotion_start_run` checks the caller's role for exactly that reason.
-- The screen builds one in two clicks.

do $$
declare
  v_tenant record;
  v_current public.academic_sessions;
  v_next_id uuid;
  v_next_name text;
begin
  for v_tenant in select id from public.tenants loop
    select * into v_current from public.academic_sessions a
    where a.tenant_id = v_tenant.id and a.is_current;

    continue when v_current.id is null;

    v_next_name := (extract(year from v_current.start_date)::integer + 1)::text
                   || '-' || (extract(year from v_current.end_date)::integer + 1)::text;

    insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
    values (
      v_tenant.id, v_next_name,
      v_current.start_date + interval '1 year',
      v_current.end_date + interval '1 year',
      false
    )
    on conflict (tenant_id, name) do nothing
    returning id into v_next_id;

    continue when v_next_id is null;

    -- The same shape as this year: same class levels, same section names, same
    -- capacities, same class teachers. All of those are decisions a school may
    -- revise, and revising twelve rows is a great deal less work than typing
    -- twelve rows.
    insert into public.sections (tenant_id, class_level_id, session_id, name, capacity, class_teacher_staff_id)
    select s.tenant_id, s.class_level_id, v_next_id, s.name, s.capacity, s.class_teacher_staff_id
    from public.sections s
    where s.tenant_id = v_tenant.id and s.session_id = v_current.id;

    v_next_id := null;
  end loop;
end $$;
