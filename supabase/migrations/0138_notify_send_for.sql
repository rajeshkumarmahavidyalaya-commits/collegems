-- ---------------------------------------------------------------------------
-- A sender for callers who are not a person
-- ---------------------------------------------------------------------------
--
-- `notify_send` reads the tenant from the JWT and refuses anybody who is not an
-- administrator. That is right for the Compose screen and useless for anything
-- that runs on a timer: a scheduler holds the service role, has no JWT, and
-- `current_tenant_id()` is null for it.
--
-- This is the same shape the payment webhook already needed, and CLAUDE.md
-- already says what to do about it:
--
--   > definer, narrow, revoked from people, and taking its authority from a row
--   > this system wrote rather than from the callback body.
--
-- So `notify_send_for` takes the tenant explicitly and is revoked from `public`,
-- `anon` **and** `authenticated` -- nothing holding a JWT may call it -- exactly
-- like `fees_settle_gateway_payment`. Its authority comes from
-- `schedules.tenant_id`, a row an administrator of that school created.
--
-- **`notify_send` becomes a wrapper over it.** Copying the body would have been
-- two implementations of "who gets this and on which channels", and the second
-- one is where the WhatsApp template freeze or the preference check quietly
-- stops being applied. One body, two doors.
--
-- ONE BEHAVIOUR DIFFERS, AND ON PURPOSE
--
-- `notify_send` raises when an audience matches nobody, because a person who
-- pressed Send deserves to be told it went nowhere. A scheduler must not:
-- "this child's guardians have no logins" is an ordinary fact about one of four
-- hundred children, and aborting the run over it would stop the other three
-- hundred and ninety-nine messages. So the caller says which it wants, and the
-- run record counts what actually went out.

create or replace function public.notify_send_for(
  p_tenant_id uuid,
  p_event_key text,
  p_subject text,
  p_body text,
  p_audience jsonb,
  p_payload jsonb default '{}'::jsonb,
  p_channels text[] default null,
  p_actor uuid default null,
  p_require_recipients boolean default true
)
returns public.notifications
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session_id uuid;
  v_channels text[];
  v_notification public.notifications;
  v_recipients integer;
begin
  if p_tenant_id is null then
    raise exception 'A notification needs a tenant';
  end if;

  if p_body is null or trim(p_body) = '' then
    raise exception 'A notification needs a body';
  end if;
  if not exists (select 1 from reference.notification_types where key = p_event_key) then
    raise exception 'Unknown notification type: %', p_event_key;
  end if;

  v_session_id := public.current_session_id(p_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  select coalesce(p_channels, nt.default_channels) into v_channels
  from reference.notification_types nt where nt.key = p_event_key;

  insert into public.notifications
    (tenant_id, session_id, event_key, subject, body, payload, audience, created_by)
  values
    (p_tenant_id, v_session_id, p_event_key, p_subject, p_body,
     coalesce(p_payload, '{}'::jsonb), coalesce(p_audience, '{}'::jsonb), p_actor)
  returning * into v_notification;

  with recipients as (
    select r.user_id from public.notify_resolve_audience(p_tenant_id, p_audience) r
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
    p_tenant_id,
    v_notification.id,
    rec.user_id,
    ch.channel,
    addr.address,
    coalesce(public.notify_render(tpl.subject, p_payload), p_subject),
    coalesce(public.notify_render(tpl.body, p_payload), p_body),
    case
      when ch.channel = 'in_app' then 'sent'
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
    case when ch.channel = 'whatsapp' then tpl.provider_template_name end,
    case
      when ch.channel = 'whatsapp' and tpl.provider_template_name is not null then
        jsonb_build_object(
          'locale', tpl.provider_template_locale,
          'params', coalesce((
            select jsonb_agg(coalesce(p_payload ->> k, '') order by ord)
            from unnest(tpl.provider_template_params) with ordinality as t(k, ord)
          ), '[]'::jsonb)
        )
    end
  from recipients rec
  cross join chosen ch
  left join public.notification_templates tpl
    on tpl.tenant_id = p_tenant_id
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
    where d.tenant_id = p_tenant_id and d.user_id = rec.user_id
      and d.revoked_at is null and ch.channel = 'push'

    union all
    select null::text
    where ch.channel = 'push'
      and not exists (
        select 1 from public.devices d
        where d.tenant_id = p_tenant_id and d.user_id = rec.user_id and d.revoked_at is null
      )
  ) addr on true
  where not exists (
    select 1 from public.notification_preferences pref
    where pref.tenant_id = p_tenant_id
      and pref.user_id = rec.user_id
      and pref.event_key = p_event_key
      and pref.channel = ch.channel
      and pref.enabled = false
  );

  get diagnostics v_recipients = row_count;

  if v_recipients = 0 and p_require_recipients then
    raise exception 'That audience matched nobody with a login, so nothing was sent';
  end if;

  return v_notification;
end;
$$;

-- Nothing holding a JWT. The `fees_settle_gateway_payment` shape, for the same
-- reason: a function that takes its tenant as an argument is a function that
-- would let any signed-in person send in any school's name.
revoke all on function public.notify_send_for(uuid, text, text, text, jsonb, jsonb, text[], uuid, boolean)
  from public, anon, authenticated;

comment on function public.notify_send_for(uuid, text, text, text, jsonb, jsonb, text[], uuid, boolean) is
  'The one implementation of "who gets this, on which channels, with what '
  'frozen against it". Takes its tenant as an argument, so it is revoked from '
  'everybody holding a JWT and is reachable only by the service role. '
  'notify_send is the door people use.';

-- ---------------------------------------------------------------------------
-- ...and the door people use
-- ---------------------------------------------------------------------------

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
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- The check that made this function definer in the first place:
  -- `notification_deliveries` has no INSERT policy at all, which is what stops
  -- a student inventing a message from the principal.
  if public.current_role_code() <> 'admin' then
    raise exception 'Only an administrator can send a notification';
  end if;

  return public.notify_send_for(
    v_tenant_id, p_event_key, p_subject, p_body, p_audience, p_payload, p_channels,
    auth.uid(), true
  );
end;
$$;

revoke all on function public.notify_send(text, text, text, jsonb, jsonb, text[])
  from public, anon;
grant execute on function public.notify_send(text, text, text, jsonb, jsonb, text[])
  to authenticated;
