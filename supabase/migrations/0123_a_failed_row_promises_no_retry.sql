-- ---------------------------------------------------------------------------
-- A permanently failed delivery should not advertise a retry time
-- ---------------------------------------------------------------------------
--
-- 0122 got the behaviour right and the record slightly wrong. A permanent
-- failure sets `status = 'failed'` and stops -- but it also moved
-- `next_attempt_at` a minute into the future, because that assignment was
-- shared with the transient branch.
--
-- Nothing reads it: the claim query only looks at `queued` rows, and
-- `notify_retry_failed` overwrites it with `now()`. So this is not a bug in
-- what the system does. It is a bug in what the system *says* -- somebody
-- reading a delivery log finds a row marked `failed` next to "retry in 1
-- minute", and has to go and read the claim query to find out which of the two
-- is lying.
--
-- That is worth a migration on its own. A column that means nothing is worse
-- than a column that is absent, because it costs a reader the time to discover
-- it means nothing. `next_attempt_at` is left exactly where it was on a
-- permanent failure, so a failed row shows the moment it stopped being tried.

create or replace function public.notify_record_result(
  p_delivery_id uuid,
  p_ok boolean,
  p_error text default null,
  p_provider_ref text default null,
  p_permanent boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_delivery public.notification_deliveries;
begin
  select * into v_delivery
  from public.notification_deliveries where id = p_delivery_id;

  if v_delivery.id is null then
    raise exception 'Delivery not found';
  end if;

  if p_ok then
    update public.notification_deliveries
    set status = 'sent', sent_at = now(), last_error = null, provider_ref = p_provider_ref
    where id = p_delivery_id;

    update public.notification_channel_settings
    set last_success_at = now(), last_error = null
    where tenant_id = v_delivery.tenant_id and channel = v_delivery.channel;
  else
    update public.notification_deliveries
    set status = case
          when p_permanent then 'failed'
          when v_delivery.attempts >= 5 then 'failed'
          else 'queued'
        end,
        last_error = p_error,
        -- `attempts` was already incremented by the claim, so the first
        -- failure arrives here as 1 and waits 4^0 = one minute. A permanent
        -- failure keeps whatever was there: there is no next attempt, and
        -- naming a time for one is the only misleading thing this row could do.
        next_attempt_at = case
          when p_permanent then v_delivery.next_attempt_at
          else now() + (interval '1 minute' * power(4, least(greatest(v_delivery.attempts - 1, 0), 4)))
        end
    where id = p_delivery_id;

    -- One fact, recorded in both places it is true: the provider said this
    -- handset is gone, so the delivery fails and the device stops being one.
    if p_permanent and v_delivery.channel = 'push' and v_delivery.address is not null then
      update public.devices d
      set revoked_at = now(),
          revoked_reason = coalesce(nullif(btrim(p_error), ''), 'the push provider rejected this token')
      where d.tenant_id = v_delivery.tenant_id
        and d.push_token = v_delivery.address
        and d.revoked_at is null;
    end if;

    update public.notification_channel_settings
    set last_error = p_error
    where tenant_id = v_delivery.tenant_id and channel = v_delivery.channel;
  end if;
end;
$$;

revoke all on function public.notify_record_result(uuid, boolean, text, text, boolean)
  from public, anon, authenticated;
