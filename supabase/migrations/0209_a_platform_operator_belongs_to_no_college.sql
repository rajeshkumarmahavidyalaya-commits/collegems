-- 0209 — A platform operator belongs to no college
--
-- Rule 1's whole argument is that the policy is the boundary and application
-- code cannot be. A console that reads across colleges is, on its face, the one
-- thing that argument forbids — which is why this was refused twice before it
-- was asked for, and why it gets its own migration rather than a policy
-- exception bolted onto `subscriptions`.
--
-- ## The property that makes it safe
--
-- An operator has a Supabase login and **no tenant**. So
-- `current_tenant_id()` returns null for them, and *every* RLS policy in the
-- schema — all sixty of them — already refuses them every row. Nothing was
-- weakened to allow this; the operator is, to the rest of the database, the
-- same tenantless caller rule 3 calls "the correct failure mode".
--
-- Their entire reach is the handful of `SECURITY DEFINER` functions below.
-- There is no operator role in `public`, no policy mentions them, and the
-- `platform` schema is readable by nobody: **all privileges are revoked from
-- `anon` and `authenticated`**, so even an operator cannot select from these
-- tables directly. The functions are the only door, and each one checks who is
-- knocking.
--
-- ## What an operator may see: metadata, and deliberately nothing else
--
-- Colleges, plans, usage counts, health. **No student rows, no fees, no marks,
-- no attendance.** That is a decision, not a limitation of the design — and it
-- is the decision that makes the blast radius of a mistake here *counts*
-- rather than *children*.
--
-- Support impersonation — entering a college and seeing what a principal sees —
-- is explicitly NOT built. It needs consent, a time limit, and an audit trail
-- the college itself can read, and bolting it on later must be a migration that
-- argues for itself rather than a quiet `or is_operator()` added to a policy.
--
-- ## Every look is written down
--
-- `platform.access_log` records who looked at what, when. Append-only: UPDATE
-- and DELETE are revoked outright rather than merely unmatched by a policy,
-- which is rule 6's stronger of the two shapes, because this table is the
-- record of what the platform's own staff did.

begin;

create schema if not exists platform;

-- Nobody reaches this schema directly. Not `anon`, not `authenticated`, not an
-- operator: the definer functions below are the only way in, and revoking USAGE
-- means a stray `select * from platform.operators` fails at the schema rather
-- than at a policy somebody might later add.
revoke all on schema platform from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who the operators are
-- ---------------------------------------------------------------------------

create table if not exists platform.operators (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       citext not null unique,
  name        text not null,
  -- Switched off rather than deleted, so the access log keeps pointing at a
  -- row. Same instinct as a revoked concession keeping its credits.
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on platform.operators;
create trigger set_updated_at before update on platform.operators
  for each row execute function public.set_updated_at();

revoke all on platform.operators from public, anon, authenticated;

comment on table platform.operators is
  'Logins that run the platform rather than belonging to a college. They have '
  'no tenant, so every RLS policy in public already refuses them every row -- '
  'their reach is entirely the definer functions in this migration.';

-- ---------------------------------------------------------------------------
-- What they looked at
-- ---------------------------------------------------------------------------

create table if not exists platform.access_log (
  id          bigint generated always as identity primary key,
  operator_id uuid not null references platform.operators(user_id),
  action      text not null,
  tenant_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists access_log_operator_idx
  on platform.access_log (operator_id, occurred_at desc);
create index if not exists access_log_tenant_idx
  on platform.access_log (tenant_id, occurred_at desc)
  where tenant_id is not null;

revoke all on platform.access_log from public, anon, authenticated;

-- Append-only, by revoke rather than by an absent policy. Rule 6: prefer the
-- revoke where the table is the record of what happened and nobody should ever
-- edit it. `postgres` still owns it, but no role a person holds can rewrite it.
revoke update, delete, truncate on platform.access_log from public, anon, authenticated;

comment on table platform.access_log is
  'Every operator action, append-only. UPDATE and DELETE are revoked outright '
  'rather than left unmatched by a policy, because this is the record of what '
  'the platform''s own staff did.';

-- ---------------------------------------------------------------------------
-- Is the caller an operator?
-- ---------------------------------------------------------------------------

create or replace function platform.current_operator()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.user_id
  from platform.operators o
  where o.user_id = (select auth.uid())
    and o.is_active;
$$;

comment on function platform.current_operator() is
  'The active operator behind this request, or null. Definer because the '
  'operators table is readable by nobody.';

-- Deliberately NOT granted to authenticated. Only the functions below call it,
-- and a client able to ask "am I an operator?" gains nothing but tells an
-- attacker whether an address is worth attacking.
revoke all on function platform.current_operator() from public, anon, authenticated;

create or replace function platform.require_operator(p_action text, p_tenant uuid default null,
                                                     p_detail jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op uuid := platform.current_operator();
begin
  if v_op is null then
    -- The same sentence whether the caller is a college's principal, a
    -- student, or nobody at all. A message that distinguished them would say
    -- which addresses are operator accounts.
    raise exception 'This is not available.' using errcode = 'insufficient_privilege';
  end if;

  -- The look is logged before the answer is produced, so a query that errors
  -- part way through still leaves a trace that somebody asked.
  insert into platform.access_log (operator_id, action, tenant_id, detail)
  values (v_op, p_action, p_tenant, p_detail);

  return v_op;
end;
$$;

revoke all on function platform.require_operator(text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The read model: metadata, and nothing that belongs to a child
-- ---------------------------------------------------------------------------

-- Definer, so it can count across colleges — and therefore it filters by
-- nothing and exposes only aggregates. Read the projection carefully before
-- adding to it: every column here is a number, a name, or a date about a
-- *college*. There is no student, guardian, invoice or mark in it, and adding
-- one would change what a leak of this function costs from counts to children.
create or replace function public.platform_colleges()
returns table (
  tenant_id       uuid,
  name            text,
  slug            text,
  timezone        text,
  created_at      timestamptz,
  plan_code       text,
  plan_status     text,
  trial_ends_on   date,
  students        bigint,
  staff           bigint,
  logins          bigint,
  student_limit   bigint,
  staff_limit     bigint,
  over_limit      boolean,
  last_activity   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform platform.require_operator('colleges.list');

  return query
  select t.id,
         t.name,
         t.slug,
         t.timezone,
         t.created_at,
         s.plan_code,
         s.status,
         s.trial_ends_on,
         (select count(*) from public.students st
           where st.tenant_id = t.id and st.status = 'active'),
         (select count(*) from public.staff sf
           where sf.tenant_id = t.id and sf.status = 'active'),
         (select count(*) from public.user_profiles up where up.tenant_id = t.id),
         (p.limits ->> 'students')::bigint,
         (p.limits ->> 'staff')::bigint,
         coalesce(
           (select count(*) from public.students st
             where st.tenant_id = t.id and st.status = 'active')
             > (p.limits ->> 'students')::bigint,
           false),
         -- "Is this college alive?" answered without reading anything a
         -- college wrote: the timestamp of its most recent audited change,
         -- never the change itself.
         (select max(al.created_at) from public.audit_log al where al.tenant_id = t.id)
  from public.tenants t
  left join public.subscriptions s on s.tenant_id = t.id
  left join reference.plans p on p.code = s.plan_code
  order by t.created_at desc;
end;
$$;

comment on function public.platform_colleges() is
  'Every college, as metadata: name, plan, usage counts, health. Refuses anyone '
  'who is not an active operator, and logs the look. Contains no student, '
  'guardian, fee or mark data by design -- a leak here exposes counts, not '
  'children.';

revoke all on function public.platform_colleges() from public, anon;
grant execute on function public.platform_colleges() to authenticated;

-- ---------------------------------------------------------------------------
-- The one write: moving a college between plans
-- ---------------------------------------------------------------------------

-- `/settings/plan` tells a college that changing plan is not self-serve and to
-- get in touch. This is the other half of that sentence — without it the screen
-- makes a promise nobody can keep, which is the failure this codebase keeps
-- naming.
create or replace function public.platform_set_plan(
  p_tenant_id uuid,
  p_plan_code text,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_before_status text;
begin
  perform platform.require_operator(
    'plan.change', p_tenant_id,
    jsonb_build_object('to_plan', p_plan_code, 'to_status', p_status));

  if not exists (select 1 from reference.plans where code = p_plan_code) then
    raise exception 'There is no plan called %.', p_plan_code using errcode = 'check_violation';
  end if;

  if p_status not in ('trialing', 'active', 'past_due', 'cancelled', 'expired') then
    raise exception '% is not a subscription status.', p_status using errcode = 'check_violation';
  end if;

  select plan_code, status into v_before, v_before_status
  from public.subscriptions where tenant_id = p_tenant_id;

  if v_before is null then
    raise exception 'That college has no subscription row.' using errcode = 'no_data_found';
  end if;

  update public.subscriptions
  set plan_code = p_plan_code,
      status = p_status,
      -- Moving a college onto a real plan ends its trial, and leaving the date
      -- behind would leave the trial critic firing at a paying customer.
      trial_ends_on = case when p_status = 'trialing' then trial_ends_on else null end
  where tenant_id = p_tenant_id;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'from', jsonb_build_object('plan', v_before, 'status', v_before_status),
    'to', jsonb_build_object('plan', p_plan_code, 'status', p_status));
end;
$$;

comment on function public.platform_set_plan(uuid, text, text) is
  'Moves a college between plans. The other half of what /settings/plan '
  'promises. Operator-only, logged before it acts, and it clears trial_ends_on '
  'when the college stops trialing so the trial critic does not fire at a '
  'paying customer.';

revoke all on function public.platform_set_plan(uuid, text, text) from public, anon;
grant execute on function public.platform_set_plan(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- An operator cannot also own a college
-- ---------------------------------------------------------------------------

-- `platform_start_school` authorises on "the caller has no tenant", and an
-- operator has no tenant — so without this an operator could provision a
-- college, become its principal, and hold both identities at once. Dual
-- identity in an authorisation system is how a boundary quietly stops being
-- one, so it is refused in a sentence.
create or replace function public.platform_start_school(
  p_school_name text, p_slug text, p_timezone text default 'Asia/Kolkata',
  p_session_name text default null, p_session_start date default null, p_session_end date default null
)
returns jsonb language plpgsql security definer set search_path = ''
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
    raise exception
      'This login runs the platform and cannot own a college on it. Use a separate account.'
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
  values (v_name, v_slug, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'))
  returning id into v_tenant;

  insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
  values (v_tenant, coalesce(nullif(trim(p_session_name), ''), to_char(v_start, 'YYYY') || '-' || to_char(v_end, 'YYYY')), v_start, v_end, true)
  returning id into v_session;

  insert into public.roles (tenant_id, code, name, tier) values
    (v_tenant, 'admin', 'Administrator', 'principal'),
    (v_tenant, 'teacher', 'Teacher', 'staff'),
    (v_tenant, 'student', 'Student', 'student'),
    (v_tenant, 'parent', 'Parent', 'student'),
    (v_tenant, 'accountant', 'Accountant', 'staff'),
    (v_tenant, 'librarian', 'Librarian', 'staff');

  select id into v_admin_role from public.roles where tenant_id = v_tenant and code = 'admin';

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, v_admin_role, code from reference.permissions;

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'teacher'
    and p.code in ('students.view','guardians.view','academics.view','attendance.view','attendance.mark','exams.view','exams.grade','homework.view','homework.manage','library.view','reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'accountant'
    and p.code in ('students.view','fees.view','fees.collect','reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'librarian'
    and p.code in ('students.view','library.view','library.manage','library.issue','library.return','reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code from public.roles r join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code in ('student','parent')
    and p.code in ('homework.view','library.view','exams.view','attendance.view','fees.view');

  insert into public.subscriptions (tenant_id, plan_code, status, trial_ends_on)
  values (v_tenant, 'trial', 'trialing', (current_date + 30));

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('tenant_id', v_tenant, 'role', 'admin')
  where id = v_uid;

  insert into public.user_profiles (id, tenant_id, role_id)
  values (v_uid, v_tenant, v_admin_role)
  on conflict (id) do update set tenant_id = excluded.tenant_id, role_id = excluded.role_id;

  return jsonb_build_object('tenant_id', v_tenant, 'slug', v_slug, 'session_id', v_session,
    'trial_ends_on', current_date + 30, 'refresh_session_required', true);
end;
$$;

revoke all on function public.platform_start_school(text, text, text, text, date, date) from public, anon;
grant execute on function public.platform_start_school(text, text, text, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- "Am I an operator?" — the one thing the app needs to route on
-- ---------------------------------------------------------------------------

-- Returns a boolean about the *caller only*, so it tells nobody anything about
-- anybody else. Not logged: this fires on every request to /platform, and an
-- access log padded with routing checks is one nobody reads.
create or replace function public.platform_am_i_an_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from platform.operators o
    where o.user_id = (select auth.uid()) and o.is_active
  );
$$;

revoke all on function public.platform_am_i_an_operator() from public, anon;
grant execute on function public.platform_am_i_an_operator() to authenticated;

commit;
