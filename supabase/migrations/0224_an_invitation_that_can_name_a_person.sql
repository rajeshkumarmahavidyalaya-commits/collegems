-- 0224 -- An invitation that can name a person.
--
-- `0221` made 555 guardians writable. This is the next question, and the answer
-- measured on the demo college is stark:
--
--   guardians                555
--   guardian logins            0
--   student logins             0
--   logins in total            2   (both administrators)
--   notification deliveries    2   (ever)
--   registered devices         0
--
-- ## The database has been ready since `0004`
--
-- `invitations` carries `person_id`, `student_id`, `staff_id` **and**
-- `guardian_id`. `handle_new_auth_user` resolves all four and stamps them onto
-- `user_profiles`. The server action accepts all three ids and inserts them.
--
-- `settings/team/team-view.tsx` mentions `guardianId` **zero times**. It sends
-- an email address and a role, and nothing else.
--
-- So an administrator who invites somebody as *Parent* creates a login with
-- `guardian_id = null` — and the policy is not ambiguous about what that means:
--
--   parents view own children   ... up.guardian_id = gs.guardian_id
--   students view self          ... id = up.student_id
--   teachers view own section   ... up.staff_id = s.class_teacher_staff_id
--
-- **Null on either side and the policy matches nothing.** The family signs in,
-- every query is correct, and every answer is nothing. `0205`'s lesson one
-- layer along: a JWT minted before a tenant existed does not have one, and a
-- profile minted without a guardian is not one.
--
-- Read the other way, the policies also say who does *not* need a subject:
-- `admins manage students` and `staff roles view students` compare the role
-- code alone. So an administrator works with nothing attached — which is why
-- this could ship and stay invisible for two hundred migrations. **The only
-- seats that break are the ones nobody in this codebase has ever signed into.**
--
-- ## What a role stands for is a column, not a branch
--
-- `roles.tier` (migration `0208`) groups the picker, and it cannot answer this:
-- `parent` and `student` share the `student` tier and need *different* records.
-- A `case role.code` in TypeScript would be the first customer's six roles
-- hardcoded — exactly what `0208` refused for the tier.
--
-- `roles.subject` says **which record this login stands for**, and carries the
-- same warning as its neighbour:
--
-- > **A subject decides what an invitation must name. It never decides what
-- > the holder may do.** That stays `role_permissions`, editable per college.
--
-- ## ...and the UI is never the gate (rule 4)
--
-- A CHECK cannot reach `roles`, so this is the composite-key device's **sixth**
-- use, and the carried column is a new kind again: **a requirement.**
--
--   invitations (tenant_id, role_id, role_subject)
--     -> roles  (tenant_id, id,      subject)      on update cascade
--
-- One key does three things at once:
--
--   * `role_subject` is held equal to the role's own, so the CHECK below can
--     ask a question about `roles` without joining to it;
--   * `tenant_id` in the key closes a hole nobody had noticed —
--     `invitations_role_id_fkey` referenced `roles(id)` alone, so an
--     invitation could name **another college's role**. Not a leak: the tenant
--     stamped into the JWT comes from `inv.tenant_id`, and a foreign role code
--     absent from this college's matrix is refused everywhere by
--     `role_has_permission`. It fails closed. It is closed here because the
--     device needs the key anyway;
--   * `on update cascade` means a college changing what a role stands for
--     rewrites its invitations and re-evaluates the CHECK.
--
-- **The CHECK applies while the row is still a promise.** `status <> 'pending'`
-- exempts accepted and revoked rows, and that is load-bearing in both
-- directions: history is not rewritten by a decision taken today, and changing
-- a role's subject is refused only while *pending* invitations contradict it —
-- recoverable by revoking them, rather than by a constraint error on a row from
-- two years ago.
--
-- The three invitations on the demo college are all `accepted`, so the
-- constraint is satisfiable the moment it is added. Verified before writing it.

begin;

-- ---------------------------------------------------------------------------
-- What a role stands for
-- ---------------------------------------------------------------------------

alter table public.roles
  add column if not exists subject text not null default 'none'
    check (subject in ('staff', 'student', 'guardian', 'none'));

comment on column public.roles.subject is
  'Which record a login with this role stands for: a staff member, a student, '
  'a guardian, or nobody. It decides what an invitation must name -- never what '
  'the holder may do, which is role_permissions and is a per-college decision.';

-- Seeded by code, because these six are the roles this product ships with.
-- A role a college invents later defaults to `none`: rule 12's conservative
-- reading, since nobody has decided what it stands for.
--
-- `admin` is `staff` rather than `none`. A principal is employed by the school,
-- and the alternative -- letting an administrator's login be attached to
-- nothing -- is how "my pay" and "my leave" quietly return nothing for the one
-- person who would never think to report it. The founding principal is
-- unaffected: `platform_start_school` writes `user_profiles` directly and
-- touches `invitations` not at all (checked, not assumed).
update public.roles set subject = case code
  when 'parent'  then 'guardian'
  when 'student' then 'student'
  when 'admin'   then 'staff'
  when 'teacher' then 'staff'
  when 'accountant' then 'staff'
  when 'librarian'  then 'staff'
  else 'none'
end;

alter table public.roles
  drop constraint if exists roles_tenant_id_subject_key,
  add constraint roles_tenant_id_subject_key unique (tenant_id, id, subject);

-- ---------------------------------------------------------------------------
-- ...carried onto the invitation, so a CHECK can see it
-- ---------------------------------------------------------------------------

alter table public.invitations
  add column if not exists role_subject text not null default 'none';

update public.invitations i
set role_subject = r.subject
from public.roles r
where r.id = i.role_id and i.role_subject is distinct from r.subject;

alter table public.invitations
  drop constraint if exists invitations_role_id_fkey,
  drop constraint if exists invitations_role_fkey,
  add constraint invitations_role_fkey
    foreign key (tenant_id, role_id, role_subject)
    references public.roles (tenant_id, id, subject)
    on update cascade
    on delete cascade;

alter table public.invitations
  drop constraint if exists invitations_subject_present,
  add constraint invitations_subject_present check (
    status <> 'pending'
    or case role_subject
         when 'staff' then
           staff_id is not null and student_id is null and guardian_id is null
         when 'student' then
           student_id is not null and staff_id is null and guardian_id is null
         when 'guardian' then
           guardian_id is not null and staff_id is null and student_id is null
         else
           staff_id is null and student_id is null and guardian_id is null
       end
  );

comment on constraint invitations_subject_present on public.invitations is
  'A pending invitation must name the record its role stands for, and no other '
  'kind. Without it a Parent invitation creates a login whose guardian_id is '
  'null, and `parents view own children` then matches no row at all.';

-- ---------------------------------------------------------------------------
-- Who an invitation can be for
-- ---------------------------------------------------------------------------

-- One read model for all three kinds, because the picker asks one question:
-- *who is this login for?* Three server-side searches would be three places to
-- forget the permission check.
--
-- `SECURITY INVOKER`, so RLS decides which rows exist -- and gated explicitly on
-- `users.manage` besides, which is rule 4's `report_run` refinement: reading
-- `people` is tenant-wide for every staff role, so the policy alone would let a
-- librarian enumerate the roll through a picker. The permission is the gate
-- that the policy deliberately is not.
--
-- `has_login` is the half a person actually needs: inviting somebody who
-- already signed in is the common mistake, and it is silent -- the second
-- invitation supersedes the first and nothing looks wrong.
create or replace function public.invite_candidates(p_subject text, p_query text)
returns table (
  id uuid,
  label text,
  hint text,
  has_login boolean
)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.role_has_permission('users.manage') then
    raise exception 'Your role cannot invite people to this school.';
  end if;

  if p_subject = 'staff' then
    return query
      select s.id,
             btrim(p.first_name || ' ' || coalesce(p.last_name, '')),
             nullif(concat_ws(' · ', s.employee_code, s.designation), ''),
             exists (select 1 from public.user_profiles up where up.staff_id = s.id)
      from public.staff s
      join public.people p on p.id = s.person_id
      where s.status = 'active'
        and (v_q = '' or p.first_name ilike '%' || v_q || '%'
                      or coalesce(p.last_name, '') ilike '%' || v_q || '%'
                      or coalesce(s.employee_code, '') ilike '%' || v_q || '%')
      order by 2, 1
      limit 20;

  elsif p_subject = 'student' then
    return query
      select st.id,
             btrim(p.first_name || ' ' || coalesce(p.last_name, '')),
             nullif(concat_ws(' · ', st.admission_number,
               (select c.name || ' · ' || sec.name
                  from public.enrolments e
                  join public.sections sec on sec.id = e.section_id
                  join public.class_levels c on c.id = sec.class_level_id
                 where e.student_id = st.id and e.status = 'active'
                 order by e.created_at desc limit 1)), ''),
             exists (select 1 from public.user_profiles up where up.student_id = st.id)
      from public.students st
      join public.people p on p.id = st.person_id
      where st.status = 'active'
        and (v_q = '' or p.first_name ilike '%' || v_q || '%'
                      or coalesce(p.last_name, '') ilike '%' || v_q || '%'
                      or st.admission_number ilike '%' || v_q || '%')
      order by 2, 1
      limit 20;

  elsif p_subject = 'guardian' then
    return query
      select g.id,
             btrim(p.first_name || ' ' || coalesce(p.last_name, '')),
             nullif(concat_ws(' · ', p.phone,
               (select string_agg(btrim(cp.first_name || ' ' || coalesce(cp.last_name, '')), ', ')
                  from public.guardian_student gs
                  join public.students cs on cs.id = gs.student_id
                  join public.people cp on cp.id = cs.person_id
                 where gs.guardian_id = g.id)), ''),
             exists (select 1 from public.user_profiles up where up.guardian_id = g.id)
      from public.guardians g
      join public.people p on p.id = g.person_id
      where (v_q = '' or p.first_name ilike '%' || v_q || '%'
                      or coalesce(p.last_name, '') ilike '%' || v_q || '%'
                      or coalesce(p.phone, '') ilike '%' || v_q || '%')
      order by 2, 1
      limit 20;
  end if;

  -- `none` falls through to no rows: a role that stands for nobody has nobody
  -- to pick, which is what the picker should show.
  return;
end;
$$;

comment on function public.invite_candidates(text, text) is
  'Who an invitation of a given subject kind can be for -- named, hinted, and '
  'flagged if they already have a login. INVOKER over RLS and gated on '
  'users.manage besides, because reading people is tenant-wide for staff roles.';

-- ---------------------------------------------------------------------------
-- ...and a critic, because 0 of 555 is not visible from any screen
-- ---------------------------------------------------------------------------

-- Rule 12's bar: *is somebody going to have to do something about it.* A school
-- that has invited nobody sees one sentence with the number in it; a school
-- that has invited everybody sees nothing. The count is of **children whose
-- whole family cannot sign in**, not of guardians, because the family is the
-- unit a school thinks in and one parent with a login is enough.
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

  select count(*) into v_total from public.students s where s.status = 'active';

  select count(*) into v_without
  from public.students s
  where s.status = 'active'
    and not exists (
      select 1 from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where gs.student_id = s.id)
    and not exists (
      select 1 from public.user_profiles up where up.student_id = s.id);

  if v_without > 0 then
    return query select
      'family.no_login',
      case when v_total > 0 and v_without = v_total then 'warn' else 'info' end,
      format(
        '%s of %s %s nobody who can sign in: no fee account, timetable, result or absence notice reaches %s family.',
        v_without, v_total,
        case when v_total = 1 then 'active student has' else 'active students have' end,
        case when v_without = 1 then 'that' else 'those' end);
  end if;

  select count(*) into v_stale
  from public.invitations i
  where i.status = 'pending' and i.expires_at <= now();

  if v_stale > 0 then
    return query select
      'family.stale_invitations',
      'info',
      format('%s %s expired without being accepted. %s to send again.',
        v_stale,
        case when v_stale = 1 then 'invitation has' else 'invitations have' end,
        case when v_stale = 1 then 'It has' else 'They have' end);
  end if;
end;
$$;

comment on function public.family_login_problems() is
  'Names the children whose family cannot sign in, and invitations that expired '
  'unaccepted. Silent once every family has a login.';

insert into reference.checks (key, label, description, function_name, shape, module, href, required_permission, sort, is_active)
values (
  'users.family_logins',
  'Family logins',
  'Whether the families this school records can actually sign in.',
  'family_login_problems',
  'severity_message',
  'Settings',
  '/settings/team',
  'users.manage',
  90,
  true
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  function_name = excluded.function_name,
  shape = excluded.shape,
  module = excluded.module,
  href = excluded.href,
  required_permission = excluded.required_permission,
  sort = excluded.sort,
  is_active = excluded.is_active;

commit;
