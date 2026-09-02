-- Variables were only interpolated when a template existed.
--
-- `notify_send` rendered `tpl.subject` / `tpl.body` and fell back to the
-- caller's text un-rendered:
--
--     coalesce(notify_render(tpl.body, payload), p_body)
--
-- With no template row for that event and channel -- which is every event
-- today, since no tenant has authored one -- the fallback won, and a message
-- composed as "Sports day has moved to {{date}}" was delivered with the braces
-- still in it. Caught by reading the delivered body rather than trusting that
-- the fan-out counts looked right.
--
-- Both branches are rendered now. Where the text came from is not something the
-- reader of the message should be able to tell.

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
    address, subject, body, status, sent_at, last_error
  )
  select
    v_tenant_id,
    v_notification.id,
    rec.user_id,
    ch.channel,
    addr.address,
    -- Rendered either way: a template if the tenant wrote one for this channel,
    -- otherwise the text the sender typed -- but always through the same
    -- interpolation.
    coalesce(
      public.notify_render(tpl.subject, p_payload),
      public.notify_render(p_subject, p_payload)
    ),
    coalesce(
      public.notify_render(tpl.body, p_payload),
      public.notify_render(p_body, p_payload)
    ),
    case
      when ch.channel = 'in_app' then 'sent'
      when ch.channel in ('email', 'sms', 'whatsapp') and addr.address is null then 'skipped'
      else 'queued'
    end,
    case when ch.channel = 'in_app' then now() else null end,
    case
      when ch.channel in ('email', 'sms', 'whatsapp') and addr.address is null
      then 'No ' || (case when ch.channel = 'email' then 'email address' else 'phone number' end)
           || ' on file for this person'
    end
  from recipients rec
  cross join chosen ch
  left join public.notification_templates tpl
    on tpl.tenant_id = v_tenant_id
   and tpl.event_key = p_event_key
   and tpl.channel = ch.channel
   and tpl.is_active
  left join lateral (
    select case ch.channel
             when 'email' then pe.email::text
             when 'sms' then pe.phone
             when 'whatsapp' then pe.phone
             else null
           end as address
    from public.user_profiles up
    left join public.people pe on pe.id = up.person_id
    where up.id = rec.user_id
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
