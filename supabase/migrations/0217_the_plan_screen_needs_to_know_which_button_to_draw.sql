-- 0217 — The plan screen needs to know which button to draw
--
-- `0214` gave a plan a `provider_plan_id` and `subscription_start_checkout` a
-- refusal when it is null. `subscription_overview()` — the one call the plan
-- screen makes — does not return it, so the screen cannot tell a purchasable
-- plan from one that will refuse.
--
-- Drawing *Upgrade* on every card and letting the refusal arrive after the
-- click is exactly the failure this file has now found twice in one week: a
-- teacher taken through a whole certificate form to meet a Postgres error, an
-- accountant shown every schedule switch and refused on each. **A control that
-- will refuse you is worse than no control**, because it costs the person the
-- work of trying.
--
-- Two keys are added and both are additive, so no existing reader breaks:
--
--   available[].purchasable   this plan has an id at the provider
--   checkout                  the college's own live checkout, if any
--
-- The second is what stops the screen offering *Upgrade* to somebody who
-- already has a payment link open in another tab. `subscription_start_checkout`
-- supersedes a stale one deliberately (rule 13's one-live-run, and refusing
-- would strand them behind their own abandoned click), but the screen should
-- show the link they already have rather than making a second one for no
-- reason.
--
-- Still `SECURITY INVOKER`, still one round trip: the screen is glanced at, so
-- it is a dashboard rather than a lookup (rule 11), and RLS decides what goes
-- in. `reference.plans` is not tenant data and has no policy — reading it here
-- is the same as it was before.

begin;

create or replace function public.subscription_overview()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'subscription', (
      select to_jsonb(x) from (
        select s.plan_code, s.status, s.trial_ends_on, s.current_period_end
        from public.subscriptions s where s.tenant_id = public.current_tenant_id()
      ) x
    ),
    'plan', (
      select to_jsonb(y) from (
        select p.code, p.name, p.description, p.price_minor, p.currency, p.bill_every, p.limits
        from public.subscriptions s join reference.plans p on p.code = s.plan_code
        where s.tenant_id = public.current_tenant_id()
      ) y
    ),
    'usage', coalesce((select jsonb_agg(to_jsonb(u) order by u.resource) from public.subscription_usage() u), '[]'::jsonb),
    'available', coalesce(
      (select jsonb_agg(to_jsonb(z) order by z.sort) from (
         select p.code, p.name, p.description, p.price_minor, p.currency,
                p.bill_every, p.limits, p.sort,
                -- The id itself is NOT exported: it is the platform's
                -- configuration at the provider, and a boolean is the whole of
                -- what a screen needs. A free plan is never "purchasable" —
                -- there is nothing to pay — so the price is part of the answer.
                (p.provider_plan_id is not null and p.price_minor > 0) as purchasable
         from reference.plans p where p.is_public
       ) z), '[]'::jsonb),
    'checkout', (
      select to_jsonb(c) from (
        select sc.id, sc.plan_code, sc.status, sc.checkout_url, sc.expires_at
        from public.subscription_checkouts sc
        where sc.tenant_id = public.current_tenant_id()
          and sc.status in ('pending', 'linked')
        -- The partial unique index makes at most one such row exist, so this
        -- `limit 1` is a formality rather than "the latest of several" — the
        -- distinction rule 2 draws about reading a history.
        limit 1
      ) c
    )
  );
$$;

comment on function public.subscription_overview() is
  'Everything the plan screen shows, in one document: the subscription, its '
  'plan, live usage, the public catalogue with a purchasable flag, and the '
  'college''s own open checkout if it has one. INVOKER -- RLS decides.';

commit;
