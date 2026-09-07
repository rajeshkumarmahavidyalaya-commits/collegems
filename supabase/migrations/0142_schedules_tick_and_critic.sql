-- ---------------------------------------------------------------------------
-- The tick, and the critic
-- ---------------------------------------------------------------------------
--
-- `schedules_tick` is the whole surface the Edge Function needs: one call, a
-- bounded number of occurrences, and a jsonb summary saying what it did and how
-- many are left. That is rule 7's bargain -- *bound it and say what the bound
-- is* -- and it means a backlog is a function invoked twice rather than a
-- request that times out.
--
-- The critic is `grading_scheme_problems()` again, aimed at a schedule. The
-- motivating failure is specific and quiet: a school switches its SMS channel
-- off, and the evening absence notice keeps "running" every night, reporting
-- four hundred matched and four hundred notified, while every delivery is
-- skipped for want of a channel. Everything looks green and nobody is being
-- told anything.
--
-- > **A schedule that runs is not a schedule that works.** The register says
-- > what ran; the critic says whether anybody heard.

create or replace function public.schedules_tick(
  p_limit integer default 25,
  p_max_recipients integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_due record;
  v_run public.schedule_runs;
  v_ran integer := 0;
  v_missed integer := 0;
  v_failed integer := 0;
  v_notified integer := 0;
  v_limit integer := greatest(least(coalesce(p_limit, 25), 200), 1);
begin
  for v_due in
    select * from public.schedules_due(v_limit)
  loop
    v_run := public.schedule_run(v_due.schedule_id, v_due.occurrence_at, p_max_recipients);
    v_ran := v_ran + 1;
    v_notified := v_notified + coalesce(v_run.notified, 0);
    if v_run.status = 'missed' then v_missed := v_missed + 1; end if;
    if v_run.status = 'failed' then v_failed := v_failed + 1; end if;
  end loop;

  return jsonb_build_object(
    'ran', v_ran,
    'missed', v_missed,
    'failed', v_failed,
    'notified', v_notified,
    -- What is still waiting, so a caller knows whether to come straight back.
    -- Counted after the fact rather than before: the answer that matters is
    -- "is there more", not "was there more".
    'remaining', (select count(*) from public.schedules_due(v_limit + 1)),
    'limit', v_limit
  );
end;
$$;

revoke all on function public.schedules_tick(integer, integer) from public, anon, authenticated;

comment on function public.schedules_tick(integer, integer) is
  'One bounded pass over everything due, across all tenants. Returns what it '
  'did and how many occurrences are still waiting, so a backlog is a second '
  'invocation rather than a timeout.';

-- ---------------------------------------------------------------------------
-- Is anybody actually hearing this?
-- ---------------------------------------------------------------------------

create or replace function public.schedule_problems()
returns table (schedule_id uuid, severity text, message text)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_s record;
  v_last record;
  v_channels text[];
  v_ch text;
begin
  if v_tenant_id is null then
    return;
  end if;

  for v_s in
    select s.*, nt.default_channels
    from public.schedules s
    left join reference.notification_types nt
      on nt.key = case s.kind
        when 'attendance.absentees' then 'attendance.absent'
        when 'fees.due_reminder' then 'fees.due_reminder'
        when 'library.overdue' then 'library.book_overdue'
      end
    where s.tenant_id = v_tenant_id
  loop
    if not v_s.is_enabled then
      continue;
    end if;

    -- A channel the school has switched off, or that this build cannot send
    -- on. Rule 10's three parts: a driver, the school's decision, credentials.
    v_channels := coalesce(v_s.channels, v_s.default_channels, array['in_app']);
    foreach v_ch in array v_channels
    loop
      if v_ch <> 'in_app' and not exists (
        select 1 from public.notification_channel_settings cs
        where cs.tenant_id = v_tenant_id and cs.channel = v_ch and cs.is_enabled
      ) then
        return query select v_s.id, 'warning'::text, format(
          'This schedule sends on %s, which is switched off. It will keep running '
          'and reporting success while every message is skipped.', v_ch);
      elsif v_ch <> 'in_app' and exists (
        select 1 from public.notification_channel_settings cs
        where cs.tenant_id = v_tenant_id and cs.channel = v_ch
          and cs.is_enabled and coalesce(cs.provider_configured, false) = false
      ) then
        return query select v_s.id, 'warning'::text, format(
          'This schedule sends on %s, which is switched on but has no credentials '
          'the dispatcher could find. Messages will queue rather than send.', v_ch);
      end if;
    end loop;

    select * into v_last
    from public.schedule_runs r
    where r.schedule_id = v_s.id
    order by r.occurrence_at desc
    limit 1;

    if v_last.id is null then
      return query select v_s.id, 'info'::text,
        'This schedule has never run. It will run at its next occurrence -- it '
        'does not go back and send the ones it missed before it was switched on.';
    elsif v_last.status = 'failed' then
      return query select v_s.id, 'error'::text, format(
        'The last run failed: %s', coalesce(v_last.note, 'no reason recorded'));
    elsif v_last.status = 'missed' then
      return query select v_s.id, 'warning'::text, format(
        'The last occurrence was not run. %s', coalesce(v_last.note, ''));
    elsif v_last.status = 'done' and v_last.matched > 0 and v_last.notified = 0 then
      return query select v_s.id, 'warning'::text, format(
        'The last run matched %s but told nobody -- none of them has a family '
        'login on file.', v_last.matched);
    end if;
  end loop;

  return;
end;
$$;

revoke all on function public.schedule_problems() from public, anon;
grant execute on function public.schedule_problems() to authenticated;
