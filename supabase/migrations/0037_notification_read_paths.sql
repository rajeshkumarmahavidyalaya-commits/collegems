-- Phase 4.1, part 3 -- the three read paths the app needs.
--
-- All of these could be PostgREST queries instead, and two of them deliberately
-- are not:
--
--   * `reference.notification_types` lives outside `public`, so reaching it from
--     supabase-js would mean exposing a second schema through the API for one
--     read-only catalog. A function is a smaller hole.
--
--   * The inbox and the outbox both need `notifications` joined to
--     `notification_deliveries`, and that foreign key is composite
--     (tenant_id, notification_id) -- deliberately, so a cross-tenant id cannot
--     be smuggled past an FK check, which does not run under RLS. PostgREST
--     embedding across a composite key is not something this project has been
--     able to verify, so the join is written here where it is plainly correct.
--
-- All three are SECURITY INVOKER: every row they return still passes through
-- the same policies a direct select would.

-- ---------------------------------------------------------------------------
-- The catalog
-- ---------------------------------------------------------------------------

create or replace function public.notify_event_types()
returns table (
  key text,
  name text,
  description text,
  default_channels text[]
)
language sql
stable
set search_path = public, extensions
as $$
  select t.key, t.name, t.description, t.default_channels
  from reference.notification_types t
  order by t.key
$$;

revoke all on function public.notify_event_types() from public, anon;
grant execute on function public.notify_event_types() to authenticated;

-- ---------------------------------------------------------------------------
-- My inbox
-- ---------------------------------------------------------------------------

-- Only `in_app`. An email delivery is a record of something the system tried to
-- send you somewhere else; showing it in the inbox would double every message
-- for anyone whose school has email switched on.
create or replace function public.notify_inbox(
  p_limit integer default 50,
  p_only_unread boolean default false
)
returns table (
  id uuid,
  notification_id uuid,
  event_key text,
  event_name text,
  subject text,
  body text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select
    d.id,
    d.notification_id,
    n.event_key,
    t.name as event_name,
    d.subject,
    d.body,
    d.read_at,
    d.created_at
  from public.notification_deliveries d
  join public.notifications n
    on n.tenant_id = d.tenant_id and n.id = d.notification_id
  join reference.notification_types t on t.key = n.event_key
  where d.recipient_user_id = ( select auth.uid() )
    and d.channel = 'in_app'
    and (not p_only_unread or d.read_at is null)
  order by d.created_at desc
  limit greatest(coalesce(p_limit, 50), 1)
$$;

revoke all on function public.notify_inbox(integer, boolean) from public, anon;
grant execute on function public.notify_inbox(integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The delivery log
-- ---------------------------------------------------------------------------

-- One row per notification with its delivery outcomes rolled up, because the
-- question an administrator actually asks is "did that go out", not "show me
-- 1,200 delivery rows". Drilling into the rows is a second query, on demand.
--
-- The status counts come from a lateral aggregate rather than a group-by over
-- a join, so a notification whose audience matched nobody still appears -- with
-- zeroes, which is exactly the case worth seeing.
create or replace function public.notify_outbox(
  p_limit integer default 100,
  p_event_key text default null
)
returns table (
  id uuid,
  event_key text,
  event_name text,
  subject text,
  body text,
  audience jsonb,
  created_at timestamptz,
  created_by_name text,
  recipients integer,
  deliveries integer,
  sent integer,
  queued integer,
  failed integer,
  skipped integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    n.id,
    n.event_key,
    t.name as event_name,
    n.subject,
    n.body,
    n.audience,
    n.created_at,
    case
      when p.first_name is null then null
      else p.first_name || ' ' || p.last_name
    end as created_by_name,
    agg.recipients,
    agg.deliveries,
    agg.sent,
    agg.queued,
    agg.failed,
    agg.skipped
  from public.notifications n
  join reference.notification_types t on t.key = n.event_key
  left join public.user_profiles up on up.id = n.created_by
  left join public.people p on p.id = up.person_id
  cross join lateral (
    select
      count(distinct d.recipient_user_id)::integer as recipients,
      count(*)::integer as deliveries,
      count(*) filter (where d.status = 'sent')::integer as sent,
      count(*) filter (where d.status in ('queued', 'sending'))::integer as queued,
      count(*) filter (where d.status = 'failed')::integer as failed,
      count(*) filter (where d.status = 'skipped')::integer as skipped
    from public.notification_deliveries d
    where d.tenant_id = n.tenant_id and d.notification_id = n.id
  ) agg
  where p_event_key is null or n.event_key = p_event_key
  order by n.created_at desc
  limit greatest(coalesce(p_limit, 100), 1)
$$;

revoke all on function public.notify_outbox(integer, text) from public, anon;
grant execute on function public.notify_outbox(integer, text) to authenticated;
