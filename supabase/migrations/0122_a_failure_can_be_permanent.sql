-- ---------------------------------------------------------------------------
-- A failure can be permanent, and a dead handset should stop being written to
-- ---------------------------------------------------------------------------
--
-- Everything the dispatcher could say about a failed delivery until now was
-- "try again later": `notify_record_result` backed off exponentially and gave
-- up after five attempts. For email and SMS that is nearly always right -- a
-- timeout, a rate limit, a provider having a bad minute.
--
-- Push is where it stops being right. A push token is not an address, it is a
-- **capability that expires**: the operating system rotates it, the person
-- uninstalls the app, the handset is wiped, and from that moment the provider
-- answers `UNREGISTERED` for ever. Backing off and retrying five times is
-- exactly the wrong response, and it is not free -- every message to every dead
-- handset costs five requests and five rows of noise in a delivery log
-- somebody is trying to read.
--
-- So a driver can now say a failure is **permanent**, and this function
-- believes it: the delivery is `failed` at once, with no retry and no backoff.
--
-- IT ALSO REVOKES THE DEVICE, and that is deliberate rather than tidy.
--
-- "The provider told us this handset is gone" is ONE fact. Recording it against
-- the delivery and not against the device would leave the next notification
-- queueing another delivery to the same dead token, and the one after that.
-- Doing both in one statement is what makes them unable to diverge -- the same
-- reasoning as `notify_record_result` already stamping the channel's health
-- rather than leaving a screen to derive it.
--
-- The revoke is narrow on purpose: only for `push`, only for a permanent
-- failure, only the token this delivery was addressed to, and only within the
-- delivery's own tenant. A token is unique per tenant among live rows, not
-- globally, so matching on the token alone could reach into another school.

drop function if exists public.notify_record_result(uuid, boolean, text, text);

create or replace function public.notify_record_result(
  p_delivery_id uuid,
  p_ok boolean,
  p_error text default null,
  p_provider_ref text default null,
  -- "Do not try this again." The provider said the address itself is dead,
  -- not that it was busy.
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
        -- `attempts` was already incremented by the claim, so the first failure
        -- arrives here as 1 and must wait 4^0 = one minute. A permanent
        -- failure gets no next attempt at all.
        next_attempt_at =
          now() + (interval '1 minute' * power(4, least(greatest(v_delivery.attempts - 1, 0), 4)))
    where id = p_delivery_id;

    -- One fact, recorded in both places it is true.
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

comment on function public.notify_record_result(uuid, boolean, text, text, boolean) is
  'The dispatcher''s write-back. `p_permanent` means the address itself is dead: '
  'the delivery fails at once with no retry, and for push the device is revoked '
  'in the same statement so the next notification does not queue another '
  'delivery to a handset that is gone.';
