-- ---------------------------------------------------------------------------
-- The counter screen's database half -- and the defect found while writing it
-- ---------------------------------------------------------------------------
--
-- `0263` wrote the rule down and guarded the *other* module with it:
--
--   > A correction is two writes too. `fees_reverse_entry` would cancel the
--   > charge and leave the goods off the shelf, so it refuses a sale by name
--   > and sends it to `stock_sale_reverse` -- which is `stock_record_movement`
--   > refusing `kind = 'sale'` in the other direction.
--
-- It named two functions and there are three. `stock_reverse_movement` is the
-- one the item screen already draws a button for, on every row, and it was
-- left accepting a sale. Probed as an administrator, in a rolled-back
-- transaction, on the live college:
--
--   stock  15.00 -> 13.00 (sold 2) -> 15.00  after stock_reverse_movement
--   owed    8.00 -> 58.00 (charged) -> 58.00  after stock_reverse_movement
--
-- The goods come back and **the family stays charged**. Exactly the half-done
-- correction the paragraph above describes, in the module that wrote it, and
-- it would have started doing damage the moment a *Sell* button existed --
-- which is what the next commit adds. So it is fixed first.
--
-- > **A rule written into one function is not a rule.** `0263` put the refusal
-- > where it had just been thinking and not where the button was. The question
-- > rule 12 already asks about a fix -- *who else does this?* -- has a sibling
-- > for a refusal: **what else reaches this row?**
--
-- Three read-model changes come with it, all of them the same omission one
-- column along: `0261` added `sold_to_student_id`, `unit_price` and
-- `sale_price`, and no reader was taught to show any of them.
--
--   * `stock_ledger` coalesced a staff name, a note and a supplier, so a sale
--     showed `--` where the buyer's name belongs. The store keeper could see
--     that two exercise books left the shelf and not who has them.
--   * `stock_on_hand` does not carry `sale_price`, so no screen can say which
--     items are for sale, or what the counter should charge.
--
-- Both are `drop` + `create` rather than `create or replace`, because the
-- return type changes. Checked first: `stock_on_hand`, `stock_ledger` and
-- `stock_issued_assets` are called from this module's own `actions.ts` and one
-- test file, and from no other function, no report and no check.

begin;

-- ------------------------------------------------- the refusal that was missed --

create or replace function public.stock_reverse_movement(
  p_movement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
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

  -- A sale is two writes -- stock out and money owed -- so undoing it is two
  -- writes as well. An adjustment here would put the goods back and leave the
  -- family charged, which is worse than refusing: the shelf and the fee
  -- account would disagree and neither would say so.
  if v_m.kind = 'sale' then
    raise exception
      'That is a sale, so reversing it has to return the goods and cancel the charge together. Use the Undo sale action on the item.';
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

comment on function public.stock_reverse_movement(uuid, text) is
  'Correct a movement with an opposing movement -- the table is revoked, so it '
  'is the only way. Refuses a sale by name: that one is two writes and '
  'stock_sale_reverse is the function that does both.';

-- ------------------------------------------------------ the buyer has a name --

drop function if exists public.stock_ledger(uuid, integer);

create function public.stock_ledger(p_item_id uuid, p_limit integer default 200)
returns table (
  id uuid,
  happened_on date,
  kind text,
  quantity numeric,
  running numeric,
  unit_cost numeric,
  unit_price numeric,
  counterparty text,
  reference text,
  note text,
  reversed boolean
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
    -- What the family was charged for one, beside what the school paid for
    -- one. Two facts, two columns: a store that shows one where it means the
    -- other cannot answer "what was our margin".
    m.unit_price,
    -- A sale names the child; everything else names whoever it named before.
    -- `btrim(coalesce(...))` rather than `a || ' ' || b`, which is null for
    -- anybody with no surname -- true of this college's people and the reason
    -- a staff issue could already show a blank.
    coalesce(
      nullif(btrim(coalesce(buyer.first_name, '') || ' ' || coalesce(buyer.last_name, '')), ''),
      nullif(btrim(coalesce(holder.first_name, '') || ' ' || coalesce(holder.last_name, '')), ''),
      m.issued_to_note,
      m.supplier
    )::text,
    m.reference,
    m.note,
    -- Only a sale can be in this state, and only the fee ledger knows: the
    -- goods come back as an ordinary `return` row, so the stock side alone
    -- cannot tell an undone sale from a child changing their mind.
    exists (
      select 1 from public.ledger_entries le
      where le.stock_movement_id = m.id and le.reverses_entry_id is not null
    )
  from public.stock_movements m
  left join public.staff s on s.id = m.issued_to_staff_id
  left join public.people holder on holder.id = s.person_id
  left join public.students st on st.id = m.sold_to_student_id
  left join public.people buyer on buyer.id = st.person_id
  where m.item_id = p_item_id
  order by m.happened_on desc, m.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

comment on function public.stock_ledger(uuid, integer) is
  'One item''s history with a running balance. INVOKER -- RLS decides which '
  'movements, and which buyers, the caller may see. `reversed` is read from '
  'the fee ledger because the stock side cannot distinguish an undone sale '
  'from a return.';

revoke all on function public.stock_ledger(uuid, integer) from public, anon;
grant execute on function public.stock_ledger(uuid, integer) to authenticated;

-- --------------------------------------------- and the price the counter asks --

drop function if exists public.stock_on_hand(date);

create function public.stock_on_hand(p_as_of date default null)
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
  average_cost numeric,
  -- **Null means not for sale**, which is not the same as free. It is the one
  -- thing that decides whether the counter can serve a child at all, so it
  -- belongs on the row the list is built from rather than in a second query.
  sale_price numeric
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
    m.average_cost,
    i.sale_price
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

comment on function public.stock_on_hand(date) is
  'Stock on hand, as a sum. **This is the only definition**, used by the '
  'screen, the reorder list, the counter and the issue check alike. '
  '`sale_price` null means the item is not for sale -- not that it is free.';

revoke all on function public.stock_on_hand(date) from public, anon;
grant execute on function public.stock_on_hand(date) to authenticated;

-- ------------------------------------------------ the catalogue says what it is --

-- A catalogue description is a decision somebody already made (`0213`), which
-- cuts both ways: when the module grows an act the description does not name,
-- the description is the thing that is now wrong. Selling is gated on
-- `inventory.manage` deliberately rather than on a new `inventory.sell` --
-- the two INSERT policies compare three role codes, and those are *exactly*
-- today's `inventory.manage` holders (admin, accountant, librarian), so a
-- separate permission would be a control the boundary cannot honour: granting
-- it to a teacher would still end in a refusal from Postgres.
update reference.permissions
set description = 'Add items and categories, receive and issue stock, and sell from the store'
where code = 'inventory.manage';

commit;
