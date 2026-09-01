-- A real per-student invoice, rather than a total.
--
-- Two things were only ever a single figure:
--
-- 1. The queued invoice email carried `total` and nothing else, so whatever
--    eventually sends it could only say "you owe 15,000" -- which is a demand,
--    not a bill. A family cannot check a demand. The payload now carries the
--    lines, what has been paid against the invoice, and the school's own
--    details, so the message can be itemised without the sender having to go
--    back to the database for any of it.
--
-- 2. There was nowhere to print one. `school.profile` gives the invoice
--    document a letterhead: `tenants` holds only a name, and an invoice with
--    no address or contact on it is not something a school can hand over.

insert into public.settings (tenant_id, key, value)
select t.id, 'school.profile', jsonb_build_object(
  'address_line1', null,
  'address_line2', null,
  'city', null,
  'state', null,
  'postal_code', null,
  'phone', null,
  'email', null,
  'website', null
)
from public.tenants t
on conflict (tenant_id, key) do nothing;

create or replace function public.fees_queue_invoice_email(p_invoice_id uuid)
returns public.jobs
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_invoice public.invoices;
  v_to text;
  v_enabled boolean;
  v_student text;
  v_admission text;
  v_guardian text;
  v_guardian_email text;
  v_total numeric;
  v_paid numeric;
  v_lines jsonb;
  v_school jsonb;
  v_school_name text;
  v_job public.jobs;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_invoice from public.invoices
  where id = p_invoice_id and tenant_id = v_tenant_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;
  if v_invoice.status <> 'issued' then
    raise exception 'That invoice is cancelled, so there is nothing to send';
  end if;

  select coalesce((s.value ->> 'enabled')::boolean, false),
         nullif(trim(coalesce(s.value ->> 'to', '')), '')
    into v_enabled, v_to
  from public.settings s
  where s.tenant_id = v_tenant_id and s.key = 'notifications.invoice_email';

  if not coalesce(v_enabled, false) or v_to is null then
    raise exception 'No billing email is configured for this school';
  end if;

  select p.first_name || ' ' || p.last_name, st.admission_number
    into v_student, v_admission
  from public.students st
  join public.people p on p.id = st.person_id
  where st.id = v_invoice.student_id;

  -- The primary guardian, so a sender can address the bill to a person rather
  -- than to a child.
  select gp.first_name || ' ' || gp.last_name, gp.email::text
    into v_guardian, v_guardian_email
  from public.guardian_student gs
  join public.guardians g on g.id = gs.guardian_id
  join public.people gp on gp.id = g.person_id
  where gs.student_id = v_invoice.student_id and gs.tenant_id = v_tenant_id
  order by gs.is_primary desc
  limit 1;

  select coalesce(jsonb_agg(
           jsonb_build_object('description', l.description, 'amount', l.amount)
           order by l.created_at
         ), '[]'::jsonb),
         coalesce(sum(l.amount), 0)
    into v_lines, v_total
  from public.invoice_lines l
  where l.invoice_id = v_invoice.id;

  -- Only what has been settled against THIS invoice. Money paid on account is
  -- deliberately excluded: it is not evidence that this bill was paid.
  select coalesce(-sum(le.amount), 0) into v_paid
  from public.ledger_entries le
  where le.invoice_id = v_invoice.id and le.entry_type = 'payment';

  select t.name into v_school_name from public.tenants t where t.id = v_tenant_id;

  select s.value into v_school
  from public.settings s
  where s.tenant_id = v_tenant_id and s.key = 'school.profile';

  insert into public.jobs (tenant_id, job_type, status, payload, created_by)
  values (
    v_tenant_id, 'invoice_email', 'queued',
    jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'issue_date', v_invoice.issue_date,
      'due_date', v_invoice.due_date,
      'student_name', v_student,
      'admission_number', v_admission,
      'guardian_name', v_guardian,
      'guardian_email', v_guardian_email,
      'lines', v_lines,
      'total', v_total,
      'paid', v_paid,
      'outstanding', v_total - v_paid,
      'school', jsonb_build_object('name', v_school_name) || coalesce(v_school, '{}'::jsonb),
      'to', v_to
    ),
    auth.uid()
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.fees_queue_invoice_email(uuid) from public, anon;
grant execute on function public.fees_queue_invoice_email(uuid) to authenticated;
