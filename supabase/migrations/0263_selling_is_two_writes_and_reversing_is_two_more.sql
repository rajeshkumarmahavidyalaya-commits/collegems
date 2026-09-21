-- 0263 -- Selling from the store: the write paths.
--
-- `0261` gave a sale somewhere to live. This is the pair of functions that put
-- one there, and the pair is the point: **a sale is two writes in two ledgers,
-- and a correction is two more.** Either half alone leaves a school wrong in a
-- way it will not notice -- stock gone and nobody billed, or a family charged
-- for something still on the shelf.
--
-- ## `fees_reverse_entry` knew about invoices and books and not about this
--
-- `0026` added `book_issue_id` and, in the same migration, taught the reversal
-- function to carry it, under a comment that describes this migration's job
-- word for word:
--
--   > `fees_reverse_entry` copied `invoice_id` but knew nothing about book
--   > issues, so reversing a library fine would have produced an entry with no
--   > link back to the book -- invisible to the librarian policy above, and
--   > unexplainable on the ledger.
--
-- Identical, one column along. A reversal of a sale that dropped
-- `stock_movement_id` would be **invisible to the store keeper's own SELECT
-- policy**, which requires that column to be non-null: the person who made the
-- sale would see the charge and not its cancellation, and conclude the family
-- still owed. So the column is carried across, and the unique index excludes
-- reversals (`0261`) precisely so that carrying it cannot collide.
--
-- > **A new source column on `ledger_entries` is not one change, it is two.**
-- > `0026` learned it, wrote it down, and the note is what caught it here --
-- > which is the whole argument for writing this kind of thing down.
--
-- ## ...and reversing the money is only half of a sale
--
-- `fees_reverse_entry` would cancel the charge and leave the goods off the
-- shelf. That is a **half-reversal**: the books balance and the store does not,
-- and nobody finds out until a stock-take. So a sale entry is refused there by
-- name and sent to `stock_sale_reverse`, which does both -- the same shape as
-- `stock_record_movement` refusing `kind = 'sale'` in `0262` and sending it
-- here. Two functions, each refusing the other's job in a sentence, rather than
-- one function that quietly does half.
--
-- ## Who may sell: the policy, mirrored
--
-- The check names `admin`, `accountant` and `librarian` because that is exactly
-- what the INSERT policies on `stock_movements` and `ledger_entries` allow. It
-- is a **mirror of one policy**, which rule 4 permits, and not a second
-- opinion: gating on `inventory.manage` instead would let a college grant that
-- permission to a teacher and hand them a form that ends in `42501` -- the
-- certificate defect this file already records. Making the matrix load-bearing
-- on the store is a policy rewrite, and rule 4 says that is a probe as several
-- roles rather than a tidy-up.
--
-- ## An ending is a door that stays shut
--
-- A child who has left is refused. Rule 12's second half: `student_exit` ends
-- the relationships somebody had, and *"if it does not exist yet, only a guard
-- on the write can help."* The library card was closed for exactly this reason;
-- a shop counter is the same door.

begin;

-- ------------------------------------------------- the reversal, taught again --

create or replace function public.fees_reverse_entry(
  p_entry_id uuid,
  p_reason text
)
returns public.ledger_entries
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_original public.ledger_entries;
  v_reversal public.ledger_entries;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'A reversal needs a reason';
  end if;

  -- No FOR UPDATE: UPDATE is revoked on this table (see 0023).
  select * into v_original from public.ledger_entries
  where id = p_entry_id and tenant_id = v_tenant_id;

  if v_original.id is null then
    raise exception 'Entry not found';
  end if;
  if v_original.reverses_entry_id is not null then
    raise exception 'That entry is itself a reversal, so it cannot be reversed';
  end if;
  if exists (select 1 from public.ledger_entries where reverses_entry_id = p_entry_id) then
    raise exception 'That entry has already been reversed';
  end if;

  -- Cancelling the charge without putting the goods back is a half-reversal:
  -- the ledger balances and the shelf does not.
  if v_original.stock_movement_id is not null then
    raise exception
      'That charge is a sale from the store. Use stock_sale_reverse, which also puts the stock back';
  end if;

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, book_issue_id, stock_movement_id,
    entry_type, amount, occurred_at, method, reference, note, reverses_entry_id, recorded_by
  ) values (
    v_original.tenant_id, v_original.session_id, v_original.student_id,
    v_original.invoice_id, v_original.book_issue_id, v_original.stock_movement_id,
    v_original.entry_type,
    -v_original.amount, now(), v_original.method, v_original.reference,
    'Reversal: ' || trim(p_reason), v_original.id, auth.uid()
  )
  returning * into v_reversal;

  return v_reversal;
end;
$$;

-- --------------------------------------------------------------- the counter --

create or replace function public.stock_sell_to_student(
  p_item_id uuid,
  p_student_id uuid,
  p_quantity numeric,
  p_unit_price numeric default null,
  p_note text default null,
  p_happened_on date default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_on date := coalesce(p_happened_on, current_date);
  v_session_id uuid;
  v_item record;
  v_student record;
  v_price numeric;
  v_on_hand numeric;
  v_movement_id uuid;
  v_entry_id uuid;
  v_total numeric;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- A mirror of the two INSERT policies, checked here so the refusal is a
  -- sentence rather than `42501` after the form was filled in.
  if (select public.current_role_code()) not in ('admin', 'accountant', 'librarian') then
    raise exception 'Your role does not sell from the store';
  end if;

  -- The money crossed the counter on a day, so the year follows the day.
  v_session_id := public.academics_session_for_date_or_raise(v_on);

  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Enter how many, as a positive number';
  end if;

  select i.id, i.name, i.unit, i.is_active, i.sale_price into v_item
  from public.inventory_items i where i.id = p_item_id;
  if v_item.id is null then
    raise exception 'That item does not exist';
  end if;
  if not v_item.is_active then
    raise exception '% is no longer stocked', v_item.name;
  end if;

  v_price := coalesce(p_unit_price, v_item.sale_price);
  if v_price is null then
    raise exception
      '% has no price, so it cannot be sold. Give it a sale price on the item first', v_item.name;
  end if;
  if v_price < 0 then
    raise exception 'A price cannot be negative';
  end if;

  select s.id, s.status,
         btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name
    into v_student
  from public.students s join public.people p on p.id = s.person_id
  where s.id = p_student_id;

  if v_student.id is null then
    -- RLS decides which children this caller can see, so "not found" and "not
    -- yours" are one answer here, exactly as every 404 in this product is.
    raise exception 'That student is not available';
  end if;
  if v_student.status <> 'active' then
    raise exception
      '% has left the school, so nothing can be sold to them', v_student.full_name;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text, 0));

  select coalesce(sum(m.quantity), 0) into v_on_hand
  from public.stock_movements m where m.item_id = p_item_id;

  if v_on_hand - p_quantity < 0 then
    raise exception 'There are % % of % on hand and you are selling %',
      public.format_quantity(v_on_hand), v_item.unit, v_item.name,
      public.format_quantity(p_quantity);
  end if;

  v_total := round(p_quantity * v_price, 2);

  insert into public.stock_movements (
    tenant_id, session_id, item_id, kind, quantity,
    sold_to_student_id, unit_price, note, happened_on, recorded_by
  ) values (
    v_tenant_id, v_session_id, p_item_id, 'sale', -abs(p_quantity),
    p_student_id, v_price, nullif(btrim(coalesce(p_note, '')), ''), v_on, auth.uid()
  )
  returning id into v_movement_id;

  -- The charge. `method` stays null: this is what is owed, not money taken --
  -- the counter collects it with the tuition, on one receipt.
  insert into public.ledger_entries (
    tenant_id, session_id, student_id, entry_type, amount,
    note, stock_movement_id, occurred_at, recorded_by
  ) values (
    v_tenant_id, v_session_id, p_student_id, 'sale', v_total,
    format('Store: %s x %s', public.format_quantity(p_quantity), v_item.name),
    v_movement_id, now(), auth.uid()
  )
  returning id into v_entry_id;

  -- No `get diagnostics` here, deliberately. Rule 6's own refinement: an
  -- UPDATE that no policy matches writes nothing and raises nothing, while an
  -- INSERT whose WITH CHECK fails *raises*. A row-count branch after this
  -- statement could never execute -- which is `0257`'s defect, and worse than
  -- no branch because it sits where a reader would believe the refusal was
  -- handled. The role check at the top is what makes that raise a sentence.
  return jsonb_build_object(
    'movement_id', v_movement_id,
    'ledger_entry_id', v_entry_id,
    'item', v_item.name,
    'unit', v_item.unit,
    'student', v_student.full_name,
    'quantity', p_quantity,
    'unit_price', v_price,
    'total', v_total,
    'on_hand_after', v_on_hand - p_quantity
  );
end;
$$;

comment on function public.stock_sell_to_student(uuid, uuid, numeric, numeric, text, date) is
  'Sell stock to a student: one movement out of the store and one charge onto '
  'the fee account, in one transaction. INVOKER -- the two narrow INSERT '
  'policies are the boundary, and the role check here only makes the refusal a '
  'sentence. Corrections go through stock_sale_reverse, never an update.';

-- -------------------------------------------------------------- the correction --

create or replace function public.stock_sale_reverse(
  p_movement_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_sale record;
  v_charge public.ledger_entries;
  v_item record;
  v_return_id uuid;
  v_reversal_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why this sale is being reversed -- it is the only thing the record will have';
  end if;

  select m.* into v_sale from public.stock_movements m
  where m.id = p_movement_id and m.tenant_id = v_tenant_id and m.kind = 'sale';
  if v_sale.id is null then
    raise exception 'That sale is not available';
  end if;

  select * into v_charge from public.ledger_entries
  where stock_movement_id = p_movement_id and reverses_entry_id is null;
  if v_charge.id is null then
    raise exception 'That sale has no charge against it, so there is nothing to reverse';
  end if;
  if exists (select 1 from public.ledger_entries where reverses_entry_id = v_charge.id) then
    raise exception 'That sale has already been reversed';
  end if;

  select i.name, i.unit into v_item from public.inventory_items i where i.id = v_sale.item_id;

  -- The goods come back as a `return`, not as an erased sale: rule 6's shape,
  -- and it keeps the fact that the thing left the shelf on the day it did.
  insert into public.stock_movements (
    tenant_id, session_id, item_id, kind, quantity, note, happened_on, recorded_by
  ) values (
    v_tenant_id, v_sale.session_id, v_sale.item_id, 'return', abs(v_sale.quantity),
    'Sale reversed: ' || btrim(p_reason), current_date, auth.uid()
  )
  returning id into v_return_id;

  -- And the money, carrying the link so the store keeper can still see it.
  insert into public.ledger_entries (
    tenant_id, session_id, student_id, entry_type, amount, note,
    stock_movement_id, reverses_entry_id, occurred_at, recorded_by
  ) values (
    v_charge.tenant_id, v_charge.session_id, v_charge.student_id, 'sale',
    -v_charge.amount, 'Reversal: ' || btrim(p_reason),
    v_charge.stock_movement_id, v_charge.id, now(), auth.uid()
  )
  returning id into v_reversal_id;

  return jsonb_build_object(
    'return_movement_id', v_return_id,
    'reversal_entry_id', v_reversal_id,
    'item', v_item.name,
    'quantity', abs(v_sale.quantity),
    'amount', v_charge.amount
  );
end;
$$;

comment on function public.stock_sale_reverse(uuid, text) is
  'Undo a sale: the goods return to the shelf and the charge is reversed, in '
  'one transaction. Never an update -- rule 6 -- and never only one half, '
  'which is why fees_reverse_entry refuses a sale by name.';

commit;
