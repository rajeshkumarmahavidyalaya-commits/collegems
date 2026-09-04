-- ---------------------------------------------------------------------------
-- Front office — the write paths
-- ---------------------------------------------------------------------------

-- Enquiry and pass numbers are gapless per tenant per session, from the same
-- counter that issues receipts. Rule 6's instinct applies to any document a
-- person is handed and may later refer to, not only to money: "enquiry 41" has
-- to mean one enquiry.
--
-- `fees_next_document_number` already does the locking; this only widens which
-- kinds it will issue, which migration 0098 permitted.
create or replace function public.front_office_next_number(p_kind text)
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select public.fees_next_document_number(p_kind)
$$;

revoke all on function public.front_office_next_number(text) from public, anon;
grant execute on function public.front_office_next_number(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording an enquiry
-- ---------------------------------------------------------------------------

create or replace function public.enquiry_create(
  p_applicant jsonb,
  p_contact jsonb,
  p_class_level_id uuid default null,
  p_source text default 'walk_in',
  p_assigned_staff_id uuid default null,
  p_next_follow_up_on date default null,
  p_notes text default null
)
returns public.enquiries
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.enquiries;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if btrim(coalesce(p_applicant ->> 'first_name', '')) = '' then
    raise exception 'An enquiry needs the child''s name';
  end if;
  if btrim(coalesce(p_contact ->> 'name', '')) = '' then
    raise exception 'An enquiry needs somebody to call back';
  end if;
  -- A contact with neither a phone nor an email is an enquiry nobody can
  -- follow up, which is the one thing this module exists to prevent.
  if btrim(coalesce(p_contact ->> 'phone', '')) = ''
     and btrim(coalesce(p_contact ->> 'email', '')) = '' then
    raise exception 'Record a phone number or an email address, or nobody can follow this up';
  end if;

  insert into public.enquiries (
    tenant_id, session_id, enquiry_number,
    applicant_first_name, applicant_last_name, date_of_birth, gender,
    class_level_id, contact_name, contact_phone, contact_email, relationship,
    source, assigned_staff_id, next_follow_up_on, notes
  )
  values (
    v_tenant_id, v_session_id, public.fees_next_document_number('enquiry'),
    btrim(p_applicant ->> 'first_name'),
    btrim(coalesce(p_applicant ->> 'last_name', '')),
    nullif(p_applicant ->> 'date_of_birth', '')::date,
    nullif(p_applicant ->> 'gender', ''),
    p_class_level_id,
    btrim(p_contact ->> 'name'),
    nullif(btrim(coalesce(p_contact ->> 'phone', '')), ''),
    nullif(btrim(coalesce(p_contact ->> 'email', '')), ''),
    nullif(btrim(coalesce(p_contact ->> 'relationship', '')), ''),
    coalesce(p_source, 'walk_in'),
    p_assigned_staff_id,
    p_next_follow_up_on,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.enquiry_create(jsonb, jsonb, uuid, text, uuid, date, text) from public, anon;
grant execute on function public.enquiry_create(jsonb, jsonb, uuid, text, uuid, date, text) to authenticated;

-- Log a contact and move the funnel in one call. Two writes that must not come
-- apart: a status that changed with no note saying why is exactly the record
-- this module exists to keep.
create or replace function public.enquiry_log_follow_up(
  p_enquiry_id uuid,
  p_note text,
  p_channel text default 'phone',
  p_outcome text default null,
  p_next_follow_up_on date default null,
  p_lost_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_enquiry public.enquiries;
  v_id uuid;
begin
  select * into v_enquiry from public.enquiries e where e.id = p_enquiry_id;
  if v_enquiry.id is null then
    raise exception 'That enquiry does not exist';
  end if;

  if btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say what was discussed -- an empty note records nothing';
  end if;

  -- `admitted` is not something a note can claim. It means a student row
  -- exists, and only `enquiry_convert` can make that true.
  if p_outcome = 'admitted' then
    raise exception 'Mark an enquiry admitted by admitting the child, not by logging a note';
  end if;

  if p_outcome = 'lost' and btrim(coalesce(p_lost_reason, '')) = '' then
    raise exception 'Say why it was lost -- a school that cannot say why it loses families cannot fix it';
  end if;

  if v_enquiry.status = 'admitted' then
    raise exception 'This enquiry became a student on %, so its outcome is settled',
      v_enquiry.converted_at::date;
  end if;

  insert into public.enquiry_follow_ups (
    tenant_id, enquiry_id, channel, note, outcome, recorded_by
  )
  values (
    v_tenant_id, p_enquiry_id, coalesce(p_channel, 'phone'),
    btrim(p_note), p_outcome, auth.uid()
  )
  returning id into v_id;

  update public.enquiries
  set status = coalesce(p_outcome, status),
      next_follow_up_on = case
        when p_outcome = 'lost' then null
        else coalesce(p_next_follow_up_on, next_follow_up_on)
      end,
      lost_reason = case when p_outcome = 'lost' then btrim(p_lost_reason) else lost_reason end
  where id = p_enquiry_id;

  return v_id;
end;
$$;

revoke all on function public.enquiry_log_follow_up(uuid, text, text, text, date, text) from public, anon;
grant execute on function public.enquiry_log_follow_up(uuid, text, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Becoming a student
-- ---------------------------------------------------------------------------

-- The moment the funnel meets the identity model.
--
-- It deliberately **calls `admit_student`** rather than writing `people`,
-- `students` and `enrolments` itself. There is one admission path in this
-- system and a child arriving through the front office is not a different kind
-- of child -- a second insert path is how two admission numbering schemes and
-- two sets of defaults end up in one database.
--
-- Idempotent by construction: `enquiries_one_per_student` is a partial unique
-- index, and `enquiries_admitted_chk` means the status cannot say `admitted`
-- without a student to point at. A retried conversion after a timeout finds
-- the enquiry already converted and says so.
create or replace function public.enquiry_convert(
  p_enquiry_id uuid,
  p_admission_number text,
  p_section_id uuid default null,
  p_roll_number text default null,
  p_admission_date date default null
)
returns public.students
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_enquiry public.enquiries;
  v_student public.students;
begin
  select * into v_enquiry from public.enquiries e where e.id = p_enquiry_id;
  if v_enquiry.id is null then
    raise exception 'That enquiry does not exist';
  end if;

  if v_enquiry.converted_student_id is not null then
    raise exception 'Enquiry % was already admitted on %',
      v_enquiry.enquiry_number, v_enquiry.converted_at::date;
  end if;

  if v_enquiry.status = 'lost' then
    raise exception 'Enquiry % is marked lost (%). Reopen it before admitting.',
      v_enquiry.enquiry_number, v_enquiry.lost_reason;
  end if;

  v_student := public.admit_student(
    jsonb_build_object(
      'first_name', v_enquiry.applicant_first_name,
      'last_name', v_enquiry.applicant_last_name,
      'date_of_birth', v_enquiry.date_of_birth,
      'gender', v_enquiry.gender,
      'phone', v_enquiry.contact_phone,
      'email', v_enquiry.contact_email
    ),
    p_admission_number,
    coalesce(p_admission_date, current_date),
    p_section_id,
    p_roll_number
  );

  update public.enquiries
  set status = 'admitted',
      converted_student_id = v_student.id,
      converted_at = now(),
      next_follow_up_on = null
  where id = p_enquiry_id;

  -- The conversion is part of the trail, not a silent state change.
  insert into public.enquiry_follow_ups (
    tenant_id, enquiry_id, channel, note, outcome, recorded_by
  )
  values (
    v_enquiry.tenant_id, p_enquiry_id, 'other',
    'Admitted as ' || p_admission_number, 'admitted', auth.uid()
  );

  return v_student;
end;
$$;

revoke all on function public.enquiry_convert(uuid, text, uuid, text, date) from public, anon;
grant execute on function public.enquiry_convert(uuid, text, uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading the funnel
-- ---------------------------------------------------------------------------

create or replace function public.enquiry_board(p_session_id uuid default null)
returns table (
  id uuid,
  enquiry_number text,
  applicant_name text,
  class_level_name text,
  contact_name text,
  contact_phone text,
  contact_email text,
  source text,
  status text,
  assigned_name text,
  next_follow_up_on date,
  overdue boolean,
  follow_up_count integer,
  last_contact timestamptz,
  lost_reason text,
  converted_student_id uuid,
  created_at timestamptz
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.enquiry_number,
    (e.applicant_first_name || ' ' || e.applicant_last_name)::text,
    cl.name,
    e.contact_name,
    e.contact_phone,
    e.contact_email,
    e.source,
    e.status,
    (sp.first_name || ' ' || sp.last_name)::text,
    e.next_follow_up_on,
    -- The number the front office cares about at 9am.
    (e.next_follow_up_on is not null
      and e.next_follow_up_on < current_date
      and e.status in ('new', 'contacted', 'visited', 'applied')),
    coalesce(f.n, 0)::integer,
    f.last_at,
    e.lost_reason,
    e.converted_student_id,
    e.created_at
  from public.enquiries e
  left join public.class_levels cl on cl.id = e.class_level_id
  left join public.staff s on s.id = e.assigned_staff_id
  left join public.people sp on sp.id = s.person_id
  left join lateral (
    select count(*) as n, max(happened_at) as last_at
    from public.enquiry_follow_ups fu
    where fu.enquiry_id = e.id
  ) f on true
  where p_session_id is null or e.session_id = p_session_id
  order by
    (e.status in ('admitted', 'lost')),
    e.next_follow_up_on nulls last,
    e.created_at desc
$$;

revoke all on function public.enquiry_board(uuid) from public, anon;
grant execute on function public.enquiry_board(uuid) to authenticated;

-- The funnel as counts, which is the only question a head teacher asks of it.
create or replace function public.enquiry_funnel(p_session_id uuid default null)
returns table (status text, count integer, share numeric)
language sql
stable
set search_path = public, extensions
as $$
  with rows as (
    select e.status
    from public.enquiries e
    where p_session_id is null or e.session_id = p_session_id
  ),
  total as (select count(*)::numeric as n from rows)
  select
    s.status,
    count(r.status)::integer,
    case when (select n from total) = 0 then 0
         else round(100.0 * count(r.status) / (select n from total), 1) end
  from (values ('new'), ('contacted'), ('visited'), ('applied'), ('admitted'), ('lost'))
    as s(status)
  left join rows r on r.status = s.status
  group by s.status
  order by array_position(
    array['new', 'contacted', 'visited', 'applied', 'admitted', 'lost'], s.status)
$$;

revoke all on function public.enquiry_funnel(uuid) from public, anon;
grant execute on function public.enquiry_funnel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

create or replace function public.visitor_check_in(
  p_visitor_name text,
  p_purpose text,
  p_phone text default null,
  p_organisation text default null,
  p_host_staff_id uuid default null,
  p_host_note text default null,
  p_student_id uuid default null,
  p_id_proof_kind text default null,
  p_id_proof_last4 text default null,
  p_vehicle_number text default null
)
returns public.visitors
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.visitors;
  v_open record;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session for this tenant';
  end if;

  if btrim(coalesce(p_visitor_name, '')) = '' then
    raise exception 'A pass needs a name';
  end if;
  if btrim(coalesce(p_purpose, '')) = '' then
    raise exception 'Say why they are here -- "who is in the building and why" is the whole register';
  end if;

  begin
    insert into public.visitors (
      tenant_id, session_id, pass_number, visitor_name, phone, organisation,
      purpose, host_staff_id, host_note, student_id,
      id_proof_kind, id_proof_last4, vehicle_number, checked_in_by
    )
    values (
      v_tenant_id, v_session_id, public.fees_next_document_number('visitor_pass'),
      btrim(p_visitor_name),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_organisation, '')), ''),
      btrim(p_purpose),
      p_host_staff_id,
      nullif(btrim(coalesce(p_host_note, '')), ''),
      p_student_id,
      nullif(btrim(coalesce(p_id_proof_kind, '')), ''),
      nullif(btrim(coalesce(p_id_proof_last4, '')), ''),
      nullif(btrim(coalesce(p_vehicle_number, '')), ''),
      auth.uid()
    )
    returning * into v_row;
  exception when unique_violation then
    -- From `visitors_one_open_visit`. Naming the existing pass turns a refusal
    -- into an instruction.
    select pass_number, checked_in_at into v_open
    from public.visitors
    where tenant_id = v_tenant_id and phone = btrim(p_phone) and checked_out_at is null
    limit 1;

    raise exception
      'That number is already signed in on pass % since %. Sign them out first.',
      coalesce(v_open.pass_number, '?'),
      to_char(coalesce(v_open.checked_in_at, now()), 'HH24:MI');
  end;

  return v_row;
end;
$$;

revoke all on function public.visitor_check_in(text, text, text, text, uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.visitor_check_in(text, text, text, text, uuid, text, uuid, text, text, text) to authenticated;

create or replace function public.visitor_check_out(p_visitor_id uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_row public.visitors;
begin
  select * into v_row from public.visitors v where v.id = p_visitor_id;
  if v_row.id is null then
    raise exception 'That pass does not exist';
  end if;
  if v_row.checked_out_at is not null then
    raise exception 'Pass % was already signed out at %',
      v_row.pass_number, to_char(v_row.checked_out_at, 'HH24:MI');
  end if;

  update public.visitors
  set checked_out_at = now(), checked_out_by = auth.uid()
  where id = p_visitor_id;

  return now();
end;
$$;

revoke all on function public.visitor_check_out(uuid) from public, anon;
grant execute on function public.visitor_check_out(uuid) to authenticated;

-- Who is in the building, and who was. Bounded: the open list is short by
-- construction, and the history is capped.
create or replace function public.visitor_register(
  p_open_only boolean default true,
  p_limit integer default 200
)
returns table (
  id uuid,
  pass_number text,
  visitor_name text,
  phone text,
  organisation text,
  purpose text,
  host_name text,
  student_name text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  minutes_inside integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    v.id, v.pass_number, v.visitor_name, v.phone, v.organisation, v.purpose,
    coalesce((hp.first_name || ' ' || hp.last_name), v.host_note)::text,
    (sp.first_name || ' ' || sp.last_name)::text,
    v.checked_in_at,
    v.checked_out_at,
    (extract(epoch from (coalesce(v.checked_out_at, now()) - v.checked_in_at)) / 60)::integer
  from public.visitors v
  left join public.staff h on h.id = v.host_staff_id
  left join public.people hp on hp.id = h.person_id
  left join public.students st on st.id = v.student_id
  left join public.people sp on sp.id = st.person_id
  where (not p_open_only or v.checked_out_at is null)
  order by v.checked_in_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;

revoke all on function public.visitor_register(boolean, integer) from public, anon;
grant execute on function public.visitor_register(boolean, integer) to authenticated;
