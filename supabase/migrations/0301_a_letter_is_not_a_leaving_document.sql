-- 0301: an admission letter is not a leaving document.
--
-- Found by 0300's own probe. Previewing the new admission letter for a child
-- admitted that month came back can_issue = true with one warning:
--
--     "10400.00 is still outstanding on this student's fee account."
--
-- That sentence exists for the transfer certificate, where withholding a
-- leaving document for dues is a real policy question somebody has to decide
-- (docs/modules/certificates.md). On a letter confirming a child has just
-- joined it is noise -- the admission fee was billed the same morning, so it
-- fires on every admission letter ever issued, and *a critic that fires on a
-- correctly finished action teaches people to ignore it* (rule 12). The
-- warning is skipped for 'admission' and kept everywhere else it fired.
--
-- Two more, both the same rule the engine already applies to transfer,
-- service and experience certificates -- *never two live documents with
-- different numbers*:
--
--   * a second live admission letter for one child is refused until the
--     first is cancelled;
--   * a second live appointment letter for one member of staff likewise.
--
-- And the sentence that refusal reuses had an article bug nobody could see
-- while the only kinds were 'experience' and 'service': it read "A experience
-- certificate has already been issued". The noun phrase is now spelled out per
-- kind, so the article agrees with the word (0196's rule, one layer along).
--
-- Everything else is 0246's definition unchanged.

create or replace function public.certificate_preview(
  p_subject_id uuid,
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
  v_what text;
begin
  select * into v_t from public.certificate_templates where id = p_template_id;
  if v_t.id is null then
    raise exception 'No such certificate template';
  end if;

  if v_t.subject = 'staff' then
    v_snapshot := public.certificate_staff_snapshot(p_subject_id, p_issued_on, p_extra);
  else
    v_snapshot := public.certificate_snapshot(p_subject_id, p_issued_on, p_extra);
  end if;

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

  -- The one-live-document rule's noun phrase, per kind, so the article agrees
  -- with the word (0301).
  v_what := case v_t.kind
    when 'experience'  then 'An experience certificate'
    when 'service'     then 'A service certificate'
    when 'appointment' then 'An appointment letter'
    when 'admission'   then 'An admission letter'
    when 'transfer'    then 'A transfer certificate'
  end;

  if v_t.subject = 'staff' then
    select st.status into v_status from public.staff st where st.id = p_subject_id;

    if v_t.kind = 'experience' and v_status = 'active' then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'message', 'This person is still employed here, so there is no leaving '
                   'date to certify service up to. A service certificate is the '
                   'one for somebody still in post.'));
    end if;

    if v_t.kind in ('experience', 'service', 'appointment') and exists (
      select 1 from public.certificates c
      where c.staff_id = p_subject_id and c.kind = v_t.kind and c.status = 'issued'
    ) then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'message', format(
          '%s has already been issued to this person. Cancel it before issuing '
          'another, so there are never two live documents with different numbers.',
          v_what)));
    end if;

    return jsonb_build_object(
      'template_id', v_t.id,
      'template_name', v_t.name,
      'kind', v_t.kind,
      'subject', v_t.subject,
      'fields', v_t.fields,
      'snapshot', v_snapshot,
      'body', v_body,
      'unresolved', to_jsonb(coalesce(v_unresolved, '{}')),
      'problems', v_problems,
      'can_issue', not exists (
        select 1 from jsonb_array_elements(v_problems) p where p ->> 'severity' = 'error'
      )
    );
  end if;

  -- Dues are a question for a leaving document, not for a letter saying a
  -- child has just joined (0301).
  if v_t.kind <> 'admission' then
    select b.balance into v_dues
    from public.fees_student_balances(null, false, array[p_subject_id]) b;

    if coalesce(v_dues, 0) > 0 then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'message', format('%s is still outstanding on this student''s fee account.',
                          to_char(v_dues, 'FM9999999990.00'))));
    end if;
  end if;

  if v_t.kind = 'transfer' then
    select st.status into v_status from public.students st where st.id = p_subject_id;
    if v_status <> 'active' then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'message', format('This student is already marked "%s".', v_status)));
    end if;
  end if;

  if v_t.kind in ('transfer', 'admission') and exists (
    select 1 from public.certificates c
    where c.student_id = p_subject_id and c.kind = v_t.kind and c.status = 'issued'
  ) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'severity', 'error',
      'message', format(
        '%s has already been issued to this student. Cancel it before issuing '
        'another, so there are never two live documents with different numbers.',
        v_what)));
  end if;

  return jsonb_build_object(
    'template_id', v_t.id,
    'template_name', v_t.name,
    'kind', v_t.kind,
    'subject', v_t.subject,
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
