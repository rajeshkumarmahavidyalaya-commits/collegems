-- 0261 -- Selling from the store: the schema half.
--
-- The last self-contained item on Phase 3b's list. The roadmap's note read
-- *"`stock_movements.kind` is `adjustment | issue | receipt`; a sale also
-- crosses into the fee ledger"* -- and the first half of that was measuring the
-- **data in use**, not the constraint. `stock_movements_kind_check` has listed
-- five kinds since the module shipped. The second half is exactly right, and is
-- what makes this a money change rather than an inventory one.
--
-- ## A sale is two facts in two ledgers, and rule 6 already settled the shape
--
-- Library fines are the precedent, and rule 6 writes them up as the pattern for
-- *"any module that wants to write here"*:
--
--   * **Book the charge when the amount is final.** A sale's amount is final at
--     the counter, so one immutable row is right -- unlike a daily-accruing
--     fine, which is why that one is booked at return.
--   * **Give a module its own narrow way in, not the whole ledger.** Librarians
--     hold a policy permitting exactly `entry_type = 'fine'` rows carrying a
--     `book_issue_id`, which is what lets `library_return_book` stay
--     `SECURITY INVOKER`. A store keeper gets the same door, one column along.
--   * **Make idempotency a unique index on the source row.** One sale entry per
--     movement, excluding reversals, so a retried sale converges rather than
--     billing twice.
--
-- ## Price is not cost, and they are different columns on purpose
--
-- `unit_cost` is what the school paid and is already restricted to `receipt`
-- and `adjustment` by `stock_movements_cost_chk`. `unit_price` is what the
-- family pays. A school buys exercise books at 18 and sells them at 25, and a
-- single column would make the store's margin unanswerable -- the
-- `book_issues.fine_paid` mistake, which rule 6 threw out once already: **a
-- second field free to disagree with the first is drift waiting to happen**,
-- and two fields that are genuinely different facts are not that.
--
-- `inventory_items.sale_price` is the default, and **null means not for sale**.
-- A school stocks chalk and floor cleaner; neither is a thing a child buys, and
-- a price of 0.00 would say "free" rather than "no".
--
-- ## A sale is to a student, and that is a limit rather than an oversight
--
-- `ledger_entries.student_id` is `not null`, so a sale to a member of staff
-- cannot go to the fee ledger at all -- the same wall that sent **staff library
-- fines to payroll** (migration `0065`). Selling to staff is therefore not
-- built here, and the existing `issue` kind with `issued_to_staff_id` remains
-- what records a department taking stock. Named rather than half-built.
--
-- ## The list of kinds had two copies, which is migration `0101`'s defect
--
-- `stock_record_movement` opens with
--
--   if p_kind not in ('receipt', 'issue', 'return', 'adjustment', 'write_off')
--
-- beside a CHECK constraint that already says exactly that. They agree, so
-- nobody was refused wrongly -- and the cost is the one `0101` already paid for
-- `document_sequences.kind`: **adding a kind means finding every copy, and the
-- next reader invents their own.** `0262` deletes the copy in the function; the
-- constraint gains `sale` here and stays the one place the list lives.

begin;

-- ---------------------------------------------------------------- the goods --

alter table public.inventory_items
  add column sale_price numeric(12, 2),
  add constraint inventory_items_sale_price_check
    check (sale_price is null or sale_price >= 0);

comment on column public.inventory_items.sale_price is
  'What a family pays for one unit. NULL means this item is not for sale -- '
  'which is different from 0.00, and is the default, because a school stocks '
  'plenty a child never buys.';

alter table public.stock_movements
  drop constraint stock_movements_kind_check,
  add constraint stock_movements_kind_check
    check (kind = any (array['receipt', 'issue', 'return', 'adjustment', 'write_off', 'sale'])),
  -- The sign table has `ELSE true`, so a kind added without a branch here would
  -- be free to move stock *in*. A sale takes stock out; say so.
  drop constraint stock_movements_sign_chk,
  add constraint stock_movements_sign_chk
    check (case kind
             when 'receipt' then quantity > 0
             when 'return' then quantity > 0
             when 'issue' then quantity < 0
             when 'write_off' then quantity < 0
             when 'sale' then quantity < 0
             else true
           end);

alter table public.stock_movements
  add column sold_to_student_id uuid,
  add column unit_price numeric(12, 2),
  -- `ON DELETE RESTRICT` rather than the `SET NULL` its staff twin uses: a
  -- sale's buyer is part of the record, and nulling it would break the CHECK
  -- below anyway. A child who has bought something is a child who has a
  -- history -- and this product ends a student's relationships (rule 12's
  -- `student_exit`) rather than deleting the row.
  add constraint stock_movements_buyer_fkey
    foreign key (tenant_id, sold_to_student_id)
    references public.students (tenant_id, id) on delete restrict,
  add constraint stock_movements_buyer_chk
    check ((kind = 'sale') = (sold_to_student_id is not null)),
  add constraint stock_movements_price_chk
    check ((kind = 'sale') = (unit_price is not null)),
  add constraint stock_movements_unit_price_check
    check (unit_price is null or unit_price >= 0);

comment on column public.stock_movements.unit_price is
  'What the family was charged for one unit, frozen at the sale. Not '
  '`unit_cost`, which is what the school paid: a store that cannot answer '
  '"what was our margin" has one number where it needs two.';

create index stock_movements_buyer_idx
  on public.stock_movements (tenant_id, sold_to_student_id, happened_on desc)
  where sold_to_student_id is not null;

-- ---------------------------------------------------------------- the money --

alter table public.ledger_entries
  add column stock_movement_id uuid references public.stock_movements (id) on delete restrict;

comment on column public.ledger_entries.stock_movement_id is
  'The sale this charge is for, exactly as `book_issue_id` names the loan a '
  'fine is for. It is what the store keeper''s INSERT policy requires, so the '
  'write function needs no SECURITY DEFINER.';

alter table public.ledger_entries
  drop constraint ledger_entries_entry_type_check,
  add constraint ledger_entries_entry_type_check
    check (entry_type = any (array['payment', 'discount', 'fine', 'refund', 'write_off', 'sale'])),
  -- A sale is a charge, not a payment: the money is taken afterwards by
  -- `fees_record_payment`, on the same receipt as tuition. That is rule 6's
  -- argument for putting library fines here, and it is why `method` stays null.
  drop constraint ledger_entries_method_chk,
  add constraint ledger_entries_method_chk
    check ((entry_type = any (array['payment', 'refund']) and method is not null)
        or (entry_type = any (array['discount', 'fine', 'write_off', 'sale']) and method is null)),
  drop constraint ledger_entries_sign_chk,
  add constraint ledger_entries_sign_chk
    check (case when reverses_entry_id is null then
             case entry_type
               when 'payment' then amount < 0
               when 'discount' then amount < 0
               when 'write_off' then amount < 0
               when 'fine' then amount > 0
               when 'refund' then amount > 0
               when 'sale' then amount > 0
               else false
             end
           else
             case entry_type
               when 'payment' then amount > 0
               when 'discount' then amount > 0
               when 'write_off' then amount > 0
               when 'fine' then amount < 0
               when 'refund' then amount < 0
               when 'sale' then amount < 0
               else false
             end
           end);

alter table public.ledger_entries
  add constraint ledger_entries_sale_source_chk
    check ((stock_movement_id is null) or (entry_type = 'sale'));

-- One charge per sale, excluding reversals: a retried sale converges instead of
-- billing a family twice. `library_return_book`'s `on conflict do nothing`
-- rests on the same shape.
create unique index ledger_entries_sale_unique
  on public.ledger_entries (stock_movement_id)
  where stock_movement_id is not null and reverses_entry_id is null;

-- The narrow door, one column along from the librarian's. Store keepers are the
-- roles that may already write `stock_movements`, so the two halves of a sale
-- are permitted to exactly the same people -- a keeper who could move the stock
-- and not raise the charge would leave a shelf short and nobody billed.
create policy "store keepers add stock sales" on public.ledger_entries
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) = any (array['admin', 'accountant', 'librarian'])
    and entry_type = 'sale'
    and stock_movement_id is not null
  );

create policy "store keepers view stock sales" on public.ledger_entries
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) = any (array['admin', 'accountant', 'librarian'])
    and stock_movement_id is not null
  );

commit;
