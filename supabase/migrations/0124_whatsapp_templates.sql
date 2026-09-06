-- ---------------------------------------------------------------------------
-- WhatsApp: the template IS the message
-- ---------------------------------------------------------------------------
--
-- Every other channel takes a string. Email takes a subject and a body, SMS
-- takes a body, push takes a title and a body -- so `notify_send` renders the
-- school's own template into `notification_deliveries.body` and the driver
-- posts it.
--
-- WhatsApp does not work that way, and pretending it does is the single most
-- likely way to ship a WhatsApp integration that appears to work and does not.
-- Outside a 24-hour window opened by the *recipient* messaging the school
-- first, Meta accepts only **pre-registered templates**: a name, a language,
-- and positional parameters. Free text is rejected. A school sending a fee
-- reminder is always outside that window -- nobody replies to a fee reminder --
-- so for this product the template path is not the fallback, it is the only
-- path.
--
-- The 24-hour window is deliberately not modelled. Using it would mean
-- recording every inbound message to know when a window opened, which is an
-- inbox: a second feature, with its own webhook, its own storage and its own
-- unread state, built so that a fee reminder could occasionally be sent as
-- free text instead of as a template. That is not a trade worth making, and
-- saying so here is cheaper than somebody rediscovering it.
--
-- WHAT THIS MEANS FOR THE DATA
--
-- A WhatsApp template has two halves that live in different places:
--
--   Meta's copy    registered with Meta, approved by Meta, and referred to by
--                  name. This system never sees its text.
--   our copy       `notification_templates.body`, which is what the delivery
--                  log shows a human and what a future channel could re-render.
--
-- So `notification_templates` gains the *pointer* to Meta's copy, and the
-- ordered list of payload keys that fill its {{1}}, {{2}} placeholders.
-- Positional, because that is what Meta's API takes; named in our data,
-- because `{{1}}` in a migration is unreadable.

alter table public.notification_templates
  -- The name registered with Meta. Null for every channel that does not need
  -- one, which is all of them except WhatsApp.
  add column provider_template_name text,
  -- Meta stores a template per language and rejects a send that names the
  -- wrong one. Defaulted rather than nullable: a missing language is the
  -- commonest reason a correctly-named template fails to send.
  add column provider_template_locale text not null default 'en',
  -- Which payload keys fill the placeholders, in order. `{"student_name",
  -- "amount"}` means Meta's {{1}} is the student's name and {{2}} the amount.
  add column provider_template_params text[] not null default '{}';

alter table public.notification_templates
  add constraint notification_templates_provider_name_chk
  check (provider_template_name is null or btrim(provider_template_name) <> '');

-- A template that names Meta's copy is only useful on a channel that consults
-- it. Saying so as a constraint stops somebody filling the field in on the
-- email row and wondering why it changes nothing.
alter table public.notification_templates
  add constraint notification_templates_provider_channel_chk
  check (provider_template_name is null or channel = 'whatsapp');

-- ---------------------------------------------------------------------------
-- Frozen onto the delivery, like the address
-- ---------------------------------------------------------------------------

-- `notification_deliveries.address` freezes the phone number as it was at send
-- time, because a log that re-reads the current number cannot answer "where did
-- we actually send it". The same argument applies with more force to a
-- template: a school that renames or re-registers one must not change what a
-- delivery six weeks ago says it sent.
alter table public.notification_deliveries
  add column provider_template text,
  add column provider_params jsonb;

-- ---------------------------------------------------------------------------
-- `notify_send` fills them, and refuses to guess
-- ---------------------------------------------------------------------------

-- Unchanged from 0118 except for the template columns and one new `skipped`
-- reason. A WhatsApp delivery with no registered template is **skipped with a
-- sentence**, not queued: queuing it would put a message in a queue that can
-- never drain, and sending it as free text would have Meta reject it after the
-- retries. Skipping says the true thing in the delivery log, where somebody
-- can act on it.
create or replace function public.notify_send(
  p_event_key text,
  p_subject text,
  p_body text,
  p_audience jsonb,
  p_payload jsonb default '{}'::jsonb,
  p_channels text[] default null
)
returns public.notifications
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_channels text[];
  v_notification public.notifications;
  v_recipients integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if public.current_role_code() <> 'admin' then
    raise exception 'Only an administrator can send a notification';
  end if;

  if p_body is null or trim(p_body) = '' then
    raise exception 'A notification needs a body';
  end if;
  if not exists (select 1 from reference.notification_types where key = p_event_key) then
    raise exception 'Unknown notification type: %', p_event_key;
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  select coalesce(p_channels, nt.default_channels) into v_channels
  from reference.notification_types nt where nt.key = p_event_key;

  insert into public.notifications
    (tenant_id, session_id, event_key, subject, body, payload, audience, created_by)
  values
    (v_tenant_id, v_session_id, p_event_key, p_subject, p_body,
     coalesce(p_payload, '{}'::jsonb), coalesce(p_audience, '{}'::jsonb), auth.uid())
  returning * into v_notification;

  with recipients as (
    select r.user_id from public.notify_resolve_audience(v_tenant_id, p_audience) r
  ),
  chosen as (
    select unnest(v_channels) as channel
  )
  insert into public.notification_deliveries (
    tenant_id, notification_id, recipient_user_id, channel,
    address, subject, body, status, sent_at, last_error,
    provider_template, provider_params
  )
  select
    v_tenant_id,
    v_notification.id,
    rec.user_id,
    ch.channel,
    addr.address,
    coalesce(public.notify_render(tpl.subject, p_payload), p_subject),
    coalesce(public.notify_render(tpl.body, p_payload), p_body),
    case
      when ch.channel = 'in_app' then 'sent'
      -- A WhatsApp message with no registered template can never be sent, so
      -- it is skipped now rather than queued for ever.
      when ch.channel = 'whatsapp' and tpl.provider_template_name is null then 'skipped'
      when ch.channel in ('email', 'sms', 'whatsapp', 'push') and addr.address is null
        then 'skipped'
      else 'queued'
    end,
    case when ch.channel = 'in_app' then now() else null end,
    case
      when ch.channel = 'whatsapp' and tpl.provider_template_name is null
        then 'No WhatsApp template is registered for this event. WhatsApp only '
             || 'accepts templates approved in advance, so there is nothing that '
             || 'could be sent.'
      when ch.channel = 'push' and addr.address is null
        then 'No device registered for this person'
      when ch.channel in ('email', 'sms', 'whatsapp') and addr.address is null
      then 'No ' || (case when ch.channel = 'email' then 'email address' else 'phone number' end)
           || ' on file for this person'
    end,
    -- Frozen at send time, like the address.
    case when ch.channel = 'whatsapp' then tpl.provider_template_name end,
    case
      when ch.channel = 'whatsapp' and tpl.provider_template_name is not null then
        jsonb_build_object(
          'locale', tpl.provider_template_locale,
          -- The payload values in the order Meta's {{1}}, {{2}} expect. A key
          -- the payload does not carry becomes an empty string rather than
          -- null: Meta rejects a null parameter outright, and a blank in a
          -- reminder is survivable where a rejected message is not.
          'params', coalesce((
            select jsonb_agg(coalesce(p_payload ->> k, '') order by ord)
            from unnest(tpl.provider_template_params) with ordinality as t(k, ord)
          ), '[]'::jsonb)
        )
    end
  from recipients rec
  cross join chosen ch
  left join public.notification_templates tpl
    on tpl.tenant_id = v_tenant_id
   and tpl.event_key = p_event_key
   and tpl.channel = ch.channel
   and tpl.is_active
  left join lateral (
    select pe.email::text as address
    from public.user_profiles up
    left join public.people pe on pe.id = up.person_id
    where up.id = rec.user_id and ch.channel = 'email'

    union all
    select pe.phone
    from public.user_profiles up
    left join public.people pe on pe.id = up.person_id
    where up.id = rec.user_id and ch.channel in ('sms', 'whatsapp')

    union all
    select null::text where ch.channel = 'in_app'

    union all
    select d.push_token
    from public.devices d
    where d.tenant_id = v_tenant_id and d.user_id = rec.user_id
      and d.revoked_at is null and ch.channel = 'push'

    union all
    select null::text
    where ch.channel = 'push'
      and not exists (
        select 1 from public.devices d
        where d.tenant_id = v_tenant_id and d.user_id = rec.user_id and d.revoked_at is null
      )
  ) addr on true
  where not exists (
    select 1 from public.notification_preferences pref
    where pref.tenant_id = v_tenant_id
      and pref.user_id = rec.user_id
      and pref.event_key = p_event_key
      and pref.channel = ch.channel
      and pref.enabled = false
  );

  get diagnostics v_recipients = row_count;

  if v_recipients = 0 then
    raise exception 'That audience matched nobody with a login, so nothing was sent';
  end if;

  return v_notification;
end;
$$;

revoke all on function public.notify_send(text, text, text, jsonb, jsonb, text[])
  from public, anon;
grant execute on function public.notify_send(text, text, text, jsonb, jsonb, text[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------

-- `grading_scheme_problems()` and `exams_problems()` in sentences, applied to
-- the message catalogue. The motivating case is exactly the one this migration
-- exists for: WhatsApp switched on, and half the events with no registered
-- template, which shows up as a delivery log full of skips that nobody reads
-- until a parent asks why they were not told.
create or replace function public.notify_template_problems()
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  with settings as (
    select * from public.notification_channel_settings
    where tenant_id = ( select public.current_tenant_id() )
  ),
  events as (
    select nt.key, nt.name, nt.default_channels from reference.notification_types nt
  )
  select 'WhatsApp is switched on, but ' || count(*)::text
         || ' event(s) have no registered template, starting with "' || min(e.name)
         || '". WhatsApp only accepts templates approved in advance, so those '
         || 'messages are skipped rather than sent.'
  from events e
  cross join settings s
  where s.channel = 'whatsapp' and s.is_enabled
    and 'whatsapp' = any (e.default_channels)
    and not exists (
      select 1 from public.notification_templates t
      where t.tenant_id = ( select public.current_tenant_id() )
        and t.event_key = e.key and t.channel = 'whatsapp'
        and t.is_active and t.provider_template_name is not null
    )
  having count(*) > 0

  union all
  -- A registered template with no parameters is legal and usually a mistake:
  -- Meta's copy almost always has placeholders, and sending none produces a
  -- message with literal {{1}} in it.
  select 'The WhatsApp template "' || t.provider_template_name || '" for "' || nt.name
         || '" lists no parameters. If Meta''s copy has placeholders, they will be '
         || 'sent empty.'
  from public.notification_templates t
  join reference.notification_types nt on nt.key = t.event_key
  where t.tenant_id = ( select public.current_tenant_id() )
    and t.channel = 'whatsapp' and t.is_active
    and t.provider_template_name is not null
    and cardinality(t.provider_template_params) = 0

  union all
  -- A parameter naming a key the event never carries renders as a blank in a
  -- message somebody receives.
  --
  -- Judged against the payloads this event has actually carried, because
  -- nothing declares an event's variables up front. That means the check can
  -- only speak once the event has been sent at least one -- guarded below,
  -- since "every parameter is unknown" on a fresh tenant would be noise rather
  -- than criticism.
  select 'The WhatsApp template for "' || nt.name || '" fills a placeholder from "'
         || p.key || '", which is not a variable this event''s messages have carried.'
  from public.notification_templates t
  join reference.notification_types nt on nt.key = t.event_key
  cross join lateral unnest(t.provider_template_params) as p(key)
  where t.tenant_id = ( select public.current_tenant_id() )
    and t.channel = 'whatsapp' and t.is_active
    and t.provider_template_name is not null
    and exists (
      select 1 from public.notifications n
      where n.tenant_id = t.tenant_id and n.event_key = t.event_key
    )
    and not exists (
      select 1
      from public.notifications n
      cross join lateral jsonb_object_keys(n.payload) as k(key)
      where n.tenant_id = t.tenant_id and n.event_key = t.event_key and k.key = p.key
    )
$$;

revoke all on function public.notify_template_problems() from public, anon;
grant execute on function public.notify_template_problems() to authenticated;
