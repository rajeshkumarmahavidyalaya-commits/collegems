-- ---------------------------------------------------------------------------
-- The template critic should judge what a school tried, not what it defaults to
-- ---------------------------------------------------------------------------
--
-- 0124's first clause asked: which events *default* to WhatsApp and have no
-- registered template? On this schema the answer is always none --
-- `reference.notification_types.default_channels` lists in-app, SMS and email
-- and never WhatsApp -- so the sentence that mattered most could never fire.
-- Switching WhatsApp on and sending nothing was indistinguishable from
-- switching it on and having it work.
--
-- Two things were wrong with the question. The narrow one is that WhatsApp is
-- not in anybody's defaults yet. The broader one is that **the defaults are the
-- wrong evidence**: a school chooses channels per message at compose time, so
-- an event that does not default to WhatsApp can still be sent on it fifty
-- times a term.
--
-- The right evidence is already in the delivery log. `notify_send` skips a
-- WhatsApp delivery with no registered template and says so in `last_error`, so
-- the skips themselves are the record of what a school tried and could not do.
-- Counting them turns the critic from a guess into a report, and it can name
-- how many people did not hear.
--
-- Widening it to *every* event instead would have been the other mistake: nine
-- complaints the moment somebody enables the channel, most about events they
-- will never send that way, which is the kind of list people learn to scroll
-- past.

create or replace function public.notify_template_problems()
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  with settings as (
    select * from public.notification_channel_settings
    where tenant_id = ( select public.current_tenant_id() )
  ),
  -- What was actually attempted and could not be sent. RLS on
  -- `notification_deliveries` scopes this to the caller, so an administrator
  -- sees the school's and nobody else sees anything they should not.
  skipped as (
    select n.event_key, nt.name as event_name, count(*) as skipped_count
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    join reference.notification_types nt on nt.key = n.event_key
    where d.channel = 'whatsapp'
      and d.status = 'skipped'
      and d.last_error like 'No WhatsApp template is registered%'
      and not exists (
        select 1 from public.notification_templates t
        where t.tenant_id = ( select public.current_tenant_id() )
          and t.event_key = n.event_key and t.channel = 'whatsapp'
          and t.is_active and t.provider_template_name is not null
      )
    group by n.event_key, nt.name
  )
  select 'WhatsApp messages for "' || s.event_name || '" have been skipped '
         || s.skipped_count::text || ' time(s): no template is registered for it, and '
         || 'WhatsApp only accepts templates approved in advance. Register one, or stop '
         || 'choosing WhatsApp for that event.'
  from skipped s

  union all
  -- Switched on and entirely unused is worth one sentence, because it is the
  -- state a school reaches by enabling the channel and stopping.
  select 'WhatsApp is switched on, but this school has registered no templates at all, '
         || 'so nothing can be sent on it.'
  from settings s
  where s.channel = 'whatsapp' and s.is_enabled
    and not exists (
      select 1 from public.notification_templates t
      where t.tenant_id = ( select public.current_tenant_id() )
        and t.channel = 'whatsapp' and t.is_active
        and t.provider_template_name is not null
    )

  union all
  select 'The WhatsApp template "' || t.provider_template_name || '" for "' || nt.name
         || '" lists no parameters. If Meta''s copy has placeholders, they will be '
         || 'sent empty.'
  from public.notification_templates t
  join reference.notification_types nt on nt.key = t.event_key
  where t.tenant_id = ( select public.current_tenant_id() )
    and t.channel = 'whatsapp' and t.is_active
    and t.provider_template_name is not null
    and cardinality(t.provider_template_params) = 0

  union all
  -- A parameter naming a key the event never carries renders as a blank in a
  -- message somebody receives. Judged against the payloads this event has
  -- actually carried, and only once it has carried one -- "every parameter is
  -- unknown" on a fresh tenant would be noise rather than criticism.
  select 'The WhatsApp template for "' || nt.name || '" fills a placeholder from "'
         || p.key || '", which is not a variable this event''s messages have carried.'
  from public.notification_templates t
  join reference.notification_types nt on nt.key = t.event_key
  cross join lateral unnest(t.provider_template_params) as p(key)
  where t.tenant_id = ( select public.current_tenant_id() )
    and t.channel = 'whatsapp' and t.is_active
    and t.provider_template_name is not null
    and exists (
      select 1 from public.notifications n
      where n.tenant_id = t.tenant_id and n.event_key = t.event_key
    )
    and not exists (
      select 1
      from public.notifications n
      cross join lateral jsonb_object_keys(n.payload) as k(key)
      where n.tenant_id = t.tenant_id and n.event_key = t.event_key and k.key = p.key
    )
$$;

revoke all on function public.notify_template_problems() from public, anon;
grant execute on function public.notify_template_problems() to authenticated;
