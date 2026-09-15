-- 0243 -- A queue nobody drains is a table.
--
-- `0242` built the queue and stopped one step short of the thing that makes it
-- a queue. This is the other half, and the shape of the omission is one this
-- file has recorded before:
--
-- > `0229` gave the *scheduler* a waker, a hundred and twenty migrations after
-- > the scheduler. `0163` gave `audit_log` a reader, after 24,000 rows had
-- > accumulated behind an admin-only policy with no caller. **The machinery is
-- > the part that gets built; the thing that turns it on is the part that gets
-- > left.**
--
-- So this migration is two small things, and neither is optional:
--
--   - **the waker** — `schoolos_jobs_tick`, a cron entry, because `jobs_tick`
--     with nothing calling it is `accounts_sync` with a button nobody presses,
--     which is the defect `0242` exists to fix;
--   - **the critic** — `job_problems()`, catalogued in `reference.checks`, so a
--     job that failed three times is a sentence on `/checks` rather than a row
--     in a table nobody opens.
--
-- ## One minute, not five
--
-- Both existing cron entries run every five minutes and this one runs every
-- minute, which is a difference worth justifying rather than leaving as an
-- inconsistency:
--
-- > **A schedule is the school's standing decision and nobody is waiting. A job
-- > is somebody's request, made now.** A bursar who presses *Post to the ledger*
-- > and watches nothing happen for five minutes concludes it is broken and
-- > presses it again — and `jobs_one_live_per_kind` then refuses them, which is
-- > correct and reads as a second failure.
--
-- The cost is a query every minute that usually returns nothing:
-- `jobs_due` is an index-only scan of `jobs_due_idx` over a table that is empty
-- when there is no work.

begin;

-- ---------------------------------------------------------------------------
-- The waker
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('schoolos_jobs_tick')
    where exists (select 1 from cron.job where jobname = 'schoolos_jobs_tick');

    -- As `postgres`, and that is load-bearing rather than incidental:
    -- `jobs_tick` is SECURITY INVOKER and refuses any role that cannot become
    -- `authenticated`, because a job runs as the person who queued it. The
    -- Edge Functions run as `service_role`, which is not a member of
    -- `authenticated` (`0241`), so they are deliberately given nothing here.
    perform cron.schedule(
      'schoolos_jobs_tick',
      '* * * * *',
      $job$select public.jobs_tick()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- …and the sentence somebody acts on
-- ---------------------------------------------------------------------------

create or replace function public.job_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row record;
begin
  if v_tenant_id is null then
    return;
  end if;

  -- A job that gave up. `error` is kept by `job_record` precisely so this can
  -- quote it: *"why did nothing happen"* must have an answer, which is rule 7's
  -- rule for a missed schedule arriving at the queue.
  for v_row in
    select j.job_type, k.label, j.error, j.attempts, j.progress_done
    from public.jobs j
    join reference.job_kinds k on k.key = j.job_type
    where j.tenant_id = v_tenant_id and j.status = 'failed'
    order by j.completed_at desc nulls last
    limit 20
  loop
    return query select
      'jobs.failed',
      'error'::text,
      format('%s stopped after %s %s. %s%s',
             v_row.label,
             v_row.attempts,
             -- Both forms carried rather than a stem and a rule: English
             -- plurals are not derivable, and a count-dependent word left
             -- disagreeing reads exactly as careless (`0196`).
             case when v_row.attempts = 1 then 'attempt' else 'attempts' end,
             coalesce(v_row.error, 'No reason was recorded.'),
             case when v_row.progress_done > 0
                  then format(' %s were done before it stopped, and those stay done.',
                              v_row.progress_done)
                  else '' end);
  end loop;

  -- A refusal is not a failure, and the difference is what somebody must do
  -- about it: a failure may be worth starting again, a refusal means a
  -- permission or a person changed.
  for v_row in
    select j.job_type, k.label, j.error, j.progress_done
    from public.jobs j
    join reference.job_kinds k on k.key = j.job_type
    where j.tenant_id = v_tenant_id and j.status = 'refused'
      and j.completed_at > now() - interval '30 days'
      -- Somebody pressing Stop is not a finding. They know.
      and coalesce(j.error, '') <> 'Stopped by somebody at the school.'
    order by j.completed_at desc
    limit 20
  loop
    return query select
      'jobs.refused',
      'warn'::text,
      format('%s stopped part-way. %s', v_row.label,
             coalesce(v_row.error, 'No reason was recorded.'));
  end loop;

  -- Queued and not moving. Anything still waiting ten minutes after it was due
  -- means the waker is not running -- `scheduler_problems()` answers that
  -- question for the *schedulers*, and until now nothing asked it of the queue.
  for v_row in
    select k.label, count(*) as n, min(j.created_at) as oldest
    from public.jobs j
    join reference.job_kinds k on k.key = j.job_type
    where j.tenant_id = v_tenant_id
      and j.status = 'queued'
      and j.not_before < now() - interval '10 minutes'
    group by k.label
  loop
    return query select
      'jobs.stuck',
      'warn'::text,
      format('%s has been waiting since %s and nothing has picked it up. '
             'That usually means the thing that runs background work is not running.',
             v_row.label, to_char(v_row.oldest, 'FMDD Mon, HH24:MI'));
  end loop;

  return;
end;
$$;

comment on function public.job_problems() is
  'What is wrong in the queue, in sentences. Gated by RLS on jobs rather than '
  'by a permission check of its own: the policy already says an administrator '
  'sees the college''s jobs and everybody else sees their own.';

insert into reference.checks (key, label, description, function_name, shape, module, href, required_permission, sort)
values (
  'jobs.queue',
  'Background work',
  'Whether anything the school started in the background has stopped, been refused, or is waiting for a worker that is not running.',
  'job_problems',
  'severity_message',
  'Settings',
  '/settings/jobs',
  -- Every role that can queue anything should be able to see that it broke.
  -- `settings.manage` is what `/settings` already gates on, and an accountant
  -- who queued the ledger sync sees their own row through the policy either way.
  'settings.manage',
  95)
on conflict (key) do nothing;

commit;
