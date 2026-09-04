-- ---------------------------------------------------------------------------
-- Notification channels: configuration, and the dispatcher's own record
-- ---------------------------------------------------------------------------
--
-- Migration 0033 built the queue and said, in its header, that nothing drains
-- it because no provider is connected. This is the first half of connecting
-- one, and the interesting problem is not the sending -- it is knowing, and
-- saying, whether a channel can send at all.
--
-- Rule 10's honesty requirement was carried by `CHANNELS[].live`, a constant in
-- the Next.js app. That was true while the answer was "never, for anybody". It
-- stops being true the moment a driver exists, because the answer becomes a
-- fact about *this deployment and this school*: an email driver with no API key
-- sends nothing, and a school with no from-address sends nothing either, and
-- neither is visible from a constant compiled into the bundle.
--
-- So liveness moves here. `CHANNELS[].driver` stays in the app and means "this
-- codebase knows how to send on this channel"; this table means "and it can,
-- here, today". A screen offering SMS reads both.
--
-- WHO WRITES WHAT
--
-- Two writers, and they must not be able to write each other's columns:
--
--   an administrator   is_enabled, from_address, sender_name
--   the dispatcher     provider, provider_configured, last_attempt_at,
--                      last_success_at, last_error
--
-- The dispatcher runs as the service role and bypasses RLS, so it needs no
-- policy. The administrator does, and a policy alone would give them the health
-- columns too -- a school that can rewrite `last_error` can hide the fact that
-- its parents stopped receiving anything. That is exactly the case CLAUDE.md's
-- "RLS cannot restrict columns" rule describes, and the answer is the same one:
-- a column-level GRANT beside the policy. It works here for the same reason it
-- worked on `notification_deliveries` and not on `homework_submissions` -- only
-- one role that holds a JWT writes this table at all, so narrowing what
-- `authenticated` may write narrows exactly the right person.

create table public.notification_channel_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'whatsapp', 'push')),

  -- The school's decision. Off means the dispatcher will not claim this
  -- channel's deliveries -- they stay queued and countable, rather than being
  -- marked skipped, so turning the channel on later drains the backlog instead
  -- of losing it.
  is_enabled boolean not null default false,
  -- Who the message comes from. An email needs an address; an SMS needs a
  -- sender id; in-app needs neither.
  from_address text,
  sender_name text,

  -- Everything below is the dispatcher's record of what happened, and is not
  -- writable by anybody holding a JWT. See the GRANT at the foot of this file.
  provider text,
  -- What the dispatcher last reported: it looked for its credentials and this
  -- tenant's from-address, and either could send or could not. Null means no
  -- dispatcher has ever run for this channel, which is a different thing from
  -- "it ran and found nothing" -- and a screen that conflates them tells a
  -- school its email is broken when in fact it has never been tried.
  provider_configured boolean,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, channel),
  -- In-app is not a provider and never needs turning on. Making that a
  -- constraint rather than a convention stops a screen offering an "enable"
  -- switch that would mean nothing.
  constraint notification_channel_settings_in_app_chk
    check (channel <> 'in_app' or (is_enabled and from_address is null))
);

create index notification_channel_settings_tenant_idx
  on public.notification_channel_settings (tenant_id);

create trigger set_updated_at before update on public.notification_channel_settings
  for each row execute function public.set_updated_at();
create trigger audit_notification_channel_settings
  after insert or update or delete on public.notification_channel_settings
  for each row execute function public.audit_row_change();

alter table public.notification_channel_settings enable row level security;

-- Everybody who can be sent something may see which channels this school uses:
-- a preference screen that offers SMS has to be able to say whether SMS works.
create policy "tenant members view notification_channel_settings"
  on public.notification_channel_settings
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage notification_channel_settings"
  on public.notification_channel_settings
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- The half the policy cannot express. Without this, "admins manage" includes
-- `last_error`, and the delivery record stops being a record.
revoke update on public.notification_channel_settings from authenticated, anon;
grant update (is_enabled, from_address, sender_name)
  on public.notification_channel_settings to authenticated;

-- ---------------------------------------------------------------------------
-- What the provider called it
-- ---------------------------------------------------------------------------

-- The provider's own id for the message. Not decoration: it is the only thing
-- that makes "we sent it, ask them" answerable when a parent says nothing
-- arrived, and it is what a delivery-status callback would match on when one
-- is built.
alter table public.notification_deliveries add column provider_ref text;

create index notification_deliveries_provider_ref_idx
  on public.notification_deliveries (tenant_id, provider_ref)
  where provider_ref is not null;

-- The claim query gained a channel term, so the index it uses should carry one.
drop index if exists public.notification_deliveries_due_idx;
create index notification_deliveries_due_idx
  on public.notification_deliveries (channel, next_attempt_at, tenant_id)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- Every tenant starts with a row per channel
-- ---------------------------------------------------------------------------

-- A missing row and a disabled row would mean the same thing to a dispatcher
-- and different things to a screen, so there is always a row. In-app is on
-- because it is not a provider; everything else is off until somebody says
-- otherwise, which is the conservative reading of rule 12 applied to spending
-- a school's money.
insert into public.notification_channel_settings (tenant_id, channel, is_enabled)
select t.id, c.channel, c.channel = 'in_app'
from public.tenants t
cross join (values ('in_app'), ('email'), ('sms'), ('whatsapp'), ('push')) as c(channel)
on conflict (tenant_id, channel) do nothing;

-- ...including tenants created later. A trigger rather than a defaulting read
-- path, because the alternative is every caller remembering to `coalesce` the
-- absent row into a disabled one, and the ninth caller not doing it.
create or replace function public.notification_channels_for_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.notification_channel_settings (tenant_id, channel, is_enabled)
  select new.id, c.channel, c.channel = 'in_app'
  from (values ('in_app'), ('email'), ('sms'), ('whatsapp'), ('push')) as c(channel)
  on conflict (tenant_id, channel) do nothing;
  return new;
end;
$$;

create trigger notification_channels_for_new_tenant
  after insert on public.tenants
  for each row execute function public.notification_channels_for_new_tenant();
