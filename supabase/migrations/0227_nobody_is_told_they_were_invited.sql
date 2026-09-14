-- 0227 -- Nobody is told they were invited.
--
-- `0224` made an invitation able to name a person. It is still a row in a table
-- that the person named has no way of knowing exists. Swept across `src/` and
-- `supabase/functions/`: **nothing sends an invitation.** The only two mentions
-- of the word outside the module are interface copy telling somebody to *ask*
-- their administrator for one.
--
-- So an office wanting its 555 families online tells 555 families by hand.
--
-- ## The audience could not express it, again
--
-- `0219` found five declared events that were never raised, and the reason was
-- not neglect: `notify_resolve_audience` could not say *"this child's family"*,
-- so a receipt could not be addressed, so it was never sent. **Here is the same
-- sentence one step further out.**
--
-- > `notify_resolve_audience` returns `TABLE(user_id uuid)` and its every branch
-- > reads `user_profiles`. **An invitee is, by definition, not a user.** There
-- > is no `kind` that could be added to fix this, because the function answers
-- > *which of our people*, and an invitation is addressed to somebody who is not
-- > one of them yet.
--
-- So this does **not** widen the resolver. Widening it would mean a branch
-- returning null user ids through a function typed to return user ids, and
-- every existing caller learning to cope.
--
-- ## ...and the delivery table was ready for it
--
-- Read before designing anything, and it settles the shape:
--
--   * `notification_deliveries.recipient_user_id` is **nullable**, and there is
--     an `address` column beside it.
--   * `notify_claim_deliveries` joins `notification_channel_settings`,
--     `notifications` and `reference.notification_types` — and **never touches
--     `user_profiles`**.
--   * `notify-dispatch` reads `delivery.address` and nothing else to decide
--     where a message goes; it already fails a delivery permanently when the
--     address is empty.
--
-- A delivery to a bare address therefore drains through the existing dispatcher
-- with **no change to the Edge Function at all**. That is rule 10's bargain
-- paying out: one table and one dispatcher means a new *kind of recipient* is
-- also a driver-free change.
--
-- `invitation_announce` is `SECURITY DEFINER` for the reason rule 10 already
-- gives — `notification_deliveries` has no INSERT policy at all, which is what
-- stops a student inventing a message from the principal — and is gated on
-- `users.manage`, the permission that draws the screen it is called from.
--
-- **`in_app` is deliberately not a default channel for this event.** The
-- recipient has no account to open. A queued in-app message for somebody who
-- cannot sign in is the queue-that-can-never-drain this codebase already
-- refused once for WhatsApp.
--
-- ## The URL is a fact about the deployment, not about the school
--
-- The body needs a link and Postgres has no idea what this deployment's address
-- is. It is a parameter: the Next server action reads its own origin from the
-- request and passes it. A raiser still writes its own words (rule 10) — the
-- words are here; only the hostname comes from the caller, and it is checked to
-- be an `http(s)` URL rather than pasted into an email unread.

begin;

insert into reference.notification_types (key, name, description, default_channels, stale_after)
values (
  'invitation.sent',
  'Invitation to join',
  'Sent to the address on an invitation, telling somebody they can create a login.',
  array['email'],
  '7 days'::interval
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  default_channels = excluded.default_channels,
  stale_after = excluded.stale_after;

-- ---------------------------------------------------------------------------
-- The raiser
-- ---------------------------------------------------------------------------

create or replace function public.invitation_announce(
  p_invitation_id uuid,
  p_signup_url text
)
returns integer
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_inv public.invitations;
  v_school text;
  v_role text;
  v_name text;
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

  -- The person's own name where the invitation names one, so the message does
  -- not open with "Dear" and a blank. `0224` is what makes this possible at
  -- all: before it, an invitation named nobody.
  select btrim(p.first_name || ' ' || coalesce(p.last_name, '')) into v_name
  from public.people p
  where p.id = coalesce(
    (select s.person_id from public.staff s where s.id = v_inv.staff_id),
    (select st.person_id from public.students st where st.id = v_inv.student_id),
    (select g.person_id from public.guardians g where g.id = v_inv.guardian_id));

  insert into public.notifications (tenant_id, event_key, subject, body, audience, payload)
  values (
    v_tenant_id,
    'invitation.sent',
    format('%s has invited you to create a login', v_school),
    format(
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
      to_char(v_inv.expires_at, 'FMDD Mon YYYY')),
    -- The audience document records who this was for and is deliberately not a
    -- shape `notify_resolve_audience` understands: nothing should ever try to
    -- re-resolve it into a user, because there is no user.
    jsonb_build_object('kind', 'invitation', 'invitation_id', v_inv.id),
    jsonb_build_object('email', v_inv.email, 'role', v_role))
  returning id into v_notification_id;

  insert into public.notification_deliveries (
    tenant_id, notification_id, recipient_user_id, channel, address, subject, body, status)
  select
    v_tenant_id,
    v_notification_id,
    -- The whole point: there is nobody to name.
    null,
    'email',
    v_inv.email,
    n.subject,
    n.body,
    'queued'
  from public.notifications n where n.id = v_notification_id;

  return 1;
end;
$$;

revoke all on function public.invitation_announce(uuid, text) from public, anon;

comment on function public.invitation_announce(uuid, text) is
  'Queues one email to the address on a pending invitation. Definer because '
  'notification_deliveries has no INSERT policy; gated on users.manage. The '
  'delivery carries a null recipient_user_id and an address, which is what '
  'notify-dispatch already reads -- an invitee is not a user.';

-- ---------------------------------------------------------------------------
-- ...and a column that was generated and never read
-- ---------------------------------------------------------------------------

-- `invitations.token` has existed since `0004` and is referenced **nowhere**:
-- not in one migration, not once in `src/`. `handle_new_auth_user` matches a
-- signup to an invitation **by email**, so the token authorises nothing.
--
-- `0220`'s rule decides it: a column recording an intention with no executable
-- half is the defect, not the safeguard. And the specific danger of keeping it
-- is that it is exactly the sort of thing somebody puts in a link — **a token
-- that authorises nothing must never appear in a URL**, because a link that
-- looks like an invitation link and is not one is worse than no link at all.
--
-- What it would take to make it real, written down so nobody re-adds it
-- blindly: the signup form would pass it through `options.data`,
-- `handle_new_auth_user` would prefer `raw_user_meta_data ->> 'invitation_token'`
-- over the email match, and it would still have to check the email agrees --
-- which is the match it already does. That is a security-relevant rewrite of
-- the signup trigger to gain nothing this design needs.
alter table public.invitations drop column if exists token;

commit;
