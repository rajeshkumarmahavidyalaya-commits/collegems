-- ---------------------------------------------------------------------------
-- Devices -- where a push notification would actually go
-- ---------------------------------------------------------------------------
--
-- The first half of the mobile API, and the piece the notification module has
-- been missing since 0033: `notify_send` resolves an email from `people.email`
-- and an SMS from `people.phone`, and for `push` it had nowhere to look. Every
-- push delivery was written with a null address -- which the new dispatcher
-- correctly treats as a dead letter, because a recipient with no address will
-- not have one in four minutes.
--
-- A push address is not a property of a person. It is a property of a phone,
-- there may be three of them, and they expire. So it is a table.
--
-- WHOSE ROW IS IT
--
-- The device belongs to the login, not to the school's administrator. A person
-- registers their own phone and revokes their own phone, and nobody else can
-- read the token -- a push token is a capability: anybody holding one and the
-- provider's key can send that handset a notification that looks like the
-- school's. So the policies are `user_id = auth.uid()` and there is deliberately
-- no admin read policy.
--
-- That has a consequence worth stating rather than discovering: **an
-- administrator cannot see the tokens**, so a support question like "why is
-- Ravi's mother not getting notifications" is answered from
-- `notification_deliveries` (which she can be told about) and from
-- `mobile_device_summary()` below, which counts devices without exposing them.

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  platform text not null check (platform in ('ios', 'android', 'web')),
  -- The provider's handle for this installation. Long, opaque, and a
  -- capability -- see the note above about who may read it.
  push_token text not null check (btrim(push_token) <> ''),

  -- What the phone is running. Kept because the only honest answer to "the app
  -- crashes on my phone" starts with knowing which build it is, and because a
  -- minimum-supported-version check needs something to compare against.
  app_version text,
  os_version text,
  device_name text,
  locale text,

  last_seen_at timestamptz not null default now(),
  -- Revoked rather than deleted: a token that stopped working is a fact worth
  -- keeping for a while, and a delete would make "she uninstalled it" and "we
  -- never had a token" the same row, which is to say no row.
  revoked_at timestamptz,
  revoked_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint devices_revoked_chk check ((revoked_at is null) = (revoked_reason is null))
);

-- One live registration per token per tenant. Partial, so a token that was
-- revoked and later re-registered on the same handset is allowed back --
-- the same reason the leave-request exclusion constraint is partial.
create unique index devices_one_live_token
  on public.devices (tenant_id, push_token) where revoked_at is null;

create index devices_tenant_idx on public.devices (tenant_id);
-- What the push driver will ask for: every live handset belonging to a person.
create index devices_user_idx
  on public.devices (tenant_id, user_id) where revoked_at is null;

create trigger set_updated_at before update on public.devices
  for each row execute function public.set_updated_at();
create trigger audit_devices
  after insert or update or delete on public.devices
  for each row execute function public.audit_row_change();

alter table public.devices enable row level security;

create policy "people manage their own devices" on public.devices
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and user_id = ( select auth.uid() )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and user_id = ( select auth.uid() )
  );

-- ---------------------------------------------------------------------------
-- Registering
-- ---------------------------------------------------------------------------

-- Called on every app start, not only on install. A push token is rotated by
-- the operating system without telling the user, so "register" has to mean
-- "this is my token now", idempotently -- which is why it is an upsert on the
-- token and why it stamps `last_seen_at` on the way through.
--
-- SECURITY INVOKER: the policy above is the gate, and it says the row is the
-- caller's. A definer here would let one login register a token against
-- another person's account, which is the one thing this table must not allow.
create or replace function public.mobile_register_device(
  p_push_token text,
  p_platform text,
  p_app_version text default null,
  p_os_version text default null,
  p_device_name text default null,
  p_locale text default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_tenant_id is null or v_user_id is null then
    raise exception 'Not signed in';
  end if;

  if p_push_token is null or btrim(p_push_token) = '' then
    raise exception 'A device needs a push token';
  end if;

  insert into public.devices (
    tenant_id, user_id, platform, push_token,
    app_version, os_version, device_name, locale, last_seen_at
  )
  values (
    v_tenant_id, v_user_id, p_platform, btrim(p_push_token),
    p_app_version, p_os_version, p_device_name, p_locale, now()
  )
  on conflict (tenant_id, push_token) where revoked_at is null
  do update set
    -- The same handset can change hands inside a school -- a shared tablet, a
    -- parent handing a phone to a sibling. Whoever registered it last owns it,
    -- and the policy makes that a decision only the new owner can take.
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_version = excluded.app_version,
    os_version = excluded.os_version,
    device_name = excluded.device_name,
    locale = excluded.locale,
    last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.mobile_register_device(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.mobile_register_device(text, text, text, text, text, text)
  to authenticated;

-- Signing out, or a provider telling us the token is dead. Idempotent: revoking
-- an already-revoked token is a no-op rather than an error, because the caller
-- is usually a retry.
create or replace function public.mobile_revoke_device(
  p_push_token text,
  p_reason text default 'signed out'
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  update public.devices
  set revoked_at = now(), revoked_reason = coalesce(nullif(btrim(p_reason), ''), 'signed out')
  where tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
    and push_token = btrim(p_push_token)
    and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mobile_revoke_device(text, text) from public, anon;
grant execute on function public.mobile_revoke_device(text, text) to authenticated;

-- How many handsets a school's people have registered, without showing a single
-- token. Definer, because an administrator has no read policy on `devices` and
-- must not get one -- the count is a support answer, the token is a capability.
create or replace function public.mobile_device_summary()
returns table (platform text, live integer, revoked integer, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    d.platform,
    count(*) filter (where d.revoked_at is null)::integer,
    count(*) filter (where d.revoked_at is not null)::integer,
    max(d.last_seen_at) filter (where d.revoked_at is null)
  from public.devices d
  where d.tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  group by d.platform
  order by d.platform
$$;

revoke all on function public.mobile_device_summary() from public, anon;
grant execute on function public.mobile_device_summary() to authenticated;
