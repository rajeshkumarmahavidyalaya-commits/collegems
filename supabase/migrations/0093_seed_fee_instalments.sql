-- ---------------------------------------------------------------------------
-- A billing calendar for the demo
--
-- Twelve monthly periods across the session. The first collects everything the
-- school charges once a year; the rest collect only what recurs.
--
-- This is what the instalment concept is for, and the demo shows it plainly:
-- the tenant's fee structures are all `annual` or `one_time`, and its transport
-- fares are monthly. Without a billing calendar, every invoice run charged the
-- annual tuition again — so a school billing monthly billed a year's tuition
-- twelve times, and nothing in the database objected.
-- ---------------------------------------------------------------------------

do $$
declare
  v_tenant uuid;
  v_session record;
  v_month date;
  v_i integer := 0;
  v_collects text[];
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then
    return;
  end if;

  for v_session in
    select id, start_date, end_date from public.academic_sessions
    where tenant_id = v_tenant
  loop
    v_i := 0;
    v_month := date_trunc('month', v_session.start_date)::date;

    while v_month <= v_session.end_date loop
      v_i := v_i + 1;

      -- The opening period carries the year's one-off and annual charges. Every
      -- other period collects only what genuinely recurs, which for this tenant
      -- is transport and nothing else.
      v_collects := case
        when v_i = 1 then array['monthly', 'quarterly', 'annual', 'one_time']
        else array['monthly']
      end;

      insert into public.fee_instalments (
        tenant_id, session_id, name, sequence, due_date,
        period_start, period_end, collects
      )
      values (
        v_tenant,
        v_session.id,
        to_char(v_month, 'FMMonth YYYY'),
        v_i,
        -- Due on the tenth of the month it covers: schools bill in advance and
        -- allow a few days to pay.
        (v_month + interval '9 days')::date,
        v_month,
        (v_month + interval '1 month - 1 day')::date,
        v_collects
      )
      on conflict (tenant_id, session_id, sequence) do nothing;

      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;
end $$;
