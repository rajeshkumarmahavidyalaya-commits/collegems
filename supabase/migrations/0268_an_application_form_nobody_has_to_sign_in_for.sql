-- ---------------------------------------------------------------------------
-- An application form nobody has to sign in for
-- ---------------------------------------------------------------------------
--
-- Every route in this product is behind the login wall, and `/signup` gives a
-- tenant only to somebody an invitation names. So a family that found a college
-- on the internet had exactly one way in: telephone the office and have somebody
-- type them into `enquiries` by hand. Measured before this migration: 8
-- enquiries on the demo college, 2 with `source = 'website'` -- both typed in by
-- staff, because the source was a label for where somebody heard of the college,
-- not a way to arrive.
--
-- This is the product's **first deliberate anonymous write path**, and `0267`
-- is why it comes second: asked first what an anonymous caller could already
-- reach, the answer was a scheduler runner that would text a college's families
-- on demand. So the shape here is written against that finding.
--
-- > **Two functions, both SECURITY DEFINER, both named in
-- > `definer_guard_violations()` with their reasons, and nothing else granted to
-- > `anon`.** No table policy is opened to `anon`; `enquiries` keeps exactly the
-- > policies it had. The public reaches one INSERT, through one function, whose
-- > every column is decided by this file rather than by the caller.
--
-- What the caller decides, and what it does not:
--
--   * the college: by its **slug**, which is already public -- it is in every
--     invitation URL, and `platform_slug_available` answers for it;
--   * the child and the contact: bounded lengths, shaped values, nothing else;
--   * **not** the year (`current_session_id`, rule 2), **not** the number
--     (the gapless numberer, rule 6), **not** the status or the source, and
--     **not** which staff member it lands with.
--
-- And what an anonymous caller may learn:
--
--   * `admission_form` returns the college's name, its class levels and a note
--     the college wrote for applicants -- or **null**. Null for a slug that does
--     not exist, for a college that has not opened admissions, and for one with
--     no current year: one answer, so the form is not a way to ask which of
--     those is true (`0209`'s *"the refusal says nothing"*).
--   * `admission_apply` returns a reference number and nothing about any other
--     applicant. A second submission of the same child and contact within a day
--     returns the **first** reference rather than filing a duplicate -- a family
--     pressing the button twice is the common case, and the reference is theirs.
--
-- Bounded, because an endpoint anybody can call is an endpoint somebody will
-- call ten thousand times:
--
--   * **per college, per hour**, under an advisory lock so two requests racing
--     cannot both see "29" -- rule 4's answer for a rule about how many other
--     rows exist. The ceiling is the college's setting (default 30) and is
--     clamped to 500 here, because a setting is a decision and a clamp is a
--     bound. A spammer can fill 30 rows an hour into one college's board; that
--     is the stated cost, and it is what the office's *Lost* button is for.
--   * **closed by default.** `admissions.online` arrives switched off, like
--     everything else in this product that faces outward.
--
-- The audit trail: `audit_row_change` records `auth.uid()`, which is null here,
-- so the history of one of these rows reads *System* on its insert. That is
-- the payment webhook's case exactly (`0215`) -- "nobody was signed in", which
-- is literally true -- and the row's own `source = 'website'` says who it was.
-- The audit layer is deliberately not taught a second meaning for null.
--
-- Not built, and named: a notification to the office when one arrives. The
-- enquiry lands at the top of the board with a follow-up due today, which is
-- where the office already looks; an event nothing is subscribed to would be
-- `0219`'s *"catalogue entry, not a feature"*.

begin;

-- --------------------------------------------------------------- the setting --

insert into reference.settings_catalog (
  key, label, description, module, value_type, fields, default_value,
  is_required, permission_code, sort_order
)
values (
  'admissions.online',
  'Online applications',
  'Lets families apply from a public page without an account. Each application '
  'arrives in the front office as a new enquiry with a follow-up due that day. '
  'The hourly limit protects the enquiry board from a flood; the note is shown '
  'at the top of the form.',
  'Front office',
  'object',
  '[{"name": "enabled", "type": "boolean", "label": "Accept applications online"},
    {"name": "per_hour", "type": "number", "label": "Most applications accepted in one hour"},
    {"name": "note", "type": "text", "label": "Note shown to applicants"}]'::jsonb,
  '{"enabled": false, "per_hour": 30, "note": null}'::jsonb,
  false,
  'frontoffice.manage',
  100
);

-- ------------------------------------------- one place a default is applied --

-- `setting_value` is the one place a default is applied (`0166`), and it asks
-- `current_tenant_id()` -- which is null for an applicant. Rather than write the
-- coalesce a second time inside the form's function, the tenant becomes a
-- parameter and `setting_value` becomes the wrapper. Safe for the reason rule 6
-- gives for `notify_send_for`: `settings` is readable by every member of a
-- college, so its protection is a tenant check and nothing narrower. Called by
-- a signed-in member with another college's id, RLS hides that college's row
-- and the answer is the catalogue default -- which is public anyway.
create or replace function public.setting_value_for(p_tenant_id uuid, p_key text)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(
    (select s.value from public.settings s
      where s.tenant_id = p_tenant_id and s.key = p_key),
    (select c.default_value from reference.settings_catalog c where c.key = p_key)
  )
$$;

revoke all on function public.setting_value_for(uuid, text) from public, anon;
grant execute on function public.setting_value_for(uuid, text) to authenticated;

comment on function public.setting_value_for(uuid, text) is
  'The one place a setting''s default is applied, for a named college. '
  'setting_value() is this with the caller''s own tenant. INVOKER: RLS on '
  'settings still decides which row a signed-in caller can see.';

create or replace function public.setting_value(p_key text)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select public.setting_value_for(( select public.current_tenant_id() ), p_key)
$$;

-- ------------------------------------------------------------------ the form --

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
  if v_tenant.id is null then
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
  -- college: its name, its year's name, its class levels and its own note. No
  -- count, no staff, no address it did not choose to write in the note.
  return jsonb_build_object(
    'college', v_tenant.name,
    'slug', v_tenant.slug,
    'session', (select s.name from public.academic_sessions s where s.id = v_session_id),
    'note', nullif(btrim(coalesce(v_setting ->> 'note', '')), ''),
    'class_levels', coalesce((
      select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name)
                       order by cl.sequence, cl.name, cl.id)
      from public.class_levels cl
      where cl.tenant_id = v_tenant.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admission_form(text) from public;
grant execute on function public.admission_form(text) to anon, authenticated;

comment on function public.admission_form(text) is
  'What the public application form may show for a college: its name, the '
  'current year, its class levels and its own note -- or null, with one null '
  'for an unknown slug, a closed college and a college with no current year. '
  'SECURITY DEFINER and granted to anon on purpose; named in '
  'definer_guard_violations(). Migration 0268.';

-- ----------------------------------------------------------------- the write --

create or replace function public.admission_apply(p_slug text, p_application jsonb)
returns jsonb
language plpgsql
volatile
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

  return jsonb_build_object('reference', v_number, 'duplicate', false, 'college', v_tenant.name);
end;
$$;

revoke all on function public.admission_apply(text, jsonb) from public;
grant execute on function public.admission_apply(text, jsonb) to anon, authenticated;

comment on function public.admission_apply(text, jsonb) is
  'The public application form''s one write: a new website enquiry in the '
  'named college''s current year, numbered by the gapless numberer. The '
  'caller decides the child and the contact, bounded; the year, the number, '
  'the source and the status are decided here. Refuses a closed or unknown '
  'college in one sentence, returns the first reference for a repeat within a '
  'day, and holds each college to its hourly limit under an advisory lock. '
  'SECURITY DEFINER and granted to anon on purpose; named in '
  'definer_guard_violations(). Migration 0268.';

-- --------------------------------------------- the guard learns two names --

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
       'files one bounded website enquiry into a college that opened online applications')
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

commit;
