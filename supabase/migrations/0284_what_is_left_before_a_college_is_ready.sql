-- 0284: what is left before a college is ready to use.
--
-- A new college's super admin signs in to a product with sixty screens and no
-- idea which six matter first. `setup_progress()` answers that as a short list
-- of yes/no steps -- school details, classes, subjects, the roll, fees, staff
-- logins, family logins -- which the home page draws as a checklist that
-- disappears once everything is done.
--
-- Why SECURITY DEFINER, when an invoker would read the same tables:
--
-- > An invoker function over row-ownership RLS lies quietly (CLAUDE.md rule 4).
-- > "Has any family been given a login?" reads `user_profiles`, whose only
-- > policies are *admins view tenant profiles* and *self views own profile*, so
-- > a college that grants `users.manage` to its office clerk would show that
-- > clerk "nobody yet" for ever. The answer has to be true for whoever may act
-- > on it.
--
-- So this is rule 4's other shape, exactly as `family_login_status()` is:
--
-- - it filters by tenant itself, in every step, because no policy runs inside;
-- - each step is included only when the caller holds the permission of the
--   screen that completes it, so nobody is shown a task they cannot do;
-- - it projects **booleans, never evidence** -- whether a family login exists,
--   never whose -- so a definer here costs a yes/no, not a row.

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
  v_steps jsonb := '[]'::jsonb;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  v_session := public.current_session_id(v_tenant);

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

  if public.role_has_permission('students.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'students', 'done',
      exists (select 1 from public.enrolments e
              where e.tenant_id = v_tenant and e.session_id = v_session and e.status = 'active'));
  end if;

  if public.role_has_permission('fees.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'fees', 'done',
      exists (select 1 from public.fee_structures f where f.tenant_id = v_tenant and f.session_id = v_session));
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
  'Which first-run steps are done, as booleans, for the steps the caller may act on (0284). Definer: filters by tenant itself and projects no evidence.';

revoke all on function public.setup_progress() from public, anon;
grant execute on function public.setup_progress() to authenticated;
