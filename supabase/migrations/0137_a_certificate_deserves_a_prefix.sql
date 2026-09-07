-- ---------------------------------------------------------------------------
-- CERTIFICATE-2025-00001
-- ---------------------------------------------------------------------------
--
-- The first certificate issued came out numbered `CERTIFICATE-2025-00001`.
-- Nothing was broken: `fees_next_document_number_for` gives a kind nobody
-- assigned a prefix the fallback `upper(p_kind)`, and its own comment says so
-- out loud --
--
--   "A kind the CHECK allows but nobody gave a prefix to still gets a usable
--    one rather than a crash: 'PAYSLIP-2025-00001' is ugly and correct, and
--    the school can edit the row."
--
-- Ugly and correct is the right trade for a payslip reference. It is the wrong
-- trade for a number typed onto a leaving certificate that a family keeps and
-- another school reads, so this gives the kind a prefix like every other kind
-- has.
--
-- **This is not the thing migration 0101 deleted.** That was a second copy of
-- *which kinds exist*, which the CHECK constraint already said and which made
-- adding a kind fail at run time. This `case` is a table of *defaults*, it
-- cannot make a valid kind fail, and the row it writes is editable afterwards
-- -- which is why the fallback is a fallback rather than an exception.
--
-- The prefix is only corrected on sequences that have issued nothing. A school
-- that has already handed out `CERTIFICATE-2025-00001` keeps that prefix, so
-- its register stays in one series: a numbering scheme that changes halfway
-- through a year is worse than an ugly one.

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
  -- ALTER plus a function nobody remembers. What follows is only a default
  -- prefix, which the school may edit on the row afterwards.
  insert into public.document_sequences (tenant_id, session_id, kind, prefix)
  values (
    p_tenant_id, p_session_id, p_kind,
    case p_kind
      when 'receipt' then 'RC'
      when 'invoice' then 'IN'
      when 'voucher' then 'JV'
      when 'enquiry' then 'ENQ'
      when 'visitor_pass' then 'VP'
      when 'certificate' then 'CERT'
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

update public.document_sequences
   set prefix = 'CERT'
 where kind = 'certificate'
   and prefix = 'CERTIFICATE'
   and next_value = 1;
