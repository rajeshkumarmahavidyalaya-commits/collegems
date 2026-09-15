-- 0233 -- An SMS is not an email with fewer lines.
--
-- `0227` gave an invitation a way to arrive, on one channel. The roadmap's
-- reason for a second is a fact about the customer rather than about the code:
-- **all 555 guardians of this college have a phone number as well as an email**
-- (571 people carry one, every one of them already in E.164), and email
-- deliverability to Indian parents is poor enough that an office that sends 555
-- invitations by email alone will be chasing most of them by hand anyway.
--
-- Rule 10's bargain pays out again: `notification_deliveries` already carries a
-- nullable `recipient_user_id` beside an `address`, the Twilio driver has
-- existed since the dispatcher shipped, and `notify_claim_deliveries` already
-- refuses a channel the school has not switched on. **So the channel is not the
-- work.** The work is two things nobody had looked at.
--
-- ## One: the body is written once and sent to every channel
--
-- `notify_send_for` composes one `p_body` and hands the same string to email,
-- SMS, WhatsApp and push alike. That has been harmless because every raiser so
-- far wrote a sentence — measured, the three events that already default to SMS
-- produce **56, 58 and 94** GSM-7 characters, all one segment.
--
-- `invitation.sent` is the first one that does not. Its email body is a letter:
-- greeting, the role, the address to sign up with, the expiry, and a line
-- saying it is safe to ignore. Measured: **347 characters — and UCS-2, because
-- of its two em dashes, which is 6 SMS segments.** Sent to 555 families that is
-- **3,330 billable parts** instead of 555, to say something that fits in one.
--
-- > **A single character outside GSM-7 halves the segment and doubles the bill.**
-- > An em dash, a curly quote, a rupee sign. `sms_segments()` is that rule's
-- > executable half, because a comment saying "keep it short" is not a length.
--
-- So this composes **two bodies**, and it does it here rather than widening
-- `notify_send_for`: a per-channel body on the general sender would be a second
-- `p_body` that every one of its six callers must now decide about, to fix one
-- event. The narrow fix is in the raiser that has the problem. If a second
-- event grows a letter for a body, that is the moment to generalise — and the
-- numbers above are recorded so the next person can see that today it is one.
--
-- Measured over all 555 guardians with this college's name and the real
-- addresses: **137 to 147 GSM-7 characters, 555 of 555 in one segment.**
--
-- ## Two: `default_channels` on this event had no reader
--
-- `0227` wrote `array['email']` into the catalogue and then hardcoded `'email'`
-- in the insert underneath. Every other raiser goes through `notify_send_for`,
-- which reads `coalesce(p_channels, nt.default_channels)` — this one does not,
-- so the catalogue row was decoration. A school editing it would have changed
-- nothing, silently, which is the shape rule 12 keeps warning about: a stored
-- value with no executable half.
--
-- It reads the catalogue now, and a channel it cannot serve is written down as
-- a skipped delivery naming the reason rather than guessed at. `in_app` is
-- still refused for the reason `0227` gave — the recipient has no account to
-- open it in — and it is refused *in a sentence on a row* now instead of by
-- being left out of a literal.
--
-- ## What this deliberately does not do
--
-- **DLT.** Indian carriers accept transactional SMS only from a sender ID and a
-- template registered with the TRAI DLT registry, which is the same shape as
-- WhatsApp's approved templates and is not modelled anywhere in this codebase —
-- not by this migration and not by the three events that have defaulted to SMS
-- since `0033`. It is a pre-existing gap in the module, named here rather than
-- papered over, and the honest description of what would close it is:
-- `notification_templates` already has the `provider_template_name` /
-- `provider_template_params` columns WhatsApp uses, so DLT is a driver change
-- plus a per-tenant sender ID setting, not a new concept.
--
-- **Refusing a long number.** A phone that is not in international format is
-- left to the gateway to reject. Skipping it here would refuse numbers Twilio
-- accepts when the sender is in the same country, and a control that refuses
-- you wrongly is worse than no control.

begin;

-- ---------------------------------------------------------------------------
-- How many messages is this, really
-- ---------------------------------------------------------------------------

create or replace function public.sms_segments(p_text text)
returns integer
language plpgsql
immutable
as $$
declare
  -- GSM 03.38, the default alphabet. Anything outside it forces the whole
  -- message to UCS-2 -- there is no per-character fallback.
  v_basic constant text :=
    E'@£$¥èéùìòÇ\nØø\rÅå'
    || E'Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ'
    || E' !"#¤%&''()*+,-./0123456789:;<=>?'
    || E'¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§'
    || E'¿abcdefghijklmnopqrstuvwxyzäöñüà';
  -- The extension table: each of these is escape + character, so it costs two.
  v_ext constant text := E'\f^{}\\[~]|€';
  v_units integer := 0;
  v_ch text;
  v_gsm boolean := true;
begin
  if p_text is null or p_text = '' then
    return 0;
  end if;

  for i in 1..length(p_text) loop
    v_ch := substr(p_text, i, 1);
    if position(v_ch in v_basic) > 0 then
      v_units := v_units + 1;
    elsif position(v_ch in v_ext) > 0 then
      v_units := v_units + 2;
    else
      v_gsm := false;
      exit;
    end if;
  end loop;

  if not v_gsm then
    -- UCS-2: 70 in a single message, 67 once the concatenation header is there.
    v_units := length(p_text);
    return case when v_units <= 70 then 1 else ceil(v_units::numeric / 67)::integer end;
  end if;

  return case when v_units <= 160 then 1 else ceil(v_units::numeric / 153)::integer end;
end;
$$;

comment on function public.sms_segments(text) is
  'How many SMS parts this text costs. GSM-7 gives 160 in one message and 153 '
  'per part after that; one character outside the alphabet -- an em dash, a '
  'curly quote, a rupee sign -- forces UCS-2 and drops those to 70 and 67. '
  'A comment saying "keep it short" is not a length.';

-- ---------------------------------------------------------------------------
-- The catalogue row, which now has a reader
-- ---------------------------------------------------------------------------

update reference.notification_types
set default_channels = array['email', 'sms']
where key = 'invitation.sent';

-- ---------------------------------------------------------------------------
-- The raiser, saying what it did per channel
-- ---------------------------------------------------------------------------

-- The return type changes, so this is a drop rather than a replace. Rule 7's
-- lesson about `report_run`: leaving the old body behind is where a permission
-- check quietly stops being updated in one of the two.
drop function if exists public.invitation_announce(uuid, text);

create function public.invitation_announce(
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
         case when w.channel = 'sms' then public.sms_segments(w.body) end
  from written w
  order by w.channel;
end;
$$;

revoke all on function public.invitation_announce(uuid, text) from public, anon;

comment on function public.invitation_announce(uuid, text) is
  'Queues one delivery per channel in reference.notification_types for '
  'invitation.sent, to the addresses on the invitation and on the person it '
  'names, and says per channel what it did. Email gets the letter; SMS gets a '
  'one-segment version of the same four facts. Definer because '
  'notification_deliveries has no INSERT policy; gated on users.manage.';

-- ---------------------------------------------------------------------------
-- ...and the bulk run counts what it actually sent
-- ---------------------------------------------------------------------------

-- An office about to text 555 families is about to be billed per part, so
-- `sms_parts` is beside `texted` rather than inferred from it -- the
-- `attendance_coverage` instinct, applied to a bill.
drop function if exists public.invitation_apply(uuid, text);

create function public.invitation_apply(
  p_run_id uuid,
  p_signup_url text
)
returns table (invited integer, failed integer, emailed integer, texted integer, sms_parts integer)
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.invitation_runs;
  v_row record;
  v_inv public.invitations;
  v_said record;
  v_invited integer := 0;
  v_failed integer := 0;
  v_emailed integer := 0;
  v_texted integer := 0;
  v_parts integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot invite people to this school.';
  end if;

  select * into v_run from public.invitation_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;

  if v_run.id is null then
    raise exception 'That invitation list does not exist';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'This list was already %', v_run.status;
  end if;

  for v_row in
    select * from public.invitation_decisions d
    where d.run_id = p_run_id and d.decision = 'invite' and d.applied_invitation_id is null
    order by d.full_name, d.id
  loop
    begin
      v_inv := public.invitation_create(
        v_row.email,
        v_run.role_id,
        coalesce(v_row.guardian_id, v_row.student_id, v_row.staff_id));

      update public.invitation_decisions
      set applied_invitation_id = v_inv.id, error = null
      where id = v_row.id;
      v_invited := v_invited + 1;

      begin
        -- A failed announcement is not a failed invitation, and a channel that
        -- skipped is not a failure at all -- it is a fact the office needs,
        -- which is why the reason is written to the row rather than counted.
        for v_said in
          select * from public.invitation_announce(v_inv.id, p_signup_url)
        loop
          if v_said.status = 'queued' and v_said.channel = 'email' then
            v_emailed := v_emailed + 1;
          elsif v_said.status = 'queued' and v_said.channel = 'sms' then
            v_texted := v_texted + 1;
            v_parts := v_parts + coalesce(v_said.segments, 1);
          end if;
        end loop;
      exception when others then
        update public.invitation_decisions
        set error = 'Invited, but nothing went out: ' || sqlerrm
        where id = v_row.id;
      end;

    exception when others then
      update public.invitation_decisions
      set error = sqlerrm
      where id = v_row.id;
      v_failed := v_failed + 1;
    end;
  end loop;

  update public.invitation_runs
  set status = 'applied', applied_at = now(), applied_by = auth.uid()
  where id = p_run_id;

  return query select v_invited, v_failed, v_emailed, v_texted, v_parts;
end;
$$;

comment on function public.invitation_apply(uuid, text) is
  'Applies an invitation list through invitation_create and announces each one. '
  'Reports emailed and texted separately, plus the number of SMS parts, because '
  'an office texting five hundred families is billed per part and one number '
  'cannot say both.';

commit;
