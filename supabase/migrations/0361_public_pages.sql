-- 0361: a college's public pages.
--
-- The reference's public site, beyond the admission form (0268):
-- an admission enquiry, a staff application, certificate verification, the
-- exam timetable, admit cards and results. Each is reached by the college's
-- slug with no login, so each is shaped by what 0267 and 0268 settled:
--
--   * every one is SECURITY DEFINER, granted to anon on purpose and named
--     with its reason in definer_guard_violations(); no table policy is
--     opened to anon;
--   * every one is **off until the college switches it on** (`public.pages`),
--     and the timetable and admit cards also need the exam itself marked
--     public (`exams.public_timetable`), because a draft exam's dates are a
--     draft;
--   * every refusal is one null: an unknown slug, a page switched off, a wrong
--     date of birth and a certificate that does not exist look the same, so
--     no page is a way to ask which is true (0209);
--   * a lookup needs two facts the person holds, never one a stranger could
--     step through: a certificate's serial *and* its holder's date of birth; an
--     admission number *and* a date of birth. Serials and admission numbers are
--     sequential;
--   * every lookup and every application is counted per college per hour
--     under an advisory lock (`public_page_hits`), because an endpoint anybody
--     can call is an endpoint somebody will call ten thousand times.
--
-- What each page shows is the projection written here and nothing else:
-- names, classes, dates and marks for the one child whose two facts were
-- given; a certificate's kind, date and whether it stands.
--
-- The staff application is the one new table. A public applicant writes it
-- through `public_staff_apply`; the office reads and decides through RLS and a
-- column grant, and "hire" is the existing add-staff form, opened pre-filled,
-- which links the application to the record it made.

begin;

-- ------------------------------------------------------------ the switches --

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'public.pages',
  'Public pages',
  'Pages anybody can open without signing in, at /college/<your college''s '
  'short name>. Each is off until switched on here. The exam timetable and '
  'admit cards also show only exams marked public on the exam''s own page. '
  'Lookups need an admission number or certificate number and a date of birth.',
  'Front office',
  'object',
  '[{"name": "enquiry", "type": "boolean", "label": "Admission enquiry form"},
    {"name": "staff_application", "type": "boolean", "label": "Staff application form"},
    {"name": "certificate_check", "type": "boolean", "label": "Certificate verification"},
    {"name": "exam_timetable", "type": "boolean", "label": "Exam timetable"},
    {"name": "admit_cards", "type": "boolean", "label": "Admit card lookup"},
    {"name": "results", "type": "boolean", "label": "Result lookup"},
    {"name": "lookups_per_hour", "type": "number", "label": "Most lookups in one hour"},
    {"name": "applications_per_hour", "type": "number", "label": "Most enquiries and staff applications in one hour"},
    {"name": "note", "type": "text", "label": "Note shown on the public pages"}]'::jsonb,
  '{"enquiry": false, "staff_application": false, "certificate_check": false, "exam_timetable": false, "admit_cards": false, "results": false, "lookups_per_hour": 120, "applications_per_hour": 20, "note": null}'::jsonb,
  false,
  'frontoffice.manage',
  101
);

alter table public.exams add column public_timetable boolean not null default false;
comment on column public.exams.public_timetable is
  'Shown on the college''s public exam timetable and admit card lookup, when those pages are switched on (0361).';

-- ------------------------------------------------------------- the counter --

create table public.public_page_hits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('lookup', 'enquiry', 'staff_application')),
  created_at timestamptz not null default now()
);
create index public_page_hits_window_idx on public.public_page_hits (tenant_id, kind, created_at desc);

comment on table public.public_page_hits is
  'One row per public lookup or application, for the per-college hourly limits (0361). The row is the record: append-only, written once, so exempt from the audit trigger (rule 9).';

alter table public.public_page_hits enable row level security;
create policy "admins read public_page_hits" on public.public_page_hits
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');
revoke insert, update, delete on public.public_page_hits from authenticated, anon;

-- The college a public page belongs to, if that page is switched on.
create function public.public_page_tenant(p_slug text, p_page text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select t.id
  from public.tenants t
  where t.slug = lower(btrim(coalesce(p_slug, '')))
    and t.is_active
    and coalesce((public.setting_value_for(t.id, 'public.pages') ->> p_page)::boolean, false)
$$;

-- Count one use and say whether it is within the hour's limit. Under a lock,
-- because the limit is a rule about how many other rows exist (rule 4).
create function public.public_page_take(p_tenant uuid, p_kind text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_setting jsonb := public.setting_value_for(p_tenant, 'public.pages');
  v_limit integer;
  v_used integer;
begin
  v_limit := greatest(1, least(coalesce(
    (v_setting ->> case when p_kind = 'lookup' then 'lookups_per_hour' else 'applications_per_hour' end)::integer,
    case when p_kind = 'lookup' then 120 else 20 end), 2000));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public_page_take:' || p_tenant::text || ':' || p_kind, 0));
  select count(*) into v_used from public.public_page_hits h
  where h.tenant_id = p_tenant and h.kind = p_kind and h.created_at > now() - interval '1 hour';
  if v_used >= v_limit then
    return false;
  end if;
  insert into public.public_page_hits (tenant_id, kind) values (p_tenant, p_kind);
  return true;
end;
$$;

revoke all on function public.public_page_tenant(text, text) from public, anon, authenticated;
revoke all on function public.public_page_take(uuid, text) from public, anon, authenticated;

-- ------------------------------------- who sits a paper, for a named college --

-- student_takes_subject reads the college from the caller's token, and a public
-- visitor has none: asked as-is it would say every child takes every elective.
-- One body with the college as a parameter, and the old name as its wrapper
-- (rule 6's notify_send_for shape; safe because its protection is a tenant
-- check, nothing narrower).
create function public.student_takes_subject_for(
  p_tenant_id uuid, p_student_id uuid, p_subject_id uuid, p_session_id uuid, p_class_level_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    not exists (
      select 1
      from public.subject_group_options o
      join public.subject_groups g on g.id = o.group_id
      where g.tenant_id = p_tenant_id
        and o.subject_id = p_subject_id
        and g.session_id = p_session_id
        and g.class_level_id = p_class_level_id
    )
    or exists (
      select 1
      from public.student_subject_choices c
      join public.subject_groups g on g.id = c.group_id
      where c.tenant_id = p_tenant_id
        and c.student_id = p_student_id
        and c.subject_id = p_subject_id
        and g.session_id = p_session_id
        and g.class_level_id = p_class_level_id
    );
$$;
revoke all on function public.student_takes_subject_for(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.student_takes_subject(
  p_student_id uuid, p_subject_id uuid, p_session_id uuid, p_class_level_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.student_takes_subject_for(public.current_tenant_id(), p_student_id, p_subject_id, p_session_id, p_class_level_id)
$$;

-- --------------------------------------------------------------- the index --

create function public.public_college(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_pages jsonb;
  v_apply boolean;
begin
  select * into v_tenant from public.tenants t
  where t.slug = lower(btrim(coalesce(p_slug, ''))) and t.is_active;
  if v_tenant.id is null then
    return null;
  end if;
  v_pages := public.setting_value_for(v_tenant.id, 'public.pages');
  v_apply := coalesce((public.setting_value_for(v_tenant.id, 'admissions.online') ->> 'enabled')::boolean, false);
  if not (v_apply
          or coalesce((v_pages ->> 'enquiry')::boolean, false)
          or coalesce((v_pages ->> 'staff_application')::boolean, false)
          or coalesce((v_pages ->> 'certificate_check')::boolean, false)
          or coalesce((v_pages ->> 'exam_timetable')::boolean, false)
          or coalesce((v_pages ->> 'admit_cards')::boolean, false)
          or coalesce((v_pages ->> 'results')::boolean, false)) then
    return null;
  end if;
  return jsonb_build_object(
    'college', v_tenant.name,
    'slug', v_tenant.slug,
    'session', (select s.name from public.academic_sessions s
                where s.tenant_id = v_tenant.id and s.is_current limit 1),
    'note', nullif(btrim(coalesce(v_pages ->> 'note', '')), ''),
    'pages', jsonb_build_object(
      'apply', v_apply,
      'enquiry', coalesce((v_pages ->> 'enquiry')::boolean, false),
      'staff_application', coalesce((v_pages ->> 'staff_application')::boolean, false),
      'certificate_check', coalesce((v_pages ->> 'certificate_check')::boolean, false),
      'exam_timetable', coalesce((v_pages ->> 'exam_timetable')::boolean, false),
      'admit_cards', coalesce((v_pages ->> 'admit_cards')::boolean, false),
      'results', coalesce((v_pages ->> 'results')::boolean, false)
    ),
    'class_levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name) order by cl.sequence, cl.name, cl.id)
      from public.class_levels cl where cl.tenant_id = v_tenant.id
    ), '[]'::jsonb)
  );
end;
$$;

-- -------------------------------------------------------- the exam timetable --

create function public.public_exam_timetable(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.public_page_tenant(p_slug, 'exam_timetable');
  v_session uuid;
begin
  if v_tenant is null then
    return null;
  end if;
  select s.id into v_session from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current;
  return jsonb_build_object(
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'centre', e.centre,
        'papers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'class', cl.name || ' ' || sec.name,
            'subject', sub.name,
            'date', es.exam_date,
            'starts_at', ts.starts_at,
            'ends_at', ts.ends_at
          ) order by es.exam_date nulls last, ts.starts_at nulls last, cl.sequence, sec.name, sub.name)
          from public.exam_subjects es
          join public.sections sec on sec.id = es.section_id
          join public.class_levels cl on cl.id = sec.class_level_id
          join public.subjects sub on sub.id = es.subject_id
          left join public.time_slots ts on ts.id = es.time_slot_id
          where es.exam_id = e.id
        ), '[]'::jsonb)
      ) order by e.starts_on nulls last, e.name)
      from public.exams e
      where e.tenant_id = v_tenant and e.session_id = v_session and e.public_timetable
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------- the child, by two facts --

-- The student whose admission number and date of birth are both right, in a
-- college, or null. Internal: called by the lookups below.
create function public.public_student_match(p_tenant uuid, p_admission_number text, p_date_of_birth date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select st.id
  from public.students st
  join public.people p on p.id = st.person_id
  where st.tenant_id = p_tenant
    and lower(st.admission_number) = lower(btrim(coalesce(p_admission_number, '')))
    and p.date_of_birth = p_date_of_birth
  limit 1
$$;
revoke all on function public.public_student_match(uuid, text, date) from public, anon, authenticated;

create function public.public_admit_card(p_slug text, p_exam_id uuid, p_admission_number text, p_date_of_birth date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.public_page_tenant(p_slug, 'admit_cards');
  v_exam public.exams;
  v_student uuid;
  v_enrol record;
begin
  if v_tenant is null then
    return null;
  end if;
  if not public.public_page_take(v_tenant, 'lookup') then
    raise exception 'Too many lookups at this college in the last hour. Please try again later.';
  end if;
  select * into v_exam from public.exams e
  where e.id = p_exam_id and e.tenant_id = v_tenant and e.public_timetable;
  v_student := public.public_student_match(v_tenant, p_admission_number, p_date_of_birth);
  if v_exam.id is null or v_student is null then
    return null;
  end if;
  select en.section_id, en.roll_number, sec.class_level_id, cl.name || ' ' || sec.name as class_name
    into v_enrol
  from public.enrolments en
  join public.sections sec on sec.id = en.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  where en.student_id = v_student and en.session_id = v_exam.session_id
    and en.status in ('active', 'promoted', 'repeated')
  limit 1;
  if v_enrol.section_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'exam', v_exam.name,
    'centre', v_exam.centre,
    'student', (select btrim(concat_ws(' ', p.first_name, p.last_name)) from public.students st
                join public.people p on p.id = st.person_id where st.id = v_student),
    'admission_number', (select st.admission_number from public.students st where st.id = v_student),
    'class', v_enrol.class_name,
    'roll_number', v_enrol.roll_number,
    'papers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject', sub.name, 'date', es.exam_date, 'starts_at', ts.starts_at, 'ends_at', ts.ends_at,
        'room', sa.room_name, 'seat', sa.seat_no
      ) order by es.exam_date nulls last, ts.starts_at nulls last, sub.name)
      from public.exam_subjects es
      join public.subjects sub on sub.id = es.subject_id
      left join public.time_slots ts on ts.id = es.time_slot_id
      left join public.exam_seat_allocations sa
        on sa.exam_subject_id = es.id and sa.student_id = v_student and sa.run_status = 'published'
      where es.exam_id = v_exam.id and es.section_id = v_enrol.section_id
        and public.student_takes_subject_for(v_tenant, v_student, es.subject_id, v_exam.session_id, v_enrol.class_level_id)
    ), '[]'::jsonb)
  );
end;
$$;

create function public.public_results(p_slug text, p_admission_number text, p_date_of_birth date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.public_page_tenant(p_slug, 'results');
  v_student uuid;
  v_results jsonb;
begin
  if v_tenant is null then
    return null;
  end if;
  if not public.public_page_take(v_tenant, 'lookup') then
    raise exception 'Too many lookups at this college in the last hour. Please try again later.';
  end if;
  v_student := public.public_student_match(v_tenant, p_admission_number, p_date_of_birth);
  if v_student is null then
    return null;
  end if;
  -- Published results of the working year only: a result is public when the
  -- college published it, and an earlier year's is the family's to ask for.
  select jsonb_agg(jsonb_build_object(
      'exam', e.name,
      'published_on', (r.published_at at time zone 'UTC')::date,
      'total', r.total_marks, 'max', r.max_marks, 'percentage', r.percentage,
      'grade', r.grade, 'result', r.result,
      'rank', r.rank_in_cohort, 'cohort', r.cohort_size,
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'subject', d ->> 'subject', 'obtained', d -> 'obtained', 'max', d -> 'max',
          'passed', d -> 'passed', 'absent', d -> 'absent'))
        from jsonb_array_elements(r.detail) d
      ), '[]'::jsonb)
    ) order by r.published_at desc, e.name)
    into v_results
  from public.exam_results r
  join public.exams e on e.id = r.exam_id
  where r.student_id = v_student and r.tenant_id = v_tenant and e.status = 'published'
    and r.session_id = (select s.id from public.academic_sessions s where s.tenant_id = v_tenant and s.is_current);
  if v_results is null then
    return null;
  end if;
  return jsonb_build_object(
    'student', (select btrim(concat_ws(' ', p.first_name, p.last_name)) from public.students st
                join public.people p on p.id = st.person_id where st.id = v_student),
    'results', v_results
  );
end;
$$;

-- ---------------------------------------------------- a certificate, checked --

create function public.public_certificate_check(p_slug text, p_serial text, p_date_of_birth date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.public_page_tenant(p_slug, 'certificate_check');
  v_cert public.certificates;
  v_name text;
  v_dob date;
begin
  if v_tenant is null then
    return null;
  end if;
  if not public.public_page_take(v_tenant, 'lookup') then
    raise exception 'Too many lookups at this college in the last hour. Please try again later.';
  end if;
  select * into v_cert from public.certificates c
  where c.tenant_id = v_tenant and upper(c.serial_no) = upper(btrim(coalesce(p_serial, '')));
  if v_cert.id is null then
    return null;
  end if;
  select btrim(concat_ws(' ', p.first_name, p.last_name)), p.date_of_birth into v_name, v_dob
  from public.people p
  where p.id = coalesce(
    (select st.person_id from public.students st where st.id = v_cert.student_id),
    (select sf.person_id from public.staff sf where sf.id = v_cert.staff_id));
  if v_dob is null or v_dob <> p_date_of_birth then
    return null;
  end if;
  return jsonb_build_object(
    'serial', v_cert.serial_no,
    'certificate', v_cert.template_name,
    'issued_on', v_cert.issued_on,
    'holder', v_name,
    'status', v_cert.status,
    'cancelled_on', (v_cert.cancelled_at at time zone 'UTC')::date
  );
end;
$$;

-- -------------------------------------------------------------- the enquiry --

create function public.public_enquiry(p_slug text, p_enquiry jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_tenant_id uuid := public.public_page_tenant(p_slug, 'enquiry');
  v_session uuid;
  v_name text := btrim(coalesce(p_enquiry ->> 'student_name', ''));
  v_first text;
  v_last text;
  v_contact text := nullif(btrim(coalesce(p_enquiry ->> 'contact_name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_enquiry ->> 'phone', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_enquiry ->> 'email', '')), ''));
  v_class_text text := btrim(coalesce(p_enquiry ->> 'class_level_id', ''));
  v_class uuid;
  v_message text := nullif(btrim(coalesce(p_enquiry ->> 'message', '')), '');
  v_existing text;
  v_number text;
  v_rows integer;
begin
  if v_tenant_id is not null then
    select * into v_tenant from public.tenants t where t.id = v_tenant_id;
    select s.id into v_session from public.academic_sessions s where s.tenant_id = v_tenant_id and s.is_current;
  end if;
  if v_tenant_id is null or v_session is null then
    raise exception 'This college is not taking enquiries online at the moment.';
  end if;
  if v_name = '' or length(v_name) > 160 then
    raise exception 'Enter the student''s name (at most 160 characters).';
  end if;
  if v_contact is not null and length(v_contact) > 120 then
    raise exception 'Your name can be at most 120 characters.';
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
  if v_message is not null and length(v_message) > 1000 then
    raise exception 'The message can be at most 1,000 characters.';
  end if;
  if v_class_text <> '' then
    if v_class_text !~ '^[0-9a-fA-F-]{36}$'
       or not exists (select 1 from public.class_levels cl where cl.tenant_id = v_tenant_id and cl.id = v_class_text::uuid) then
      raise exception 'Choose a class from the list.';
    end if;
    v_class := v_class_text::uuid;
  end if;
  v_first := split_part(v_name, ' ', 1);
  v_last := btrim(substr(v_name, length(v_first) + 1));

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public_enquiry:' || v_tenant_id::text, 0));
  -- The same enquiry sent twice within a day is one enquiry.
  select e.enquiry_number into v_existing
  from public.enquiries e
  where e.tenant_id = v_tenant_id and e.session_id = v_session and e.source = 'website'
    and e.created_at > now() - interval '1 day'
    and lower(e.applicant_first_name) = lower(v_first) and lower(e.applicant_last_name) = lower(v_last)
    and e.contact_phone is not distinct from v_phone
    and lower(e.contact_email) is not distinct from v_email
  order by e.created_at limit 1;
  if v_existing is not null then
    return jsonb_build_object('reference', v_existing, 'duplicate', true, 'college', v_tenant.name);
  end if;
  if not public.public_page_take(v_tenant_id, 'enquiry') then
    raise exception 'This college has received a lot of enquiries in the last hour. Please try again later, or contact the college directly.';
  end if;

  v_number := public.fees_next_document_number_for(v_tenant_id, v_session, 'enquiry');
  insert into public.enquiries (
    tenant_id, session_id, enquiry_number, applicant_first_name, applicant_last_name,
    class_level_id, contact_name, contact_phone, contact_email,
    source, status, next_follow_up_on, notes
  ) values (
    v_tenant_id, v_session, v_number, v_first, v_last,
    v_class, coalesce(v_contact, v_name), v_phone, v_email,
    'website', 'new', (now() at time zone coalesce(v_tenant.timezone, 'Asia/Kolkata'))::date,
    coalesce('Enquiry from the college''s public page. ' || v_message, 'Enquiry from the college''s public page.')
  );
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'The enquiry could not be saved. Please try again.';
  end if;
  return jsonb_build_object('reference', v_number, 'duplicate', false, 'college', v_tenant.name);
end;
$$;

-- ------------------------------------------------------ the staff application --

create table public.staff_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  last_name text not null default '' check (length(last_name) <= 80),
  date_of_birth date,
  gender text check (gender is null or gender in ('male', 'female', 'other', 'undisclosed')),
  email text check (email is null or length(email) <= 200),
  phone text check (phone is null or length(phone) <= 20),
  city text check (city is null or length(city) <= 100),
  position text not null check (length(btrim(position)) between 1 and 100),
  qualification text check (qualification is null or length(qualification) <= 300),
  experience_years numeric(4, 1) check (experience_years is null or experience_years between 0 and 60),
  message text check (message is null or length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'shortlisted', 'rejected', 'hired')),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint staff_applications_staff_fkey foreign key (tenant_id, staff_id)
    references public.staff (tenant_id, id) on delete set null (staff_id),
  constraint staff_applications_contact_chk check (email is not null or phone is not null),
  constraint staff_applications_hired_chk check (staff_id is null or status = 'hired')
);
create index staff_applications_tenant_status_idx on public.staff_applications (tenant_id, status, created_at desc);
create index staff_applications_staff_idx on public.staff_applications (staff_id);
create index staff_applications_decided_by_idx on public.staff_applications (decided_by);

comment on table public.staff_applications is
  'Somebody applying to work at the college from its public page (0361). The office shortlists, rejects, or hires through the add-staff form, which links the application to the record it made.';

create trigger set_updated_at before update on public.staff_applications
  for each row execute function public.set_updated_at();
create trigger audit_staff_applications after insert or update or delete on public.staff_applications
  for each row execute function public.audit_row_change();

alter table public.staff_applications enable row level security;
-- Whoever may add staff records, which is the decision this table feeds. No
-- insert policy: an applicant writes through public_staff_apply, which decides
-- the status. staff.manage is held by no family role (rule 4: check the matrix
-- when a gate is tenant-wide).
create policy "staff managers read staff_applications" on public.staff_applications
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.role_has_permission('staff.manage')));
create policy "staff managers decide staff_applications" on public.staff_applications
  for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.role_has_permission('staff.manage')))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.role_has_permission('staff.manage')));
revoke insert, update, delete on public.staff_applications from authenticated, anon;
-- What the applicant wrote stays as they wrote it.
grant update (status, decision_note, decided_by, decided_at, staff_id) on public.staff_applications to authenticated;

create function public.public_staff_apply(p_slug text, p_application jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.public_page_tenant(p_slug, 'staff_application');
  v_first text := btrim(coalesce(p_application ->> 'first_name', ''));
  v_last text := btrim(coalesce(p_application ->> 'last_name', ''));
  v_dob_text text := btrim(coalesce(p_application ->> 'date_of_birth', ''));
  v_dob date;
  v_gender text := nullif(btrim(coalesce(p_application ->> 'gender', '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_application ->> 'email', '')), ''));
  v_phone text := nullif(btrim(coalesce(p_application ->> 'phone', '')), '');
  v_city text := nullif(btrim(coalesce(p_application ->> 'city', '')), '');
  v_position text := btrim(coalesce(p_application ->> 'position', ''));
  v_qualification text := nullif(btrim(coalesce(p_application ->> 'qualification', '')), '');
  v_experience_text text := btrim(coalesce(p_application ->> 'experience_years', ''));
  v_experience numeric;
  v_message text := nullif(btrim(coalesce(p_application ->> 'message', '')), '');
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'This college is not taking applications online at the moment.';
  end if;
  if v_first = '' or length(v_first) > 80 or length(v_last) > 80 then
    raise exception 'Enter your name (at most 80 characters each).';
  end if;
  if v_position = '' or length(v_position) > 100 then
    raise exception 'Say which post you are applying for.';
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
  if v_gender is not null and v_gender not in ('male', 'female', 'other', 'undisclosed') then
    raise exception 'Choose one of the options given for gender.';
  end if;
  if v_city is not null and length(v_city) > 100 then
    raise exception 'The city can be at most 100 characters.';
  end if;
  if v_qualification is not null and length(v_qualification) > 300 then
    raise exception 'The qualification can be at most 300 characters.';
  end if;
  if v_message is not null and length(v_message) > 2000 then
    raise exception 'The message can be at most 2,000 characters.';
  end if;
  if v_dob_text <> '' then
    begin
      v_dob := v_dob_text::date;
    exception when others then
      raise exception 'That date of birth is not a real date.';
    end;
    if v_dob > current_date - interval '16 years' or v_dob < current_date - interval '90 years' then
      raise exception 'That date of birth is not a real date.';
    end if;
  end if;
  if v_experience_text <> '' then
    if v_experience_text !~ '^\d{1,2}(\.\d)?$' then
      raise exception 'Give your experience in years, such as 3 or 4.5.';
    end if;
    v_experience := v_experience_text::numeric;
  end if;

  -- The same person applying for the same post within a day is one application.
  select a.id into v_id from public.staff_applications a
  where a.tenant_id = v_tenant_id and a.created_at > now() - interval '1 day'
    and lower(a.first_name) = lower(v_first) and lower(a.last_name) = lower(v_last)
    and lower(a.position) = lower(v_position)
    and a.phone is not distinct from v_phone and a.email is not distinct from v_email
  limit 1;
  if v_id is not null then
    return jsonb_build_object('reference', upper(left(v_id::text, 8)), 'duplicate', true);
  end if;
  if not public.public_page_take(v_tenant_id, 'staff_application') then
    raise exception 'This college has received a lot of applications in the last hour. Please try again later.';
  end if;

  insert into public.staff_applications (
    tenant_id, first_name, last_name, date_of_birth, gender, email, phone, city,
    position, qualification, experience_years, message
  ) values (
    v_tenant_id, v_first, v_last, v_dob, v_gender, v_email, v_phone, v_city,
    v_position, v_qualification, v_experience, v_message
  ) returning id into v_id;
  return jsonb_build_object('reference', upper(left(v_id::text, 8)), 'duplicate', false);
end;
$$;

-- ------------------------------------------------------------------ grants --

revoke all on function public.public_college(text) from public;
revoke all on function public.public_exam_timetable(text) from public;
revoke all on function public.public_admit_card(text, uuid, text, date) from public;
revoke all on function public.public_results(text, text, date) from public;
revoke all on function public.public_certificate_check(text, text, date) from public;
revoke all on function public.public_enquiry(text, jsonb) from public;
revoke all on function public.public_staff_apply(text, jsonb) from public;
grant execute on function public.public_college(text) to anon, authenticated;
grant execute on function public.public_exam_timetable(text) to anon, authenticated;
grant execute on function public.public_admit_card(text, uuid, text, date) to anon, authenticated;
grant execute on function public.public_results(text, text, date) to anon, authenticated;
grant execute on function public.public_certificate_check(text, text, date) to anon, authenticated;
grant execute on function public.public_enquiry(text, jsonb) to anon, authenticated;
grant execute on function public.public_staff_apply(text, jsonb) to anon, authenticated;

-- ----------------------------------------------- the guards learn the names --

create or replace function public.definer_guard_violations()
returns table (function_name text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with anonymous_on_purpose (name, why) as (
    values
      -- The signup form asks whether a slug is free before an account exists.
      -- Returns a boolean about a slug and nothing about the college behind it.
      ('platform_slug_available',
       'answers whether a college slug is free, for a signup form with no account yet'),
      -- The public application form (0268). Returns a college's name, year,
      -- class levels and its own note -- or one null for every reason it cannot.
      ('admission_form',
       'shows the public application form what a college chose to publish, or null'),
      -- Its one write: an enquiry whose every decided column is decided inside,
      -- bounded per college per hour under an advisory lock.
      ('admission_apply',
       'files one bounded website enquiry into a college that opened online applications'),
      -- The public pages (0361). Each is off until the college switches it on,
      -- answers every refusal with one null, and is counted per college per hour.
      ('public_college',
       'lists which public pages a college switched on, with its name and classes, or null'),
      ('public_exam_timetable',
       'shows the dated papers of exams a college marked public, or null'),
      ('public_admit_card',
       'shows one child''s papers and seats for a public exam, given admission number and date of birth'),
      ('public_results',
       'shows one child''s published results, given admission number and date of birth'),
      ('public_certificate_check',
       'says whether a certificate stands, given its serial and the holder''s date of birth'),
      ('public_enquiry',
       'files one bounded website enquiry into a college that opened enquiries'),
      ('public_staff_apply',
       'files one bounded staff application into a college that opened applications')
  )
  select
    p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    'SECURITY DEFINER and executable by anon, and not on the list in '
    || 'definer_guard_violations(). Inside a definer no policy runs, so this '
    || 'grant is the only check -- revoke it, or name the function there with '
    || 'the reason an anonymous caller needs it.'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
    and pg_catalog.has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in (select name from anonymous_on_purpose)
  order by 1
$$;

create or replace function public.audit_guard_violations()
returns table (table_name text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    case
      when not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'id'
          and a.attnum > 0 and not a.attisdropped
      )
      then 'has no id column, so audit_row_change() cannot record which row changed'
      else 'has no audit trigger -- see rule 9, and migration 0162 for the exemptions'
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname not in (
      'audit_log', 'jobs', 'schedule_runs', 'notice_reads',
      -- 0361: a count of public lookups, written once and never edited.
      'public_page_hits'
    )
    and not exists (
      select 1
      from pg_trigger tg
      join pg_proc p on p.oid = tg.tgfoid
      where tg.tgrelid = c.oid
        and not tg.tgisinternal
        and p.proname = 'audit_row_change'
    )
  order by 1
$$;

commit;
