-- 0264 -- The sale worked, both rows were right, and the balance did not move.
--
-- `0263`'s probe sold two boxes of chalk at 25.00 to a named child, as an
-- administrator, and reported:
--
--   SALE   total 50.00 | on hand 15.00 -> 13.00 | balance 1100.00 -> 1100.00
--
-- Stock left the shelf. A `ledger_entries` row of 50.00 was written, correctly
-- signed, correctly linked, immutable. And **the only screen that collects the
-- money never saw it.**
--
-- ## Measured
--
--   today                2026-09-21
--   the flag says        2025-2026     <- current_session_id()
--   the date falls in    2026-2027     <- academics_session_for_date()
--   the balance reads    2025-2026
--
-- `stock_sell_to_student` stamped the charge with the **date's** year, and
-- `fees_student_balances` filters on the **flag's**. Both are correct functions
-- and they answer different questions, which is rule 2's whole point -- and
-- this file already wrote down which one a charge takes:
--
--   > **A row that bills a year is not a row that records a day.** An invoice's
--   > `session_id` is which year's fees it charges [...] Date arithmetic there
--   > would misfile April's arrears notice in the opposite direction.
--
-- ## A sale is genuinely both, and that is not a contradiction
--
-- The **movement** is a dated observation: goods left the shelf on a day, and
-- `0198` is why it takes its year from that day. The **charge** is money owed
-- on a fee account, and it belongs to the year the school is running -- so one
-- act writes two rows with two different `session_id`s, deliberately.
--
-- That is not a new idea here. `library_return_book` -- the function rule 6
-- names as *the* pattern for writing to this ledger -- already does exactly it:
-- the issue is dated, and the fine insert reads
-- `public.current_session_id(v_tenant_id)`. **The precedent was in the
-- precedent**, one statement below the three bullet points that were copied.
--
-- ## And the probe is the part worth carrying
--
-- Every assertion about *rows* passed. The movement existed, negative and
-- linked. The entry existed, positive and linked, and the unique index held.
-- A probe that checked what was written would have reported success.
--
-- > **Assert the number a person reads, not the rows you wrote.** This file
-- > keeps recording the same shape -- `subscription_usage` counting 303
-- > students for a college with none, `attendance_coverage` at 0.0%, a cost
-- > printed for an SMS never sent -- and here it is one layer earlier: nothing
-- > was *wrong*, and the answer was still invisible.

begin;

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
  v_movement_session uuid;
  v_account_session uuid;
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

  -- Two rows, two questions, two years -- and they are allowed to differ.
  --
  --   the movement  records a day   -> the year that day falls in   (0198)
  --   the charge    bills a year    -> the year the school is in    (rule 2)
  --
  -- Getting the second one from the date filed a real charge into a year
  -- `fees_student_balances` does not read, and the money was invisible.
  v_movement_session := public.academics_session_for_date_or_raise(v_on);
  v_account_session := public.current_session_id(v_tenant_id);
  if v_account_session is null then
    raise exception 'This college has no current academic year, so nothing can be charged';
  end if;

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
    v_tenant_id, v_movement_session, p_item_id, 'sale', -abs(p_quantity),
    p_student_id, v_price, nullif(btrim(coalesce(p_note, '')), ''), v_on, auth.uid()
  )
  returning id into v_movement_id;

  -- The charge. `method` stays null: this is what is owed, not money taken --
  -- the counter collects it with the tuition, on one receipt.
  insert into public.ledger_entries (
    tenant_id, session_id, student_id, entry_type, amount,
    note, stock_movement_id, occurred_at, recorded_by
  ) values (
    v_tenant_id, v_account_session, p_student_id, 'sale', v_total,
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
  'the fee account, in one transaction. The two rows carry different years on '
  'purpose -- the movement records a day, the charge bills a year (0264). '
  'INVOKER: the two narrow INSERT policies are the boundary, and the role '
  'check only makes the refusal a sentence. Corrections go through '
  'stock_sale_reverse, never an update.';

commit;
