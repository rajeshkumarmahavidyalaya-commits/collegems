-- 0216 — A deployment that cannot take money should say so
--
-- Two corrections and one addition, all from the same sentence in `0214`'s
-- header:
--
--   > Null means "this plan is not purchasable yet" … see
--   > `subscription_problems()` below, which says so rather than failing at
--   > checkout.
--
-- **There was no such thing below.** `0214` added the column and the refusal
-- and never touched the critic, so that forward reference described an
-- intention rather than the file. Migrations are immutable once applied, so
-- this is the correction — the `0129` → `0131` shape a second time in three
-- migrations, which is worth noticing on its own:
--
-- > A comment that describes what the migration *ought* to contain reads
-- > exactly like one describing what it does. The tell is the cross-reference:
-- > **if a comment names a function, open it.**
--
-- ## What the critic now says, and to whom
--
-- `plan.unpurchasable` fires when the college's own plan cannot be paid for
-- online — a deployment where nobody has mapped `reference.plans` onto the
-- provider's dashboard. That is a **platform** fault rather than a college's,
-- and the sentence says so, because a bursar who reads "we cannot take your
-- money" and thinks it is their bank will ring the wrong number.
--
-- It is silent on `trial`, which is not supposed to be purchasable, and silent
-- once a plan carries a `provider_plan_id`. Rule 12's bar: *is somebody going
-- to have to do something about it* — yes, and that somebody is the platform.

begin;

create or replace function public.subscription_problems()
returns table (key text, severity text, message text)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select 'trial.ending'::text, 'warning'::text,
    format('The trial ends on %s. After that the roll is frozen where it is -- nothing is lost, but no new children or staff can be added until a plan is chosen.', to_char(s.trial_ends_on, 'FMDD Mon YYYY'))
  from public.subscriptions s
  where s.status = 'trialing' and s.trial_ends_on is not null
    and s.trial_ends_on >= current_date and s.trial_ends_on < current_date + 7
  union all
  select 'trial.ended'::text, 'error'::text,
    format('The trial ended on %s. Everything recorded is intact and readable, and no new children or staff can be added until a plan is chosen.', to_char(s.trial_ends_on, 'FMDD Mon YYYY'))
  from public.subscriptions s where s.status = 'expired'
  union all
  select 'plan.past_due'::text, 'warning'::text,
    'The last payment did not go through. Nothing is limited yet -- this is a warning rather than a wall -- but it will be if it stays unpaid.'::text
  from public.subscriptions s where s.status = 'past_due'
  union all
  select 'plan.over_limit'::text, 'error'::text,
    format('This school has %s %s and the plan covers %s. Nothing has been removed; no more can be added until the plan changes.', u.used, u.resource, u.allowed)
  from public.subscription_usage() u where u.over

  union all

  -- The addition. Deliberately phrased as the platform's problem: a college
  -- reading "payment is not set up" about their own account would go and check
  -- their bank, and the thing that is actually missing is a row in the
  -- provider's dashboard that only the platform can create.
  select 'plan.unpurchasable'::text, 'warning'::text,
    format(
      'The %s plan cannot be paid for online on this deployment yet -- that is ours to fix, not yours. Nothing is limited; get in touch and we will move you across by hand.',
      p.name)
  from public.subscriptions s
  join reference.plans p on p.code = s.plan_code
  where p.price_minor > 0
    and p.provider_plan_id is null
    -- Only while it matters: a college that is paying, or in trial, is not
    -- waiting on a checkout button. This is for the one who has decided to buy
    -- and cannot.
    and s.status in ('expired', 'past_due', 'cancelled')

  order by 1;
$$;

comment on function public.subscription_problems() is
  'What is wrong with this college''s subscription, in sentences. Includes '
  'plan.unpurchasable, which is a fault in the deployment rather than in the '
  'college -- reference.plans has no provider_plan_id, so no checkout can be '
  'started and somebody at the platform has to map it.';

commit;
