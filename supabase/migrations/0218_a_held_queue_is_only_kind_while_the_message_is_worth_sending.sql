-- 0218 — A held queue is only kind while the message is worth sending
--
-- Rule 10 says, as a feature:
--
--   > **A held channel keeps its queue.** A channel that is off, unconfigured
--   > or unbuilt does not mark its deliveries `skipped` — they stay `queued`
--   > and countable, so connecting a provider in March sends February's
--   > reminders. Dropping them would be tidier and would lose a school's mail.
--
-- That is right, and it has no end. `notify_claim_deliveries` bounds nothing by
-- age: it claims any `queued` row whose `next_attempt_at` has passed, on any
-- channel a school has since switched on. So a school that publishes results in
-- September with SMS off, and connects Twilio in March, texts four hundred
-- families about last year's examination.
--
-- ## The rule that already exists, one layer along
--
-- Rule 7 drew exactly this distinction for **schedules** and did not carry it
-- to **deliveries**:
--
--   > each schedule carries its own `grace_minutes` because the right answer
--   > differs by kind — an absence notice two hours late is worse than none, a
--   > fee reminder is not.
--
-- The same sentence is true of a queued message. An absence notice is about
-- *today*; a fee reminder is about a debt that is still owed; results are about
-- an examination that stops being news. **One interval cannot serve all
-- three**, so it is per event type — rule 12's shape: a school could reasonably
-- disagree, so it is data rather than an `if`.
--
-- ## What "stale" does, and what it deliberately does not
--
-- A stale delivery is marked `expired` **with the reason on it**, never
-- deleted and never silently dropped. Rule 7's schedules lesson applied to a
-- message: *"why did nothing go out on the 3rd"* must have an answer, and a row
-- that vanished has none.
--
-- `in_app` is exempt, and that is the point of the split: an in-app message is
-- already `sent` the moment it is composed — it sits in a list the person opens
-- when they open it, and a list is not a queue. Nothing there is waiting on a
-- provider, so nothing there can go stale.
--
-- Null means **never stale**, and it is the conservative reading (rule 12): a
-- kind nobody has thought about keeps today's behaviour. Only the kinds
-- somebody has decided about carry an interval.

begin;

-- ---------------------------------------------------------------------------
-- How long this kind of message is worth sending
-- ---------------------------------------------------------------------------

alter table reference.notification_types
  add column if not exists stale_after interval;

comment on column reference.notification_types.stale_after is
  'How long a queued delivery of this kind is still worth sending. Null means '
  'never stale, which is the conservative default. Measured from the delivery''s '
  'creation, never from the last attempt -- a message that has been retried for '
  'a week is a week old, not fresh.';

-- The three decisions, and each is a sentence somebody can argue with:
--
--   an absence notice is about TODAY. Two days later it is not news, it is a
--   confusing text about a Tuesday the family has forgotten.
update reference.notification_types set stale_after = interval '2 days'
where key = 'attendance.absent';

--   results stop being news. A fortnight is generous: by then the card has
--   gone home and the family has seen it on the phone.
update reference.notification_types set stale_after = interval '14 days'
where key = 'exam.results_published';

--   a notice board entry is a pointer to a document that is still on the
--   board, so the pointer keeps working -- but a month-old "there is a new
--   notice" is not.
update reference.notification_types set stale_after = interval '30 days'
where key = 'notice.published';

-- Deliberately left null: `fees.due_reminder`, `fees.invoice_raised`,
-- `fees.payment_received`, `library.book_overdue`. A debt that is still owed is
-- still worth a reminder however late the channel was switched on, and a
-- receipt is a record the family may want whenever it arrives. These are the
-- cases rule 10's original sentence was written about.

-- ---------------------------------------------------------------------------
-- Marking them, rather than dropping them
-- ---------------------------------------------------------------------------

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'expired'));

-- Definer and revoked from everybody holding a JWT, exactly like the rest of
-- the dispatcher's own functions: a school configures a channel, it does not
-- write its history. Takes the tenant as an argument for the same reason
-- `notify_send_for` does — the scheduled run has no JWT at all.
create or replace function public.notify_expire_stale(p_tenant_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_count integer;
begin
  with stale as (
    update public.notification_deliveries d
       set status = 'expired',
           last_error = format(
             'Not sent: this kind of message stops being worth sending after %s, '
             'and the %s channel was not able to send when it was composed.',
             nt.stale_after, d.channel)
      from public.notifications n
      join reference.notification_types nt on nt.key = n.event_key
     where n.id = d.notification_id
       and nt.stale_after is not null
       -- in_app is never queued (it is `sent` at compose time), so this is
       -- belt and braces rather than a live branch -- and it is here because
       -- the day somebody queues an in-app message is the day this would
       -- silently expire a message nobody was waiting on a provider for.
       and d.channel <> 'in_app'
       and d.status = 'queued'
       and d.created_at < now() - nt.stale_after
       and (p_tenant_id is null or d.tenant_id = p_tenant_id)
    returning 1
  )
  select count(*) into v_count from stale;

  return v_count;
end;
$$;

comment on function public.notify_expire_stale(uuid) is
  'Marks queued deliveries whose kind has gone stale as `expired`, with the '
  'reason on the row. Never deletes: "why did nothing go out" must have an '
  'answer. Called from schedule-tick, because a second timing mechanism is a '
  'second place to look when something did not run.';

revoke all on function public.notify_expire_stale(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ...and the claim refuses one even if the sweep has not run yet
-- ---------------------------------------------------------------------------

-- Two halves, because the sweep runs on a timer and the dispatcher does not.
-- Without this, connecting a provider at 09:00 sends the backlog before the
-- 09:05 tick has a chance to expire it -- and the whole point is the message
-- that should not go.
create or replace function public.notify_claim_deliveries(
  p_limit integer default 50,
  p_tenant_id uuid default null,
  p_channel text default null
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
begin
  return query
  update public.notification_deliveries d
  set status = 'sending',
      attempts = d.attempts + 1
  where d.id in (
    select c.id
    from public.notification_deliveries c
    join public.notification_channel_settings s
      on s.tenant_id = c.tenant_id and s.channel = c.channel
    join public.notifications n on n.id = c.notification_id
    join reference.notification_types nt on nt.key = n.event_key
    where c.channel <> 'in_app'
      and s.is_enabled
      and coalesce(s.provider_configured, false)
      and (p_tenant_id is null or c.tenant_id = p_tenant_id)
      and (p_channel is null or c.channel = p_channel)
      -- The addition. `nt.stale_after is null` keeps every kind nobody has
      -- decided about exactly as it was.
      and (nt.stale_after is null or c.created_at >= now() - nt.stale_after)
      and (
        (c.status = 'queued' and c.next_attempt_at <= now())
        or (c.status = 'sending' and c.created_at < now() - interval '15 minutes')
      )
    order by c.next_attempt_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning d.*;
end;
$$;

comment on function public.notify_claim_deliveries(integer, uuid, text) is
  'Claims work for the dispatcher. Refuses a channel whose provider_configured '
  'is false, and -- since 0218 -- a delivery whose kind has gone stale, so '
  'switching a channel on does not send last term''s news before the sweep '
  'has run.';

revoke all on function public.notify_claim_deliveries(integer, uuid, text) from public, anon, authenticated;

commit;
