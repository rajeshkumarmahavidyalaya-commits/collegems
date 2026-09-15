-- 0241 -- Two wakers, and only one of them can.
--
-- `0240` put the impersonation outside every definer frame. This is the tick
-- that calls it, and building it turned up the fact that decides its shape.
--
-- > **`service_role` is not a member of `authenticated`.** Measured:
-- > `pg_has_role('service_role','authenticated','USAGE')` is **false**, and
-- > `pg_has_role('postgres','authenticated','USAGE')` is **true**.
--
-- So the `schedule-tick` Edge Function — which authenticates as `service_role`
-- — **cannot run a report as anybody**. `SET ROLE authenticated` would be
-- refused it, one statement into the digest, with an error naming a role rather
-- than a report.
--
-- The tempting repair is `grant authenticated to service_role`. That edits the
-- role graph of the platform this product runs on, permanently and for every
-- other thing that key touches, in order to save a second cron entry. It is not
-- done here.
--
-- **So the digest tick has exactly one waker, and that is written down rather
-- than discovered.** It costs nothing: a digest is queued through
-- `notify_send_for` like every other message, and the dispatcher — which is
-- where the provider secrets are, and the only reason the Edge Function exists
-- — sends it afterwards either way.
--
--     cron (postgres)                    Edge Function (service_role)
--       ├── schedules_tick()       <---- also called here
--       └── schedule_digests_tick()      cannot be: no SET ROLE
--
-- `tests/schedules/waker.test.ts` asserts the cron wakes everything the Edge
-- Function wakes. That direction is the one that matters and still holds; the
-- reverse is now deliberately false, so the guard gains the other half — the
-- Edge Function must **never** be given this RPC, because the failure would be
-- a runtime error about a role, every morning, at a school.
--
-- ## The claim is the thing that must not race
--
-- `schedule_runs` is unique on `(schedule_id, occurrence_at)` and the run opens
-- with `on conflict do nothing`, so **whichever tick reaches an occurrence
-- first owns it.** A message tick that kept picking up digest schedules would
-- claim the occurrence and then refuse it — a race whose loser is always the
-- one that could have done the work. So the two ticks are given disjoint sets
-- of kinds, out of **one list**: `schedule_kinds_needing_authority()`. One
-- definition, consulted by both, because two hand-written lists are two answers
-- and the second one drifts.
--
-- The filters are shaped deliberately differently. The digest tick names what
-- it takes; the message tick names only what it leaves. A kind added to the
-- CHECK next year is therefore picked up by the message tick, where an
-- unimplemented kind raises by name into a `failed` run somebody can read —
-- rather than being silently run by neither.
--
-- ## …and a refused digest is a schedule that runs and does not work
--
-- `schedule_problems()` warns when a run matched somebody and told nobody. A
-- digest whose creator lost the permission matches nobody *and* tells nobody,
-- so it lands as a clean `done` with a sentence in the register that no screen
-- reads. Rule 7's line — *a schedule that runs is not a schedule that works* —
-- arriving at the kind that can refuse itself.
--
-- ## …and one word, corrected from `0240`
--
-- `0240`'s refusal read *"admin may no longer run Fee defaulters"*. `admin` is
-- `roles.code`, which `0208` deliberately kept as an internal string while the
-- name a college reads lives in `roles.name`. A code on a screen is the same
-- mistake `0196` made with a plural: right about the fact, careless to read.

begin;

-- ---------------------------------------------------------------------------
-- One list, consulted by both ticks
-- ---------------------------------------------------------------------------

create or replace function public.schedule_kinds_needing_authority()
returns text[]
language sql
immutable
set search_path = 'public', 'extensions'
as $$
  -- A kind belongs here when running it means *being somebody*. Everything else
  -- sends a message about a row, which needs no authority beyond the tenant's.
  select array['report.digest']::text[];
$$;

comment on function public.schedule_kinds_needing_authority() is
  'The schedule kinds that run as the person who scheduled them, and therefore '
  'cannot run inside a SECURITY DEFINER frame. schedules_tick excludes these '
  'and schedule_digests_tick takes only these, from this one list.';

-- ---------------------------------------------------------------------------
-- The due list learns to be asked for a subset
-- ---------------------------------------------------------------------------

-- Dropped rather than left beside a wider one: two bodies is where the
-- occurrence rule quietly stops being the same in one of them.
drop function if exists public.schedules_due(integer);

create function public.schedules_due(
  p_limit integer default 100,
  p_only_kinds text[] default null,
  p_except_kinds text[] default null
)
returns table (
  schedule_id uuid,
  tenant_id uuid,
  kind text,
  name text,
  occurrence_at timestamp with time zone,
  minutes_late integer,
  within_grace boolean
)
language sql
stable
security definer
set search_path = 'public', 'extensions'
as $$
  with candidates as (
    select
      s.id,
      s.tenant_id,
      s.kind,
      s.name,
      s.grace_minutes,
      (((now() at time zone t.timezone)::date - d.offset_days) + s.run_at)
        at time zone t.timezone as occurrence_at,
      ((now() at time zone t.timezone)::date - d.offset_days) as local_date,
      s.weekdays,
      s.day_of_month
    from public.schedules s
    join public.tenants t on t.id = s.tenant_id
    cross join (values (0), (1)) as d(offset_days)
    where s.is_enabled
      and (p_only_kinds is null or s.kind = any (p_only_kinds))
      and (p_except_kinds is null or not (s.kind = any (p_except_kinds)))
  ),
  matching as (
    select *
    from candidates c
    where
      (
        (cardinality(c.weekdays) = 0 and c.day_of_month is null)
        or (c.day_of_month is not null and extract(day from c.local_date)::smallint = c.day_of_month)
        or (cardinality(c.weekdays) > 0
            and extract(isodow from c.local_date)::smallint = any (c.weekdays))
      )
      and c.occurrence_at <= now()
      and not exists (
        select 1 from public.schedule_runs r
        where r.schedule_id = c.id and r.occurrence_at = c.occurrence_at
      )
  )
  select
    m.id,
    m.tenant_id,
    m.kind,
    m.name,
    m.occurrence_at,
    (extract(epoch from (now() - m.occurrence_at)) / 60)::integer,
    (now() - m.occurrence_at) <= (m.grace_minutes * interval '1 minute')
  from matching m
  order by m.occurrence_at
  limit greatest(coalesce(p_limit, 100), 1)
$$;

revoke all on function public.schedules_due(integer, text[], text[]) from public, anon, authenticated;

comment on function public.schedules_due(integer, text[], text[]) is
  'Occurrences due now and not yet claimed, oldest first. The kind filters are '
  'how two ticks divide the work without racing for the same occurrence: one '
  'names what it takes, the other names only what it leaves.';

-- ---------------------------------------------------------------------------
-- The message tick leaves the kinds that need an authority
-- ---------------------------------------------------------------------------

create or replace function public.schedules_tick(
  p_limit integer default 25,
  p_max_recipients integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_due record;
  v_run public.schedule_runs;
  v_ran integer := 0;
  v_missed integer := 0;
  v_failed integer := 0;
  v_notified integer := 0;
  v_limit integer := greatest(least(coalesce(p_limit, 25), 200), 1);
  v_except text[] := public.schedule_kinds_needing_authority();
begin
  -- Excluded at the source, not skipped in the loop: skipping would let a
  -- college with twenty-five digest schedules starve its own absence notices
  -- out of the limit, without either tick doing anything wrong.
  for v_due in
    select * from public.schedules_due(v_limit, null, v_except)
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
    'remaining', (select count(*) from public.schedules_due(v_limit + 1, null, v_except)),
    'limit', v_limit
  );
end;
$$;

revoke all on function public.schedules_tick(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- …and the digest tick takes only those, as somebody
-- ---------------------------------------------------------------------------

create or replace function public.schedule_digests_tick(
  p_limit integer default 25
)
returns jsonb
language plpgsql
-- **SECURITY INVOKER**, for the reason `0240` exists: `schedule_report_digest`
-- does `SET ROLE`, Postgres forbids that anywhere inside a definer frame, and
-- this is its caller. Callable only by a role that may become `authenticated`
-- — which is `postgres`, and is **not** `service_role`.
set search_path = 'public', 'extensions'
as $$
declare
  v_due record;
  v_digest jsonb;
  v_run public.schedule_runs;
  v_ran integer := 0;
  v_sent integer := 0;
  v_refused integer := 0;
  v_missed integer := 0;
  v_failed integer := 0;
  v_only text[] := public.schedule_kinds_needing_authority();
  v_limit integer := greatest(least(coalesce(p_limit, 25), 200), 1);
begin
  if not pg_has_role(current_user, 'authenticated', 'USAGE') then
    -- Said once, here, rather than as `42501: permission denied to set role`
    -- from inside a report a school is waiting for.
    raise exception
      'This role cannot become a member of the college, so it cannot run a '
      'report as one. Scheduled reports are woken by pg_cron as postgres; the '
      'schedule-tick Edge Function runs as service_role and cannot do this.';
  end if;

  for v_due in
    select * from public.schedules_due(v_limit, v_only, null)
  loop
    -- The report runs before the occurrence is claimed, so two ticks racing
    -- would both compute an answer and one would discard it. That costs a
    -- wasted read; claiming first and computing second would cost a sent
    -- message with nothing behind it, which is the worse of the two.
    v_digest := public.schedule_report_digest(v_due.schedule_id);
    v_run := public.schedule_run(v_due.schedule_id, v_due.occurrence_at, 1, v_digest);

    v_ran := v_ran + 1;
    if v_run.status = 'missed' then v_missed := v_missed + 1;
    elsif v_run.status = 'failed' then v_failed := v_failed + 1;
    elsif coalesce(v_run.notified, 0) > 0 then v_sent := v_sent + 1;
    else v_refused := v_refused + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ran', v_ran,
    'sent', v_sent,
    'refused', v_refused,
    'missed', v_missed,
    'failed', v_failed,
    'remaining', (select count(*) from public.schedules_due(v_limit + 1, v_only, null)),
    'limit', v_limit
  );
end;
$$;

revoke all on function public.schedule_digests_tick(integer) from public, anon, authenticated;

comment on function public.schedule_digests_tick(integer) is
  'Runs the scheduled reports that are due, each as the person who scheduled '
  'it. SECURITY INVOKER and callable only by a role that may SET ROLE '
  'authenticated: pg_cron as postgres. service_role is not a member of '
  'authenticated, so the Edge Function cannot and must not call this.';

-- ---------------------------------------------------------------------------
-- The second waker
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('schoolos_schedule_digests_tick')
    where exists (
      select 1 from cron.job where jobname = 'schoolos_schedule_digests_tick');

    perform cron.schedule(
      'schoolos_schedule_digests_tick',
      '*/5 * * * *',
      $job$select public.schedule_digests_tick()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0240's refusal said a role code where a person reads a name
-- ---------------------------------------------------------------------------

create or replace function public.schedule_report_digest(p_schedule_id uuid)
returns jsonb
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_s public.schedules;
  v_key text;
  v_report record;
  v_up record;
  v_role record;
  v_rows bigint := 0;
  v_claims text;
begin
  select * into v_s from public.schedules where id = p_schedule_id;
  if v_s.id is null then
    raise exception 'No such schedule';
  end if;
  if v_s.kind <> 'report.digest' then
    raise exception 'That schedule is not a report digest';
  end if;

  v_key := nullif(btrim(coalesce(v_s.params ->> 'report_key', '')), '');
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason',
      'This schedule does not say which report to run.');
  end if;

  select r.key, r.name, r.required_permission into v_report
  from reference.reports r where r.key = v_key;
  if v_report.key is null then
    return jsonb_build_object('ok', false, 'reason',
      format('There is no report called %s any more.', v_key));
  end if;

  -- The authority is re-checked, never remembered: an administrator who left in
  -- March must not still be running the fee digest in June.
  select up.id, up.role_id, up.tenant_id into v_up
  from public.user_profiles up
  where up.id = v_s.created_by and up.tenant_id = v_s.tenant_id;

  if v_up.id is null then
    return jsonb_build_object('ok', false, 'reason',
      'The person who scheduled this no longer has a login at this college, so '
      'there is nobody whose permissions the run could use.');
  end if;

  -- `name` is the word the college chose; `code` is the string sixty policies
  -- compare. Only one of the two is for reading.
  select r.code, r.name into v_role from public.roles r where r.id = v_up.role_id;

  if not exists (
    select 1 from public.role_permissions rp
    where rp.tenant_id = v_s.tenant_id
      and rp.role_id = v_up.role_id
      and rp.permission_code = v_report.required_permission
      and rp.allowed
  ) then
    return jsonb_build_object('ok', false, 'reason',
      format('%s may no longer run %s, so nothing was sent. That role lost %s.',
             coalesce(v_role.name, 'The role that scheduled this'),
             v_report.name, v_report.required_permission));
  end if;

  -- Become them, for exactly one statement.
  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_up.id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', v_s.tenant_id,
        'role', v_role.code)
    )::text, true);

    set local role authenticated;

    select max(rr.total_count) into v_rows
    from public.report_run(
      v_report.key,
      coalesce(v_s.params -> 'report_params', '{}'::jsonb),
      1, 0) rr;

    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
  exception when others then
    -- Leaving the session as `authenticated` would make every later statement
    -- in this tick answer for a person who is not there.
    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
    raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, 0),
    'report_name', v_report.name,
    'recipient', v_up.id);
end;
$$;

revoke all on function public.schedule_report_digest(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A digest that refuses itself every morning is a schedule that does not work
-- ---------------------------------------------------------------------------

create or replace function public.schedule_problems()
returns table (schedule_id uuid, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
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
        when 'report.digest' then 'report.digest'
      end
    where s.tenant_id = v_tenant_id
  loop
    if not v_s.is_enabled then
      continue;
    end if;

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
    elsif v_s.kind = 'report.digest'
          and v_last.status = 'done'
          and coalesce(v_last.notified, 0) = 0
          and v_last.note is not null then
      -- A digest refuses itself rather than failing: the creator left, or their
      -- role lost the permission. Nothing is broken, so nothing raises, so
      -- without this the register carries the sentence and no screen reads it.
      return query select v_s.id, 'warning'::text, format(
        'The last run sent nothing. %s', v_last.note);
    elsif v_last.status = 'done' and v_last.matched > 0 and v_last.notified = 0 then
      return query select v_s.id, 'warning'::text, format(
        'The last run matched %s but told nobody -- none of them has a family '
        'login on file.', v_last.matched);
    end if;
  end loop;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- …and a digest with no waker is a fault, where a message with none is not
-- ---------------------------------------------------------------------------

-- `0230` reports the absence of an in-database job as *information*, because an
-- Edge Function calling `schedules_tick` is a supported and invisible-from-here
-- answer. For digests that is not true: nothing outside this database can run
-- one, so the absence of the job **is** the answer.
create or replace function public.scheduler_liveness()
returns jsonb
language plpgsql
security definer
stable
set search_path = 'public', 'extensions', 'cron'
as $$
declare
  v_jobs integer;
  v_digest_jobs integer;
  v_last timestamptz;
  v_status text;
begin
  if not public.role_has_permission('schedules.view') then
    raise exception 'Your role cannot see the scheduler.';
  end if;

  select count(*) into v_jobs
  from cron.job where jobname = 'schoolos_schedules_tick' and active;

  select count(*) into v_digest_jobs
  from cron.job where jobname = 'schoolos_schedule_digests_tick' and active;

  select d.end_time, d.status into v_last, v_status
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname = 'schoolos_schedules_tick'
  order by d.start_time desc
  limit 1;

  return jsonb_build_object(
    'in_database_waker', v_jobs > 0,
    'digest_waker', v_digest_jobs > 0,
    'last_run_at', v_last,
    'last_status', v_status,
    'minutes_since', case when v_last is null then null
                          else floor(extract(epoch from (now() - v_last)) / 60)::integer end);
end;
$$;

revoke all on function public.scheduler_liveness() from public, anon;

create or replace function public.scheduler_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v jsonb;
  v_minutes integer;
  v_digests integer;
begin
  if not public.role_has_permission('schedules.view') then
    return;
  end if;

  v := public.scheduler_liveness();
  v_minutes := (v ->> 'minutes_since')::integer;

  select count(*) into v_digests
  from public.schedules s
  where s.tenant_id = public.current_tenant_id()
    and s.is_enabled
    and s.kind = any (public.schedule_kinds_needing_authority());

  -- Silent unless this college actually has one, which is the bar CLAUDE.md
  -- sets for a critic: is somebody going to have to do something about it.
  if v_digests > 0 and not coalesce((v ->> 'digest_waker')::boolean, false) then
    return query select
      'scheduler.no_digest_waker',
      'warn',
      format(
        '%s scheduled report(s) are switched on and nothing in the database is '
        'running them. Unlike the message schedules, nothing outside it can: a '
        'report runs as the person who scheduled it, and only a database job '
        'has the authority to become them.', v_digests);
  end if;

  if not (v ->> 'in_database_waker')::boolean then
    -- Information, not a fault: an Edge Function or an external scheduler
    -- calling `schedules_tick` is a supported and invisible-from-here answer.
    return query select
      'scheduler.no_waker',
      'info',
      'Nothing inside the database is waking the scheduler. That is fine if '
      'something outside it calls schedules_tick -- the schedule-tick Edge '
      'Function does. If nothing does, every schedule stays silent for ever '
      'and no register of that is kept.';
    return;
  end if;

  if v_minutes is null then
    return query select
      'scheduler.never_ran',
      'warn',
      'The scheduler is set to run every five minutes and has never run once. '
      'Until it does, no absence notice, fee reminder or overdue-book reminder '
      'will go out.';
  elsif v_minutes > 30 then
    return query select
      'scheduler.stalled',
      'warn',
      format(
        'The scheduler last ran %s minutes ago and is set to run every five. '
        'Anything due since then is going out late, or past its grace, not at all.',
        v_minutes);
  end if;

  return;
end;
$$;

commit;
