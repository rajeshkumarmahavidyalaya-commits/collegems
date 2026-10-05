-- 0334: An invoice with a concession can be cancelled.
--
-- Found wiring the "Cancel invoice" button, which no screen had ever drawn:
-- `cancelInvoice` existed in the fee actions with no caller (the 0333 sweep of
-- server actions nothing calls). Reading the function before giving it a
-- button showed it could not have worked for a large share of invoices:
--
--   if exists (select 1 from ledger_entries where invoice_id = p_invoice_id)
--     then raise 'Money has been recorded against this invoice. Reverse those entries first.'
--
-- `fees_generate_invoice` credits a concession to the ledger *against the
-- invoice* (rule 6: a discount is not a negative invoice line). So every
-- invoice for a child with a concession -- 32 of them on the demo college --
-- was refused, before any money was taken. And "reverse those entries first"
-- could never be obeyed: a reversal carries the same invoice_id, so after
-- reversing, two entries existed instead of one.
--
-- The rule is about money a family paid or was refunded, not about the
-- concession that came with the bill. So:
--
-- * Refuse while a live entry that is not this invoice's own concession credit
--   is against it -- live meaning neither a reversal nor reversed. That is a
--   payment, a refund or an adjustment somebody recorded, and undoing it is a
--   person's decision on the fee account.
-- * Reverse the invoice's live concession credits in the same transaction, by
--   `fees_reverse_entry`, so the family is not left holding a credit for a
--   charge that no longer exists.
--
-- And the omission 0026 and 0265 each found one column along, a third time:
-- `fees_reverse_entry` copied invoice_id, book_issue_id and stock_movement_id
-- onto a reversal and dropped `concession_award_id`, so a reversed concession
-- credit was invisible to anything reading credits by award. It is copied now.
-- The award's unique index excludes reversals, so the copy is allowed.

begin;

create or replace function public.fees_reverse_entry(p_entry_id uuid, p_reason text)
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
    concession_award_id,
    entry_type, amount, occurred_at, method, reference, note, reverses_entry_id, recorded_by
  ) values (
    v_original.tenant_id, v_original.session_id, v_original.student_id,
    v_original.invoice_id, v_original.book_issue_id, v_original.stock_movement_id,
    v_original.concession_award_id,
    v_original.entry_type,
    -v_original.amount, now(), v_original.method, v_original.reference,
    'Reversal: ' || trim(p_reason), v_original.id, auth.uid()
  )
  returning * into v_reversal;

  return v_reversal;
end;
$$;

create or replace function public.fees_cancel_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_invoice public.invoices;
  v_paid integer;
  v_credit record;
  v_rows integer;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Cancelling an invoice needs a reason';
  end if;
  select * into v_invoice from public.invoices
  where id = p_invoice_id and tenant_id = v_tenant_id
  for update;
  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'That invoice is already cancelled';
  end if;

  -- Live entries that are not the invoice's own concession credits.
  select count(*) into v_paid
  from public.ledger_entries e
  where e.invoice_id = p_invoice_id
    and e.reverses_entry_id is null
    and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id)
    and not (e.entry_type = 'discount' and e.concession_award_id is not null);
  if v_paid > 0 then
    raise exception
      '% recorded against invoice % (a payment, refund or adjustment). Reverse % on the fee account first, then cancel.',
      case when v_paid = 1 then 'One entry is' else v_paid || ' entries are' end,
      v_invoice.invoice_number,
      case when v_paid = 1 then 'it' else 'them' end;
  end if;

  for v_credit in
    select e.id from public.ledger_entries e
    where e.invoice_id = p_invoice_id
      and e.entry_type = 'discount'
      and e.concession_award_id is not null
      and e.reverses_entry_id is null
      and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id)
  loop
    perform public.fees_reverse_entry(
      v_credit.id, format('invoice %s cancelled: %s', v_invoice.invoice_number, trim(p_reason)));
  end loop;

  update public.invoices
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = trim(p_reason)
   where id = p_invoice_id
  returning * into v_invoice;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Only somebody who manages fees can cancel an invoice.' using errcode = '42501';
  end if;
  return v_invoice;
end;
$$;

commit;
