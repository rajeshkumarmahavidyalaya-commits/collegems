-- The notification service's write path and its dispatcher queue.
--
-- `notify_send` is SECURITY INVOKER and therefore admin-only, because the
-- `notifications` insert policy is. That is deliberate rather than an
-- oversight: a teacher able to call this directly could address every parent in
-- the school with arbitrary text.
--
-- When attendance, fees or exams start raising their own notifications, each
-- gets a narrow function of its own -- the same shape library fines got in
-- migration 0026, where librarians were granted exactly `entry_type = 'fine'`
-- rows carrying a book issue and nothing else. Building that access now, before
-- any module needs it, would be building a spam vector on speculation.

-- ---------------------------------------------------------------------------
-- Rendering
-- ---------------------------------------------------------------------------

-- `{{variable}}` interpolation against the notification's payload. Deliberately
-- dumb: no conditionals, no loops, no expression language. A template engine in
-- the database is a sandbox-escape surface, and school notices do not need one.
create or replace function public.notify_render(p_template text, p_payload jsonb)
returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_out text := p_template;
  v_key text;
begin
  if p_template is null then
    return null;
  end if;

  for v_key in select jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) loop
    v_out := replace(v_out, '{{' || v_key || '}}', coalesce(p_payload ->> v_key, ''));
  end loop;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who a notification is for
-- ---------------------------------------------------------------------------

-- Audience is stored as intent (`{"kind":"section","section_id":…}`) rather
-- than a frozen list of ids, and this turns intent into people at send time.
--
--   {"kind":"all"}
--   {"kind":"role","role":"parent"}
--   {"kind":"users","user_ids":["…"]}
--   {"kind":"section","section_id":"…","who":"students"|"parents"|"both"}
--
-- Only people with a login can receive anything: a young student with no
-- account is not a recipient, and their guardian is. That is why this resolves
-- through `user_profiles` rather than through `students`.
create or replace function public.notify_resolve_audience(
  p_tenant_id uuid,
  p_audience jsonb
)
returns table (user_id uuid)
language sql
stable
set search_path = public, extensions
as $$
  select up.id
  from public.user_profiles up
  where up.tenant_id = p_tenant_id
    and up.is_active
    and (
      (p_audience ->> 'kind') = 'all'

      or (
        (p_audience ->> 'kind') = 'role'
        and up.role_id in (
          select r.id from public.roles r
          where r.tenant_id = p_tenant_id and r.code = (p_audience ->> 'role')
        )
      )

      or (
        (p_audience ->> 'kind') = 'users'
        and up.id::text in (
          select jsonb_array_elements_text(coalesce(p_audience -> 'user_ids', '[]'::jsonb))
        )
      )

      or (
        (p_audience ->> 'kind') = 'section'
        and (
          (
            coalesce(p_audience ->> 'who', 'both') in ('students', 'both')
            and up.student_id in (
              select e.student_id from public.enrolments e
              where e.tenant_id = p_tenant_id
                and e.section_id = (p_audience ->> 'section_id')::uuid
                and e.status = 'active'
            )
          )
          or (
            coalesce(p_audience ->> 'who', 'both') in ('parents', 'both')
            and up.guardian_id in (
              select gs.guardian_id
              from public.guardian_student gs
              join public.enrolments e on e.student_id = gs.student_id
              where gs.tenant_id = p_tenant_id
                and e.tenant_id = p_tenant_id
                and e.section_id = (p_audience ->> 'section_id')::uuid
                and e.status = 'active'
            )
          )
        )
      )
    )
$$;

revoke all on function public.notify_resolve_audience(uuid, jsonb) from public, anon;
grant execute on function public.notify_resolve_audience(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending
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

  -- What the caller asked for, else what the catalog says this event uses.
  select coalesce(p_channels, nt.default_channels) into v_channels
  from reference.notification_types nt where nt.key = p_event_key;

  insert into public.notifications
    (tenant_id, session_id, event_key, subject, body, payload, audience, created_by)
  values
    (v_tenant_id, v_session_id, p_event_key, p_subject, p_body,
     coalesce(p_payload, '{}'::jsonb), coalesce(p_audience, '{}'::jsonb), auth.uid())
  returning * into v_notification;

  -- One delivery per recipient per channel, in one statement.
  --
  -- An in-app delivery is `sent` the moment it exists, because the row IS the
  -- delivery -- there is nothing further to do and pretending it is queued
  -- would leave the dispatcher forever "about to" deliver something already
  -- delivered.
  --
  -- A channel with no address is `skipped`, not `failed`: a parent with no
  -- phone number is not a delivery failure to investigate, it is a message
  -- that was never sendable.
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
  -- Absence of a preference row means "use the catalog default", so only an
  -- explicit opt-out suppresses a channel.
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

revoke all on function public.notify_send(text, text, text, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.notify_send(text, text, text, jsonb, jsonb, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The inbox
-- ---------------------------------------------------------------------------

create or replace function public.notify_unread_count()
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select count(*)::integer
  from public.notification_deliveries d
  where d.recipient_user_id = ( select auth.uid() )
    and d.channel = 'in_app'
    and d.read_at is null
$$;

create or replace function public.notify_mark_all_read()
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  update public.notification_deliveries
  set read_at = now()
  where recipient_user_id = auth.uid()
    and channel = 'in_app'
    and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_unread_count() from public, anon;
revoke all on function public.notify_mark_all_read() from public, anon;
grant execute on function public.notify_unread_count() to authenticated;
grant execute on function public.notify_mark_all_read() to authenticated;

-- ---------------------------------------------------------------------------
-- The dispatcher queue
-- ---------------------------------------------------------------------------

-- Claims a batch for an Edge Function to send.
--
-- `for update skip locked` is what makes this safe to run more than once at a
-- time: two dispatchers claim disjoint batches instead of both sending the
-- same message. In-app deliveries are excluded because they are already sent.
--
-- SECURITY DEFINER and revoked from every role a person can hold, for the same
-- reason `fees_settle_gateway_payment` is: it runs where there is no user, and
-- nothing holding a JWT should be able to mark other people's mail as sending.
create or replace function public.notify_claim_deliveries(p_limit integer default 50)
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
    where c.status = 'queued'
      and c.next_attempt_at <= now()
      and c.channel <> 'in_app'
    order by c.next_attempt_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning d.*;
end;
$$;

revoke all on function public.notify_claim_deliveries(integer)
  from public, anon, authenticated;

-- Records what happened to one claimed delivery.
--
-- Backoff is exponential and bounded: roughly 1, 4, 16, 64 and 256 minutes,
-- then the delivery is `failed` and stops consuming attempts. A queue that
-- retries forever is how a dead SMS gateway turns into a bill.
create or replace function public.notify_record_result(
  p_delivery_id uuid,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts
  from public.notification_deliveries where id = p_delivery_id;

  if v_attempts is null then
    raise exception 'Delivery not found';
  end if;

  if p_ok then
    update public.notification_deliveries
    set status = 'sent', sent_at = now(), last_error = null
    where id = p_delivery_id;
  else
    update public.notification_deliveries
    set status = case when v_attempts >= 5 then 'failed' else 'queued' end,
        last_error = p_error,
        next_attempt_at = now() + (interval '1 minute' * power(4, least(v_attempts, 4)))
    where id = p_delivery_id;
  end if;
end;
$$;

revoke all on function public.notify_record_result(uuid, boolean, text)
  from public, anon, authenticated;
