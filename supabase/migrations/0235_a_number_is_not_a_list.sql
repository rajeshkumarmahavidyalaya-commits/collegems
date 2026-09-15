-- 0235 -- A number is not a list.
--
-- `family_login_problems()` says *"301 of 302 active students have nobody who
-- can sign in"* and stops. An office reading that has to do something about
-- 301 named children, and the sentence names none of them; the link underneath
-- goes to `/settings/team`, which is a form for inviting one person at a time.
--
-- Rule 11 decides the shape without argument: **do not add a screen to answer a
-- question.** The list is a catalogue row — `reference.reports` plus one
-- `SECURITY INVOKER` function — and `/reports` renders it without being edited.
--
-- ## …and the critic was lying to somebody already
--
-- Writing the report meant reading the critic, and the critic has the shape
-- this file has now recorded three times: a `not exists` whose two sides are
-- narrowed by **different** policies.
--
--   * `students` is readable by every staff role.
--   * `user_profiles` has exactly two SELECT policies: *admins view tenant
--     profiles*, and *self views own profile*.
--   * `invitations` is admin-only, full stop.
--
-- So to anybody who is not an administrator, no child's family has a login,
-- because no child's family *is visible to have one*. Absence and invisibility
-- are the same shape, which is precisely `student_exit_problems` accusing a
-- teacher's 200 children and `attendance_coverage` reporting eleven classes at
-- 0.0%.
--
-- It is gated on `users.manage`, which today only `admin` holds — so the bug is
-- invisible until a college grants that permission to its office clerk, which
-- `/settings/permissions` now lets it do on any Tuesday. Demonstrated by
-- granting it to the Accountant role in a rolled-back transaction, with one
-- guardian given a real login so that 301 is the true answer:
--
--   | seat                          | family.no_login   | family.stale_invitations |
--   |-------------------------------|-------------------|--------------------------|
--   | admin                         | 301 of 302, info  | 1 expired                |
--   | accountant + `users.manage`   | **302 of 302**, warn | **absent**            |
--
-- Three defects in one function and one seat: an over-report, a **severity
-- escalation** from `info` to `warn` (because `v_without = v_total` is the
-- warn condition, and an invisible login makes that true), and a silent
-- under-report of the second finding. None of them detectable from the seat
-- anybody tests with.
--
-- ## One definition, consulted by both
--
-- `attendance_coverage`'s rule says to narrow the wide side to the rows the
-- caller could have seen the evidence for. **There is no such narrowing here**:
-- `user_profiles` is all-or-nothing per role, so there is no per-student subset
-- that makes the question answerable. The honest alternative is the one rule 4
-- already names for `staff_directory()`:
--
-- > **A definer read model must filter by tenant itself, and it is the only
-- > kind that may.** Inside a definer no policy runs, so that predicate *is* the
-- > isolation.
--
-- `family_login_status()` is that: definer, tenant-filtered, gated on
-- `users.manage` in its own body, and returning **no profile id, no user id and
-- no role** — one row per active student saying what is in the way. The cost of
-- a mistake here is therefore a guardian's name and telephone number, which
-- every staff role can already read from `people`, plus one boolean.
--
-- Both callers consult it, so the critic's number and the report's row count
-- cannot disagree — which is rule 11's own instruction (*wrap the module's own
-- read path*) applied to a critic rather than to a report.

begin;

-- ---------------------------------------------------------------------------
-- What is in the way, per child
-- ---------------------------------------------------------------------------

create or replace function public.family_login_status(p_section_id uuid default null)
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  section_label text,
  guardian_count integer,
  contact_name text,
  contact_email text,
  contact_phone text,
  state text
)
language plpgsql
security definer
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- Not a silent empty: a definer that answered nothing to a caller who may not
  -- ask is indistinguishable from a school where every family can sign in.
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot see who can sign in to this school.';
  end if;

  return query
  with kids as (
    select
      s.id,
      s.admission_number,
      btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as full_name,
      (select cl.name || ' · ' || sec.name
       from public.enrolments e
       join public.sections sec on sec.id = e.section_id
       join public.class_levels cl on cl.id = sec.class_level_id
       where e.student_id = s.id and e.status = 'active'
         and e.session_id = public.current_session_id(v_tenant_id)
       limit 1) as section_label,
      exists (select 1 from public.user_profiles up where up.student_id = s.id) as self_login
    from public.students s
    join public.people p on p.id = s.person_id
    where s.tenant_id = v_tenant_id
      and s.status = 'active'
      and (p_section_id is null or exists (
        select 1 from public.enrolments e
        where e.student_id = s.id and e.section_id = p_section_id and e.status = 'active'))
  ),
  -- The best contact this child has, and "best" is the school's own answer:
  -- `guardian_student.is_primary` is a partial unique index since `0221`, so
  -- there is at most one and the order below is deterministic rather than
  -- "whichever row the join happened to return".
  contacts as (
    select
      k.id as student_id,
      count(gs.guardian_id)::integer as guardian_count,
      count(*) filter (
        where nullif(btrim(coalesce(gp.email::text, '')), '') is not null
           or nullif(btrim(coalesce(gp.phone, '')), '') is not null
      )::integer as contactable,
      bool_or(exists (
        select 1 from public.user_profiles up where up.guardian_id = gs.guardian_id
      )) as any_guardian_login,
      bool_or(exists (
        select 1 from public.invitations i
        where i.guardian_id = gs.guardian_id and i.status = 'pending' and i.expires_at > now()
      )) as invitation_open,
      bool_or(exists (
        select 1 from public.invitations i
        where i.guardian_id = gs.guardian_id and i.status = 'pending' and i.expires_at <= now()
      )) as invitation_expired,
      (array_agg(
        btrim(gp.first_name || ' ' || coalesce(gp.last_name, ''))
        order by gs.is_primary desc, gp.first_name, gs.guardian_id
      ))[1] as contact_name,
      (array_agg(
        nullif(btrim(coalesce(gp.email::text, '')), '')
        order by gs.is_primary desc, gp.first_name, gs.guardian_id
      ))[1] as contact_email,
      (array_agg(
        nullif(btrim(coalesce(gp.phone, '')), '')
        order by gs.is_primary desc, gp.first_name, gs.guardian_id
      ))[1] as contact_phone
    from kids k
    join public.guardian_student gs on gs.student_id = k.id
    join public.guardians g on g.id = gs.guardian_id
    join public.people gp on gp.id = g.person_id
    group by k.id
  )
  select
    k.id,
    k.admission_number,
    k.full_name,
    k.section_label,
    coalesce(c.guardian_count, 0),
    c.contact_name,
    c.contact_email,
    c.contact_phone,
    case
      when k.self_login or coalesce(c.any_guardian_login, false) then 'ok'
      when coalesce(c.guardian_count, 0) = 0 then 'no_guardian'
      when coalesce(c.contactable, 0) = 0 then 'no_address'
      when coalesce(c.invitation_open, false) then 'invited'
      when coalesce(c.invitation_expired, false) then 'expired'
      else 'not_invited'
    end
  from kids k
  left join contacts c on c.student_id = k.id
  -- Worst first, then by class and name: the list is read from the top, and
  -- "nobody is linked at all" is further from a login than "invited, waiting".
  order by
    case
      when k.self_login or coalesce(c.any_guardian_login, false) then 5
      when coalesce(c.guardian_count, 0) = 0 then 0
      when coalesce(c.contactable, 0) = 0 then 1
      when coalesce(c.invitation_expired, false) then 2
      else 3
    end,
    k.section_label nulls last,
    k.full_name,
    k.id;
end;
$$;

revoke all on function public.family_login_status(uuid) from public, anon;

comment on function public.family_login_status(uuid) is
  'One row per active student saying what stands between their family and a '
  'login. Definer because user_profiles and invitations are admin-only, so an '
  'invoker version answers a non-admin "nobody can sign in" about every child '
  '-- absence and invisibility are the same shape. Filters by tenant itself, '
  'gated on users.manage, and returns no user id and no role.';

-- ---------------------------------------------------------------------------
-- The report
-- ---------------------------------------------------------------------------

create or replace function public.report_family_logins(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select to_jsonb(t)
  from (
    select
      f.admission_number,
      f.full_name as student,
      f.section_label as class,
      f.guardian_count as guardians,
      f.contact_name as contact,
      f.contact_email as email,
      f.contact_phone as phone,
      case f.state
        when 'no_guardian'  then 'No guardian linked'
        when 'no_address'   then 'No email or phone on any guardian'
        when 'not_invited'  then 'Nobody has been invited yet'
        when 'invited'      then 'Invited, waiting'
        when 'expired'      then 'Invitation expired'
        else f.state
      end as state
    from public.family_login_status(public.report_param_uuid(p_params, 'section')) f
    where f.state <> 'ok'
      and (
        public.report_param_text(p_params, 'state', null) is null
        or f.state = public.report_param_text(p_params, 'state', null)
      )
  ) t
$$;

comment on function public.report_family_logins(jsonb) is
  'The list behind users.family_logins. Only the children who cannot -- the '
  'roll is students.roster, and a report that answered both questions would '
  'bury this one.';

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values (
  'users.family_logins',
  'Families who cannot sign in',
  'Every active student whose family has no way into the app, worst first, with what is in the way. The counts on Needs attention come from this same list.',
  'Settings',
  'users.manage',
  'report_family_logins',
  '[
     {"name": "section", "type": "section", "label": "Class", "required": false},
     {"name": "state", "type": "select", "label": "What is in the way", "required": false,
      "options": [
        {"value": "no_guardian", "label": "No guardian linked"},
        {"value": "no_address", "label": "No email or phone"},
        {"value": "not_invited", "label": "Nobody invited yet"},
        {"value": "invited", "label": "Invited, waiting"},
        {"value": "expired", "label": "Invitation expired"}
      ]}
   ]'::jsonb,
  '[
     {"key": "admission_number", "type": "text", "label": "Adm. no."},
     {"key": "student", "type": "text", "label": "Student"},
     {"key": "class", "type": "text", "label": "Class"},
     {"key": "guardians", "type": "number", "align": "right", "label": "Guardians"},
     {"key": "contact", "type": "text", "label": "Contact"},
     {"key": "email", "type": "text", "label": "Email"},
     {"key": "phone", "type": "text", "label": "Phone"},
     {"key": "state", "type": "badge", "label": "What is in the way"}
   ]'::jsonb,
  99,
  'staff')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  module = excluded.module,
  required_permission = excluded.required_permission,
  function_name = excluded.function_name,
  parameters = excluded.parameters,
  columns = excluded.columns,
  sort_order = excluded.sort_order,
  audience = excluded.audience;

-- ---------------------------------------------------------------------------
-- The other half of the same blindness
-- ---------------------------------------------------------------------------

-- `invitations` is admin-only with no second policy at all, so the stale-
-- invitation finding did not over-report to a non-admin holding `users.manage`
-- — it **vanished**. An under-report is the quieter of the two failures and the
-- harder to notice: a page that says nothing reads exactly like a page with
-- nothing to say.
create or replace function public.family_login_stale_invitations()
returns integer
language plpgsql
security definer
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_count integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot see this school''s invitations.';
  end if;

  select count(*) into v_count
  from public.invitations i
  where i.tenant_id = v_tenant_id
    and i.status = 'pending'
    and i.expires_at <= now();

  return v_count;
end;
$$;

revoke all on function public.family_login_stale_invitations() from public, anon;

comment on function public.family_login_stale_invitations() is
  'How many invitations expired unaccepted. Definer and tenant-filtered for the '
  'same reason as family_login_status: invitations is admin-only, so an invoker '
  'count answers a non-admin zero and the finding disappears rather than being '
  'refused.';

-- ---------------------------------------------------------------------------
-- ...and the critic counts the same rows
-- ---------------------------------------------------------------------------

create or replace function public.family_login_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_total integer;
  v_without integer;
  v_stale integer;
begin
  if not public.role_has_permission('users.manage') then
    return;
  end if;

  -- One call, both numbers. The critic's count and the report's row count are
  -- now the same query, so a school cannot be told 301 and shown 287.
  select count(*), count(*) filter (where f.state <> 'ok')
    into v_total, v_without
  from public.family_login_status(null) f;

  if v_without > 0 then
    return query select
      'family.no_login',
      case when v_total > 0 and v_without = v_total then 'warn' else 'info' end,
      format(
        '%s of %s active %s %s nobody who can sign in: no fee account, timetable, result or absence notice reaches %s. The report "Families who cannot sign in" names them.',
        v_without,
        v_total,
        case when v_total   = 1 then 'student' else 'students' end,
        case when v_without = 1 then 'has'     else 'have'     end,
        case when v_without = 1 then 'that child''s family' else 'their families' end);
  end if;

  -- Deliberately still counted here rather than in `family_login_status`: a
  -- staff invitation that expired has nothing to do with a child, and folding
  -- it into a per-student read model would be a second answer to a different
  -- question. It reads `invitations` through this function's own definer
  -- helper for the same reason the count above does.
  select public.family_login_stale_invitations() into v_stale;

  if v_stale > 0 then
    return query select
      'family.stale_invitations',
      'info',
      format('%s %s expired without being accepted. %s to be sent again.',
        v_stale,
        case when v_stale = 1 then 'invitation has' else 'invitations have' end,
        case when v_stale = 1 then 'It needs'       else 'They need'        end);
  end if;
end;
$$;

commit;
