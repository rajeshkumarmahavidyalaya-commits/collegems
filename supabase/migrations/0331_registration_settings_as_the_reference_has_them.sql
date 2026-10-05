-- 0331: Registration settings as the reference has them.
--
-- The reference wizard's sixth step has five groups. 0330 built the success
-- message and some required fields; this builds the rest, each with the
-- reader that makes it true (0220: a setting nobody reads is an intention):
--
-- 1. Basic registration settings, on `admissions.online`:
--    - form_title: the heading of the public application form;
--    - notify_email / notify_phone: each online application is announced to
--      them, an email and an SMS, through the dispatcher (rule 10), never by
--      calling a provider;
--    - redirect_url: where the public form sends the family after it has
--      shown its success message.
--    admission_form returns the title and the redirect; admission_apply
--    announces. A failed announcement is not a failed application, so the
--    announcement is its own block and only warns.
--
-- 2. Registration options, `admissions.numbering`: the next admission number
--    is offered on the admission form (`next_admission_number`, a prefix and
--    the next number after the largest one with that prefix), and a blank roll
--    number becomes the next one in the section (`next_roll_number`). Both are
--    suggestions the unique index and the office still decide on. The
--    reference's "Auto-create invoices" is the fee heads' bill-on-admission
--    switch (0286), and needs nothing new.
--
-- 3. Required student information: `admissions.required_fields` gains the
--    reference's remaining switches: mandatory last name (on by default, which
--    is the form as it was), religion, caste, ID number, student photo, medical
--    complaint and country.
--
-- 4. Additional panels, `admissions.form_panels`: which optional sections the
--    admission form draws: parent details, a parent login invitation, a
--    student login invitation, transport, fees and a survey question.
--    Transport defaults on, the rest off, which is the form as it was.
--
-- 5. Religion, caste, an ID number, a medical note and "how did you hear about
--    us" have no column anywhere. They are not put on `people`: every staff
--    role reads `people` (rule 4 records a teacher reading 872 rows), and a
--    child's caste, religion, Aadhaar number and medical condition are not a
--    timetable's business. So they get `student_profiles`, one row per child,
--    readable by the administrator and the child's own family, and written by
--    the administrator. The absence of a teacher policy is the point.

begin;

-- ---------------------------------------------------------------------------
-- 5. The sensitive half of a child's record

create table public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  student_id uuid not null,
  religion text check (religion is null or length(religion) <= 60),
  caste text check (caste is null or length(caste) <= 80),
  id_number text check (id_number is null or length(id_number) <= 40),
  medical_notes text check (medical_notes is null or length(medical_notes) <= 1000),
  heard_from text check (heard_from is null or length(heard_from) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_profiles_student_fkey foreign key (tenant_id, student_id)
    references public.students (tenant_id, id),
  unique (tenant_id, student_id)
);

comment on table public.student_profiles is
  'A child''s religion, caste, ID number, medical note and how the family heard of the college (0331). Kept off people, which every staff role reads; readable by the administrator and the child''s own family only.';

create trigger set_updated_at before update on public.student_profiles
  for each row execute function public.set_updated_at();
create trigger audit_student_profiles after insert or update or delete on public.student_profiles
  for each row execute function public.audit_row_change();

alter table public.student_profiles enable row level security;

create policy "admins manage student_profiles" on public.student_profiles
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

create policy "parents view own children profiles" on public.student_profiles
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'parent'
         and exists (
           select 1 from public.guardian_student gs
           join public.user_profiles up on up.guardian_id = gs.guardian_id
           where up.id = (select auth.uid()) and gs.student_id = student_profiles.student_id));

create policy "students view own profile" on public.student_profiles
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = 'student'
         and student_id = (select up.student_id from public.user_profiles up where up.id = (select auth.uid())));

-- No teacher, accountant or librarian policy, deliberately: see the header.

-- ---------------------------------------------------------------------------
-- 1-4. The settings

update reference.settings_catalog
set fields = fields || '[
      {"name": "form_title", "type": "text", "label": "Registration form title"},
      {"name": "notify_email", "type": "email", "label": "Admin email for notifications"},
      {"name": "notify_phone", "type": "text", "label": "Admin phone for SMS notifications"},
      {"name": "redirect_url", "type": "url", "label": "Redirect URL after registration"}]'::jsonb,
    default_value = default_value || '{"form_title": null, "notify_email": null, "notify_phone": null, "redirect_url": null}'::jsonb
where key = 'admissions.online'
  and not exists (select 1 from jsonb_array_elements(fields) f where f ->> 'name' = 'form_title');

update reference.settings_catalog
set fields = fields || '[
      {"name": "last_name", "type": "boolean", "label": "Mandatory last name"},
      {"name": "religion", "type": "boolean", "label": "Religion"},
      {"name": "caste", "type": "boolean", "label": "Caste/Sub-caste"},
      {"name": "id_number", "type": "boolean", "label": "ID number/proof"},
      {"name": "student_photo", "type": "boolean", "label": "Student photo"},
      {"name": "medical", "type": "boolean", "label": "Medical complaint"},
      {"name": "country", "type": "boolean", "label": "Country"}]'::jsonb,
    default_value = default_value || '{"last_name": true, "religion": false, "caste": false, "id_number": false, "student_photo": false, "medical": false, "country": false}'::jsonb
where key = 'admissions.required_fields'
  and not exists (select 1 from jsonb_array_elements(fields) f where f ->> 'name' = 'religion');

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values
  (
    'admissions.form_panels',
    'Sections of the admission form',
    'Which optional sections the admission form shows: the parent''s details, '
    'an invitation for the parent or the student to sign in, transport, the fees '
    'the class pays, and how the family heard about the college.',
    'Front office',
    'object',
    '[{"name": "parent_details", "type": "boolean", "label": "Parent details panel"},
      {"name": "parent_login", "type": "boolean", "label": "Parent login panel"},
      {"name": "student_login", "type": "boolean", "label": "Student login panel"},
      {"name": "transport", "type": "boolean", "label": "Transport details"},
      {"name": "fees", "type": "boolean", "label": "Fees panel"},
      {"name": "survey", "type": "boolean", "label": "Survey panel"}]'::jsonb,
    '{"parent_details": false, "parent_login": false, "student_login": false, "transport": true, "fees": false, "survey": false}'::jsonb,
    false,
    'students.manage',
    106
  ),
  (
    'admissions.numbering',
    'Admission and roll numbers',
    'Offer the next admission number on the admission form, after the largest '
    'one that starts with the prefix; and give a student the next roll number in '
    'their section when the roll number is left blank.',
    'Front office',
    'object',
    '[{"name": "auto_admission_number", "type": "boolean", "label": "Auto-generate admission numbers"},
      {"name": "admission_prefix", "type": "text", "label": "Admission number prefix"},
      {"name": "auto_roll_number", "type": "boolean", "label": "Auto-generate roll numbers"}]'::jsonb,
    '{"auto_admission_number": false, "admission_prefix": null, "auto_roll_number": false}'::jsonb,
    false,
    'students.manage',
    107
  )
on conflict (key) do nothing;

insert into reference.notification_types (key, name, description, default_channels, stale_after)
values ('admissions.application', 'New online application',
        'Sent to the college''s registration email and phone when a family applies on the public form.',
        array['email', 'sms'], interval '2 days')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The next numbers

create or replace function public.next_admission_number()
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_setting jsonb;
  v_prefix text;
  v_max bigint;
  v_width integer;
begin
  if v_tenant is null then
    raise exception 'No tenant in session' using errcode = '42501';
  end if;
  if not public.role_has_permission('students.manage') then
    raise exception 'Admitting a student needs students.manage.' using errcode = '42501';
  end if;
  v_setting := public.setting_value('admissions.numbering');
  v_prefix := coalesce(btrim(v_setting ->> 'admission_prefix'), '');

  select max(substr(s.admission_number, length(v_prefix) + 1)::bigint),
         max(length(s.admission_number) - length(v_prefix))
  into v_max, v_width
  from public.students s
  where left(s.admission_number, length(v_prefix)) = v_prefix
    and substr(s.admission_number, length(v_prefix) + 1) ~ '^[0-9]{1,15}$';

  return v_prefix || lpad((coalesce(v_max, 0) + 1)::text, greatest(coalesce(v_width, 4), 1), '0');
end;
$$;

comment on function public.next_admission_number() is
  'The admission number to offer next: the prefix from admissions.numbering and one more than the largest number after it (0331). A suggestion; the unique index decides. INVOKER, gated on students.manage.';

revoke all on function public.next_admission_number() from public, anon;
grant execute on function public.next_admission_number() to authenticated;

create or replace function public.next_roll_number(p_section_id uuid)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select (coalesce(max(e.roll_number::bigint), 0) + 1)::text
  from public.enrolments e
  where e.section_id = p_section_id
    and e.roll_number ~ '^[0-9]{1,15}$'
$$;

comment on function public.next_roll_number(uuid) is
  'One more than the largest numeric roll number in a section (0331), for admissions.numbering.auto_roll_number. INVOKER over enrolments'' policies.';

revoke all on function public.next_roll_number(uuid) from public, anon;
grant execute on function public.next_roll_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The public form's title and redirect, and the announcement

create or replace function public.admission_form(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_setting jsonb;
  v_session_id uuid;
begin
  select * into v_tenant from public.tenants t
  where t.slug = lower(btrim(coalesce(p_slug, '')));
  if v_tenant.id is null or not v_tenant.is_active then
    return null;
  end if;

  v_setting := public.setting_value_for(v_tenant.id, 'admissions.online');
  if not coalesce((v_setting ->> 'enabled')::boolean, false) then
    return null;
  end if;

  v_session_id := public.current_session_id(v_tenant.id);
  if v_session_id is null then
    return null;
  end if;

  -- The projection is the whole of what an anonymous caller learns about a
  -- college: its name, its year's name, its class levels and what it chose to
  -- say on its own form. No count, no staff, and never the notification
  -- addresses, which are the office's and not the applicant's.
  return jsonb_build_object(
    'college', v_tenant.name,
    'slug', v_tenant.slug,
    'session', (select s.name from public.academic_sessions s where s.id = v_session_id),
    'note', nullif(btrim(coalesce(v_setting ->> 'note', '')), ''),
    'success_message', nullif(btrim(coalesce(v_setting ->> 'success_message', '')), ''),
    'form_title', nullif(btrim(coalesce(v_setting ->> 'form_title', '')), ''),
    'redirect_url', case when coalesce(v_setting ->> 'redirect_url', '') ~ '^https?://[^ ]+$'
                         then v_setting ->> 'redirect_url' end,
    'class_levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name)
                       order by cl.sequence, cl.name, cl.id)
      from public.class_levels cl
      where cl.tenant_id = v_tenant.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admission_apply(p_slug text, p_application jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_setting jsonb;
  v_session_id uuid;
  v_per_hour integer;
  v_recent integer;
  v_first text := btrim(coalesce(p_application ->> 'first_name', ''));
  v_last text := btrim(coalesce(p_application ->> 'last_name', ''));
  v_dob_text text := btrim(coalesce(p_application ->> 'date_of_birth', ''));
  v_dob date;
  v_gender text := nullif(btrim(coalesce(p_application ->> 'gender', '')), '');
  v_class_text text := btrim(coalesce(p_application ->> 'class_level_id', ''));
  v_class uuid;
  v_contact text := btrim(coalesce(p_application ->> 'contact_name', ''));
  v_phone text := nullif(btrim(coalesce(p_application ->> 'contact_phone', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_application ->> 'contact_email', '')), ''));
  v_relationship text := nullif(btrim(coalesce(p_application ->> 'relationship', '')), '');
  v_notes text := nullif(btrim(coalesce(p_application ->> 'notes', '')), '');
  v_existing text;
  v_number text;
  v_notify_email text;
  v_notify_phone text;
  v_class_name text;
  v_subject text;
  v_long text;
  v_short text;
  v_notification_id uuid;
begin
  -- One sentence for every reason the college cannot be applied to, for the
  -- same reason admission_form returns one null.
  select * into v_tenant from public.tenants t
  where t.slug = lower(btrim(coalesce(p_slug, '')));
  if v_tenant.id is not null then
    v_setting := public.setting_value_for(v_tenant.id, 'admissions.online');
    v_session_id := public.current_session_id(v_tenant.id);
  end if;
  if v_tenant.id is null
     or not v_tenant.is_active
     or not coalesce((v_setting ->> 'enabled')::boolean, false)
     or v_session_id is null then
    raise exception 'This college is not taking applications online at the moment.';
  end if;

  -- ------------------------------------------------ the fields, each bounded --
  if v_first = '' then
    raise exception 'Enter the child''s first name.';
  end if;
  if length(v_first) > 80 or length(v_last) > 80 then
    raise exception 'A name can be at most 80 characters.';
  end if;
  if v_contact = '' then
    raise exception 'Enter the name of the person the college should contact.';
  end if;
  if length(v_contact) > 120 then
    raise exception 'The contact''s name can be at most 120 characters.';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Enter a phone number or an email address, or the college cannot reply.';
  end if;
  if v_phone is not null and v_phone !~ '^[0-9+() -]{6,20}$' then
    raise exception 'That phone number does not look right. Use digits, spaces and + only.';
  end if;
  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'That email address does not look right.';
  end if;
  if v_relationship is not null and length(v_relationship) > 40 then
    raise exception 'The relationship can be at most 40 characters.';
  end if;
  if v_notes is not null and length(v_notes) > 1000 then
    raise exception 'The message can be at most 1,000 characters.';
  end if;
  if v_gender is not null and v_gender not in ('male', 'female', 'other', 'undisclosed') then
    raise exception 'Choose one of the options given for gender.';
  end if;

  if v_dob_text <> '' then
    if v_dob_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'That date of birth is not a real date.';
    end if;
    begin
      v_dob := v_dob_text::date;
    exception when others then
      raise exception 'That date of birth is not a real date.';
    end;
    if v_dob > current_date or v_dob < current_date - interval '100 years' then
      raise exception 'That date of birth is not a real date.';
    end if;
  end if;

  -- A class level from another college would be refused by the composite
  -- foreign key, in words nobody applying should read. Checked first for the
  -- message, not for the enforcement.
  if v_class_text <> '' then
    if v_class_text !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'Choose a class from the list.';
    end if;
    v_class := v_class_text::uuid;
    if not exists (
      select 1 from public.class_levels cl
      where cl.tenant_id = v_tenant.id and cl.id = v_class
    ) then
      raise exception 'Choose a class from the list.';
    end if;
  end if;

  -- ---------------------------------------------- one at a time, per college --
  -- The hourly count is a rule about how many other rows exist, so it is
  -- checked under a lock or two requests racing both see room for one more.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admission_apply:' || v_tenant.id::text, 0)
  );

  -- The same child and the same contact inside a day is the same application
  -- sent twice. Checked before the limit, so pressing the button again never
  -- counts against the college's hour.
  select e.enquiry_number into v_existing
  from public.enquiries e
  where e.tenant_id = v_tenant.id
    and e.session_id = v_session_id
    and e.source = 'website'
    and e.created_at > now() - interval '1 day'
    and lower(e.applicant_first_name) = lower(v_first)
    and lower(e.applicant_last_name) = lower(v_last)
    and e.contact_phone is not distinct from v_phone
    and lower(e.contact_email) is not distinct from v_email
  order by e.created_at
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('reference', v_existing, 'duplicate', true, 'college', v_tenant.name);
  end if;

  v_per_hour := greatest(1, least(coalesce((v_setting ->> 'per_hour')::integer, 30), 500));
  select count(*) into v_recent
  from public.enquiries e
  where e.tenant_id = v_tenant.id
    and e.source = 'website'
    and e.created_at > now() - interval '1 hour';
  if v_recent >= v_per_hour then
    raise exception 'This college has received a lot of applications in the last hour. Please try again later, or contact the college directly.';
  end if;

  v_number := public.fees_next_document_number_for(v_tenant.id, v_session_id, 'enquiry');

  insert into public.enquiries (
    tenant_id, session_id, enquiry_number,
    applicant_first_name, applicant_last_name, date_of_birth, gender,
    class_level_id, contact_name, contact_phone, contact_email, relationship,
    source, status, next_follow_up_on, notes
  )
  values (
    v_tenant.id, v_session_id, v_number,
    v_first, v_last, v_dob, v_gender,
    v_class, v_contact, v_phone, v_email, v_relationship,
    -- Decided here, never by the caller.
    'website', 'new',
    -- Due today where the college is, so it is at the top of the office's list
    -- the morning it arrives rather than waiting to be noticed.
    (now() at time zone coalesce(v_tenant.timezone, 'Asia/Kolkata'))::date,
    v_notes
  );

  get diagnostics v_recent = row_count;
  if v_recent <> 1 then
    raise exception 'The application could not be saved. Please try again.';
  end if;

  -- ------------------------------------------- tell the college (0331) --
  -- To the addresses the college chose, through the dispatcher (rule 10).
  -- The words are this function's, never the applicant's beyond their own
  -- name and contact, and the hourly limit above bounds how many it sends.
  -- A failed announcement is not a failed application: its own block, and a
  -- warning in the log rather than an error to a family.
  v_notify_email := lower(nullif(btrim(coalesce(v_setting ->> 'notify_email', '')), ''));
  v_notify_phone := nullif(btrim(coalesce(v_setting ->> 'notify_phone', '')), '');
  if v_notify_email is not null or v_notify_phone is not null then
    begin
      select cl.name into v_class_name from public.class_levels cl where cl.id = v_class;
      v_subject := format('New online application: %s', btrim(v_first || ' ' || v_last));
      v_long := format(
        E'%s has applied online to %s%s.\n\nReference: %s\nContact: %s%s%s\n\nOpen Inquiries to follow up.',
        btrim(v_first || ' ' || v_last),
        v_tenant.name,
        case when v_class_name is null then '' else ' for ' || v_class_name end,
        v_number,
        v_contact,
        case when v_phone is null then '' else ', ' || v_phone end,
        case when v_email is null then '' else ', ' || v_email end);
      v_short := format('%s: new application %s, %s. Contact %s.',
        v_tenant.name, v_number, btrim(v_first || ' ' || v_last), coalesce(v_phone, v_email));

      insert into public.notifications (
        tenant_id, session_id, event_key, subject, body, audience, payload, created_by)
      values (
        v_tenant.id, v_session_id, 'admissions.application', v_subject, v_long,
        jsonb_build_object('kind', 'address'),
        jsonb_build_object('reference', v_number), null)
      returning id into v_notification_id;

      insert into public.notification_deliveries (
        tenant_id, notification_id, recipient_user_id, channel, address, subject, body, status)
      select v_tenant.id, v_notification_id, null, x.ch, x.addr, v_subject, x.body, 'queued'
      from (values ('email', v_notify_email, v_long), ('sms', v_notify_phone, v_short)) as x(ch, addr, body)
      where x.addr is not null;
    exception when others then
      raise warning 'admission_apply: application % saved, announcement not queued: %', v_number, sqlerrm;
    end;
  end if;

  return jsonb_build_object('reference', v_number, 'duplicate', false, 'college', v_tenant.name);
end;
$$;

commit;
