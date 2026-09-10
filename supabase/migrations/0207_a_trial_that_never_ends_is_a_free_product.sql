-- 0207 — A trial that never ends is a free product
--
-- `0205` gave every new school `status = 'trialing'` and `trial_ends_on =
-- current_date + 30`, and then **nothing anywhere moved it off that**. The
-- date was written down and never read. Thirty days later the school keeps its
-- 50 children and 10 staff for ever, and the only way anybody would find out is
-- by looking.
--
-- That is this file's own recurring shape, one turn after writing it down:
-- a column that records an intention, with no executable half. `ends_on` on a
-- bus seat was the same mistake (rule 2), and so was `fee_structures.frequency`
-- being stored for seventy migrations and never acted on (rule 6).
--
-- Three halves, because two is what the previous migration shipped.

begin;

-- ---------------------------------------------------------------------------
-- 1. The write half: a date passing is a fact, not a decision
-- ---------------------------------------------------------------------------

-- Rule 7's test for a scheduled job — *"anything it does must be expressible
-- without a user"* — and this passes it cleanly: whether 30 days have elapsed
-- is arithmetic, with nobody's authority in it. So it takes the same shape as
-- `notify_send_for`: `SECURITY DEFINER`, revoked from everybody holding a JWT,
-- called by the scheduler and by nothing a person can reach.
--
-- It is deliberately not a cron job inside Postgres. This project's scheduler
-- is `schedule-tick`, and a second timing mechanism would be a second place to
-- look when something did not run.
create or replace function public.subscription_expire_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.subscriptions
  set status = 'expired'
  where status = 'trialing'
    and trial_ends_on is not null
    and trial_ends_on < current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.subscription_expire_trials() is
  'Moves a lapsed trial to `expired`. Expressible without a user (rule 7): '
  'whether thirty days have passed is arithmetic. Revoked from anon and '
  'authenticated -- the scheduler calls it, nobody holding a JWT can.';

revoke all on function public.subscription_expire_trials() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. What `expired` actually does
-- ---------------------------------------------------------------------------

-- `0205`'s trigger read the plan's limits and ignored the subscription's
-- status, so an expired trial was indistinguishable from a live one. It now
-- refuses — and the shape of that refusal is a product decision worth stating
-- rather than leaving in a boolean:
--
--   * **The school keeps everything.** Nothing is deleted, hidden or locked;
--     every register, receipt and report reads exactly as before. A product
--     that holds a school's records hostage over a lapsed card is one no
--     school should trust with its records in the first place.
--   * **It cannot grow.** No new children, no new staff. That is the whole
--     consequence, it is reversible the moment somebody pays, and the message
--     says so.
--   * **`past_due` is not `expired`.** A card that failed on Tuesday is a bank,
--     not a decision — bricking admissions over it would punish a school for
--     something its bursar has not even been told about yet. Only `expired` and
--     `cancelled` refuse.
create or replace function public.subscription_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := new.tenant_id;
  v_resource text := tg_argv[0];
  v_allowed  bigint;
  v_used     bigint;
  v_plan     text;
  v_status   text;
begin
  select s.status, s.plan_code, (p.limits ->> v_resource)::bigint
    into v_status, v_plan, v_allowed
  from public.subscriptions s
  join reference.plans p on p.code = s.plan_code
  where s.tenant_id = v_tenant;

  -- A school with no subscription row at all predates this and must keep
  -- working. Silence here is deliberate, not an oversight.
  if v_status is null then
    return new;
  end if;

  if v_status in ('expired', 'cancelled') then
    raise exception
      'This school''s % has ended, so no more % can be added. Everything already '
      'recorded stays exactly as it is, and adding resumes as soon as the plan does.',
      case when v_status = 'expired' then 'trial' else 'subscription' end,
      v_resource
      using errcode = 'check_violation';
  end if;

  if v_allowed is null then
    return new;
  end if;

  if v_resource = 'students' then
    select count(*) into v_used from public.students
    where tenant_id = v_tenant and status = 'active';
  elsif v_resource = 'staff' then
    select count(*) into v_used from public.staff
    where tenant_id = v_tenant and status = 'active';
  else
    return new;
  end if;

  if v_used >= v_allowed then
    raise exception
      'The % plan covers % %, and this school already has %. Upgrade the plan to add more.',
      v_plan, v_allowed, v_resource, v_used
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The critic, because a date nobody is warned about is an ambush
-- ---------------------------------------------------------------------------

-- Rule 12's bar for a `problems()` function: not *"could this be wrong"* but
-- *"is somebody going to have to do something about it"*. Every branch here
-- clears it, and each is silent until it does — a school on a healthy plan with
-- room to spare gets nothing at all.
create or replace function public.subscription_problems()
returns table (key text, severity text, message text)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  -- The trial is running out. Seven days, because that is long enough for a
  -- head teacher to get a purchase order signed and short enough that the
  -- warning is not background noise for a month.
  select
    'trial.ending'::text,
    'warning'::text,
    format(
      'The trial ends on %s. After that the roll is frozen where it is -- nothing '
      'is lost, but no new children or staff can be added until a plan is chosen.',
      to_char(s.trial_ends_on, 'FMDD Mon YYYY')
    )
  from public.subscriptions s
  where s.status = 'trialing'
    and s.trial_ends_on is not null
    and s.trial_ends_on >= current_date
    and s.trial_ends_on < current_date + 7

  union all

  -- It already has.
  select
    'trial.ended'::text,
    'error'::text,
    format(
      'The trial ended on %s. Everything recorded is intact and readable, and no '
      'new children or staff can be added until a plan is chosen.',
      to_char(s.trial_ends_on, 'FMDD Mon YYYY')
    )
  from public.subscriptions s
  where s.status = 'expired'

  union all

  select
    'plan.past_due'::text,
    'warning'::text,
    'The last payment did not go through. Nothing is limited yet -- this is a '
    'warning rather than a wall -- but it will be if it stays unpaid.'::text
  from public.subscriptions s
  where s.status = 'past_due'

  union all

  -- Over a ceiling. Reachable without expiring: a school upgraded *down*, or
  -- admitted through an import before a limit existed. `subscription_usage()`
  -- already distinguishes "no ceiling" from "a ceiling of zero", so this cannot
  -- fire on a plan that has none.
  select
    'plan.over_limit'::text,
    'error'::text,
    format(
      'This school has %s %s and the plan covers %s. Nothing has been removed; '
      'no more can be added until the plan changes.',
      u.used, u.resource, u.allowed
    )
  from public.subscription_usage() u
  where u.over

  order by 1;
$$;

comment on function public.subscription_problems() is
  'What a school needs to do something about on its plan. SECURITY INVOKER: '
  'every branch reads `subscriptions` through its own policy, so a member sees '
  'their own school and no other. Silent when there is nothing to act on.';

revoke all on function public.subscription_problems() from public, anon;
grant execute on function public.subscription_problems() to authenticated;

-- Catalogued, or nobody finds it. Rule 11: *"a critic is only worth what it
-- costs to reach it"* -- eight `problems()` functions existed on one screen
-- each, and a school learned four hundred parents were getting nothing by
-- happening to open the schedules page.
--
-- Gated on `settings.manage` rather than anything a teacher holds, by the rule
-- migration 0189 wrote down: a critic is addressed to somebody who can *act* on
-- it. A class teacher cannot choose a plan.
insert into reference.checks
  (key, label, description, function_name, shape, module, href, required_permission, sort)
values
  ('platform.subscription', 'The plan',
   'Whether the trial is running out, a payment has failed, or the school has outgrown what it pays for.',
   'subscription_problems', 'severity_message', 'Settings', '/settings/plan',
   'settings.manage', 5)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      function_name = excluded.function_name,
      shape = excluded.shape,
      module = excluded.module,
      href = excluded.href,
      required_permission = excluded.required_permission,
      sort = excluded.sort;

commit;
