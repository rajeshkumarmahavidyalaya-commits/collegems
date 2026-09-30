-- 0309: a daily SMS limit per college, and what actually arrived.
--
-- Two gaps `docs/modules/notifications.md` listed as unbuilt, and 0308 made
-- the second one sharper.
--
-- ## 1. A daily SMS limit
--
-- A school with a misconfigured audience can send a great many SMS, each one
-- billed. `notifications.sms_daily_limit` is the college's own number: at most
-- this many SMS leave in one day, the college's day (`tenants.timezone`), and
-- the rest **wait**. Not skipped: rule 10 says a held channel keeps its queue,
-- and a message held by a limit is exactly that -- tomorrow's first batch,
-- still subject to its kind's `stale_after`. Empty means no limit, which is
-- today's behaviour.
--
-- The limit is applied where work is claimed, `notify_claim_deliveries`, the
-- one place every send passes through. Postgres refuses a window function
-- beside `FOR UPDATE`, so the claim locks candidates first and applies each
-- college's remaining budget one level up; a locked row the budget leaves out
-- is simply not updated, and is released when the call returns.
--
-- ## 2. What actually arrived
--
-- "Sent" has meant "the provider accepted it". With DLT (0308) that is further
-- from the truth than it was: an Indian carrier drops a mismatched message
-- after the gateway accepted it. Providers report the outcome afterwards, to a
-- webhook. `notify-receipts` (an Edge Function) verifies each report and calls
-- `notify_record_receipt`, which finds the delivery by the reference the
-- provider gave at send time (`provider_ref`, written by this system, so the
-- authority is a row we wrote rather than the callback body -- rule 6's
-- webhook shape) and records the outcome beside the status rather than in it:
-- `status` stays the dispatcher's account of what it did, `receipt_status` is
-- the provider's account of what happened next. Two questions, two columns.

begin;

-- ------------------------------------------------------------ the daily limit --

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'notifications.sms_daily_limit',
  'SMS per day',
  'The most SMS this college sends in one day. Messages over the limit wait and '
  'go out the next day, oldest first; nothing is dropped. Leave it empty for no '
  'limit.',
  'Notifications',
  'object',
  '[{"name": "limit", "type": "number", "label": "SMS per day (empty for no limit)"}]'::jsonb,
  '{"limit": null}'::jsonb,
  false,
  'settings.manage',
  125
)
on conflict (key) do nothing;

-- Today's SMS, counted per college.
create index notification_deliveries_sms_day_idx
  on public.notification_deliveries (tenant_id, sent_at)
  where channel = 'sms' and sent_at is not null;

-- How many SMS a college may still send today, in its own day. Null means no
-- limit. Counts what was sent today and what is being sent now; a failed
-- attempt that went back to the queue is not counted, because a provider does
-- not bill a message it refused.
create or replace function public.sms_daily_remaining(p_tenant_id uuid)
returns integer
language sql
stable
set search_path = public, extensions
as $$
  with lim as (
    select case
      when (public.setting_value_for(p_tenant_id, 'notifications.sms_daily_limit') ->> 'limit') ~ '^[0-9]+$'
        then (public.setting_value_for(p_tenant_id, 'notifications.sms_daily_limit') ->> 'limit')::integer
    end as n
  ),
  day as (
    select (date_trunc('day', now() at time zone coalesce(t.timezone, 'Asia/Kolkata'))
            at time zone coalesce(t.timezone, 'Asia/Kolkata')) as starts
    from public.tenants t where t.id = p_tenant_id
  )
  select case when lim.n is null then null else greatest(lim.n - (
    select count(*)::integer from public.notification_deliveries d, day
    where d.tenant_id = p_tenant_id and d.channel = 'sms'
      and ((d.status = 'sent' and d.sent_at >= day.starts) or d.status = 'sending')
  ), 0) end
  from lim
$$;

-- Takes a tenant, so nobody holding a JWT may call it (the notify_send_for
-- shape). The claim, the critic's definer twin and the dispatcher reach it.
revoke all on function public.sms_daily_remaining(uuid) from public, anon, authenticated;

create or replace function public.notify_claim_deliveries(
  p_limit integer default 50,
  p_tenant_id uuid default null,
  p_channel text default null
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
begin
  return query
  with budgets as (
    -- Each college's SMS left for today, computed once per call. Null: no limit.
    select t.id as tenant_id, public.sms_daily_remaining(t.id) as remaining
    from public.tenants t
    where p_tenant_id is null or t.id = p_tenant_id
  )
  update public.notification_deliveries d
  set status = 'sending',
      attempts = d.attempts + 1
  where d.id in (
    select ranked.id
    from (
      select locked.id, locked.next_attempt_at, locked.channel, locked.remaining,
             row_number() over (partition by locked.tenant_id, locked.channel
                                order by locked.next_attempt_at, locked.id) as rn
      from (
        select c.id, c.tenant_id, c.channel, c.next_attempt_at, b.remaining
        from public.notification_deliveries c
        join budgets b on b.tenant_id = c.tenant_id
        join public.notification_channel_settings s
          on s.tenant_id = c.tenant_id and s.channel = c.channel
        join public.notifications n on n.id = c.notification_id
        join reference.notification_types nt on nt.key = n.event_key
        where c.channel <> 'in_app'
          and s.is_enabled
          and coalesce(s.provider_configured, false)
          and (p_channel is null or c.channel = p_channel)
          and (nt.stale_after is null or c.created_at >= now() - nt.stale_after)
          and (
            (c.status = 'queued' and c.next_attempt_at <= now())
            or (c.status = 'sending' and c.created_at < now() - interval '15 minutes')
          )
          -- 0309: a college whose SMS for today are used up contributes no SMS
          -- here at all, so its waiting messages cannot fill the window and
          -- starve every other college's email.
          and (c.channel <> 'sms' or b.remaining is null or b.remaining > 0)
        order by c.next_attempt_at
        limit greatest(p_limit, 1) * 4
        for update of c skip locked
      ) locked
    ) ranked
    -- ...and a college with some SMS left sends only that many.
    where ranked.channel <> 'sms' or ranked.remaining is null or ranked.rn <= ranked.remaining
    order by ranked.next_attempt_at
    limit greatest(p_limit, 1)
  )
  returning d.*;
end;
$$;

comment on function public.notify_claim_deliveries(integer, uuid, text) is
  'Claims work for the dispatcher. Refuses a channel whose provider_configured '
  'is false, a delivery whose kind has gone stale (0218), and an SMS beyond the '
  'college''s daily limit (0309), which waits for tomorrow rather than being '
  'dropped.';

revoke all on function public.notify_claim_deliveries(integer, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- receipts --

alter table public.notification_deliveries
  add column receipt_status text
    check (receipt_status in ('delivered', 'undelivered', 'bounced', 'complained')),
  add column receipt_at timestamptz,
  add column receipt_detail text;

comment on column public.notification_deliveries.receipt_status is
  'What the provider reported after accepting the message (0309): delivered, '
  'undelivered, bounced or complained. Null until a report arrives. status is '
  'the dispatcher''s account; this is the provider''s.';

-- A report names the provider's reference and nothing else.
create index notification_deliveries_ref_idx
  on public.notification_deliveries (provider_ref)
  where provider_ref is not null;

create or replace function public.notify_record_receipt(
  p_channel text,
  p_ref text,
  p_state text,
  p_detail text default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows integer;
begin
  if p_state not in ('delivered', 'undelivered', 'bounced', 'complained') then
    raise exception 'Unknown receipt state: %', p_state;
  end if;
  if coalesce(btrim(p_ref), '') = '' then
    return 0;
  end if;

  -- A report for a delivery this system did not write matches nothing, and
  -- says so by returning 0: the reference is the authority, not the body.
  -- A later report replaces an earlier one except that nothing overwrites a
  -- complaint, which is the one outcome a college must never lose.
  update public.notification_deliveries d
  set receipt_status = p_state,
      receipt_at = now(),
      receipt_detail = left(p_detail, 400)
  where d.provider_ref = p_ref
    and d.channel = p_channel
    and d.status = 'sent'
    and d.receipt_status is distinct from 'complained';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.notify_record_receipt(text, text, text, text) from public, anon, authenticated;

comment on function public.notify_record_receipt(text, text, text, text) is
  'Records a provider''s delivery report against the delivery it names by '
  'provider_ref. Called only by the notify-receipts Edge Function, after it has '
  'verified the report''s signature; revoked from everybody holding a JWT.';

-- ------------------------------------------------------------------ critic --

-- The counts the critic needs, from a definer that filters by college itself.
-- An invoker critic would count deliveries through the caller's RLS, and a
-- college can grant settings.manage to somebody whose view of deliveries is
-- narrower than the college's: a smaller number, plausible and wrong (rule 4).
-- Counts only, for the caller's own college, to somebody who may act on them.
create or replace function public.notification_outcome_counts()
returns table (daily_limit integer, remaining integer, waiting integer,
               undelivered_7d integer, reported_7d integer)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not public.role_has_permission('settings.manage') then
    raise exception 'Only somebody who can change the notification settings can see these counts.';
  end if;
  return query
  select
    case when (public.setting_value_for(v_tenant, 'notifications.sms_daily_limit') ->> 'limit') ~ '^[0-9]+$'
      then (public.setting_value_for(v_tenant, 'notifications.sms_daily_limit') ->> 'limit')::integer end,
    public.sms_daily_remaining(v_tenant),
    (select count(*)::integer from public.notification_deliveries d
      where d.tenant_id = v_tenant and d.channel = 'sms' and d.status = 'queued'),
    (select count(*)::integer from public.notification_deliveries d
      where d.tenant_id = v_tenant and d.receipt_at >= now() - interval '7 days'
        and d.receipt_status in ('undelivered', 'bounced')),
    (select count(*)::integer from public.notification_deliveries d
      where d.tenant_id = v_tenant and d.receipt_at >= now() - interval '7 days'
        and d.receipt_status is not null);
end;
$$;

revoke all on function public.notification_outcome_counts() from public, anon;
grant execute on function public.notification_outcome_counts() to authenticated;

create or replace function public.notification_outcome_problems()
returns table (severity text, message text)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v record;
begin
  select * into v from public.notification_outcome_counts();
  if v.daily_limit is not null and v.remaining = 0 and v.waiting > 0 then
    return query select 'warning'::text, format(
      'Today''s SMS limit of %s is used up, and %s %s waiting for tomorrow. Raise the '
      || 'limit under Settings if these should go today.',
      v.daily_limit, v.waiting, case when v.waiting = 1 then 'message is' else 'messages are' end);
  end if;

  if v.undelivered_7d > 0 then
    return query select 'warning'::text, format(
      '%s of %s %s the providers reported on in the last week %s not delivered. For '
      || 'SMS in India the usual reason is a message that does not match its DLT '
      || 'template; the delivery log shows each one.',
      v.undelivered_7d, v.reported_7d,
      case when v.reported_7d = 1 then 'message' else 'messages' end,
      case when v.undelivered_7d = 1 then 'was' else 'were' end);
  end if;
end;
$$;

revoke all on function public.notification_outcome_problems() from public, anon;
grant execute on function public.notification_outcome_problems() to authenticated;

insert into reference.checks
  (key, label, description, function_name, shape, module, href, required_permission, sort)
values (
  'notifications.outcomes',
  'Messages go out and arrive',
  'Whether today''s SMS limit is holding messages back, and how many messages the '
  'providers reported as not delivered in the last week.',
  'notification_outcome_problems',
  'severity_message',
  'Notifications',
  '/notifications/log',
  'settings.manage',
  275
)
on conflict (key) do nothing;

commit;
