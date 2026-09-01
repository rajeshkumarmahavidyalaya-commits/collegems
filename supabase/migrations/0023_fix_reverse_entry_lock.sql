-- `fees_reverse_entry` could never run: it took `select ... for update` on
-- `ledger_entries` to lock the row it was about to mirror, and 0021 revokes
-- UPDATE on that table to make the ledger append-only. Postgres requires the
-- UPDATE privilege for a row lock, so every reversal failed with
-- `permission denied for table ledger_entries`.
--
-- The two requirements genuinely conflict, and immutability wins: the lock
-- goes, not the revoke. Nothing is lost, because the lock was never what made
-- double-reversal safe -- `ledger_entries_reversal_unique` is. Two concurrent
-- reversals of the same entry now both pass the friendly pre-check and the
-- second fails on the unique index (23505), which the server action turns back
-- into "That entry has already been reversed". The constraint is the gate; the
-- pre-check is only there to give a better message in the ordinary case.

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

  -- No FOR UPDATE: see the header. The unique index below does the real work.
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

  insert into public.ledger_entries (
    tenant_id, session_id, student_id, invoice_id, entry_type, amount,
    occurred_at, method, reference, note, reverses_entry_id, recorded_by
  ) values (
    v_original.tenant_id, v_original.session_id, v_original.student_id,
    v_original.invoice_id, v_original.entry_type, -v_original.amount,
    now(), v_original.method, v_original.reference,
    'Reversal: ' || trim(p_reason), v_original.id, auth.uid()
  )
  returning * into v_reversal;

  return v_reversal;
end;
$$;
