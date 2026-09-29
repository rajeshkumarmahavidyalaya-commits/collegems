-- 0302: setup in the order a college is built.
--
-- The eSkooly comparison's third finding. Its menu runs in the order a school
-- sets itself up -- General settings, Classes, Subjects, Students, Employees,
-- Fees, Timetable -- and a new school works down it without training. Ours had
-- the steps (0284) in an order nobody would take them in: fees came after
-- students, which means the admission form (0286's admission fee) billed a
-- child against a year with no fees set, and there was no step for the staff
-- records or the timetable at all, only for their logins.
--
-- So the checklist now reads in build order:
--
--   1. profile        the college's details        settings.manage
--   2. classes        this year's classes          academics.manage
--   3. subjects       each class's subjects        academics.manage
--   4. fees           what each class pays         fees.manage
--   5. staff          the staff records            staff.manage      (new)
--   6. students       the roll                     students.manage
--   7. timetable      the class routine            academics.manage  (new)
--   8. staff_logins   staff can sign in            users.manage
--   9. family_logins  families can sign in         users.manage
--
-- Everything 0284 said about the shape still holds and is unchanged: definer,
-- because a login question read through user_profiles' policies lies to
-- anybody but an administrator; tenant filtered by hand in every step; each
-- step only for somebody holding the permission of the screen that completes
-- it; booleans out, never evidence.
--
-- "staff" is done when somebody other than the person setting up has a staff
-- record -- the founder is on the roll from the moment the college exists
-- (platform_start_school), so "any staff row" would be true on day one.

create or replace function public.setup_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_me_staff uuid;
  v_steps jsonb := '[]'::jsonb;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  v_session := public.current_session_id(v_tenant);
  select up.staff_id into v_me_staff
  from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant;

  if public.role_has_permission('settings.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'profile', 'done',
      not exists (select 1 from public.settings_problems() p where p.severity = 'warning'));
  end if;

  if public.role_has_permission('academics.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'classes', 'done',
      exists (select 1 from public.sections s where s.tenant_id = v_tenant and s.session_id = v_session));
    v_steps := v_steps || jsonb_build_object('key', 'subjects', 'done',
      exists (select 1 from public.section_subjects ss where ss.tenant_id = v_tenant and ss.session_id = v_session));
  end if;

  if public.role_has_permission('fees.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'fees', 'done',
      exists (select 1 from public.fee_structures f where f.tenant_id = v_tenant and f.session_id = v_session));
  end if;

  if public.role_has_permission('staff.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'staff', 'done',
      exists (select 1 from public.staff st
              where st.tenant_id = v_tenant and st.status = 'active'
                and st.id is distinct from v_me_staff));
  end if;

  if public.role_has_permission('students.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'students', 'done',
      exists (select 1 from public.enrolments e
              where e.tenant_id = v_tenant and e.session_id = v_session and e.status = 'active'));
  end if;

  if public.role_has_permission('academics.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'timetable', 'done',
      exists (select 1 from public.timetable_entries te
              where te.tenant_id = v_tenant and te.session_id = v_session));
  end if;

  if public.role_has_permission('users.manage') then
    -- Somebody other than the caller: the person setting up is not their staff.
    v_steps := v_steps || jsonb_build_object('key', 'staff_logins', 'done',
      exists (select 1 from public.user_profiles up
              where up.tenant_id = v_tenant and up.staff_id is not null and up.id <> auth.uid())
      or exists (select 1 from public.invitations i
                 where i.tenant_id = v_tenant and i.staff_id is not null and i.status = 'pending'));
    v_steps := v_steps || jsonb_build_object('key', 'family_logins', 'done',
      exists (select 1 from public.user_profiles up
              where up.tenant_id = v_tenant and (up.guardian_id is not null or up.student_id is not null))
      or exists (select 1 from public.invitations i
                 where i.tenant_id = v_tenant and (i.guardian_id is not null or i.student_id is not null)
                   and i.status = 'pending'));
  end if;

  return jsonb_build_object('steps', v_steps);
end;
$function$;

comment on function public.setup_progress() is
  'Which first-run steps are done, in the order a college is built (0302), as booleans, for the steps the caller may act on (0284). Definer: filters by tenant itself and projects no evidence.';
