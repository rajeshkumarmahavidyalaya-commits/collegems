-- ---------------------------------------------------------------------------
-- A new college gets the matrix the product ships, not the one from 0209
-- ---------------------------------------------------------------------------
--
-- Found while adding a permission for live classes, by asking the question a
-- new permission has to answer: **who gets it in a college that does not exist
-- yet?**
--
-- Every permission added since `0209` was granted "by reading the matrix" --
-- `insert ... select from role_permissions where permission_code = <the
-- closest existing act>` (`0213`'s rule, and a good one). That reaches every
-- college that already exists. It cannot reach one founded tomorrow, because
-- `platform_start_school` seeds a new college's teacher, accountant, librarian
-- and families from **four literal lists written in 0209**, and nothing has
-- touched them since.
--
-- Measured against the demo college, whose non-admin matrix was written by
-- migrations and nobody else (5 audited edits by a person, all test fixtures
-- that net to zero, plus one probe reverted on 10 September):
--
--   role        demo college   a college started today   missing
--   teacher          23                11                   12
--   accountant       22                 4                   18
--   librarian         9                 6                    3
--   student          10                 5                    5
--   parent           10                 5                    5
--
-- What that means for the first real customer, the day they sign up:
--
--   * **no family can read the notice board** -- `notices.view` is missing for
--     both student and parent, and the board is the screen rule 10 says a
--     family comes back to in March;
--   * **no family can apply for leave**, and **no class teacher can decide
--     it** -- `leave.apply` and `leave.decide`;
--   * **no teacher can write a report-card remark** (`exams.remark`), mark
--     syllabus coverage (`syllabus.track`) or see the cover roster
--     (`substitutions.view`);
--   * the accountant has fees and nothing else: no accounts, no payroll, no
--     concessions, no store.
--
-- The administrator is unaffected -- `0209` grants them every row of
-- `reference.permissions`, whenever it was added -- which is exactly why
-- nobody saw it: **the only seat anybody signs into is the one that works.**
-- Rule 4's sentence about the roles a reason forgets, arriving at signup.
--
-- > **A default written as a literal list inside a function is a default
-- > nobody updates.** The fix is rule 12's: the default matrix is data.
--
-- `reference.role_permission_defaults` is the fifth catalogue beside
-- permissions, reports, checks and plans -- outside `public` because it
-- belongs to no tenant. `platform_start_school` reads it, so a permission added
-- next year reaches next year's colleges by adding a row, and
-- `tests/auth/default-matrix.test.ts` fails if a permission is declared without
-- saying who gets it by default -- the `nav-audience` guard's shape: a
-- permission held by the administrator alone is fine, and has to be named.
--
-- Seeded from the demo college's current non-admin matrix, row for row. No
-- existing college changes: this touches only what a new one starts with.

begin;

create table reference.role_permission_defaults (
  role_code text not null
    check (role_code in ('teacher', 'accountant', 'librarian', 'student', 'parent')),
  permission_code text not null
    references reference.permissions (code) on update cascade on delete cascade,
  primary key (role_code, permission_code)
);

comment on table reference.role_permission_defaults is
  'What each non-administrator role may do in a college founded today. Read '
  'by platform_start_school; an administrator gets every permission. A '
  'college edits its own matrix afterwards at /settings/permissions -- this '
  'is only where it starts. Migration 0269.';

-- The permission catalogue's shape (rule 1): global data outside `public`, RLS
-- off because it holds nothing about any tenant, and no write for anybody
-- holding a JWT. Unlike `reference.permissions` it is not readable by `anon`:
-- nobody without an account has a question it answers.
revoke all on reference.role_permission_defaults from public, anon, authenticated;
grant select on reference.role_permission_defaults to authenticated;

insert into reference.role_permission_defaults (role_code, permission_code) values
  ('teacher', 'academics.view'),
  ('teacher', 'attendance.mark'),
  ('teacher', 'attendance.view'),
  ('teacher', 'certificates.view'),
  ('teacher', 'concessions.view'),
  ('teacher', 'exams.grade'),
  ('teacher', 'exams.remark'),
  ('teacher', 'exams.seating'),
  ('teacher', 'exams.view'),
  ('teacher', 'guardians.view'),
  ('teacher', 'homework.manage'),
  ('teacher', 'homework.view'),
  ('teacher', 'hostel.view'),
  ('teacher', 'inventory.view'),
  ('teacher', 'leave.decide'),
  ('teacher', 'leave.view'),
  ('teacher', 'library.view'),
  ('teacher', 'notices.view'),
  ('teacher', 'reports.view'),
  ('teacher', 'students.view'),
  ('teacher', 'substitutions.view'),
  ('teacher', 'syllabus.track'),
  ('teacher', 'transport.view'),
  ('accountant', 'accounts.manage'),
  ('accountant', 'accounts.post'),
  ('accountant', 'accounts.view'),
  ('accountant', 'certificates.view'),
  ('accountant', 'concessions.manage'),
  ('accountant', 'concessions.view'),
  ('accountant', 'fees.collect'),
  ('accountant', 'fees.view'),
  ('accountant', 'frontoffice.manage'),
  ('accountant', 'frontoffice.view'),
  ('accountant', 'hostel.view'),
  ('accountant', 'hr.view'),
  ('accountant', 'inventory.adjust'),
  ('accountant', 'inventory.manage'),
  ('accountant', 'inventory.view'),
  ('accountant', 'notices.view'),
  ('accountant', 'payroll.process'),
  ('accountant', 'payroll.view'),
  ('accountant', 'reports.view'),
  ('accountant', 'schedules.view'),
  ('accountant', 'students.view'),
  ('accountant', 'transport.view'),
  ('librarian', 'inventory.manage'),
  ('librarian', 'inventory.view'),
  ('librarian', 'library.issue'),
  ('librarian', 'library.manage'),
  ('librarian', 'library.return'),
  ('librarian', 'library.view'),
  ('librarian', 'notices.view'),
  ('librarian', 'reports.view'),
  ('librarian', 'students.view'),
  ('student', 'attendance.view'),
  ('student', 'exams.view'),
  ('student', 'fees.view'),
  ('student', 'homework.view'),
  ('student', 'hostel.view'),
  ('student', 'leave.apply'),
  ('student', 'leave.view'),
  ('student', 'library.view'),
  ('student', 'notices.view'),
  ('student', 'transport.view'),
  ('parent', 'attendance.view'),
  ('parent', 'exams.view'),
  ('parent', 'fees.view'),
  ('parent', 'homework.view'),
  ('parent', 'hostel.view'),
  ('parent', 'leave.apply'),
  ('parent', 'leave.view'),
  ('parent', 'library.view'),
  ('parent', 'notices.view'),
  ('parent', 'transport.view');

-- The body is `0209`'s, unchanged except for the four literal lists, which
-- become one insert from the catalogue above.
create or replace function public.platform_start_school(
  p_school_name text,
  p_slug text,
  p_timezone text default 'Asia/Kolkata',
  p_session_name text default null,
  p_session_start date default null,
  p_session_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid; v_session uuid; v_admin_role uuid;
  v_slug text := lower(trim(p_slug));
  v_name text := trim(p_school_name);
  v_start date := coalesce(p_session_start, date_trunc('year', current_date)::date);
  v_end date;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if public.current_tenant_id() is not null then
    raise exception 'This login already belongs to a school.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from platform.operators o where o.user_id = v_uid) then
    raise exception 'This login runs the platform and cannot own a college on it. Use a separate account.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'A school needs a name.' using errcode = 'check_violation';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'The address may use lower-case letters, numbers and hyphens only, and must be at least three characters.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'The address %.schoolos.app is already taken.', v_slug using errcode = 'unique_violation';
  end if;
  v_end := coalesce(p_session_end, (v_start + interval '1 year' - interval '1 day')::date);
  insert into public.tenants (name, slug, timezone)
  values (v_name, v_slug, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata')) returning id into v_tenant;
  insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
  values (v_tenant, coalesce(nullif(trim(p_session_name), ''), to_char(v_start,'YYYY')||'-'||to_char(v_end,'YYYY')), v_start, v_end, true)
  returning id into v_session;
  insert into public.roles (tenant_id, code, name, tier) values
    (v_tenant,'admin','Administrator','principal'), (v_tenant,'teacher','Teacher','staff'),
    (v_tenant,'student','Student','student'), (v_tenant,'parent','Parent','student'),
    (v_tenant,'accountant','Accountant','staff'), (v_tenant,'librarian','Librarian','staff');
  select id into v_admin_role from public.roles where tenant_id = v_tenant and code = 'admin';
  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, v_admin_role, code from reference.permissions;
  -- Everybody else starts from the catalogue (0269), never from a list here.
  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, d.permission_code
  from public.roles r
  join reference.role_permission_defaults d on d.role_code = r.code
  where r.tenant_id = v_tenant;
  insert into public.subscriptions (tenant_id, plan_code, status, trial_ends_on)
  values (v_tenant, 'trial', 'trialing', (current_date + 30));
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('tenant_id', v_tenant, 'role','admin')
  where id = v_uid;
  insert into public.user_profiles (id, tenant_id, role_id) values (v_uid, v_tenant, v_admin_role)
  on conflict (id) do update set tenant_id = excluded.tenant_id, role_id = excluded.role_id;
  return jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'session_id', v_session,
    'trial_ends_on', current_date + 30, 'refresh_session_required', true);
end;
$$;

commit;
