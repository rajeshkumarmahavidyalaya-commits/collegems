-- ---------------------------------------------------------------------------
-- Inventory — the read models and the write path
-- ---------------------------------------------------------------------------

-- Stock on hand, as a sum. **This is the only definition**, used by the screen,
-- the reorder list and the issue check alike, so none of the three can disagree
-- about how many of something the school has.
create or replace function public.stock_on_hand(p_as_of date default null)
returns table (
  item_id uuid,
  sku text,
  name text,
  category_name text,
  unit text,
  is_asset boolean,
  is_active boolean,
  reorder_level numeric,
  on_hand numeric,
  below_reorder boolean,
  issued_out numeric,
  last_movement date,
  -- Weighted only over receipts, which are the only movements that carry a
  -- price. A store that values its issues invents numbers.
  average_cost numeric
)
language sql
stable
set search_path = public, extensions
as $$
  select
    i.id, i.sku, i.name, c.name, i.unit, i.is_asset, i.is_active, i.reorder_level,
    coalesce(m.on_hand, 0),
    -- `reorder_level = 0` means "do not track", so it never flags.
    (i.reorder_level > 0 and coalesce(m.on_hand, 0) <= i.reorder_level),
    coalesce(m.issued_out, 0),
    m.last_movement,
    m.average_cost
  from public.inventory_items i
  left join public.item_categories c on c.id = i.category_id
  left join lateral (
    select
      sum(sm.quantity) as on_hand,
      -- What is out with somebody, for assets: issues less returns.
      -sum(sm.quantity) filter (where sm.kind in ('issue', 'return')) as issued_out,
      max(sm.happened_on) as last_movement,
      case
        when sum(sm.quantity) filter (where sm.kind = 'receipt' and sm.unit_cost is not null) > 0
        then round(
          sum(sm.quantity * sm.unit_cost) filter (where sm.kind = 'receipt' and sm.unit_cost is not null)
          / sum(sm.quantity) filter (where sm.kind = 'receipt' and sm.unit_cost is not null), 2)
      end as average_cost
    from public.stock_movements sm
    where sm.item_id = i.id
      and (p_as_of is null or sm.happened_on <= p_as_of)
  ) m on true
  order by (i.reorder_level > 0 and coalesce(m.on_hand, 0) <= i.reorder_level) desc, i.name
$$;

revoke all on function public.stock_on_hand(date) from public, anon;
grant execute on function public.stock_on_hand(date) to authenticated;

-- One item's history with a running balance, so "why do we have eleven of
-- these" is answerable a year later. The same shape as `accounts_ledger`.
create or replace function public.stock_ledger(p_item_id uuid, p_limit integer default 200)
returns table (
  id uuid,
  happened_on date,
  kind text,
  quantity numeric,
  running numeric,
  unit_cost numeric,
  counterparty text,
  reference text,
  note text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    m.id, m.happened_on, m.kind, m.quantity,
    sum(m.quantity) over (order by m.happened_on, m.created_at, m.id
                          rows between unbounded preceding and current row),
    m.unit_cost,
    coalesce(
      (p.first_name || ' ' || p.last_name),
      m.issued_to_note,
      m.supplier
    )::text,
    m.reference,
    m.note
  from public.stock_movements m
  left join public.staff s on s.id = m.issued_to_staff_id
  left join public.people p on p.id = s.person_id
  where m.item_id = p_item_id
  order by m.happened_on desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

revoke all on function public.stock_ledger(uuid, integer) from public, anon;
grant execute on function public.stock_ledger(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording a movement
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: the insert policy on `stock_movements` already decides who
-- may write one. What this adds is the signing, and the one rule no constraint
-- can see.
--
-- **You cannot issue what you do not have.** That is a fact about every other
-- movement of the item, so no CHECK reaches it — the same genre as a bus with
-- forty seats and debits equalling credits. It is checked here, under an
-- advisory lock on the item so two clerks issuing the last box cannot both
-- pass, and the message carries the number:
--
--   "There are 3 box of Chalk (white) on hand and you are issuing 5."
--
-- An `adjustment` is deliberately exempt: a stock count that finds fewer than
-- the ledger says is exactly the movement that must be allowed to take stock
-- negative, because refusing it would leave the ledger permanently wrong.
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

  -- Positive in, signing done here -- never ask somebody at a counter for a
  -- negative number. An adjustment is the exception, because its whole purpose
  -- is to be able to go either way.
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
      raise exception
        'There are % % of % on hand and you are taking out %.',
        trim(to_char(v_on_hand, 'FM999999990.99')), v_item.unit, v_item.name,
        trim(to_char(abs(v_signed), 'FM999999990.99'));
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

-- Correcting a movement is an opposing movement, never an edit -- the table is
-- revoked, so this is the only way, and it says what it is reversing.
create or replace function public.stock_reverse_movement(
  p_movement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_m public.stock_movements;
  v_id uuid;
begin
  select * into v_m from public.stock_movements m where m.id = p_movement_id;
  if v_m.id is null then
    raise exception 'That movement does not exist';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why it is being reversed';
  end if;

  insert into public.stock_movements (
    tenant_id, session_id, item_id, kind, quantity, unit_cost,
    issued_to_staff_id, issued_to_note, supplier, reference, note,
    happened_on, recorded_by
  )
  values (
    v_m.tenant_id, v_m.session_id, v_m.item_id, 'adjustment', -v_m.quantity, null,
    v_m.issued_to_staff_id, v_m.issued_to_note, v_m.supplier,
    'reversal of ' || left(v_m.id::text, 8),
    btrim(p_reason),
    current_date, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.stock_reverse_movement(uuid, text) from public, anon;
grant execute on function public.stock_reverse_movement(uuid, text) to authenticated;

-- What is out with whom, for the assets a school lends and expects back.
create or replace function public.stock_issued_assets()
returns table (
  item_id uuid,
  sku text,
  name text,
  holder text,
  quantity numeric,
  since date
)
language sql
stable
set search_path = public, extensions
as $$
  select
    i.id, i.sku, i.name,
    coalesce((p.first_name || ' ' || p.last_name), m.issued_to_note, 'Unrecorded')::text,
    -sum(m.quantity),
    min(m.happened_on)
  from public.stock_movements m
  join public.inventory_items i on i.id = m.item_id
  left join public.staff s on s.id = m.issued_to_staff_id
  left join public.people p on p.id = s.person_id
  where i.is_asset
    and m.kind in ('issue', 'return')
  group by i.id, i.sku, i.name,
           coalesce((p.first_name || ' ' || p.last_name), m.issued_to_note, 'Unrecorded')
  -- Only what is still out: a holder who returned everything nets to zero.
  having -sum(m.quantity) > 0
  order by i.name
$$;

revoke all on function public.stock_issued_assets() from public, anon;
grant execute on function public.stock_issued_assets() to authenticated;
