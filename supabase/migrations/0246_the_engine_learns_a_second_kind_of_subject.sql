-- 0246 -- The engine learns a second kind of subject.
--
-- `0245` gave `certificates` a subject and a staff id. This is the half that
-- fills one in, and the shape is `0224`'s lesson about invitations, verbatim:
--
-- > **One field, not three.** The caller passes a single `p_subject_id` and the
-- > *server* decides which column it lands in, by reading the template. The
-- > client cannot put a student's id into `staff_id`, and there is no
-- > "exactly one of these" rule in the browser to get wrong.
--
-- The two functions are **dropped and recreated** rather than replaced. The
-- first parameter changes meaning — `p_student_id` is now `p_subject_id` — and
-- `create or replace` cannot rename a parameter, so keeping both would leave a
-- second body where the preview's checks quietly stop being updated. That is
-- `report_run`'s rule from `0154`, and the app calls these by named argument,
-- so both sides move together.
--
-- ## The school's details, and a copy deliberately left in place
--
-- `certificate_staff_snapshot` needs the same seven `school.*` keys the student
-- snapshot builds, and writing them out twice is how one college comes to print
-- two different addresses on two documents issued the same morning —
-- `library.fine_per_day`'s lesson. So `certificate_school_values()` is the
-- definition, and the staff snapshot calls it.
--
-- **`certificate_snapshot` is deliberately not rewritten to use it.** Its
-- school block is a second copy and it stays, for the reason this file already
-- gives about `role_has_permission`'s three copies: *replacing a load-bearing
-- function is a probe of it, not a tidy-up*, and this one renders documents
-- families keep. The two are pinned by an executable check instead —
-- `certificates.school_values_agree` compares the seven keys the two snapshots
-- produce for the same college and reports a finding if they ever differ. The
-- next migration that has to touch `certificate_snapshot` for its own reasons
-- is the one that should collapse them.
--
-- ## What a staff certificate can say, and what it refuses to
--
-- Only four staff columns are `not null` — `employee_code`, `designation`,
-- `date_of_joining`, `status` — and rule 12 is strict about what a *seeded*
-- template may print: **only values the database is guaranteed to have.**
-- `department`, `date_of_leaving` and `exit_reason` are nullable, so a template
-- that prints one of them leaves its `{{placeholder}}` standing and issuing
-- refuses. That is not a limitation to work around; it is the mechanism:
--
-- > An **experience certificate** certifies completed service, so it prints
-- > `{{staff.date_of_leaving}}` — and for somebody still employed that is null,
-- > the preview names it, and the certificate cannot be issued. Correct: you
-- > cannot certify service up to a day that has not happened.
-- >
-- > A **service certificate** is for somebody still here, prints no leaving
-- > date, and issues today.
--
-- The split falls straight out of the nullability rather than being invented.

begin;

-- ---------------------------------------------------------------------------
-- One definition of who the college is
-- ---------------------------------------------------------------------------

create or replace function public.certificate_school_values(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'school.name', ( select t.name from public.tenants t where t.id = p_tenant_id ),
    'school.address', nullif(trim(both ', ' from concat_ws(', ',
      p.value ->> 'address_line1', p.value ->> 'address_line2',
      p.value ->> 'city', p.value ->> 'state', p.value ->> 'postal_code')), ''),
    'school.city', p.value ->> 'city',
    'school.state', p.value ->> 'state',
    'school.phone', p.value ->> 'phone',
    'school.email', p.value ->> 'email',
    'school.website', p.value ->> 'website'
  ))
  from (
    select coalesce(
      ( select s.value from public.settings s
        where s.tenant_id = p_tenant_id and s.key = 'school.profile' ),
      '{}'::jsonb) as value
  ) p
$$;

comment on function public.certificate_school_values(uuid) is
  'The school.* keys every certificate prints, in one place. A student '
  'certificate and a staff one issued the same morning must not disagree '
  'about the college address.';

revoke all on function public.certificate_school_values(uuid) from public, anon;
grant execute on function public.certificate_school_values(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The staff snapshot
-- ---------------------------------------------------------------------------
--
-- `SECURITY INVOKER`, like its student twin, so every value has passed the same
-- policies a direct select would. Note what that means here: RLS on `staff` is
-- role-wide, so this does **not** narrow who may build a snapshot — the gate is
-- the INSERT policy on `certificates` (administrators only) and the read
-- policies `0245` added. A snapshot stores nothing.

create or replace function public.certificate_staff_snapshot(
  p_staff_id uuid,
  p_issued_on date default null,
  p_extra jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_issued_on date;
  v_row       record;
  v_upto      date;
  v_years     integer;
  v_months    integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_issued_on := coalesce(p_issued_on, public.mobile_today());

  select
    st.employee_code,
    st.designation,
    st.department,
    st.date_of_joining,
    st.date_of_leaving,
    st.status,
    st.exit_reason,
    trim(both ' ' from
      p.first_name || ' ' || coalesce(p.middle_name || ' ', '') || p.last_name) as full_name,
    p.first_name,
    p.date_of_birth,
    p.gender,
    p.blood_group,
    nullif(trim(both ', ' from concat_ws(', ',
      p.address_line1, p.address_line2, p.city, p.state, p.postal_code)), '') as address
  into v_row
  from public.staff st
  join public.people p on p.id = st.person_id
  where st.id = p_staff_id and st.tenant_id = v_tenant_id;

  if v_row.employee_code is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;

  -- Service is counted to the leaving date when there is one and to the day the
  -- document is issued when there is not, which is what makes the same function
  -- serve a leaver's experience certificate and a serving member's.
  v_upto := coalesce(v_row.date_of_leaving, v_issued_on);
  v_years := extract(year from age(v_upto, v_row.date_of_joining))::integer;
  v_months := extract(month from age(v_upto, v_row.date_of_joining))::integer;

  return public.certificate_school_values(v_tenant_id) || jsonb_strip_nulls(jsonb_build_object(
    'staff.name', v_row.full_name,
    'staff.first_name', v_row.first_name,
    'staff.employee_code', v_row.employee_code,
    'staff.designation', v_row.designation,
    'staff.department', v_row.department,
    'staff.date_of_birth', to_char(v_row.date_of_birth, 'FMDD Mon YYYY'),
    'staff.gender', initcap(v_row.gender),
    'staff.blood_group', v_row.blood_group,
    'staff.address', v_row.address,
    'staff.status', initcap(v_row.status),

    'service.from', to_char(v_row.date_of_joining, 'FMDD Mon YYYY'),
    -- Null while somebody is still employed. A template that prints it is
    -- therefore un-issuable for a serving member of staff, which is the point.
    'service.to', to_char(v_row.date_of_leaving, 'FMDD Mon YYYY'),
    'service.reason', v_row.exit_reason,
    -- Both counts carried rather than a stem and a rule: English plurals are
    -- not derivable, and this prints on a document somebody keeps (`0196`).
    'service.length', case
      when v_years = 0 and v_months = 0 then 'less than a month'
      when v_years = 0 then v_months || (case when v_months = 1 then ' month' else ' months' end)
      when v_months = 0 then v_years || (case when v_years = 1 then ' year' else ' years' end)
      else v_years || (case when v_years = 1 then ' year, ' else ' years, ' end)
           || v_months || (case when v_months = 1 then ' month' else ' months' end)
    end,

    'date.issued', to_char(v_issued_on, 'FMDD Mon YYYY'),
    'serial', null
  )) || coalesce(p_extra, '{}'::jsonb);
end;
$$;

revoke all on function public.certificate_staff_snapshot(uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_staff_snapshot(uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Preview, dispatching on the template's subject
-- ---------------------------------------------------------------------------

drop function if exists public.certificate_preview(uuid, uuid, date, jsonb);

create function public.certificate_preview(
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
begin
  select * into v_t from public.certificate_templates where id = p_template_id;
  if v_t.id is null then
    raise exception 'No such certificate template';
  end if;

  -- The template decides which snapshot fills it. One field in, and the server
  -- resolves what it names.
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

  if v_t.subject = 'staff' then
    select st.status into v_status from public.staff st where st.id = p_subject_id;

    -- A sentence, not a refusal: the missing leaving date already refuses, and
    -- saying *why* is more use than saying it twice.
    if v_t.kind = 'experience' and v_status = 'active' then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'message', 'This person is still employed here, so there is no leaving '
                   'date to certify service up to. A service certificate is the '
                   'one for somebody still in post.'));
    end if;

    if v_t.kind in ('experience', 'service') and exists (
      select 1 from public.certificates c
      where c.staff_id = p_subject_id and c.kind = v_t.kind and c.status = 'issued'
    ) then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'message', format(
          'A %s certificate has already been issued to this person. Cancel it '
          'before issuing another, so there are never two live certificates '
          'with different numbers.', v_t.kind)));
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

  -- Not a refusal. Whether dues withhold a certificate is a school's policy and
  -- several boards forbid it outright.
  select b.balance into v_dues
  from public.fees_student_balances(null, false, array[p_subject_id]) b;

  if coalesce(v_dues, 0) > 0 then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
      'severity', 'warning',
      'message', format('%s is still outstanding on this student''s fee account.',
                        to_char(v_dues, 'FM9999999990.00'))));
  end if;

  if v_t.kind = 'transfer' then
    select st.status into v_status from public.students st where st.id = p_subject_id;
    if v_status <> 'active' then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'message', format('This student is already marked "%s".', v_status)));
    end if;

    if exists (
      select 1 from public.certificates c
      where c.student_id = p_subject_id and c.kind = 'transfer' and c.status = 'issued'
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

revoke all on function public.certificate_preview(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_preview(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Issue
-- ---------------------------------------------------------------------------

drop function if exists public.certificate_issue(uuid, uuid, date, jsonb);

create function public.certificate_issue(
  p_subject_id uuid,
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

  -- The same preview the person just looked at, recomputed here rather than
  -- trusted from the client: the screen is a convenience, this is the gate.
  v_preview := public.certificate_preview(p_subject_id, p_template_id, v_issued_on, p_extra);

  if not (v_preview ->> 'can_issue')::boolean then
    raise exception 'This certificate cannot be issued yet: %',
      ( select string_agg(p ->> 'message', ' ')
        from jsonb_array_elements(v_preview -> 'problems') p
        where p ->> 'severity' = 'error' );
  end if;

  -- Allocated before rendering, so a template that prints {{serial}} gets the
  -- real number rather than a hole. Gapless, per rule 6, from the same counter
  -- receipts and invoices use -- and **one counter for both kinds of subject**,
  -- because a college's certificate register is one register.
  v_serial := public.fees_next_document_number_for(v_tenant_id, v_session_id, 'certificate');

  if v_t.subject = 'staff' then
    v_snapshot := public.certificate_staff_snapshot(p_subject_id, v_issued_on, p_extra);
  else
    v_snapshot := public.certificate_snapshot(p_subject_id, v_issued_on, p_extra);
  end if;
  v_snapshot := v_snapshot || jsonb_build_object('serial', v_serial);
  v_body := public.certificate_render(v_t.body, v_snapshot);

  v_unresolved := public.certificate_placeholders(v_body);
  if array_length(v_unresolved, 1) is not null then
    raise exception 'Nothing filled: %', array_to_string(v_unresolved, ', ');
  end if;

  -- `subject` is deliberately not supplied: the BEFORE INSERT trigger from
  -- `0245` stamps it from the template, and the composite key plus the CHECK
  -- then refuse a row whose id does not match. The trigger populates; the
  -- constraint enforces.
  insert into public.certificates (
    tenant_id, session_id, student_id, staff_id,
    template_id, template_name, kind,
    serial_no, issued_on, issued_by,
    snapshot, body
  )
  values (
    v_tenant_id, v_session_id,
    case when v_t.subject = 'staff' then null else p_subject_id end,
    case when v_t.subject = 'staff' then p_subject_id else null end,
    v_t.id, v_t.name, v_t.kind,
    v_serial, v_issued_on, ( select auth.uid() ),
    v_snapshot, v_body
  )
  returning * into v_row;

  -- Issuing a leaving certificate *is* the act of the child leaving. Gated on
  -- the subject as well as the kind: a staff template must never reach into
  -- `students`, and `kind` alone would not stop it.
  if v_t.subject = 'student' and v_t.kind = 'transfer' then
    update public.students set status = 'transferred'
    where id = p_subject_id and status = 'active';
  end if;

  return v_row;
end;
$$;

revoke all on function public.certificate_issue(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_issue(uuid, uuid, date, jsonb) to authenticated;

commit;
