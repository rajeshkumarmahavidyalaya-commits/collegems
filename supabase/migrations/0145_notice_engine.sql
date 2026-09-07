-- ---------------------------------------------------------------------------
-- Publishing, withdrawing, reading
-- ---------------------------------------------------------------------------
--
-- `notice_publish` is `SECURITY INVOKER`: `notices` already has an
-- administrator-only write policy, so RLS is the gate and a definer function
-- would only be a second one. It is a Postgres function for the ordinary
-- reason -- setting the status, stamping the publisher and announcing it must
-- be one transaction, and supabase-js cannot open one.
--
-- THE ONE THING THAT IS CAUGHT RATHER THAN RAISED
--
-- `notify_send` refuses an audience that matches nobody with a login, and it is
-- right to: a person who pressed Send deserves to be told it went nowhere. But
-- publishing a notice is not sending a message -- **the board is the point, and
-- the announcement is a courtesy.** A Grade 1 circular whose parents have no
-- logins yet must still go up on the board.
--
-- So the announcement is attempted inside an exception block and its failure is
-- *written down* rather than swallowed: `last_announce_error` holds the reason,
-- the function returns it, and the screen says "published, but nobody was
-- notified because...". A caught exception with nowhere to put the message is
-- how a school ends up believing four hundred parents were told.

alter table public.notices
  add column if not exists last_announce_error text;

comment on column public.notices.last_announce_error is
  'Why the last announcement did not go out, if it did not. The notice still '
  'published -- the board is the point and the announcement is a courtesy -- '
  'and this is where the courtesy failing is recorded rather than swallowed.';

-- ---------------------------------------------------------------------------
-- Announce
-- ---------------------------------------------------------------------------

create or replace function public.notice_announce(p_notice_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_n public.notices;
  v_notification public.notifications;
  v_error text;
begin
  select * into v_n from public.notices where id = p_notice_id;
  if v_n.id is null then
    raise exception 'No such notice, or you cannot see it';
  end if;
  if v_n.status <> 'published' then
    raise exception 'Only a published notice can be announced';
  end if;

  begin
    v_notification := public.notify_send(
      'notice.published',
      v_n.title,
      v_n.body,
      v_n.audience,
      jsonb_build_object(
        'notice_id', v_n.id,
        'title', v_n.title,
        'category', v_n.category
      )
    );
  exception when others then
    v_error := left(sqlerrm, 500);
  end;

  update public.notices
     set announced_count = announced_count + case when v_error is null then 1 else 0 end,
         last_announced_at = case when v_error is null then now() else last_announced_at end,
         last_announce_error = v_error
   where id = p_notice_id;

  return jsonb_build_object(
    'announced', v_error is null,
    'notification_id', v_notification.id,
    'error', v_error
  );
end;
$$;

revoke all on function public.notice_announce(uuid) from public, anon;
grant execute on function public.notice_announce(uuid) to authenticated;

comment on function public.notice_announce(uuid) is
  'Sends the notice as a notification. Separate from publishing on purpose: '
  'publishing announces once, and announcing a second time is a deliberate act '
  'with its own audit row rather than a flag whose meaning depends on history.';

-- ---------------------------------------------------------------------------
-- Publish
-- ---------------------------------------------------------------------------

create or replace function public.notice_publish(p_notice_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_n public.notices;
  v_result jsonb;
begin
  select * into v_n from public.notices where id = p_notice_id;
  if v_n.id is null then
    raise exception 'No such notice, or you cannot see it';
  end if;
  if coalesce(trim(v_n.title), '') = '' or coalesce(trim(v_n.body), '') = '' then
    raise exception 'A notice needs a title and something in it';
  end if;

  update public.notices
     set status = 'published',
         published_at = coalesce(published_at, now()),
         published_by = coalesce(published_by, ( select auth.uid() )),
         withdrawn_at = null,
         withdrawn_by = null,
         withdraw_reason = null
   where id = p_notice_id
  returning * into v_n;

  if v_n.id is null then
    -- No policy matched. Under RLS an update that matches nothing succeeds
    -- while touching nothing, and reporting that as a publish would be a lie.
    raise exception 'You cannot publish this notice';
  end if;

  -- Announce **only the first time**. A school reinstating a withdrawn circular
  -- is fixing a mistake, not making a new announcement, and four hundred phones
  -- should not buzz for it. Doing it again is `notice_announce`, deliberately.
  if v_n.announced_count = 0 then
    v_result := public.notice_announce(p_notice_id);
  else
    v_result := jsonb_build_object(
      'announced', false,
      'error', null,
      'note', format(
        'Already announced %s time(s). Publishing again does not re-announce -- '
        'use "announce again" if that is what you want.', v_n.announced_count)
    );
  end if;

  return jsonb_build_object('notice_id', p_notice_id, 'status', 'published') || v_result;
end;
$$;

revoke all on function public.notice_publish(uuid) from public, anon;
grant execute on function public.notice_publish(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Withdraw
-- ---------------------------------------------------------------------------

create or replace function public.notice_withdraw(p_notice_id uuid, p_reason text)
returns public.notices
language plpgsql
set search_path = public, extensions
as $$
declare
  v_n public.notices;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why it is being withdrawn -- people have already read it';
  end if;

  update public.notices
     set status = 'withdrawn',
         withdrawn_at = now(),
         withdrawn_by = ( select auth.uid() ),
         withdraw_reason = trim(p_reason)
   where id = p_notice_id and status = 'published'
  returning * into v_n;

  if v_n.id is null then
    raise exception 'That notice is not published, or you cannot withdraw it';
  end if;

  -- The read receipts stay. Who saw a circular before it was pulled is exactly
  -- the question somebody will ask afterwards.
  return v_n;
end;
$$;

revoke all on function public.notice_withdraw(uuid, text) from public, anon;
grant execute on function public.notice_withdraw(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The board
-- ---------------------------------------------------------------------------
--
-- `SECURITY INVOKER`, so the policy decides what is on it -- including the
-- audience test. There is no `where` here that repeats the rule; a filter
-- written twice is a filter that will disagree with itself.

create or replace function public.notice_board(p_limit integer default 50)
returns table (
  id uuid,
  title text,
  body text,
  category text,
  is_pinned boolean,
  published_at timestamptz,
  starts_on date,
  expires_on date,
  status text,
  attachments integer,
  is_read boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    n.id,
    n.title,
    n.body,
    n.category,
    n.is_pinned,
    n.published_at,
    n.starts_on,
    n.expires_on,
    n.status,
    (select count(*)::integer from public.notice_files f where f.notice_id = n.id),
    exists (
      select 1 from public.notice_reads r
      where r.notice_id = n.id and r.user_id = ( select auth.uid() )
    )
  from public.notices n
  where n.status = 'published'
  order by n.is_pinned desc, n.published_at desc nulls last
  limit greatest(least(coalesce(p_limit, 50), 200), 1)
$$;

revoke all on function public.notice_board(integer) from public, anon;
grant execute on function public.notice_board(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- I have read it
-- ---------------------------------------------------------------------------

create or replace function public.notice_mark_read(p_notice_id uuid)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- Idempotent. A second visit to the page must not raise, and it must not move
  -- the timestamp either: `read_at` is when they first read it, which is the
  -- only version of that fact worth keeping.
  insert into public.notice_reads (tenant_id, notice_id, user_id)
  values (v_tenant_id, p_notice_id, ( select auth.uid() ))
  on conflict (notice_id, user_id) do nothing;

  return found;
end;
$$;

revoke all on function public.notice_mark_read(uuid) from public, anon;
grant execute on function public.notice_mark_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Did anybody read it?
-- ---------------------------------------------------------------------------
--
-- The question a board can answer and a broadcast cannot. `audience` is
-- resolved with the notification module's own function, so "who this was for"
-- means the same thing on the board, in the message and in this count.

create or replace function public.notice_read_summary(p_notice_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'audience', (
      select count(*)
      from public.notify_resolve_audience(
        ( select public.current_tenant_id() ),
        (select n.audience from public.notices n where n.id = p_notice_id)
      )
    ),
    'read', (
      select count(*) from public.notice_reads r where r.notice_id = p_notice_id
    ),
    'announced', (
      select announced_count from public.notices n where n.id = p_notice_id
    ),
    'last_announce_error', (
      select last_announce_error from public.notices n where n.id = p_notice_id
    )
  )
  where exists (select 1 from public.notices n where n.id = p_notice_id)
$$;

revoke all on function public.notice_read_summary(uuid) from public, anon;
grant execute on function public.notice_read_summary(uuid) to authenticated;
