-- ---------------------------------------------------------------------------
-- The backoff now does what its comment always said
-- ---------------------------------------------------------------------------
--
-- Migration 0034 wrote "roughly 1, 4, 16, 64 and 256 minutes" and then computed
-- `power(4, least(attempts, 4))` -- but `attempts` is incremented at *claim*,
-- so the first failure already carries a 1 and the first retry was four minutes
-- away. The one-minute step never happened, and migration 0114 copied the
-- arithmetic along with the sentence.
--
-- Nothing was broken by it. It is worth a migration anyway, because the
-- sentence is the thing anybody reads when a provider goes down at four o'clock
-- and somebody has to say when the queue will move -- and a comment that is
-- quietly one step out is worse than no comment. This is the payroll lesson
-- from rule 12 in miniature: the description read exactly as a person checking
-- it would expect, and only the arithmetic disagreed.
--
-- Retry n now waits 4^(n-1) minutes: 1, 4, 16, 64, 256, then `failed`.

create or replace function public.notify_record_result(
  p_delivery_id uuid,
  p_ok boolean,
  p_error text default null,
  p_provider_ref text default null
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
    set status = case when v_delivery.attempts >= 5 then 'failed' else 'queued' end,
        last_error = p_error,
        -- `attempts` was already incremented by the claim, so the first failure
        -- arrives here as 1 and must wait 4^0 = one minute.
        next_attempt_at =
          now() + (interval '1 minute' * power(4, least(greatest(v_delivery.attempts - 1, 0), 4)))
    where id = p_delivery_id;

    update public.notification_channel_settings
    set last_error = p_error
    where tenant_id = v_delivery.tenant_id and channel = v_delivery.channel;
  end if;
end;
$$;

revoke all on function public.notify_record_result(uuid, boolean, text, text)
  from public, anon, authenticated;
