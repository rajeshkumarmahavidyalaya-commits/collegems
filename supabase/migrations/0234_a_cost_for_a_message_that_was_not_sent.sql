-- 0234 -- A cost for a message that was not sent.
--
-- `0233`, probed end to end the moment it was applied. Two invitations, one
-- naming a guardian with a phone number and one naming a guardian whose number
-- was blanked in the same transaction:
--
--   guardian with a phone     email  queued   segments null
--   guardian with a phone     sms    queued   segments 1
--   guardian with no phone    email  queued   segments null
--   guardian with no phone    sms    skipped  segments 1      <-- wrong
--
-- The last row is the bug. The skipped delivery keeps its body — deliberately,
-- because an office looking at it should be able to see what would have gone —
-- and `sms_segments()` was computed from that body regardless of whether
-- anything was sent. So the function reported a cost for a message that does
-- not exist.
--
-- Nothing was miscounted downstream: `invitation_apply` adds to `sms_parts`
-- only where `status = 'queued'`, so the run totals were right. **That is what
-- makes it worth a migration rather than a shrug** — the number was wrong in
-- the one place a person reads it and right in the one place a machine does,
-- which is precisely the shape this file keeps recording:
--
-- > **A plausible number is more dangerous than an error.** `subscription_usage`
-- > counting 303 students for a college with none; `attendance_coverage`
-- > reporting eleven classes at 0.0%; a `DO` block timing a query nobody will
-- > run. Each was right about arithmetic and wrong about what it was counting.
--
-- Here the arithmetic is right too: that body really would cost one segment.
-- It is the **attachment** that is wrong, and the fix is the rule the schema
-- already applies to money — a cost belongs to a thing that happened.
--
-- Null, not zero, for the same reason `dashboard_summary` reports a null
-- collection rate before anything is billed: *"this cost nothing"* and *"there
-- is no cost, because there is no message"* are different facts and zero says
-- the first.

begin;

create or replace function public.invitation_announce(
  p_invitation_id uuid,
  p_signup_url text
)
returns table (channel text, status text, reason text, segments integer)
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_inv public.invitations;
  v_school text;
  v_role text;
  v_person_id uuid;
  v_name text;
  v_phone text;
  v_long text;
  v_short text;
  v_subject text;
  v_channels text[];
  v_notification_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot invite people to this school.';
  end if;

  select * into v_inv from public.invitations i
  where i.id = p_invitation_id and i.tenant_id = v_tenant_id;

  if v_inv.id is null then
    raise exception 'That invitation does not exist';
  end if;

  -- Announcing a withdrawn invitation would send somebody a link that refuses
  -- them. An accepted one is worse: they already have the login.
  if v_inv.status <> 'pending' then
    raise exception 'That invitation was already %', v_inv.status;
  end if;

  if p_signup_url !~ '^https?://[^ ]+$' then
    raise exception 'The sign-up address is not a web address';
  end if;

  select t.name into v_school from public.tenants t where t.id = v_tenant_id;
  select r.name into v_role from public.roles r where r.id = v_inv.role_id;

  -- One lookup for both the name and the number. `0224` is what makes either
  -- possible: before it, an invitation named nobody.
  v_person_id := coalesce(
    (select s.person_id from public.staff s where s.id = v_inv.staff_id),
    (select st.person_id from public.students st where st.id = v_inv.student_id),
    (select g.person_id from public.guardians g where g.id = v_inv.guardian_id));

  select btrim(p.first_name || ' ' || coalesce(p.last_name, '')),
         nullif(btrim(coalesce(p.phone, '')), '')
    into v_name, v_phone
  from public.people p where p.id = v_person_id;

  v_subject := format('%s has invited you to create a login', v_school);

  v_long := format(
    E'%s\n\n'
    '%s has invited you to create a login as %s.\n\n'
    'Go to %s/signup and sign up with this email address — %s — and no other. '
    'The invitation is open until %s.\n\n'
    'If you were not expecting this, you can ignore it: nothing happens until '
    'somebody signs up.',
    case when coalesce(v_name, '') = '' then 'Hello,' else 'Hello ' || v_name || ',' end,
    v_school,
    v_role,
    rtrim(p_signup_url, '/'),
    v_inv.email,
    to_char(v_inv.expires_at, 'FMDD Mon YYYY'));

  -- The same four facts, in one segment: who, where, which address, until when.
  -- No greeting and no reassurance -- both are what an SMS drops first, and
  -- the address is the one thing that cannot be dropped, because signing up
  -- with the wrong one silently creates a tenantless login.
  v_short := format(
    '%s: create your login at %s/signup using %s. Open until %s.',
    v_school,
    rtrim(p_signup_url, '/'),
    v_inv.email,
    to_char(v_inv.expires_at, 'FMDD Mon YYYY'));

  select nt.default_channels into v_channels
  from reference.notification_types nt where nt.key = 'invitation.sent';

  insert into public.notifications (
    tenant_id, session_id, event_key, subject, body, audience, payload, created_by)
  values (
    v_tenant_id,
    public.current_session_id(v_tenant_id),
    'invitation.sent',
    v_subject,
    v_long,
    -- Deliberately not a shape `notify_resolve_audience` understands: nothing
    -- should ever try to re-resolve this into a user, because there is no user.
    jsonb_build_object('kind', 'invitation', 'invitation_id', v_inv.id),
    jsonb_build_object('email', v_inv.email, 'role', v_role),
    auth.uid())
  returning id into v_notification_id;

  return query
  with chosen as (select unnest(v_channels) as ch),
  composed as (
    select
      c.ch,
      case when c.ch = 'sms' then v_short else v_long end as body,
      case when c.ch = 'email' then v_inv.email
           when c.ch = 'sms' then v_phone end as address,
      case
        when c.ch not in ('email', 'sms') then
          format('This invitation cannot be sent by %s: the person has no account yet, '
                 'so there is nothing to deliver it to.', c.ch)
        when c.ch = 'email' and coalesce(v_inv.email, '') = '' then
          'This invitation has no email address on it'
        when c.ch = 'sms' and v_person_id is null then
          'This invitation names an address and nobody, so there is no phone number to text'
        when c.ch = 'sms' and v_phone is null then
          'No phone number on record for this person'
      end as why
    from chosen c
  ),
  written as (
    insert into public.notification_deliveries (
      tenant_id, notification_id, recipient_user_id, channel,
      address, subject, body, status, last_error)
    select
      v_tenant_id,
      v_notification_id,
      -- The whole point: there is nobody to name.
      null,
      cm.ch,
      cm.address,
      v_subject,
      cm.body,
      case when cm.why is null then 'queued' else 'skipped' end,
      cm.why
    from composed cm
    returning notification_deliveries.channel,
              notification_deliveries.status,
              notification_deliveries.last_error,
              notification_deliveries.body
  )
  select w.channel, w.status, w.last_error,
         -- `and w.status = 'queued'` is the whole of 0234. A skipped delivery
         -- keeps its body so somebody can see what would have gone; it does not
         -- keep a price, because nothing was sent.
         case when w.channel = 'sms' and w.status = 'queued'
              then public.sms_segments(w.body) end
  from written w
  order by w.channel;
end;
$$;

revoke all on function public.invitation_announce(uuid, text) from public, anon;

commit;
