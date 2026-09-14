-- 0230 -- Nothing said the scheduler was asleep.
--
-- `0229` gave the scheduler a waker. The question this asks is why nobody
-- noticed it did not have one for a hundred and twenty migrations.
--
-- The module is well instrumented and every instrument was pointed one step too
-- far in. `schedule_runs` is the register of what ran; `schedule_problems()`
-- says *whether anybody heard* — it reads `is_enabled` and
-- `provider_configured`, so it answers the reach question properly. **Both are
-- silent when the tick never happens at all**, because a scheduler that is not
-- running produces no runs to criticise and no deliveries to find fault with.
--
-- > An empty register reads as *"nothing was due"*. It reads identically to
-- > *"nothing is asking"*. That is `attendance_coverage`'s lesson — a rate
-- > cannot say what was never measured — arriving at the scheduler.
--
-- ## Judged by evidence, not by the cron table
--
-- The tempting check is *"is there a row in `cron.job`"*. That would be a false
-- accusation on any deployment that is not Supabase: `schedule-tick` is still
-- the supported waker there, and it leaves no trace in `cron.*`.
--
-- So the absence of an in-database job is reported as **information, not a
-- fault**, in a sentence that says what would make it fine; and where a job
-- does exist, it is judged on whether it has actually succeeded recently. The
-- bar CLAUDE.md sets for a critic is *"is somebody going to have to do
-- something about it"*, and a critic that fires on a correctly-configured
-- external waker teaches people to ignore it.

begin;

-- ---------------------------------------------------------------------------
-- Reading the cron catalogue, which is the postgres role's alone
-- ---------------------------------------------------------------------------

-- `SECURITY DEFINER` because `cron.job` and `cron.job_run_details` are not
-- readable by `authenticated`, and deliberately narrow: it returns whether a
-- job exists and when it last succeeded. **No tenant data is in the
-- projection** — this is a fact about the deployment, the same standard `0209`
-- holds the platform functions to.
create or replace function public.scheduler_liveness()
returns jsonb
language plpgsql
security definer
stable
set search_path = 'public', 'extensions', 'cron'
as $$
declare
  v_jobs integer;
  v_last timestamptz;
  v_status text;
begin
  if not public.role_has_permission('schedules.view') then
    raise exception 'Your role cannot see the scheduler.';
  end if;

  select count(*) into v_jobs
  from cron.job where jobname = 'schoolos_schedules_tick' and active;

  select d.end_time, d.status into v_last, v_status
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname = 'schoolos_schedules_tick'
  order by d.start_time desc
  limit 1;

  return jsonb_build_object(
    'in_database_waker', v_jobs > 0,
    'last_run_at', v_last,
    'last_status', v_status,
    'minutes_since', case when v_last is null then null
                          else floor(extract(epoch from (now() - v_last)) / 60)::integer end);
end;
$$;

revoke all on function public.scheduler_liveness() from public, anon;

comment on function public.scheduler_liveness() is
  'Whether anything in the database is waking the scheduler, and when it last '
  'succeeded. Definer because the cron catalogue is the postgres role''s; no '
  'tenant data is in the projection.';

-- ---------------------------------------------------------------------------
-- ...and the sentence somebody acts on
-- ---------------------------------------------------------------------------

create or replace function public.scheduler_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v jsonb;
  v_minutes integer;
begin
  if not public.role_has_permission('schedules.view') then
    return;
  end if;

  v := public.scheduler_liveness();
  v_minutes := (v ->> 'minutes_since')::integer;

  if not (v ->> 'in_database_waker')::boolean then
    -- Information, not a fault: an Edge Function or an external scheduler
    -- calling `schedules_tick` is a supported and invisible-from-here answer.
    return query select
      'scheduler.no_waker',
      'info',
      'Nothing inside the database is waking the scheduler. That is fine if '
      'something outside it calls schedules_tick — the schedule-tick Edge '
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
  elsif (v ->> 'last_status') is distinct from 'succeeded' then
    return query select
      'scheduler.failing',
      'warn',
      format('The scheduler''s last run ended as "%s" rather than succeeding.',
             coalesce(v ->> 'last_status', 'unknown'));
  end if;
end;
$$;

comment on function public.scheduler_problems() is
  'Whether anything is waking the scheduler at all. schedule_problems() asks '
  'whether anybody heard; both it and the run register are silent when the tick '
  'never happens, because a scheduler that is not running produces nothing to '
  'criticise.';

insert into reference.checks (key, label, description, function_name, shape, module, href, required_permission, sort, is_active)
values (
  'schedules.alive',
  'Scheduler',
  'Whether anything is waking the scheduler. Everything timed depends on it.',
  'scheduler_problems',
  'severity_message',
  'Communication',
  '/schedules',
  'schedules.view',
  65,
  true
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  function_name = excluded.function_name,
  shape = excluded.shape,
  module = excluded.module,
  href = excluded.href,
  required_permission = excluded.required_permission,
  sort = excluded.sort,
  is_active = excluded.is_active;

commit;
