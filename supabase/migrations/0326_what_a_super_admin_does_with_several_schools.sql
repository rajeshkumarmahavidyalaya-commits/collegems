-- 0326: what a super admin does with several schools.
--
-- The reference's School Management area, and what running several colleges
-- needs beyond picking one (0323, 0325). Every function here is a definer,
-- because a super admin acts on a school that is not the one in their token,
-- and every one opens with school_require_admin(that school): the caller's
-- membership there must be active and its role must hold users.manage. That
-- check is the whole authority, so it is the first statement of each.
--
-- 1. Admins per school -- school_admins, school_assign_admin,
--    school_remove_admin. Assigning an email that has a login adds a
--    membership; one without becomes a pending invitation that
--    handle_new_auth_user resolves at sign-up. The answer is one sentence
--    either way, or the form would tell any administrator which addresses
--    are registered. Removing goes through membership_leave (0323), so a
--    person who belongs elsewhere is not banned everywhere.
-- 2. Edit a school -- school_update_profile: its name, the school.profile
--    contact lines, its logo and which modules its menu shows. The logo is a
--    small data URL on tenants, not a Storage object: Storage's policy reads
--    the tenant in the token, and the card is read by a super admin working
--    in another college. A CHECK bounds it to PNG, JPEG or WebP and 200,000
--    characters.
-- 3. Pause a school -- tenants.is_active and school_set_active. Paused,
--    members other than its administrators see a notice instead of the app
--    and the public application form closes (admission_form and
--    admission_apply, 0268's bodies with one condition added each). It is
--    not a boundary: logins and data are untouched, and RLS still decides
--    every read. To stop somebody reading, switch their login off.
-- 4. Copy setup -- school_copy_setup(from, to): classes, this year's
--    sections and subject assignments, subjects, periods, weekends, fee
--    heads, this year's regular fee amounts and grading schemes, matched by
--    name and code. Never a person, a payment or a record. Only into a school
--    with no classes yet.
-- 5. Figures on each card -- my_school_figures: children on roll, collected
--    this month and dues outstanding, totals only, for the colleges the
--    caller administers.
-- 6. Per-school menu -- the modules.menu setting (catalogued, so /settings
--    renders it too). The menu leaves a switched-off module out; its pages
--    still check their own permissions, as the reference's "Menu show"
--    switches do.

begin;

-- ------------------------------------------------------------ the columns

alter table public.tenants
  add column is_active boolean not null default true,
  add column logo text,
  add constraint tenants_logo_chk check (
    logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(logo) <= 200000));

comment on column public.tenants.is_active is
  'False when the super admin has paused the college (0326): members other than its administrators see a paused notice, and the public application form closes. Data and logins are untouched.';
comment on column public.tenants.logo is
  'The college logo as a small data URL (PNG, JPEG or WebP, at most 200,000 characters), drawn on its School Management card (0326). Stored on the row rather than in Storage because the card is read by a super admin working in another college, whose token Storage would refuse.';

insert into reference.settings_catalog
  (key, label, description, module, value_type, fields, default_value, is_required, permission_code, sort_order)
values (
  'modules.menu',
  'Modules in the menu',
  'Which modules this college''s menu shows. A module switched off is left out of everybody''s menu and search; nothing is removed, and its pages still check their own permissions.',
  'School',
  'object',
  '[{"name":"library","type":"boolean","label":"Library"},
    {"name":"transport","type":"boolean","label":"Transport"},
    {"name":"hostel","type":"boolean","label":"Hostel"},
    {"name":"inventory","type":"boolean","label":"Store and stock"},
    {"name":"exams","type":"boolean","label":"Examination"},
    {"name":"accounts","type":"boolean","label":"Accounts"},
    {"name":"payroll","type":"boolean","label":"Payroll"},
    {"name":"certificates","type":"boolean","label":"Certificates"},
    {"name":"homework","type":"boolean","label":"Homework"},
    {"name":"live_classes","type":"boolean","label":"Live classes"}]'::jsonb,
  '{"library":true,"transport":true,"hostel":true,"inventory":true,"exams":true,"accounts":true,"payroll":true,"certificates":true,"homework":true,"live_classes":true}'::jsonb,
  false,
  'settings.manage',
  40
)
on conflict (key) do nothing;

-- --------------------------------------------------------- who administers

-- Is this login an active administrator (its role holds users.manage) of that
-- college? The super admin's test, asked of any college, not only the one in
-- the token.
create or replace function public.school_is_administered_by(p_tenant uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.school_memberships m
    join public.role_permissions rp on rp.role_id = m.role_id and rp.tenant_id = m.tenant_id
    where m.tenant_id = p_tenant and m.user_id = p_user and m.is_active
      and rp.permission_code = 'users.manage' and rp.allowed
  )
$$;

revoke all on function public.school_is_administered_by(uuid, uuid) from public, anon, authenticated;

create or replace function public.school_require_admin(p_tenant uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null or not public.school_is_administered_by(p_tenant, auth.uid()) then
    raise exception 'Only an administrator of that school can do this.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.school_require_admin(uuid) from public, anon, authenticated;

-- ------------------------------------------------------- admins per school

create or replace function public.school_admins(p_tenant uuid)
returns table (user_id uuid, email text, display_name text, status text, is_you boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  perform public.school_require_admin(p_tenant);
  return query
  select m.user_id, au.email::text,
         coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), au.email)::text,
         case when m.is_active then 'active' else 'switched_off' end,
         m.user_id = auth.uid()
  from public.school_memberships m
  join public.role_permissions rp on rp.role_id = m.role_id and rp.tenant_id = m.tenant_id
                                 and rp.permission_code = 'users.manage' and rp.allowed
  join auth.users au on au.id = m.user_id
  left join public.people p on p.id = m.person_id
  where m.tenant_id = p_tenant
  union all
  select null::uuid, i.email::text, i.email::text, 'invited', false
  from public.invitations i
  join public.roles r on r.id = i.role_id and r.tenant_id = i.tenant_id and r.code = 'admin'
  where i.tenant_id = p_tenant and i.status = 'pending' and i.expires_at > now()
  order by 4, 3;
end;
$$;

comment on function public.school_admins(uuid) is
  'The administrators of one school and the pending administrator invitations (0326). Definer; refuses anybody who does not administer that school.';

create or replace function public.school_assign_admin(p_tenant uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
  v_role uuid;
  v_school text;
begin
  perform public.school_require_admin(p_tenant);
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 200 then
    raise exception 'Enter a valid email address.';
  end if;
  select t.name into v_school from public.tenants t where t.id = p_tenant;
  select r.id into v_role from public.roles r where r.tenant_id = p_tenant and r.code = 'admin';
  if v_role is null then
    raise exception 'That school has no Administrator role.';
  end if;

  select au.id into v_user from auth.users au where lower(au.email) = v_email;

  if v_user is not null then
    if exists (select 1 from platform.operators o where o.user_id = v_user) then
      -- Said the same way as success would be impossible here: an operator
      -- may not hold a college (0209).
      raise exception 'That login cannot be an administrator of a school.';
    end if;
    insert into public.school_memberships (tenant_id, user_id, role_id, is_active)
    values (p_tenant, v_user, v_role, true)
    on conflict (tenant_id, user_id) do update set role_id = excluded.role_id, is_active = true;
    -- If they can sign in nowhere today, or this is the college they are in,
    -- this membership becomes their active one so the role reaches the token.
    if exists (select 1 from public.user_profiles up where up.id = v_user and up.tenant_id = p_tenant)
       or exists (select 1 from auth.users au where au.id = v_user and au.banned_until is not null and au.banned_until > now())
       or not exists (select 1 from public.user_profiles up
                      join public.school_memberships m on m.user_id = up.id and m.tenant_id = up.tenant_id
                      where up.id = v_user and m.is_active) then
      if exists (select 1 from public.user_profiles up where up.id = v_user) then
        perform public.membership_activate_profile(v_user, p_tenant);
        perform public.login_close(p_tenant, v_user, true);
      end if;
    end if;
  elsif not exists (select 1 from public.invitations i
                    where i.tenant_id = p_tenant and lower(i.email::text) = v_email
                      and i.status = 'pending' and i.expires_at > now()) then
    insert into public.invitations (tenant_id, email, role_id, invited_by)
    values (p_tenant, v_email, v_role, auth.uid());
  end if;

  -- One sentence whether or not the address already has a login: an answer
  -- that differed would tell any administrator which addresses are registered.
  return jsonb_build_object('school', v_school, 'email', v_email,
    'message', format('%s is an administrator of %s. Without a SchoolOS login yet, they become one when they sign up with this address.', v_email, v_school));
end;
$$;

comment on function public.school_assign_admin(uuid, text) is
  'Make an email an administrator of one school (0326): a membership for an existing login, a pending invitation otherwise, answered in one sentence either way. Refuses anybody who does not administer that school, and an operator.';

create or replace function public.school_remove_admin(p_tenant uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.school_require_admin(p_tenant);
  if p_user = auth.uid() then
    raise exception 'You cannot remove yourself. Ask another administrator.';
  end if;
  if not exists (select 1 from public.school_memberships where tenant_id = p_tenant and user_id = p_user) then
    raise exception 'That login does not belong to that school.';
  end if;
  if public.logins_that_can_manage_users(p_tenant, p_user) = 0 then
    raise exception 'That is the only login that can manage this school. Add another administrator first.';
  end if;
  perform public.membership_leave(p_tenant, p_user);
  return jsonb_build_object('removed', true);
end;
$$;

comment on function public.school_remove_admin(uuid, uuid) is
  'Switch an administrator off in one school (0326) through membership_leave: never the caller, never the last way back.';

-- ------------------------------------------------ details, logo, menu, pause

create or replace function public.school_update_profile(
  p_tenant uuid,
  p_name text,
  p_profile jsonb,
  p_logo text,
  p_menu jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_profile jsonb := '{}'::jsonb;
  v_menu jsonb := '{}'::jsonb;
  k text;
  v_rows integer;
begin
  perform public.school_require_admin(p_tenant);
  if length(v_name) < 2 or length(v_name) > 160 then
    raise exception 'A school needs a name of 2 to 160 characters.';
  end if;

  -- Only the keys the catalogue declares, each a string or null, each bounded.
  foreach k in array array['address_line1','address_line2','city','state','postal_code','phone','email','website'] loop
    v_profile := v_profile || jsonb_build_object(k,
      nullif(left(btrim(coalesce(p_profile ->> k, '')), 200), ''));
  end loop;
  foreach k in array array['library','transport','hostel','inventory','exams','accounts','payroll','certificates','homework','live_classes'] loop
    v_menu := v_menu || jsonb_build_object(k, coalesce((p_menu ->> k)::boolean, true));
  end loop;

  update public.tenants set name = v_name where id = p_tenant;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'That school does not exist.';
  end if;

  -- 'keep' leaves the logo alone; '' clears it; anything else is the new one,
  -- checked by the column's CHECK.
  if p_logo is distinct from 'keep' then
    update public.tenants set logo = nullif(p_logo, '') where id = p_tenant;
  end if;

  insert into public.settings (tenant_id, key, value, updated_by)
  values (p_tenant, 'school.profile', v_profile, auth.uid())
  on conflict (tenant_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  insert into public.settings (tenant_id, key, value, updated_by)
  values (p_tenant, 'modules.menu', v_menu, auth.uid())
  on conflict (tenant_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();

  return jsonb_build_object('name', v_name);
end;
$$;

comment on function public.school_update_profile(uuid, text, jsonb, text, jsonb) is
  'Edit one school from School Management (0326): name, contact lines, logo and which modules its menu shows. Definer; refuses anybody who does not administer that school; writes only declared keys.';

create or replace function public.school_set_active(p_tenant uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rows integer;
begin
  perform public.school_require_admin(p_tenant);
  update public.tenants set is_active = coalesce(p_active, true) where id = p_tenant;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'That school does not exist.';
  end if;
  return jsonb_build_object('active', coalesce(p_active, true));
end;
$$;

comment on function public.school_set_active(uuid, boolean) is
  'Pause or resume one school (0326). Paused: members other than its administrators see a notice, the public application form closes. Data and logins are untouched.';

-- --------------------------------------------------------- figures per card

create or replace function public.my_school_figures()
returns table (
  tenant_id uuid,
  logo text,
  is_paused boolean,
  session_name text,
  students_on_roll integer,
  collected_this_month numeric,
  dues_outstanding numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Totals for the colleges the caller administers, never a name. Inside a
  -- definer no policy runs, so every sum names its tenant by hand. Dues use
  -- fees_student_balances' own arithmetic (current year, issued invoices plus
  -- the year's ledger, per enrolled child, owing only); that function answers
  -- only for the college in the token, so this is its copy for the card, and
  -- the probe in 0326 checks the two agree.
  with mine as (
    select m.tenant_id, t.logo, t.is_active, t.timezone,
           public.current_session_id(m.tenant_id) as session_id
    from public.school_memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.user_id = auth.uid()
      and public.school_is_administered_by(m.tenant_id, auth.uid())
  )
  select
    x.tenant_id,
    x.logo,
    not x.is_active,
    (select s.name from public.academic_sessions s where s.id = x.session_id),
    (select count(*)::integer from public.enrolments e
      where e.tenant_id = x.tenant_id and e.session_id = x.session_id and e.status = 'active'),
    coalesce((select -sum(le.amount) from public.ledger_entries le
      where le.tenant_id = x.tenant_id
        and le.entry_type in ('payment', 'refund')
        and le.occurred_at >= (date_trunc('month', now() at time zone x.timezone) at time zone x.timezone)
        and le.occurred_at < ((date_trunc('month', now() at time zone x.timezone) + interval '1 month') at time zone x.timezone)), 0),
    coalesce((
      select sum(greatest(coalesce(c.charged, 0) + coalesce(n.net, 0), 0))
      from public.enrolments e
      left join lateral (
        select sum(il.amount) as charged
        from public.invoices i join public.invoice_lines il on il.invoice_id = i.id
        where i.tenant_id = x.tenant_id and i.session_id = x.session_id
          and i.status = 'issued' and i.student_id = e.student_id) c on true
      left join lateral (
        select sum(le.amount) as net
        from public.ledger_entries le
        where le.tenant_id = x.tenant_id and le.session_id = x.session_id
          and le.student_id = e.student_id) n on true
      where e.tenant_id = x.tenant_id and e.session_id = x.session_id and e.status = 'active'), 0)
  from mine x
$$;

comment on function public.my_school_figures() is
  'Logo, pause flag, year, children on roll, collected this month and dues outstanding for each college the caller administers (0326). Totals only; definer filtered by auth.uid() and by tenant by hand.';

-- ------------------------------------------------------------- copy setup

create or replace function public.school_copy_setup(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_from_session uuid;
  v_to_session uuid;
  n_classes integer; n_sections integer; n_subjects integer; n_assign integer;
  n_slots integer; n_heads integer; n_fees integer; n_schemes integer;
begin
  perform public.school_require_admin(p_from);
  perform public.school_require_admin(p_to);
  if p_from = p_to then
    raise exception 'Choose a different school to copy from.';
  end if;
  if exists (select 1 from public.class_levels where tenant_id = p_to) then
    raise exception 'This school already has classes, so its setup was not replaced. Copying is for a new school.';
  end if;
  v_from_session := public.current_session_id(p_from);
  v_to_session := public.current_session_id(p_to);
  if v_from_session is null or v_to_session is null then
    raise exception 'Both schools need a current academic year first.';
  end if;

  insert into public.class_levels (tenant_id, name, sequence)
  select p_to, cl.name, cl.sequence from public.class_levels cl where cl.tenant_id = p_from;
  get diagnostics n_classes = row_count;

  insert into public.sections (tenant_id, class_level_id, session_id, name, capacity)
  select p_to, tcl.id, v_to_session, s.name, s.capacity
  from public.sections s
  join public.class_levels fcl on fcl.id = s.class_level_id
  join public.class_levels tcl on tcl.tenant_id = p_to and tcl.name = fcl.name
  where s.tenant_id = p_from and s.session_id = v_from_session;
  get diagnostics n_sections = row_count;

  insert into public.subjects (tenant_id, name, code, kind, is_active)
  select p_to, sb.name, sb.code, sb.kind, sb.is_active from public.subjects sb where sb.tenant_id = p_from
  on conflict (tenant_id, code) do nothing;
  get diagnostics n_subjects = row_count;

  insert into public.section_subjects (tenant_id, session_id, section_id, subject_id)
  select p_to, v_to_session, ts.id, tsb.id
  from public.section_subjects ss
  join public.sections fs on fs.id = ss.section_id
  join public.class_levels fcl on fcl.id = fs.class_level_id
  join public.class_levels tcl on tcl.tenant_id = p_to and tcl.name = fcl.name
  join public.sections ts on ts.tenant_id = p_to and ts.session_id = v_to_session
                         and ts.class_level_id = tcl.id and ts.name = fs.name
  join public.subjects fsb on fsb.id = ss.subject_id
  join public.subjects tsb on tsb.tenant_id = p_to and tsb.code = fsb.code
  where ss.tenant_id = p_from and ss.session_id = v_from_session
  on conflict do nothing;
  get diagnostics n_assign = row_count;

  insert into public.time_slots (tenant_id, kind, period_number, label, starts_at, ends_at, is_break)
  select p_to, ts.kind, ts.period_number, ts.label, ts.starts_at, ts.ends_at, ts.is_break
  from public.time_slots ts where ts.tenant_id = p_from
  on conflict (tenant_id, kind, period_number) do nothing;
  get diagnostics n_slots = row_count;

  insert into public.weekends (tenant_id, weekday, is_teaching)
  select p_to, w.weekday, w.is_teaching from public.weekends w where w.tenant_id = p_from
  on conflict (tenant_id, weekday) do update set is_teaching = excluded.is_teaching;

  insert into public.fee_heads (tenant_id, code, name, description, category, is_active, bill_on_admission)
  select p_to, fh.code, fh.name, fh.description, fh.category, fh.is_active, fh.bill_on_admission
  from public.fee_heads fh where fh.tenant_id = p_from
  on conflict (tenant_id, code) do nothing;
  get diagnostics n_heads = row_count;

  -- The regular amounts only: a student type is the school's own decision.
  insert into public.fee_structures (tenant_id, session_id, class_level_id, fee_head_id, amount, frequency)
  select p_to, v_to_session, tcl.id, tfh.id, fs.amount, fs.frequency
  from public.fee_structures fs
  join public.class_levels fcl on fcl.id = fs.class_level_id
  join public.class_levels tcl on tcl.tenant_id = p_to and tcl.name = fcl.name
  join public.fee_heads ffh on ffh.id = fs.fee_head_id
  join public.fee_heads tfh on tfh.tenant_id = p_to and tfh.code = ffh.code
  where fs.tenant_id = p_from and fs.session_id = v_from_session and fs.student_type_id is null
  on conflict do nothing;
  get diagnostics n_fees = row_count;

  insert into public.grading_schemes (tenant_id, name, description, rules, is_default)
  select p_to, g.name, g.description, g.rules, g.is_default from public.grading_schemes g where g.tenant_id = p_from
  on conflict (tenant_id, name) do nothing;
  get diagnostics n_schemes = row_count;

  return jsonb_build_object('classes', n_classes, 'sections', n_sections, 'subjects', n_subjects,
    'subject_assignments', n_assign, 'periods', n_slots, 'fee_heads', n_heads,
    'fee_amounts', n_fees, 'grading_schemes', n_schemes);
end;
$$;

comment on function public.school_copy_setup(uuid, uuid) is
  'Copy one school''s setup into a new one (0326): classes, this year''s sections and subject assignments, subjects, periods, weekends, fee heads, this year''s regular fee amounts and grading schemes. Never people, money or records. Needs the caller to administer both; refuses a school that already has classes.';

-- ------------------------------------------------------------------ grants

revoke all on function public.school_admins(uuid) from public, anon;
grant execute on function public.school_admins(uuid) to authenticated;
revoke all on function public.school_assign_admin(uuid, text) from public, anon;
grant execute on function public.school_assign_admin(uuid, text) to authenticated;
revoke all on function public.school_remove_admin(uuid, uuid) from public, anon;
grant execute on function public.school_remove_admin(uuid, uuid) to authenticated;
revoke all on function public.school_update_profile(uuid, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.school_update_profile(uuid, text, jsonb, text, jsonb) to authenticated;
revoke all on function public.school_set_active(uuid, boolean) from public, anon;
grant execute on function public.school_set_active(uuid, boolean) to authenticated;
revoke all on function public.my_school_figures() from public, anon;
grant execute on function public.my_school_figures() to authenticated;
revoke all on function public.school_copy_setup(uuid, uuid) from public, anon;
grant execute on function public.school_copy_setup(uuid, uuid) to authenticated;

-- ------------------------------------------- a paused college takes no forms

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

  return jsonb_build_object('reference', v_number, 'duplicate', false, 'college', v_tenant.name);
end;
$$;

commit;
