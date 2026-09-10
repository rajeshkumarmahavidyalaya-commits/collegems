-- 0214 — A plan nobody can pay for is a price list
--
-- `0205` created `reference.plans` with prices on it and `public.subscriptions`
-- with `provider`, `provider_customer_id` and `provider_subscription_id`.
-- **Nothing has ever written those three columns.** `0207` added trial expiry
-- and `0209` gave an operator a dropdown, so today a college's plan changes
-- because somebody at the platform moves it by hand.
--
-- That is the same shape this file keeps naming — `fee_structures.frequency`
-- stored and never acted on, `trial_ends_on` written and never read, a bus
-- seat's `ends_on` documented in a comment nobody could execute. A column
-- recording an intention with no executable half.
--
-- ## Whose Razorpay account, and why that is the first question
--
-- Rule 6 already puts the college's gateway credentials on the Edge Functions:
-- `RAZORPAY_KEY_ID` and friends are how a **college charges a family**. This is
-- the other direction — **the platform charging a college** — and it is a
-- different merchant account with different keys.
--
-- > Two flows of money in opposite directions must not share a secret. A
-- > signature bug in the fee webhook would then also be a signature bug in the
-- > one that decides whether a school keeps its subscription.
--
-- So the platform's credentials are `PLATFORM_RAZORPAY_KEY_ID`,
-- `PLATFORM_RAZORPAY_KEY_SECRET` and `PLATFORM_RAZORPAY_WEBHOOK_SECRET`, on
-- their own Edge Functions, and neither pair is ever in the Next.js app.
--
-- ## Two tables, because "asked for" and "on" are different facts
--
-- `subscription_checkouts` is the intent — *this college pressed Upgrade to
-- standard at 14:02*. `subscriptions.plan_code` is what they are actually on.
-- Collapsing them hands a college the plan the moment they click, which is the
-- whole reason `payment_intents` exists one module along.
--
-- `subscription_invoices` is what the platform charged and when the money
-- arrived. Rule 6's shape applied to the platform's own receivable: append-only
-- by **revoke** (the stronger of the two, because this is the record of what
-- happened), idempotent on the provider's event id, and in **minor units**
-- throughout — Razorpay speaks paise, and a float rupee somewhere in the middle
-- is how a bill comes out a penny wrong.
--
-- ## What a college may do with any of this
--
-- Read it. Both tables carry `tenant_id` and RLS per rule 1, both are readable
-- by every member of the college (a bursar who cannot see the bill cannot pay
-- it), and **neither has a write policy at all** — the same decision `0205`
-- made for `subscriptions`. Every write is a definer function: one for the
-- college's own intent, one for the callback, and the callback's is revoked
-- from everybody holding a JWT.

begin;

-- ---------------------------------------------------------------------------
-- The plan needs the provider's name for it
-- ---------------------------------------------------------------------------

-- Razorpay Subscriptions bill against a plan registered in Razorpay's own
-- dashboard, so a code here has to be mapped to an id there. Null means "this
-- plan is not purchasable yet", which is exactly right for `trial` and is the
-- state every plan is in on a deployment nobody has configured — see
-- `subscription_problems()` below, which says so rather than failing at
-- checkout.
alter table reference.plans
  add column if not exists provider text,
  add column if not exists provider_plan_id text;

comment on column reference.plans.provider_plan_id is
  'The plan''s id in the payment provider''s own dashboard. Null means the '
  'plan cannot be bought yet -- a deployment-level fact, which is why it is '
  'here on the platform''s catalogue rather than on a tenant row.';

-- ---------------------------------------------------------------------------
-- The intent
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_checkouts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  plan_code       text not null references reference.plans(code),
  provider        text not null default 'razorpay',
  -- Written back by the Edge Function once the provider has been asked.
  provider_subscription_id text,
  checkout_url    text,
  status          text not null default 'pending'
                  check (status in ('pending', 'linked', 'paid', 'cancelled', 'failed')),
  failure_reason  text,
  -- A link that is a fortnight old is a price somebody was quoted a fortnight
  -- ago. `payment_intents` makes the same promise for the same reason.
  expires_at      timestamptz not null default now() + interval '24 hours',
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists subscription_checkouts_tenant_idx
  on public.subscription_checkouts (tenant_id, created_at desc);

-- The Edge Function and the webhook both find a checkout by what the provider
-- calls it, so that lookup is the one that has to be a seek.
create unique index if not exists subscription_checkouts_provider_key
  on public.subscription_checkouts (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- Rule 13's partial-unique device: one live checkout per college. Two
-- half-finished upgrades disagree, and whichever is paid second silently wins.
create unique index if not exists subscription_checkouts_one_live
  on public.subscription_checkouts (tenant_id)
  where status in ('pending', 'linked');

alter table public.subscription_checkouts enable row level security;

drop policy if exists "members view own subscription_checkouts" on public.subscription_checkouts;
create policy "members view own subscription_checkouts"
  on public.subscription_checkouts for select
  using (tenant_id = (select public.current_tenant_id()));

-- No write policy, deliberately. Everything that writes here is a definer
-- function below. A migration that tidily "adds the missing insert policy"
-- lets a student start a checkout for their school.
comment on table public.subscription_checkouts is
  'A college asking to move to a plan, and the provider''s answer. Deliberately '
  'separate from subscriptions.plan_code, which is what they are actually on -- '
  'collapsing the two hands a college the plan the moment they click. No write '
  'policy: subscription_start_checkout is the only way in.';

drop trigger if exists set_updated_at on public.subscription_checkouts;
create trigger set_updated_at before update on public.subscription_checkouts
  for each row execute function public.set_updated_at();

drop trigger if exists audit_subscription_checkouts on public.subscription_checkouts;
create trigger audit_subscription_checkouts
  after insert or update or delete on public.subscription_checkouts
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- What was charged
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_invoices (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  plan_code          text not null references reference.plans(code),
  -- Minor units, because the provider speaks them. A rupee here and paise at
  -- the provider is the `library.fine_per_day` mistake with a decimal point in
  -- it: two representations of one number, agreeing until they do not.
  amount_minor       bigint not null check (amount_minor >= 0),
  currency           text not null default 'INR',
  period_start       date not null,
  period_end         date not null,
  status             text not null check (status in ('paid', 'failed')),
  provider           text not null default 'razorpay',
  provider_event_id  text not null,
  provider_payment_id text,
  occurred_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint subscription_invoices_period check (period_end >= period_start)
);

create index if not exists subscription_invoices_tenant_idx
  on public.subscription_invoices (tenant_id, occurred_at desc);

-- Rule 6: make idempotency a unique index on the source row. A retried webhook
-- converges instead of billing twice.
create unique index if not exists subscription_invoices_event_key
  on public.subscription_invoices (provider, provider_event_id);

alter table public.subscription_invoices enable row level security;

drop policy if exists "members view own subscription_invoices" on public.subscription_invoices;
create policy "members view own subscription_invoices"
  on public.subscription_invoices for select
  using (tenant_id = (select public.current_tenant_id()));

-- Append-only by REVOKE rather than by an absent policy — rule 6's stronger
-- shape, because this table is the record of what the platform charged and
-- nobody, the platform included, should edit it after the fact. A write raises
-- 42501 rather than silently matching nothing.
revoke update, delete, truncate on public.subscription_invoices from public, anon, authenticated;

comment on table public.subscription_invoices is
  'What the platform charged this college and whether the money arrived. '
  'Append-only by revoke; idempotent on the provider''s event id. Minor units '
  'throughout, because the provider speaks them.';

-- Rule 9's exemption test — "a table is exempt when the row IS the record" —
-- applies here, so no audit trigger: an append-only row that is never edited
-- would store a second copy of a fact that cannot change.

-- ---------------------------------------------------------------------------
-- The college asks
-- ---------------------------------------------------------------------------

create or replace function public.subscription_start_checkout(p_plan_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_plan reference.plans;
  v_current text;
  v_id uuid;
begin
  if v_tenant is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  -- SECURITY DEFINER because the table has no write policy, so the permission
  -- check is this function's own job. `users.manage` rather than
  -- `settings.manage`: committing a college to a monthly charge is the same
  -- kind of act as deciding who may sign in, and `0213` took the fee-head
  -- meaning out of `settings.manage`.
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role does not change the college''s plan.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_plan from reference.plans where code = p_plan_code;
  if v_plan.code is null then
    raise exception 'There is no plan called %.', p_plan_code using errcode = 'check_violation';
  end if;

  -- A plan with no id at the provider cannot be bought, and saying so here is
  -- the difference between a sentence and a failed callback nobody sees.
  if v_plan.provider_plan_id is null then
    raise exception
      '% is not set up for online payment on this deployment yet. Get in touch and we will move you across.',
      v_plan.name
      using errcode = 'feature_not_supported';
  end if;

  select plan_code into v_current from public.subscriptions where tenant_id = v_tenant;
  if v_current = p_plan_code then
    raise exception 'This college is already on %.', v_plan.name using errcode = 'check_violation';
  end if;

  -- Rule 13's one-live-run rule, enforced by the partial unique index above.
  -- Superseding rather than refusing: somebody who opened a link yesterday and
  -- came back today wants the new one, and a refusal would leave them stuck
  -- behind their own abandoned click.
  update public.subscription_checkouts
     set status = 'cancelled', failure_reason = 'Superseded by a newer request'
   where tenant_id = v_tenant and status in ('pending', 'linked');

  insert into public.subscription_checkouts (tenant_id, plan_code, created_by)
  values (v_tenant, p_plan_code, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object(
    'checkout_id', v_id,
    'plan_code', p_plan_code,
    'plan_name', v_plan.name,
    'amount_minor', v_plan.price_minor,
    'currency', v_plan.currency,
    'bill_every', v_plan.bill_every,
    -- The app takes this to the Edge Function, which is the only thing holding
    -- the platform's key. Rule 6: the app creates an intent, never a link.
    'needs_provider_link', true);
end;
$$;

comment on function public.subscription_start_checkout(text) is
  'Records that a college wants to move to a plan, and returns what the Edge '
  'Function needs to turn it into a payment link. Creates no link itself -- the '
  'provider secret is not in this database and not in the Next.js app.';

revoke all on function public.subscription_start_checkout(text) from public, anon;
grant execute on function public.subscription_start_checkout(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The callback answers
-- ---------------------------------------------------------------------------

-- Revoked from `public`, `anon` AND `authenticated`, exactly as
-- `fees_settle_gateway_payment` is: a webhook has no JWT, so
-- `current_tenant_id()` is null and no invoker function can serve it — and
-- nothing that *does* hold a JWT has any business calling this. Its authority
-- comes from a checkout row this system wrote, never from the callback body.
create or replace function public.subscription_settle_provider_event(
  p_provider text,
  p_provider_subscription_id text,
  p_provider_event_id text,
  p_event text,
  p_amount_minor bigint default null,
  p_provider_payment_id text default null,
  p_period_start date default null,
  p_period_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout public.subscription_checkouts;
  v_plan reference.plans;
  v_existing public.subscription_invoices;
  v_tenant uuid;
  v_start date;
  v_end date;
begin
  if p_provider_event_id is null or trim(p_provider_event_id) = '' then
    raise exception 'A provider event needs its event id -- it is the idempotency key.';
  end if;

  select * into v_checkout from public.subscription_checkouts
   where provider = p_provider
     and provider_subscription_id = p_provider_subscription_id
   for update;

  if v_checkout.id is null then
    raise exception 'No checkout for % subscription %', p_provider, p_provider_subscription_id;
  end if;
  v_tenant := v_checkout.tenant_id;

  -- Idempotency before anything else, so a redelivered webhook is a no-op that
  -- returns the same answer rather than a second charge or a raised error.
  select * into v_existing from public.subscription_invoices
   where provider = p_provider and provider_event_id = p_provider_event_id;
  if v_existing.id is not null then
    return jsonb_build_object('tenant_id', v_tenant, 'already_applied', true,
                              'invoice_id', v_existing.id);
  end if;

  select * into v_plan from reference.plans where code = v_checkout.plan_code;

  if p_event = 'charged' then
    -- The amount is checked against the catalogue rather than trusted from the
    -- body, the same way fees_settle_gateway_payment checks against the intent.
    -- A forged callback cannot decide what a college was charged.
    if p_amount_minor is null or p_amount_minor <> v_plan.price_minor then
      raise exception 'Provider reported % but % costs %',
        p_amount_minor, v_plan.name, v_plan.price_minor;
    end if;

    v_start := coalesce(p_period_start, current_date);
    v_end := coalesce(
      p_period_end,
      case v_plan.bill_every
        when 'year' then (v_start + interval '1 year' - interval '1 day')::date
        else (v_start + interval '1 month' - interval '1 day')::date
      end);

    insert into public.subscription_invoices (
      tenant_id, plan_code, amount_minor, currency, period_start, period_end,
      status, provider, provider_event_id, provider_payment_id)
    values (
      v_tenant, v_checkout.plan_code, p_amount_minor, v_plan.currency, v_start, v_end,
      'paid', p_provider, p_provider_event_id, p_provider_payment_id);

    update public.subscriptions
       set plan_code = v_checkout.plan_code,
           status = 'active',
           -- A paid plan is not a trial. Leaving the date behind would leave
           -- `subscription_problems()` warning a paying customer about an
           -- expiring trial -- the same trap 0209's plan control avoids.
           trial_ends_on = null,
           current_period_end = v_end,
           provider = p_provider,
           provider_subscription_id = p_provider_subscription_id
     where tenant_id = v_tenant;

    update public.subscription_checkouts set status = 'paid' where id = v_checkout.id;

    return jsonb_build_object('tenant_id', v_tenant, 'plan_code', v_checkout.plan_code,
                              'status', 'active', 'period_end', v_end);
  end if;

  if p_event = 'failed' then
    insert into public.subscription_invoices (
      tenant_id, plan_code, amount_minor, currency, period_start, period_end,
      status, provider, provider_event_id, provider_payment_id)
    values (
      v_tenant, v_checkout.plan_code, coalesce(p_amount_minor, v_plan.price_minor),
      v_plan.currency, coalesce(p_period_start, current_date),
      coalesce(p_period_end, current_date),
      'failed', p_provider, p_provider_event_id, p_provider_payment_id);

    -- `past_due`, never `expired`: 0207 already draws that line — a card that
    -- failed on Tuesday is a bank, not a decision. Only a college that never
    -- had a live plan is knocked back to the checkout.
    update public.subscriptions
       set status = case when plan_code = 'trial' then status else 'past_due' end
     where tenant_id = v_tenant;

    return jsonb_build_object('tenant_id', v_tenant, 'status', 'past_due');
  end if;

  if p_event = 'cancelled' then
    update public.subscriptions set status = 'cancelled' where tenant_id = v_tenant;
    update public.subscription_checkouts set status = 'cancelled' where id = v_checkout.id;
    return jsonb_build_object('tenant_id', v_tenant, 'status', 'cancelled');
  end if;

  raise exception '% is not an event this system knows how to apply.', p_event
    using errcode = 'check_violation';
end;
$$;

comment on function public.subscription_settle_provider_event(text, text, text, text, bigint, text, date, date) is
  'The subscription callback''s single way in. Definer, revoked from everybody '
  'holding a JWT, idempotent on the provider event id, and it takes the amount '
  'from reference.plans rather than from the callback body.';

revoke all on function public.subscription_settle_provider_event(text, text, text, text, bigint, text, date, date)
  from public, anon, authenticated;

commit;
