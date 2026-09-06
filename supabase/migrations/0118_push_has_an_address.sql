-- ---------------------------------------------------------------------------
-- A push notification now has somewhere to go
-- ---------------------------------------------------------------------------
--
-- `notify_send` resolved an address per channel from the recipient's `people`
-- row -- email from `email`, SMS and WhatsApp from `phone` -- and for `push` it
-- had nothing to look at, so it fell through the CASE and wrote a `queued`
-- delivery with a null address. Nothing drained the queue, so nothing noticed.
-- The dispatcher notices: a claimed delivery with no address is a dead letter,
-- because a recipient with no address will not have one in four minutes.
--
-- `devices` (migration 0117) is the missing table, and it changes the shape of
-- the fan-out rather than just filling in a column:
--
--   email / sms / whatsapp   one address per person
--   push                     one address per HANDSET, and a person has three
--
-- So the address lateral returns a *set*. For every other channel it returns
-- exactly one row and nothing about those deliveries changes. For push it
-- returns one row per live device -- and, when there are none, exactly one row
-- with a null address, so the log says "no device registered for this person"
-- rather than saying nothing at all. A recipient who silently vanishes from a
-- delivery log is the failure this module exists to prevent.
--
-- Everything else in this function is unchanged from 0035: the admin check, the
-- preference filter, the template lookup, the empty-audience refusal.

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

  -- The check the `notifications` insert policy used to make. A definer
  -- bypasses that policy, so it has to be made here or not at all.
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
    coalesce(public.notify_render(tpl.subject, p_payload), p_subject),
    coalesce(public.notify_render(tpl.body, p_payload), p_body),
    case
      when ch.channel = 'in_app' then 'sent'
      when ch.channel in ('email', 'sms', 'whatsapp', 'push') and addr.address is null
        then 'skipped'
      else 'queued'
    end,
    case when ch.channel = 'in_app' then now() else null end,
    case
      when ch.channel = 'push' and addr.address is null
        then 'No device registered for this person'
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
  -- One row per address. Exactly one for a person-addressed channel; one per
  -- live handset for push; and one null row for a push recipient with no
  -- handset, so the delivery log can say why.
  --
  -- LEFT join, not CROSS, and that is load-bearing: a login with no
  -- `user_profiles` row returns no rows from the first arm, and a cross join
  -- would drop that recipient from the delivery log entirely rather than
  -- recording a skip. Vanishing silently is the one outcome this table exists
  -- to prevent.
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
