-- ---------------------------------------------------------------------------
-- The tick was locked, and the room behind it was not
-- ---------------------------------------------------------------------------
--
-- Found on the way to building this product's first *deliberate* anonymous
-- write path -- the online admission form -- by asking the question that has to
-- come first: **what can an anonymous caller already reach?**
--
-- `has_function_privilege('anon', ...)` over `public`, filtered to
-- `SECURITY DEFINER`, returned nine functions. Six are trigger functions, and
-- Postgres refuses to call one directly -- probed as `anon`:
--
--   0A000: trigger functions can only be called as triggers
--
-- One, `platform_slug_available`, is anonymous on purpose: the signup form asks
-- whether a slug is free before the person has an account. `job_cancel` opens
-- with `if v_tenant_id is null then raise`, so a tenantless caller is refused.
-- That leaves one.
--
-- **`schedule_run` has no caller check at all.** It is the scheduler's runner:
-- definer, because it writes `notification_deliveries`, which has no INSERT
-- policy by design (rule 10). It looks the schedule up by id with no tenant
-- filter, and takes `p_occurrence_at` and `p_digest` from its caller. Probed as
-- `anon` -- the role the publishable key in every browser bundle maps to -- in a
-- rolled-back transaction:
--
--   schedule_run('<RKM fee reminder, switched OFF>', now(), 5, null)
--   -> status 'done': "Stopped at 5, which is this run's limit ...
--                      5 had no family login to send to."
--
-- It ran a college's fee reminder that is **switched off**, for a caller with no
-- account, and wrote nothing only because none of those five families has a
-- login yet. The demo data was the only thing standing in the way, and the
-- invitation work of the last thirty migrations exists to remove exactly that.
-- Once families sign in, anybody holding the public key could make any college
-- text its families on demand. `p_occurrence_at` is the caller's, so the unique
-- index that makes an occurrence run once does not bind: a new timestamp is a
-- new occurrence.
--
-- `schedules_tick` -- its only non-digest caller -- was revoked from `anon`
-- correctly. **The door was locked and the room behind it was not.** Postgres
-- grants EXECUTE on every new function to PUBLIC, and on Supabase to `anon`
-- and `authenticated` explicitly as well, so a definer function is callable by
-- anybody unless a migration says otherwise; `0142` and `0241` said so for the
-- tick and not for the thing the tick calls.
--
-- > **A definer function is a privilege, not a helper.** Inside it no policy
-- > runs, so its EXECUTE grant is the only check there is -- rule 1's sentence
-- > about TRUNCATE, arriving at functions. `0159` fixed the tables' default
-- > grant and wrote a guard; the functions' default grant never got one.
--
-- Who legitimately calls it, checked rather than assumed: the two ticks, both
-- woken by pg_cron as `postgres` (`cron.job.username`), and nothing in `src/` or
-- `supabase/functions/`. `schedule_digests_tick` impersonates a user, but for
-- exactly one `report_run` statement, and resets the role before it calls
-- `schedule_run` -- so revoking from `authenticated` does not reach it.

begin;

-- ---------------------------------------------------------------- the fix --

revoke all on function public.schedule_run(uuid, timestamptz, integer, jsonb)
  from public, anon, authenticated;

comment on function public.schedule_run(uuid, timestamptz, integer, jsonb) is
  'Run one occurrence of one schedule. SECURITY DEFINER and deliberately '
  'callable by nobody holding a JWT: it has no caller check of its own, takes '
  'the occurrence and the digest from its caller, and writes deliveries no '
  'policy admits. Its callers are schedules_tick (definer) and '
  'schedule_digests_tick (pg_cron as postgres). Revoked in 0267 after a probe '
  'as anon ran a switched-off fee reminder.';

-- Refuses a tenantless caller already, so this changes no behaviour -- it is
-- here so the guard below can say "no definer is anonymous by accident" without
-- an exception that exists only because the function happened to be careful.
revoke all on function public.job_cancel(uuid) from public, anon;

-- ------------------------------------------------------ the fifth guard --

-- Beside `schema_guard_violations`, `privilege_guard_violations`,
-- `audit_guard_violations` and `index_guard_violations`, and kept separate for
-- the reason `0160` gave: shape, grants, audit, indexes and function privileges
-- are different questions that fail for different reasons, and one guard
-- answering five is one guard nobody can read the failure of.
--
-- **The question is narrow on purpose.** Every definer reachable by `anon`
-- must be on the list below with its reason. It does not ask about
-- `authenticated`, because a signed-in caller reaching a definer is the normal
-- case -- dozens of them, each with its own permission check inside -- and a
-- guard that reports the normal case is a guard somebody switches off. The
-- cross-tenant half of `schedule_run` (any college's member could run any
-- college's schedule) is closed by the revoke above and is **not** something
-- this guard can see; that is written down rather than implied.
--
-- Trigger functions are excluded by return type, on the probe above: Postgres
-- will not call one outside a trigger, so its EXECUTE grant decides nothing.
create or replace function public.definer_guard_violations()
returns table (function_name text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with anonymous_on_purpose (name, why) as (
    values
      -- The signup form asks whether a slug is free before an account exists.
      -- Returns a boolean about a slug and nothing about the college behind it.
      ('platform_slug_available',
       'answers whether a college slug is free, for a signup form with no account yet')
  )
  select
    p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    'SECURITY DEFINER and executable by anon, and not on the list in '
    || 'definer_guard_violations(). Inside a definer no policy runs, so this '
    || 'grant is the only check -- revoke it, or name the function there with '
    || 'the reason an anonymous caller needs it.'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in (select name from anonymous_on_purpose)
  order by 1
$$;

revoke all on function public.definer_guard_violations() from public, anon;
grant execute on function public.definer_guard_violations() to authenticated;

comment on function public.definer_guard_violations() is
  'An empty result is the passing state. Every SECURITY DEFINER function in '
  'public that anon can execute is named inside this function with its reason; '
  'anything else is a way around every policy for a caller with no account. '
  'Trigger functions are excluded because Postgres will not call one directly. '
  'Migration 0267.';

commit;
