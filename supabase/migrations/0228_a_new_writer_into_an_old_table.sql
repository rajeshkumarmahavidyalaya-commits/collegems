-- 0228 -- A new writer into an old table.
--
-- `0227`'s probe refused on the first announcement:
--
--   23502  null value in column "session_id" of relation "notifications"
--
-- `notifications` carries `session_id not null` because rule 2 says every
-- transactional table does, and `notify_send_for` — the table's only other
-- writer — has supplied it since the module shipped. `invitation_announce` is
-- the second writer and did not.
--
-- > **Rule 1's "every table carries `tenant_id`" has a rule-2 twin, and a new
-- > writer inherits both.** Reading the *table* would have said so; reading the
-- > existing *writer* would have said so. Neither was done, and the probe was
-- > what asked.
--
-- `created_by` goes in with it, for the same reason and from the same place:
-- `auth.uid()`, so the trail names the administrator who sent it rather than
-- the definer function that wrote the row.
--
-- The year is `current_session_id()` and not arithmetic on today's date, which
-- is `0198`'s distinction applied rather than assumed: an invitation is not a
-- register taken on a day, it is an administrative act filed under the year the
-- school has decided it is working in — the same reading `notify_send_for`
-- already takes for every other notification, and a second answer inside one
-- table would be worse than either answer.

begin;

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

  if v_inv.status <> 'pending' then
    raise exception 'That invitation was already %', v_inv.status;
  end if;

  if p_signup_url !~ '^https?://[^ ]+$' then
    raise exception 'The sign-up address is not a web address';
  end if;

  select t.name into v_school from public.tenants t where t.id = v_tenant_id;
  select r.name into v_role from public.roles r where r.id = v_inv.role_id;

  select btrim(p.first_name || ' ' || coalesce(p.last_name, '')) into v_name
  from public.people p
  where p.id = coalesce(
    (select s.person_id from public.staff s where s.id = v_inv.staff_id),
    (select st.person_id from public.students st where st.id = v_inv.student_id),
    (select g.person_id from public.guardians g where g.id = v_inv.guardian_id));

  insert into public.notifications (
    tenant_id, session_id, event_key, subject, body, audience, payload, created_by)
  values (
    v_tenant_id,
    public.current_session_id(v_tenant_id),
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
    jsonb_build_object('kind', 'invitation', 'invitation_id', v_inv.id),
    jsonb_build_object('email', v_inv.email, 'role', v_role),
    auth.uid())
  returning id into v_notification_id;

  insert into public.notification_deliveries (
    tenant_id, notification_id, recipient_user_id, channel, address, subject, body, status)
  select
    v_tenant_id,
    v_notification_id,
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

commit;
