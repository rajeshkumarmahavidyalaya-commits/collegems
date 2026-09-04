-- ---------------------------------------------------------------------------
-- One way to print a number in a sentence
--
-- `stock_record_movement`'s refusal read:
--
--   "There are 15. box of Chalk (white) on hand and you are taking out 999.."
--
-- `to_char(15, 'FM999999990.99')` yields `15.` — the decimal point survives
-- even when nothing follows it. Payroll hit this in migration 0059 and solved
-- it with `hr_format_days`; inventory hit it again three lines into its first
-- error message, which is the signal that the helper was never really about
-- days.
--
-- So it is generalised rather than copied. `hr_format_days` becomes a wrapper,
-- and the next module that needs to put a quantity in a sentence has one place
-- to reach for.
--
-- The rule underneath, and it is a small one worth keeping: **a message that
-- exists to be read is code too.** "15. box" is the kind of thing that makes a
-- careful person distrust the number next to it.
-- ---------------------------------------------------------------------------

create or replace function public.format_quantity(
  p_value numeric,
  p_decimals integer default 2
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case
    when p_value is null then '0'
    -- A whole number prints whole: "15 boxes", never "15.00 boxes".
    when p_value = trunc(p_value) then trunc(p_value)::bigint::text
    else trim(trailing '.' from to_char(
      p_value,
      'FM999999999990' ||
        case when coalesce(p_decimals, 2) > 0
             then '.' || repeat('9', least(greatest(p_decimals, 1), 6))
             else '' end
    ))
  end
$$;

revoke all on function public.format_quantity(numeric, integer) from public, anon;
grant execute on function public.format_quantity(numeric, integer) to authenticated;

-- Unchanged in behaviour: whole days print whole, half days keep one decimal.
create or replace function public.hr_format_days(p_days numeric)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select public.format_quantity(p_days, 1)
$$;

revoke all on function public.hr_format_days(numeric) from public, anon;
grant execute on function public.hr_format_days(numeric) to authenticated;

-- And the message that found it.
create or replace function public.stock_record_movement(
  p_item_id uuid,
  p_kind text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_issued_to_staff_id uuid default null,
  p_issued_to_note text default null,
  p_supplier text default null,
  p_reference text default null,
  p_note text default null,
  p_happened_on date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_item record;
  v_on_hand numeric;
  v_signed numeric;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if p_kind not in ('receipt', 'issue', 'return', 'adjustment', 'write_off') then
    raise exception 'Unknown movement kind: %', p_kind;
  end if;

  if p_kind <> 'adjustment' and coalesce(p_quantity, 0) <= 0 then
    raise exception 'Enter how many, as a positive number';
  end if;
  if p_kind = 'adjustment' and coalesce(p_quantity, 0) = 0 then
    raise exception 'An adjustment of zero changes nothing';
  end if;

  select i.id, i.name, i.unit, i.is_active into v_item
  from public.inventory_items i where i.id = p_item_id;

  if v_item.id is null then
    raise exception 'That item does not exist';
  end if;
  if not v_item.is_active and p_kind = 'receipt' then
    raise exception '% is no longer stocked', v_item.name;
  end if;

  v_signed := case p_kind
    when 'issue' then -abs(p_quantity)
    when 'write_off' then -abs(p_quantity)
    when 'adjustment' then p_quantity
    else abs(p_quantity)
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text, 0));

  if v_signed < 0 and p_kind <> 'adjustment' then
    select coalesce(sum(m.quantity), 0) into v_on_hand
    from public.stock_movements m where m.item_id = p_item_id;

    if v_on_hand + v_signed < 0 then
      raise exception 'There are % % of % on hand and you are taking out %',
        public.format_quantity(v_on_hand), v_item.unit, v_item.name,
        public.format_quantity(abs(v_signed));
    end if;
  end if;

  insert into public.stock_movements (
    tenant_id, session_id, item_id, kind, quantity, unit_cost,
    issued_to_staff_id, issued_to_note, supplier, reference, note,
    happened_on, recorded_by
  )
  values (
    v_tenant_id, v_session_id, p_item_id, p_kind, v_signed,
    case when p_kind in ('receipt', 'adjustment') then p_unit_cost end,
    p_issued_to_staff_id,
    nullif(btrim(coalesce(p_issued_to_note, '')), ''),
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    coalesce(p_happened_on, current_date),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.stock_record_movement(uuid, text, numeric, numeric, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.stock_record_movement(uuid, text, numeric, numeric, uuid, text, text, text, text, date) to authenticated;
