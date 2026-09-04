-- ---------------------------------------------------------------------------
-- The dispatcher's contract
-- ---------------------------------------------------------------------------
--
-- Migration 0034 wrote a claim function and a result function against a queue
-- nothing drained. Now something does, and three things about it were wrong or
-- missing once a real sender existed at the other end.
--
-- 1. **A claim must be able to say which tenant and which channel.** The
--    scheduled drain wants everything; an administrator pressing "send the
--    queued ones now" wants their own school, and must not be able to make
--    another school's messages leave the building.
--
-- 2. **A claim must not take work the deployment cannot do.** An email driver
--    with no API key that claims a thousand deliveries turns them all into
--    failures with five attempts each. So the claim reads
--    `notification_channel_settings`: the school has to have turned the channel
--    on, and the dispatcher has to have reported that it can serve it.
--
--    That ordering is the contract, and it is a cycle if you read it wrongly:
--    `provider_configured` is written by the dispatcher, so on a fresh
--    deployment it is null and nothing is claimable. The dispatcher therefore
--    **reports what it can do before it claims what it can serve** -- one
--    `notify_channel_report` per channel per run, then the claim. A dispatcher
--    that skipped the report would drain nothing and say nothing, which is at
--    least a safe way to be broken.
--
-- 3. **A claim must be able to recover from a dispatcher that died.** A row set
--    to `sending` by a function that then ran out of wall clock stays `sending`
--    for ever. Rows stuck there longer than fifteen minutes are claimable
--    again, which makes this queue at-least-once rather than at-most-once: a
--    provider that accepted a message just before the process died may send it
--    twice. That is the right trade for this traffic -- a duplicated fee
--    reminder is a nuisance and a lost absence notice is a child nobody
--    called about -- and `provider_ref` is what lets somebody prove which
--    happened.

drop function if exists public.notify_claim_deliveries(integer);
drop function if exists public.notify_record_result(uuid, boolean, text);

-- ---------------------------------------------------------------------------
-- What this deployment can do, as reported by the thing that would do it
-- ---------------------------------------------------------------------------

-- Called once per channel at the start of every dispatcher run, before any
-- claim. `p_configured` is the driver's own answer to "do I have my
-- credentials, and does this school have a from-address" -- which is not
-- something the database can work out for itself, because the credentials
-- deliberately live only on the Edge Function.
--
-- SECURITY DEFINER and revoked from every role a person can hold, like
-- `fees_settle_gateway_payment`: it runs where there is no user, and a school
-- that could call it could claim its email was configured when it was not.
create or replace function public.notify_channel_report(
  p_tenant_id uuid,
  p_channel text,
  p_provider text,
  p_configured boolean,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.notification_channel_settings
  set provider = p_provider,
      provider_configured = p_configured,
      last_attempt_at = now(),
      -- A configured channel keeps whatever error its last real send left; an
      -- unconfigured one is described by the reason it cannot send. Blanking
      -- the error on every run would erase the only evidence of a provider
      -- that rejects one message in fifty.
      last_error = case when p_configured then last_error else p_error end
  where tenant_id = p_tenant_id and channel = p_channel;
$$;

revoke all on function public.notify_channel_report(uuid, text, text, boolean, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

create or replace function public.notify_claim_deliveries(
  p_limit integer default 50,
  p_tenant_id uuid default null,
  p_channel text default null
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
  update public.notification_deliveries d
  set status = 'sending',
      attempts = d.attempts + 1
  where d.id in (
    select c.id
    from public.notification_deliveries c
    join public.notification_channel_settings s
      on s.tenant_id = c.tenant_id and s.channel = c.channel
    where c.channel <> 'in_app'
      -- In-app deliveries are already sent: the row IS the delivery.
      and s.is_enabled
      and coalesce(s.provider_configured, false)
      and (p_tenant_id is null or c.tenant_id = p_tenant_id)
      and (p_channel is null or c.channel = p_channel)
      and (
        (c.status = 'queued' and c.next_attempt_at <= now())
        -- The reaper. A dispatcher that died left these behind.
        or (c.status = 'sending' and c.created_at < now() - interval '15 minutes')
      )
    order by c.next_attempt_at
    limit greatest(p_limit, 1)
    -- What makes this safe to run more than once at a time: two dispatchers
    -- claim disjoint batches instead of both sending the same message.
    for update skip locked
  )
  returning d.*;
end;
$$;

revoke all on function public.notify_claim_deliveries(integer, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settling
-- ---------------------------------------------------------------------------

-- Backoff is exponential and bounded: roughly 1, 4, 16, 64 and 256 minutes,
-- then the delivery is `failed` and stops consuming attempts. A queue that
-- retries for ever is how a dead SMS gateway turns into a bill.
--
-- It also stamps the channel's health, because "when did email last work here"
-- is the first question anybody asks and deriving it from a scan of a delivery
-- table is a page of SQL on every screen load.
create or replace function public.notify_record_result(
  p_delivery_id uuid,
  p_ok boolean,
  p_error text default null,
  p_provider_ref text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_delivery public.notification_deliveries;
begin
  select * into v_delivery
  from public.notification_deliveries where id = p_delivery_id;

  if v_delivery.id is null then
    raise exception 'Delivery not found';
  end if;

  if p_ok then
    update public.notification_deliveries
    set status = 'sent', sent_at = now(), last_error = null, provider_ref = p_provider_ref
    where id = p_delivery_id;

    update public.notification_channel_settings
    set last_success_at = now(), last_error = null
    where tenant_id = v_delivery.tenant_id and channel = v_delivery.channel;
  else
    update public.notification_deliveries
    set status = case when v_delivery.attempts >= 5 then 'failed' else 'queued' end,
        last_error = p_error,
        next_attempt_at = now() + (interval '1 minute' * power(4, least(v_delivery.attempts, 4)))
    where id = p_delivery_id;

    update public.notification_channel_settings
    set last_error = p_error
    where tenant_id = v_delivery.tenant_id and channel = v_delivery.channel;
  end if;
end;
$$;

revoke all on function public.notify_record_result(uuid, boolean, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What a screen needs to tell the truth
-- ---------------------------------------------------------------------------

-- One row per channel: what the school asked for, what the dispatcher last
-- reported, and how much is waiting. SECURITY INVOKER, so the counts are the
-- caller's own view through RLS -- an administrator sees the school's, and a
-- parent asking the same question sees their own deliveries and nothing else.
--
-- This exists because the honest sentence has three parts and no single column
-- carries it: *is there a driver for this channel at all* (the app knows),
-- *has this school turned it on and given it an address* (`is_enabled`,
-- `from_address`), and *did the dispatcher find its credentials* -- and a
-- screen that shows only the middle one tells a school its SMS is on while
-- nothing leaves the building.
create or replace function public.notify_channel_status()
returns table (
  channel text,
  is_enabled boolean,
  from_address text,
  sender_name text,
  provider text,
  provider_configured boolean,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  queued integer,
  oldest_queued_at timestamptz,
  failed integer,
  sent_recently integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    s.channel,
    s.is_enabled,
    s.from_address,
    s.sender_name,
    s.provider,
    s.provider_configured,
    s.last_attempt_at,
    s.last_success_at,
    s.last_error,
    coalesce(d.queued, 0)::integer,
    d.oldest_queued_at,
    coalesce(d.failed, 0)::integer,
    coalesce(d.sent_recently, 0)::integer
  from public.notification_channel_settings s
  left join lateral (
    select
      count(*) filter (where nd.status in ('queued', 'sending')) as queued,
      min(nd.created_at) filter (where nd.status in ('queued', 'sending')) as oldest_queued_at,
      count(*) filter (where nd.status = 'failed') as failed,
      count(*) filter (where nd.status = 'sent' and nd.sent_at > now() - interval '7 days')
        as sent_recently
    from public.notification_deliveries nd
    where nd.tenant_id = s.tenant_id and nd.channel = s.channel
  ) d on true
  where s.tenant_id = ( select public.current_tenant_id() )
  order by case s.channel
    when 'in_app' then 0 when 'email' then 1 when 'sms' then 2
    when 'whatsapp' then 3 else 4 end
$$;

revoke all on function public.notify_channel_status() from public, anon;
grant execute on function public.notify_channel_status() to authenticated;

-- ---------------------------------------------------------------------------
-- Putting a failure back
-- ---------------------------------------------------------------------------

-- An administrator whose provider was misconfigured for an afternoon has a
-- pile of `failed` rows and no way to reach them: `notification_deliveries` has
-- no UPDATE policy for administrators at all, deliberately, because the table
-- is the system's record of what it did. So this is definer with its own admin
-- check -- the `notify_send` shape.
--
-- `attempts` goes back to zero, because a manual retry is a decision that the
-- reason for the failure has been dealt with, and five attempts against a
-- provider that was simply switched off should not count against the fix.
-- `last_error` is left alone: it is why the row is here, and clearing it would
-- make the screen forget what went wrong the moment somebody tried again.
create or replace function public.notify_retry_failed(
  p_channel text default null,
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_count integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can retry failed messages';
  end if;

  -- Bounded, and the bound is said out loud by the caller, per rule 7: this
  -- runs in a request handler and a school with 40,000 dead rows must not
  -- discover that by timing out.
  with due as (
    select id from public.notification_deliveries
    where tenant_id = v_tenant_id
      and status = 'failed'
      and (p_channel is null or channel = p_channel)
    order by created_at
    limit greatest(least(p_limit, 2000), 1)
  )
  update public.notification_deliveries d
  set status = 'queued', attempts = 0, next_attempt_at = now()
  from due
  where d.id = due.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_retry_failed(text, integer) from public, anon;
grant execute on function public.notify_retry_failed(text, integer) to authenticated;
