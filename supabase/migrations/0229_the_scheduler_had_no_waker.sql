-- 0229 -- The scheduler had no waker.
--
-- `schedule_runs` is empty. Not one occurrence has ever fired, on a deployment
-- that has had six schedules and a scheduler module since migration `0110`.
--
-- The reason is not a bug in the module. **Nothing was calling it.** Swept:
-- no `vercel.json`, no `supabase/config.toml`, no cron entry anywhere in the
-- repository, and `pg_cron` was not installed. `schedule-tick` is an Edge
-- Function whose own header says its whole job is *"the one thing Postgres
-- cannot do: be woken up"* — and nothing woke it.
--
-- ## …and the obvious waker is forbidden by rule 6
--
-- `schedule-tick` refuses any caller whose token is not the service role, which
-- is correct: the URL would otherwise let anybody make every school's messages
-- go out early. But it means **the waker must hold the service-role key**, and
-- rule 6 says secrets never enter the Next.js app. A Vercel cron hitting a Next
-- route with that key in the environment is the shortest path and it is the one
-- this file forbids.
--
-- ## Postgres cannot be woken, but it can wake itself
--
-- Read what the Edge Function actually calls, rather than assuming it does
-- work:
--
--   subscription_expire_trials()
--   notify_expire_stale()
--   schedules_tick(p_limit, p_max_recipients)
--
-- **Three RPCs, and all three are Postgres functions with defaults.** The
-- function is a waker and nothing else — so with `pg_cron` there is nothing to
-- wake. No HTTP, no service-role key, no secret anywhere, and the jobs run as
-- `postgres`, which is exactly the authority those three already require
-- (each is `SECURITY DEFINER` and revoked from everybody holding a JWT).
--
-- The Edge Function **stays**. It is the deployment path for anywhere that is
-- not Supabase, and it is the manual button. Two wakers are safe here rather
-- than by luck: `schedule_runs` is unique on `(schedule_id, occurrence_at)` and
-- the run begins with `on conflict do nothing`, so an occurrence runs once
-- however many things ask for it. That was `0110`'s design and this is the
-- first time anything has depended on it.
--
-- ## Frequency, and why it is not the fifteen minutes the comment says
--
-- `schedule-tick`'s header says *"every fifteen minutes is plenty"*. That
-- figure was chosen when a wake-up cost an HTTP invocation. In-database it
-- costs a function call, and a five-minute grain is what makes `grace_minutes`
-- mean anything for a 07:30 absence notice — past its grace an occurrence is
-- written down as `missed`, and at fifteen-minute resolution a five-minute
-- grace can never be met.
--
-- The cron's own timezone is irrelevant and that is the module's whole point:
-- `schedules_tick` asks each tenant *"is it half past seven where you are?"*.
-- pg_cron runs in UTC and does not need to know.

begin;

create extension if not exists pg_cron;

-- Idempotent: re-running this migration re-points the jobs rather than
-- accumulating a second copy of each.
do $$
declare v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in (
      'schoolos_schedules_tick',
      'schoolos_expire_stale_deliveries',
      'schoolos_expire_trials')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end $$;

-- Every five minutes: which schools' clocks have passed which of their own
-- schedules. Bounded by `schedules_tick` itself (25 occurrences, 500
-- recipients), so a backlog is the next tick rather than a long transaction.
select cron.schedule(
  'schoolos_schedules_tick',
  '*/5 * * * *',
  $job$select public.schedules_tick()$job$);

-- Every half hour: a delivery whose kind has gone stale is marked `expired`
-- with the reason on the row. The claim refuses a stale row directly too, so
-- this sweep is the record rather than the enforcement -- *"why did nothing go
-- out"* must have an answer.
select cron.schedule(
  'schoolos_expire_stale_deliveries',
  '*/30 * * * *',
  $job$select public.notify_expire_stale()$job$);

-- Daily, a few minutes after midnight UTC. A trial ends on a date, so the hour
-- does not matter; what matters is that it ends at all, which is `0207`'s
-- point -- a trial that never ends is a free product.
select cron.schedule(
  'schoolos_expire_trials',
  '10 0 * * *',
  $job$select public.subscription_expire_trials()$job$);

commit;
