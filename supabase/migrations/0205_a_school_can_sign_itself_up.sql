-- 0205 — A school can sign itself up
--
-- Twenty-five modules, and no way to become a customer. Migration `0002` says
-- it plainly — *"Tenant provisioning (insert/update/delete) is a privileged,
-- out-of-band operation performed with the service role"* — and the only
-- `insert into public.tenants` in two hundred migrations is the demo seed. So
-- onboarding a school meant somebody running SQL by hand, and `invitations`,
-- which rule 3 builds the whole signup path on, had an "admins manage
-- invitations" policy since `0005` and **no caller anywhere in `src/`**.
--
-- That is this codebase's own recurring shape, arriving at the front door:
-- *a correct write path nobody can call is not a fix.*
--
-- Three things this adds, and one it deliberately refuses.
--
-- ## The plan catalogue is data, not branches (rule 12)
--
-- `reference.plans` sits beside `reference.permissions`, `reference.reports`
-- and `reference.checks` — the fourth catalogue, and outside `public` for the
-- same reason they are: rule 1's invariant test requires every `public` table
-- to carry `tenant_id`, and a plan belongs to no tenant. Limits are a jsonb
-- document, so "how many students may a school on Standard have" is a row a
-- person edits, not a release.
--
-- ## A subscription is a tenant's own row (rule 1)
--
-- `public.subscriptions` carries `tenant_id not null` and RLS, like everything
-- else in `public`. Members may **read** their school's plan — a bursar being
-- told "you are on Standard, 250 students" is the whole point — and there is
-- **no write policy at all**. That absence is the mechanism, exactly as it is
-- on `notification_deliveries` and `student_leave_requests`: the only writers
-- are the definer functions below and, later, the billing webhook. A migration
-- that tidily "adds the missing update policy" hands every administrator their
-- own pricing.
--
-- ## A seat limit is a rule about how many other rows exist
--
-- Rule 4's second boundary: no constraint sees a second row, so a count limit
-- lives in a function with the numbers in the message. The difference here is
-- *where* it has to hang. A bus seat is checked inside `transport_assign_student`
-- because that is the only way a seat is ever made — but a student is created by
-- a server action doing a plain insert, and a plain insert through PostgREST
-- routes around any function. So this is a `BEFORE INSERT` trigger, which is the
-- only thing that catches every writer, and it is on the two tables that decide
-- what a school is paying for: children on the roll, and logins.
--
-- ## What it refuses: a platform-operator console
--
-- Reading across tenants is the one thing rule 1 exists to make impossible, and
-- a "manage all schools" screen is that by definition. Nothing here creates a
-- role, a policy exception or a definer read model that can see two tenants at
-- once. When that console is built it needs its own decision, its own schema and
-- its own guard — not a quiet exception bolted onto this.

begin;

-- ---------------------------------------------------------------------------
-- The plan catalogue
-- ---------------------------------------------------------------------------

create table if not exists reference.plans (
  code           text primary key,
  name           text not null,
  description    text not null,
  -- Minor units, per rule 6's instinct about money: an integer number of paise,
  -- never a float. Null price is a plan nobody is charged for.
  price_minor    bigint check (price_minor is null or price_minor >= 0),
  currency       text not null default 'INR',
  bill_every     text not null default 'month' check (bill_every in ('month', 'year')),
  -- {"students": 250, "staff": 40} — a missing key means no ceiling, which is
  -- rule 12's "a missing key means the conservative reading" inverted on
  -- purpose: the conservative reading for a *limit* is not to invent one, or a
  -- school upgrading to a plan that forgot to mention staff cannot add any.
  limits         jsonb not null default '{}'::jsonb,
  -- A plan a school may choose for itself. A bespoke plan is a row with this
  -- false, which is how "we agreed a price with this district" is representable
  -- without a second table.
  is_public      boolean not null default true,
  sort           integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists set_updated_at on reference.plans;
create trigger set_updated_at before update on reference.plans
  for each row execute function public.set_updated_at();

-- Same shape as reference.permissions: no tenant data, so no RLS, and writes
-- are revoked rather than policed. Do not "fix" this by enabling RLS without
-- policies — that would break every read.
grant select on reference.plans to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on reference.plans
  from anon, authenticated;

comment on table reference.plans is
  'Subscription plans, catalogued as data (rule 12). Outside public because a '
  'plan belongs to no tenant and rule 1''s invariant requires every public table '
  'to carry tenant_id. RLS is deliberately off: it holds no tenant data and '
  'writes are revoked by GRANT.';

insert into reference.plans (code, name, description, price_minor, bill_every, limits, sort)
values
  ('trial', 'Trial', 'Thirty days, the whole product, one school.',
     0, 'month', '{"students": 50, "staff": 10}'::jsonb, 1),
  ('standard', 'Standard', 'A single school up to 250 children.',
     499900, 'month', '{"students": 250, "staff": 40}'::jsonb, 2),
  ('premium', 'Premium', 'Larger schools, no ceiling on the roll.',
     1499900, 'month', '{}'::jsonb, 3)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- One subscription per tenant
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  plan_code                text not null references reference.plans(code),
  status                   text not null default 'trialing'
                             check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_on            date,
  current_period_end       date,
  -- Filled in by the billing webhook, never by a person. Rule 6: the provider's
  -- own identifiers are what makes a callback idempotent.
  provider                 text check (provider is null or provider in ('razorpay')),
  provider_customer_id     text,
  provider_subscription_id text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- (tenant_id) is unique, so it is also the covering index for every lookup
  -- here. A separate subscriptions_tenant_idx would be a strict prefix of it and
  -- `index_guard_violations()` would say so (migration 0204).
  constraint subscriptions_one_per_tenant unique (tenant_id)
);

create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create trigger audit_subscriptions
  after insert or update or delete on public.subscriptions
  for each row execute function public.audit_row_change();

alter table public.subscriptions enable row level security;

-- Read: anybody in the school. What plan the school is on is not a secret from
-- the people working under it, and a bursar who cannot see the ceiling cannot
-- plan for it.
create policy "tenant members view own subscription" on public.subscriptions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Write: nothing. Deliberately no INSERT, UPDATE or DELETE policy — the writers
-- are the definer functions in this migration and the billing callback that
-- follows. This absence is the mechanism, not an omission; a later migration
-- that "adds the missing update policy" lets an administrator move their own
-- school onto the free plan.

comment on table public.subscriptions is
  'One row per tenant. Readable by every member of the school, writable by '
  'nobody: the only writers are SECURITY DEFINER functions and the billing '
  'callback. The absent write policy is the mechanism — do not add one.';

-- ---------------------------------------------------------------------------
-- What the school is using, and what it is allowed
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, so RLS decides what it can count — which is right, because
-- every caller is a member of exactly one school and the counts are of their
-- own rows. Returns the limit *and* the usage: rule 12's "a measurement and a
-- decision are two columns", applied to a ceiling.
create or replace function public.subscription_usage()
returns table (
  resource   text,
  used       bigint,
  allowed    bigint,
  over       boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with plan as (
    select p.limits
    from public.subscriptions s
    join reference.plans p on p.code = s.plan_code
    where s.tenant_id = public.current_tenant_id()
  ),
  counted as (
    select 'students'::text as resource,
           (select count(*) from public.students where status = 'active') as used
    union all
    select 'staff',
           (select count(*) from public.staff where status = 'active')
  )
  select c.resource,
         c.used,
         (select (limits ->> c.resource)::bigint from plan) as allowed,
         case
           when (select (limits ->> c.resource)::bigint from plan) is null then false
           else c.used > (select (limits ->> c.resource)::bigint from plan)
         end as over
  from counted c
  order by c.resource;
$$;

comment on function public.subscription_usage() is
  'What this school uses against what its plan allows. A null `allowed` is a '
  'plan with no ceiling for that resource, which is not the same as a ceiling '
  'of zero — the two must never be collapsed on a screen.';

-- The enforcement half. SECURITY DEFINER because it reads `subscriptions`,
-- which has no policy problem, and `reference.plans`, which any role may read —
-- but the count it takes must be of *every* row in the tenant, not the rows the
-- caller happens to be allowed to see. A teacher inserting a student must be
-- refused on the school's true roll, not on their own visible subset. That is
-- exactly the invoker-function trap this codebase already documented once, so
-- it is a definer here, and it filters by tenant itself (which, per rule 11, is
-- the one kind of function that may).
create or replace function public.subscription_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant   uuid := new.tenant_id;
  v_resource text := tg_argv[0];
  v_allowed  bigint;
  v_used     bigint;
  v_plan     text;
begin
  select s.plan_code, (p.limits ->> v_resource)::bigint
    into v_plan, v_allowed
  from public.subscriptions s
  join reference.plans p on p.code = s.plan_code
  where s.tenant_id = v_tenant;

  -- No subscription row, or a plan with no ceiling for this resource, is not a
  -- refusal. A school seeded before this migration has no subscription and must
  -- keep working.
  if v_allowed is null then
    return new;
  end if;

  if v_resource = 'students' then
    select count(*) into v_used from public.students
    where tenant_id = v_tenant and status = 'active';
  elsif v_resource = 'staff' then
    select count(*) into v_used from public.staff
    where tenant_id = v_tenant and status = 'active';
  else
    return new;
  end if;

  if v_used >= v_allowed then
    -- The numbers in the message, per rule 4. "Limit exceeded" tells somebody
    -- standing at an admission desk nothing they can act on.
    raise exception
      'The % plan covers % %, and this school already has %. Upgrade the plan to add more.',
      v_plan, v_allowed, v_resource, v_used
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.subscription_enforce_limit() is
  'A seat limit is a rule about how many other rows exist, which no constraint '
  'can see (rule 4). It is a trigger rather than a check inside a write function '
  'because students and staff are created by plain inserts from server actions, '
  'and a plain insert through PostgREST routes around any function.';

create trigger enforce_student_limit
  before insert on public.students
  for each row execute function public.subscription_enforce_limit('students');

create trigger enforce_staff_limit
  before insert on public.staff
  for each row execute function public.subscription_enforce_limit('staff');

-- ---------------------------------------------------------------------------
-- Provisioning: the caller who signed up and has no school yet
-- ---------------------------------------------------------------------------

-- Rule 3 says a signup with no matching invitation gets no tenant, and calls
-- that "the correct failure mode". It is — and it is also exactly the state a
-- person is in one second after deciding to start a school. So that state is
-- the authorisation: this function serves a caller who is authenticated and
-- belongs to no tenant, and refuses everybody else. One school per login,
-- enforced by the same test.
create or replace function public.platform_start_school(
  p_school_name   text,
  p_slug          text,
  p_timezone      text default 'Asia/Kolkata',
  p_session_name  text default null,
  p_session_start date default null,
  p_session_end   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid;
  v_session    uuid;
  v_admin_role uuid;
  v_slug       text := lower(trim(p_slug));
  v_name       text := trim(p_school_name);
  v_start      date := coalesce(p_session_start, date_trunc('year', current_date)::date);
  v_end        date;
  v_email      text;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;

  -- The whole authorisation, in one line: a caller who already belongs to a
  -- school is not starting one.
  if public.current_tenant_id() is not null then
    raise exception 'This login already belongs to a school.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'A school needs a name.' using errcode = 'check_violation';
  end if;

  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception
      'The address may use lower-case letters, numbers and hyphens only, and must be at least three characters.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.tenants where slug = v_slug) then
    raise exception 'The address %.schoolos.app is already taken.', v_slug
      using errcode = 'unique_violation';
  end if;

  v_end := coalesce(p_session_end, (v_start + interval '1 year' - interval '1 day')::date);

  insert into public.tenants (name, slug, timezone)
  values (v_name, v_slug, coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata'))
  returning id into v_tenant;

  -- The first academic year. Rule 2: everything transactional is scoped to one,
  -- so a school with none has a product that cannot record anything.
  insert into public.academic_sessions (tenant_id, name, start_date, end_date, is_current)
  values (
    v_tenant,
    coalesce(nullif(trim(p_session_name), ''),
             to_char(v_start, 'YYYY') || '-' || to_char(v_end, 'YYYY')),
    v_start, v_end, true
  )
  returning id into v_session;

  -- The six roles of rule 3. Per-tenant rows, so this school can add its own
  -- later without touching anybody else's.
  insert into public.roles (tenant_id, code, name) values
    (v_tenant, 'admin', 'Administrator'),
    (v_tenant, 'teacher', 'Teacher'),
    (v_tenant, 'student', 'Student'),
    (v_tenant, 'parent', 'Parent'),
    (v_tenant, 'accountant', 'Accountant'),
    (v_tenant, 'librarian', 'Librarian');

  select id into v_admin_role from public.roles
  where tenant_id = v_tenant and code = 'admin';

  -- The starting matrix. Deliberately the same one the demo tenant seeds, so a
  -- new school and the school this product was designed against behave
  -- identically on day one. A school narrows it afterwards from /settings.
  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, v_admin_role, code from reference.permissions;

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code
  from public.roles r
  join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'teacher'
    and p.code in ('students.view', 'guardians.view', 'academics.view',
                   'attendance.view', 'attendance.mark', 'exams.view', 'exams.grade',
                   'homework.view', 'homework.manage', 'library.view', 'reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code
  from public.roles r
  join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'accountant'
    and p.code in ('students.view', 'fees.view', 'fees.collect', 'reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code
  from public.roles r
  join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code = 'librarian'
    and p.code in ('students.view', 'library.view', 'library.manage',
                   'library.issue', 'library.return', 'reports.view');

  insert into public.role_permissions (tenant_id, role_id, permission_code)
  select v_tenant, r.id, p.code
  from public.roles r
  join reference.permissions p on true
  where r.tenant_id = v_tenant and r.code in ('student', 'parent')
    and p.code in ('homework.view', 'library.view', 'exams.view',
                   'attendance.view', 'fees.view');

  -- Thirty days of everything. `trialing`, not `active`: the billing callback
  -- is what makes a school active, and a status that lies about having been
  -- paid for is how a product loses track of its own revenue.
  insert into public.subscriptions (tenant_id, plan_code, status, trial_ends_on)
  values (v_tenant, 'trial', 'trialing', (current_date + 30));

  -- No `settings` rows are seeded on purpose. `reference.settings_catalog`
  -- holds THE default and `setting_value` is the only place one is applied;
  -- writing them here would be the sixth copy of a default that migration 0101
  -- already paid to delete once.

  -- Finally the caller becomes this school's administrator. Stamped into the
  -- JWT the same way handle_new_auth_user does it, so RLS sees the tenant on
  -- the very next request.
  select email into v_email from auth.users where id = v_uid;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', v_tenant, 'role', 'admin')
  where id = v_uid;

  insert into public.user_profiles (id, tenant_id, role_id)
  values (v_uid, v_tenant, v_admin_role)
  on conflict (id) do update
    set tenant_id = excluded.tenant_id, role_id = excluded.role_id;

  return jsonb_build_object(
    'tenant_id', v_tenant,
    'slug', v_slug,
    'session_id', v_session,
    'trial_ends_on', current_date + 30,
    -- The caller's JWT is stale from this moment: it was minted before the
    -- stamp above. The app has to refresh the session or the next request is
    -- still tenantless, and a screen that does not say so looks broken.
    'refresh_session_required', true
  );
end;
$$;

comment on function public.platform_start_school(text, text, text, text, date, date) is
  'Self-serve provisioning. Authorised by the caller having no tenant — which is '
  'precisely the state rule 3 leaves a signup in when no invitation matches — so '
  'it serves exactly one school per login and refuses every existing member.';

revoke all on function public.platform_start_school(text, text, text, text, date, date)
  from public, anon;
grant execute on function public.platform_start_school(text, text, text, text, date, date)
  to authenticated;

-- Is this address free? Called from the signup form before anybody commits to
-- typing the rest. Deliberately says nothing about the school that holds a
-- taken slug.
create or replace function public.platform_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.tenants where slug = lower(trim(p_slug)));
$$;

revoke all on function public.platform_slug_available(text) from public;
grant execute on function public.platform_slug_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: every school that exists already
-- ---------------------------------------------------------------------------

-- The demo tenant predates all of this and must not become unusable. It gets
-- premium (no ceilings) rather than a trial that would expire behind it.
insert into public.subscriptions (tenant_id, plan_code, status)
select t.id, 'premium', 'active'
from public.tenants t
where not exists (select 1 from public.subscriptions s where s.tenant_id = t.id);

commit;
