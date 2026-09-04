-- ---------------------------------------------------------------------------
-- One document numberer
--
-- Found by extending the system rather than by reading it. Adding enquiry and
-- visitor-pass numbers hit `Unknown document kind: visitor_pass` — because
-- `fees_next_document_number_for` carries **its own list** of which kinds
-- exist, alongside the CHECK constraint on `document_sequences.kind` that
-- already says so.
--
-- Worse, migration 0073 had already worked around it: `accounts_next_voucher_
-- number` is a second, hand-copied implementation of the same
-- insert-then-increment, because extending the shared one looked harder than
-- writing another. Front office would have made that a third.
--
-- Two changes, both about having one definition of a thing:
--
--   1. **The function stops repeating the kind list.** The CHECK constraint
--      owns which kinds exist; a bad kind now fails on the insert, with the
--      constraint's own error, instead of on a list somebody has to remember to
--      update in two places.
--   2. **The prefix becomes data.** It was already a column on
--      `document_sequences`; only the *default* was hardcoded, so that default
--      now comes from a small map with a legible fallback, and a school that
--      wants "ADM" instead of "ENQ" edits a row.
--
-- `accounts_next_voucher_number` becomes a thin wrapper, so voucher numbering
-- and receipt numbering cannot drift apart.
-- ---------------------------------------------------------------------------

create or replace function public.fees_next_document_number_for(
  p_tenant_id uuid,
  p_session_id uuid,
  p_kind text
)
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_prefix text;
  v_value bigint;
  v_year text;
begin
  if p_tenant_id is null or p_session_id is null then
    raise exception 'A document number needs a tenant and a session';
  end if;

  -- No list of kinds here. `document_sequences_kind_check` is the list, and
  -- this insert is what consults it -- so adding a kind is one ALTER, not an
  -- ALTER plus a function nobody remembers.
  insert into public.document_sequences (tenant_id, session_id, kind, prefix)
  values (
    p_tenant_id, p_session_id, p_kind,
    case p_kind
      when 'receipt' then 'RC'
      when 'invoice' then 'IN'
      when 'voucher' then 'JV'
      when 'enquiry' then 'ENQ'
      when 'visitor_pass' then 'VP'
      -- A kind the CHECK allows but nobody gave a prefix to still gets a
      -- usable one rather than a crash: "PAYSLIP-2025-00001" is ugly and
      -- correct, and the school can edit the row.
      else upper(p_kind)
    end
  )
  on conflict (tenant_id, session_id, kind) do nothing;

  update public.document_sequences
     set next_value = next_value + 1
   where tenant_id = p_tenant_id and session_id = p_session_id and kind = p_kind
  returning prefix, next_value - 1 into v_prefix, v_value;

  if v_value is null then
    raise exception 'Could not allocate a % number', p_kind;
  end if;

  select to_char(start_date, 'YYYY') into v_year
  from public.academic_sessions where id = p_session_id;

  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, 5, '0');
end;
$$;

revoke all on function public.fees_next_document_number_for(uuid, uuid, text) from public, anon;

-- Was a hand-copied second implementation (migration 0073). Now one line, so
-- the gapless guarantee is proved once.
create or replace function public.accounts_next_voucher_number()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select public.fees_next_document_number('voucher')
$$;

revoke all on function public.accounts_next_voucher_number() from public, anon;
grant execute on function public.accounts_next_voucher_number() to authenticated;
