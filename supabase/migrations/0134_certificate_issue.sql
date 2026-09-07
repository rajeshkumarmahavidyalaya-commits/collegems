-- ---------------------------------------------------------------------------
-- The certificate engine, part two: preview, issue, cancel
-- ---------------------------------------------------------------------------
--
-- Migration 0133 assembled the values and criticised the wording. This is the
-- half that writes, and the line between them is the module's whole design:
--
-- > **Preview computes; issue freezes.**
--
-- `certificate_preview` may be called a hundred times and stores nothing.
-- `certificate_issue` calls it once more -- server-side, ignoring whatever the
-- screen believed -- allocates a gapless serial, renders with it, and writes
-- the rendered text down. From that moment the document is a row.

create or replace function public.certificate_preview(
  p_student_id uuid,
  p_template_id uuid,
  p_issued_on date default null,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_t public.certificate_templates;
  v_snapshot jsonb;
  v_body text;
  v_unresolved text[];
  v_problems jsonb := '[]'::jsonb;
  v_dues numeric;
  v_status text;
begin
  select * into v_t from public.certificate_templates where id = p_template_id;
  if v_t.id is null then
    raise exception 'No such certificate template';
  end if;

  v_snapshot := public.certificate_snapshot(p_student_id, p_issued_on, p_extra);
  v_body := public.certificate_render(v_t.body, v_snapshot);
  v_unresolved := public.certificate_placeholders(v_body);

  if 'serial' = any (v_unresolved) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'severity', 'info',
      'message', 'The serial number is allocated when the certificate is issued, '
                 'so {{serial}} is still standing in this preview.'));
  end if;

  if array_length(v_unresolved, 1) is not null then
    v_problems := v_problems || (
      select coalesce(jsonb_agg(jsonb_build_object(
        'severity', 'error',
        'message', format(
          'Nothing filled {{%s}}. The certificate cannot be issued with that '
          'printed on it -- supply the value, or take it out of the wording.', u)
      )), '[]'::jsonb)
      from unnest(v_unresolved) u where u <> 'serial'
    );
  end if;

  -- Not a refusal. See the header: whether dues withhold a certificate is a
  -- school's policy and several boards forbid it outright.
  select b.balance into v_dues
  from public.fees_student_balances(null, false, array[p_student_id]) b;

  if coalesce(v_dues, 0) > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'message', format('%s is still outstanding on this student''s fee account.',
                        to_char(v_dues, 'FM9999999990.00'))));
  end if;

  if v_t.kind = 'transfer' then
    select st.status into v_status from public.students st where st.id = p_student_id;
    if v_status <> 'active' then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'message', format('This student is already marked "%s".', v_status)));
    end if;

    if exists (
      select 1 from public.certificates c
      where c.student_id = p_student_id and c.kind = 'transfer' and c.status = 'issued'
    ) then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'message', 'A transfer certificate has already been issued to this student. '
                   'Cancel it before issuing another, so there are never two live '
                   'certificates with different numbers.'));
    end if;
  end if;

  return jsonb_build_object(
    'template_id', v_t.id,
    'template_name', v_t.name,
    'kind', v_t.kind,
    'fields', v_t.fields,
    'snapshot', v_snapshot,
    'body', v_body,
    'unresolved', to_jsonb(coalesce(v_unresolved, '{}')),
    'problems', v_problems,
    'can_issue', not exists (
      select 1 from jsonb_array_elements(v_problems) p where p ->> 'severity' = 'error'
    )
  );
end;
$$;

revoke all on function public.certificate_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_preview(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Issue
-- ---------------------------------------------------------------------------
--
-- `SECURITY INVOKER`: `certificates` has an INSERT policy for administrators
-- and `students` has its own update policy, so RLS is already the gate. This is
-- a Postgres function for the ordinary reason -- allocating a serial, writing
-- the certificate and marking the child as transferred must be one transaction,
-- and supabase-js cannot open one.

create or replace function public.certificate_issue(
  p_student_id uuid,
  p_template_id uuid,
  p_issued_on date default null,
  p_extra jsonb default '{}'::jsonb
)
returns public.certificates
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id  uuid := public.current_tenant_id();
  v_session_id uuid;
  v_issued_on  date;
  v_t public.certificate_templates;
  v_preview jsonb;
  v_snapshot jsonb;
  v_serial text;
  v_body text;
  v_unresolved text[];
  v_row public.certificates;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'There is no current academic session to issue against';
  end if;

  v_issued_on := coalesce(p_issued_on, public.mobile_today());

  select * into v_t from public.certificate_templates where id = p_template_id;
  if v_t.id is null then
    raise exception 'No such certificate template';
  end if;
  if not v_t.is_active then
    raise exception 'The template "%" has been retired', v_t.name;
  end if;

  -- The same preview the person just looked at. Recomputing it here rather than
  -- trusting what the client sends is the ordinary server-boundary rule: the
  -- screen is a convenience, this is the gate.
  v_preview := public.certificate_preview(p_student_id, p_template_id, v_issued_on, p_extra);

  if not (v_preview ->> 'can_issue')::boolean then
    raise exception 'This certificate cannot be issued yet: %',
      ( select string_agg(p ->> 'message', ' ')
        from jsonb_array_elements(v_preview -> 'problems') p
        where p ->> 'severity' = 'error' );
  end if;

  -- The serial is allocated *before* rendering, so a template that prints
  -- {{serial}} gets the real number rather than a hole. Gapless, per rule 6,
  -- from the same counter receipts and invoices use.
  v_serial := public.fees_next_document_number_for(v_tenant_id, v_session_id, 'certificate');

  v_snapshot := public.certificate_snapshot(p_student_id, v_issued_on, p_extra)
                || jsonb_build_object('serial', v_serial);
  v_body := public.certificate_render(v_t.body, v_snapshot);

  v_unresolved := public.certificate_placeholders(v_body);
  if array_length(v_unresolved, 1) is not null then
    -- Belt and braces: the preview said this was clear, so reaching here means
    -- the two disagreed, and issuing a document with `{{...}}` printed on it is
    -- not a thing to do quietly.
    raise exception 'Nothing filled: %', array_to_string(v_unresolved, ', ');
  end if;

  insert into public.certificates (
    tenant_id, session_id, student_id,
    template_id, template_name, kind,
    serial_no, issued_on, issued_by,
    snapshot, body
  )
  values (
    v_tenant_id, v_session_id, p_student_id,
    v_t.id, v_t.name, v_t.kind,
    v_serial, v_issued_on, ( select auth.uid() ),
    v_snapshot, v_body
  )
  returning * into v_row;

  -- Issuing a leaving certificate *is* the act of the child leaving. Doing it in
  -- two steps leaves a school with certificates issued to children still on the
  -- roll, which is how a class list ends up with somebody who left in April.
  if v_t.kind = 'transfer' then
    update public.students set status = 'transferred'
    where id = p_student_id and status = 'active';
  end if;

  return v_row;
end;
$$;

revoke all on function public.certificate_issue(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_issue(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel
-- ---------------------------------------------------------------------------

create or replace function public.certificate_cancel(
  p_certificate_id uuid,
  p_reason text
)
returns public.certificates
language plpgsql
set search_path = public, extensions
as $$
declare
  v_row public.certificates;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the certificate is being cancelled -- it stays in the register for ever';
  end if;

  select * into v_row from public.certificates where id = p_certificate_id;
  if v_row.id is null then
    raise exception 'No such certificate, or you cannot see it';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'Certificate % is already cancelled', v_row.serial_no;
  end if;

  update public.certificates
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = ( select auth.uid() ),
         cancel_reason = trim(p_reason)
   where id = p_certificate_id
  returning * into v_row;

  if v_row.id is null then
    -- No policy matched. Silently touching nothing is what RLS does, and it is
    -- the wrong thing to report as success.
    raise exception 'You cannot cancel this certificate';
  end if;

  -- A cancelled leaving certificate means the child did not leave after all.
  -- Only from `transferred`, though: somebody marked `alumni` or `expelled`
  -- since has been moved deliberately, and undoing that here would be this
  -- function quietly overruling a person.
  if v_row.kind = 'transfer' then
    update public.students set status = 'active'
    where id = v_row.student_id and status = 'transferred';
  end if;

  return v_row;
end;
$$;

revoke all on function public.certificate_cancel(uuid, text) from public, anon;
grant execute on function public.certificate_cancel(uuid, text) to authenticated;
