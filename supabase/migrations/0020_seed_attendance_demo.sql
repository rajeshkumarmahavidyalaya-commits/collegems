-- Demo attendance for the last 20 school days, so the register, the report and
-- the dashboard card are never designed against an empty table.
--
-- Weekends are skipped. Roughly 92% present, with absences and lates
-- distributed by a hash of (enrolment, date) rather than random() -- re-running
-- this produces the same register, which keeps the demo stable and makes the
-- `on conflict do nothing` genuinely a no-op rather than a silent overwrite.

do $$
declare
  v_tenant_id uuid;
  v_session_id uuid;
  v_day date;
  v_days_back int;
  v_inserted int;
  v_total int := 0;
begin
  select id into v_tenant_id from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant_id is null then
    raise notice 'Demo tenant not present; skipping attendance seed.';
    return;
  end if;

  select id into v_session_id
  from public.academic_sessions
  where tenant_id = v_tenant_id and is_current
  limit 1;

  if v_session_id is null then
    raise notice 'No current session for the demo tenant; skipping attendance seed.';
    return;
  end if;

  v_days_back := 0;
  while v_days_back < 28 loop
    v_day := current_date - v_days_back;
    v_days_back := v_days_back + 1;

    -- 6 = Saturday, 7 = Sunday
    if extract(isodow from v_day) >= 6 then
      continue;
    end if;

    insert into public.attendance_records
      (tenant_id, session_id, enrolment_id, attendance_date, period, status)
    select
      v_tenant_id,
      v_session_id,
      e.id,
      v_day,
      0,
      case (abs(hashtext(e.id::text || v_day::text)) % 100)
        when 0 then 'excused'
        when 1 then 'excused'
        when 2 then 'late'
        when 3 then 'late'
        when 4 then 'late'
        when 5 then 'absent'
        when 6 then 'absent'
        when 7 then 'absent'
        when 8 then 'absent'
        else 'present'
      end
    from public.enrolments e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_session_id
      and e.status = 'active'
    on conflict (tenant_id, enrolment_id, attendance_date, period) do nothing;

    get diagnostics v_inserted = row_count;
    v_total := v_total + v_inserted;
  end loop;

  raise notice 'Seeded % attendance records through %', v_total, current_date;
end $$;
