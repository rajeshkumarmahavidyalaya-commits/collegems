-- 0289: who can sign in, a leaver's login closes, and four deletes that
-- were guarded only by a button.
--
-- 1. **Nobody could see, change or remove a login.** Settings > Team listed
--    invitations; once one was accepted the person vanished from every screen.
--    `staff_exit` ended a teacher's lessons and library card and left their
--    login alone, and no policy consults `staff.status` -- they compare the
--    role in the token -- so a leaver read what any teacher reads.
--
--    * `team_logins()` lists the college's logins: who, which record, which
--      role, whether they can sign in, when they last did. Definer, because
--      the email lives in `auth.users`; gated on `users.manage`; the tenant is
--      filtered by hand (rule 4's definer shape).
--    * `login_set_access(user, active)` switches a login off or on. Off is
--      three things at once: `user_profiles.is_active`, the auth user banned
--      (`banned_until`), and their sessions ended, so the next page they open
--      signs them out and they cannot sign back in. An access token already
--      issued stays valid until it expires (at most an hour); that is the
--      honest limit of a token-based system and it is written here rather than
--      claimed away.
--    * `login_set_role(user, role)` changes what a login is for, only to a
--      role whose `roles.subject` the profile can satisfy (a Parent login must
--      name a guardian), and ends their sessions so the new role applies now.
--    * **A way back is always kept.** Neither function will remove the last
--      active login whose role holds `users.manage` -- the same instinct as
--      `keep_a_way_back` on the matrix (0212) -- and neither acts on the caller.
--    * **A leaver's login closes by itself.** A trigger on `staff` switches
--      off every login linked to somebody whose status leaves `active`, by
--      whatever path. One act that ends the relationships (rule 12), not a
--      step the office has to remember. It skips the last way back and says
--      so with a notice rather than locking a college out.
--
-- 2. **Four deletes the database accepted and the screen merely discouraged.**
--    Each is refused while it has history, in a sentence, by a trigger:
--      * an exam once **published** (its results reached families) -- and a
--        paper of one. Unpublish first; that is audited and reversible.
--      * homework with **marked** submissions. Unpublish it instead.
--      * a period that **cover arrangements** name -- a record of who
--        covered whom, which would cascade away with the lessons.
--      * a book that has **ever been lent**. Set its copies to 0 instead.

-- ---------------------------------------------------------------------------
-- 1. Logins
-- ---------------------------------------------------------------------------

-- How many active logins in a college hold `users.manage`, leaving one out.
create or replace function public.logins_that_can_manage_users(p_tenant uuid, p_excluding uuid)
returns bigint
language sql
stable
security definer
set search_path = public, extensions
as $$
  select count(*)
  from public.user_profiles up
  join public.role_permissions rp on rp.role_id = up.role_id and rp.tenant_id = up.tenant_id
  where up.tenant_id = p_tenant
    and up.is_active
    and up.id is distinct from p_excluding
    and rp.permission_code = 'users.manage'
    and rp.allowed
$$;

revoke all on function public.logins_that_can_manage_users(uuid, uuid) from public, anon, authenticated;

create or replace function public.team_logins()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role_id uuid,
  role_name text,
  role_subject text,
  record_kind text,
  is_active boolean,
  last_sign_in_at timestamptz,
  is_you boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot see who can sign in.';
  end if;

  return query
  select
    up.id,
    au.email::text,
    coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), au.email)::text,
    r.id,
    r.name,
    r.subject,
    case
      when up.staff_id is not null then 'staff'
      when up.guardian_id is not null then 'guardian'
      when up.student_id is not null then 'student'
      else 'none'
    end,
    up.is_active and (au.banned_until is null or au.banned_until < now()),
    au.last_sign_in_at,
    up.id = auth.uid()
  from public.user_profiles up
  join auth.users au on au.id = up.id
  join public.roles r on r.id = up.role_id
  left join public.people p on p.id = up.person_id
  where up.tenant_id = v_tenant
  order by (up.is_active) desc, r.name, 3;
end;
$$;

comment on function public.team_logins() is
  'Who can sign in to this college: name, email, role, record, active, last sign-in (0289). Definer because the email is in auth.users; gated on users.manage; tenant filtered by hand.';

create or replace function public.login_close(p_tenant uuid, p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.user_profiles set is_active = p_active
  where id = p_user and tenant_id = p_tenant;

  update auth.users
  set banned_until = case when p_active then null else 'infinity'::timestamptz end
  where id = p_user;

  if not p_active then
    -- Ends every refresh token with them: the next request signs them out.
    delete from auth.sessions where user_id = p_user;
  end if;
end;
$$;

comment on function public.login_close(uuid, uuid, boolean) is
  'The mechanism behind switching a login off or on (0289): profile flag, auth ban, sessions ended. Revoked from every JWT role; callers check authority first.';

revoke all on function public.login_close(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.login_set_access(p_user_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot change who can sign in.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot switch off your own login. Ask another administrator.';
  end if;

  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), au.email)
  into v_name
  from public.user_profiles up
  join auth.users au on au.id = up.id
  left join public.people p on p.id = up.person_id
  where up.id = p_user_id and up.tenant_id = v_tenant;

  if v_name is null then
    raise exception 'That login does not belong to this college.';
  end if;

  if not p_active and public.logins_that_can_manage_users(v_tenant, p_user_id) = 0 then
    raise exception
      '% is the only login that can manage who signs in. Give that to somebody else first, or nobody could ever change it again.',
      v_name;
  end if;

  perform public.login_close(v_tenant, p_user_id, p_active);

  return jsonb_build_object('name', v_name, 'active', p_active);
end;
$$;

comment on function public.login_set_access(uuid, boolean) is
  'Switch a login off (profile, auth ban, sessions ended) or back on (0289). Gated on users.manage; never the caller; never the last login that can manage users.';

create or replace function public.login_set_role(p_user_id uuid, p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_profile public.user_profiles;
  v_role public.roles;
  v_name text;
  v_keeps_manage boolean;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot change what a login is for.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own role. Ask another administrator.';
  end if;

  select * into v_profile from public.user_profiles where id = p_user_id and tenant_id = v_tenant;
  if v_profile.id is null then
    raise exception 'That login does not belong to this college.';
  end if;

  select * into v_role from public.roles where id = p_role_id and tenant_id = v_tenant;
  if v_role.id is null then
    raise exception 'That role does not exist in this college.';
  end if;

  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This login')
  into v_name
  from public.people p where p.id = v_profile.person_id;
  v_name := coalesce(v_name, 'This login');

  -- What a role stands for (0224): a Parent login must name a guardian, a
  -- Teacher login a member of staff. A role the profile cannot satisfy would
  -- sign in to a product where every policy matches nothing.
  if (v_role.subject = 'staff' and v_profile.staff_id is null)
     or (v_role.subject = 'guardian' and v_profile.guardian_id is null)
     or (v_role.subject = 'student' and v_profile.student_id is null) then
    raise exception
      '% cannot become %: that role is for somebody who is a % here, and this login is not linked to one.',
      v_name, v_role.name,
      case v_role.subject when 'staff' then 'member of staff' when 'guardian' then 'parent or guardian' else 'student' end;
  end if;

  select exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role_id and rp.permission_code = 'users.manage' and rp.allowed
  ) into v_keeps_manage;

  if not v_keeps_manage and v_profile.is_active
     and public.logins_that_can_manage_users(v_tenant, p_user_id) = 0 then
    raise exception
      '% is the only login that can manage who signs in, and % cannot. Give that to somebody else first.',
      v_name, v_role.name;
  end if;

  update public.user_profiles set role_id = p_role_id where id = p_user_id;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role.code)
  where id = p_user_id;

  -- The role is in the token, so it applies from their next sign-in.
  delete from auth.sessions where user_id = p_user_id;

  return jsonb_build_object('name', v_name, 'role', v_role.name);
end;
$$;

comment on function public.login_set_role(uuid, uuid) is
  'Change what a login is for (0289): only to a role whose subject the profile satisfies; never the caller; never away from the last login that can manage users. Ends their sessions so the role applies now.';

revoke all on function public.team_logins() from public, anon;
grant execute on function public.team_logins() to authenticated;
revoke all on function public.login_set_access(uuid, boolean) from public, anon;
grant execute on function public.login_set_access(uuid, boolean) to authenticated;
revoke all on function public.login_set_role(uuid, uuid) from public, anon;
grant execute on function public.login_set_role(uuid, uuid) to authenticated;

-- A leaver's login closes with them.
create or replace function public.staff_leaving_closes_logins()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  u record;
begin
  if old.status = 'active' and new.status <> 'active' then
    for u in
      select up.id from public.user_profiles up
      where up.tenant_id = new.tenant_id and up.staff_id = new.id and up.is_active
    loop
      if public.logins_that_can_manage_users(new.tenant_id, u.id) = 0 then
        -- Closing this one would leave the college with no way to manage
        -- logins at all. Leave it, and say so.
        raise notice 'Kept the login of the last person who can manage logins open.';
      else
        perform public.login_close(new.tenant_id, u.id, false);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.staff_leaving_closes_logins() from public, anon, authenticated;

create trigger staff_leaving_closes_logins
  after update of status on public.staff
  for each row execute function public.staff_leaving_closes_logins();

comment on function public.staff_leaving_closes_logins() is
  'When a member of staff stops being active, their logins are switched off (0289). Re-employing them does not switch them back on: that is a decision, made on the team screen.';

-- ---------------------------------------------------------------------------
-- 2. Four deletes
-- ---------------------------------------------------------------------------

create or replace function public.guard_exam_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  if old.status = 'published' then
    raise exception
      '% cannot be deleted while it is published: its results have been sent to families. Unpublish it first.',
      old.name using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace function public.guard_exam_paper_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_exam public.exams;
begin
  select * into v_exam from public.exams where id = old.exam_id;
  -- Gone already (a draft exam being deleted, or a whole college): allow.
  if v_exam.id is null then
    return old;
  end if;
  if v_exam.status = 'published' then
    raise exception
      'A paper of % cannot be deleted while the exam is published. Unpublish it first.',
      v_exam.name using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace function public.guard_homework_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_marked bigint;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  select count(*) into v_marked
  from public.homework_submissions s
  where s.tenant_id = old.tenant_id and s.homework_id = old.id and s.status in ('graded', 'returned');
  if v_marked > 0 then
    raise exception
      '"%" cannot be deleted: % would go with it. Unpublish it instead -- the marks stay.',
      old.title, public.count_phrase(v_marked, 'marked submission', 'marked submissions')
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace function public.guard_time_slot_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cover bigint;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  select count(*) into v_cover
  from public.substitutions s
  join public.timetable_entries e on e.id = s.timetable_entry_id
  where e.tenant_id = old.tenant_id and e.time_slot_id = old.id;
  if v_cover > 0 then
    raise exception
      'Period % cannot be deleted: % name it, and they are the record of who covered whom. Rename the period instead.',
      old.period_number, public.count_phrase(v_cover, 'cover arrangement', 'cover arrangements')
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create or replace function public.guard_book_delete()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_loans bigint;
begin
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  select count(*) into v_loans from public.book_issues b where b.book_id = old.id;
  if v_loans > 0 then
    raise exception
      '"%" cannot be deleted: it has been lent % and those loans are the library''s record. Set its copies to 0 instead, so it cannot be lent again.',
      old.title, public.count_phrase(v_loans, 'time', 'times')
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_exam_delete() from public, anon, authenticated;
revoke all on function public.guard_exam_paper_delete() from public, anon, authenticated;
revoke all on function public.guard_homework_delete() from public, anon, authenticated;
revoke all on function public.guard_time_slot_delete() from public, anon, authenticated;
revoke all on function public.guard_book_delete() from public, anon, authenticated;

create trigger guard_exam_delete before delete on public.exams
  for each row execute function public.guard_exam_delete();
create trigger guard_exam_paper_delete before delete on public.exam_subjects
  for each row execute function public.guard_exam_paper_delete();
create trigger guard_homework_delete before delete on public.homework
  for each row execute function public.guard_homework_delete();
create trigger guard_time_slot_delete before delete on public.time_slots
  for each row execute function public.guard_time_slot_delete();
create trigger guard_book_delete before delete on public.books
  for each row execute function public.guard_book_delete();
