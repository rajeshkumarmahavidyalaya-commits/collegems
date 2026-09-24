-- 0278: switching back to an earlier year is asked, not assumed.
--
-- 0276 made `academics_session_activate` refuse a *forward* switch that would
-- leave children behind, unless the caller confirms. The other direction had
-- no check at all, and the year screen draws "Make current" on every card --
-- 2024-2025's included. Switching back files every new register, invoice and
-- receipt into a year that is over, and hides the current year's children just
-- as surely. It cannot simply be refused, because going back is how a switch
-- made by mistake is undone; so it takes the same explicit confirmation
-- (errcode 55000, which the dialog turns into "switch anyway").
--
-- Same signature, so `create or replace` keeps 0276's grants.

create or replace function public.academics_session_activate(p_session_id uuid, p_force boolean default false)
returns public.academic_sessions
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row public.academic_sessions;
  v_target public.academic_sessions;
  v_current public.academic_sessions;
  v_waiting integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('academics.manage') then
    raise exception 'Your role cannot change the current academic year';
  end if;

  select * into v_target from public.academic_sessions s
  where s.id = p_session_id and s.tenant_id = v_tenant_id;
  if v_target.id is null then
    raise exception 'No such academic year, or you may not change it';
  end if;

  select * into v_current from public.academic_sessions s
  where s.tenant_id = v_tenant_id and s.is_current;

  -- Moving forward while children are still enrolled only in the year being
  -- left: they would vanish from every screen of the new one. Refused with the
  -- count, unless somebody has read it and says so (0276).
  if not p_force and v_current.id is not null and v_current.id <> v_target.id
     and v_target.start_date > v_current.start_date then
    select count(*)::integer into v_waiting
    from public.enrolments e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_current.id
      and e.status = 'active'
      and not exists (
        select 1 from public.enrolments n
        where n.tenant_id = v_tenant_id
          and n.session_id = v_target.id
          and n.student_id = e.student_id
      );

    if v_waiting > 0 then
      raise exception '% % in % % not been promoted into % yet. Switch now and % will disappear from every class list, register and fee screen of the new year. Promote first, or confirm that you want to switch anyway.',
        v_waiting,
        case when v_waiting = 1 then 'child' else 'children' end,
        v_current.name,
        case when v_waiting = 1 then 'has' else 'have' end,
        v_target.name,
        case when v_waiting = 1 then 'that child' else 'they' end
        using errcode = '55000';
    end if;
  end if;

  -- Moving backwards files every new register, invoice and receipt into an
  -- earlier year. That is almost always a slip -- and occasionally exactly
  -- right, when a switch made by mistake is being undone -- so it is asked,
  -- not refused (0278).
  if not p_force and v_current.id is not null and v_current.id <> v_target.id
     and v_target.start_date < v_current.start_date then
    raise exception '% starts before %, the current year. From now on every register, invoice and receipt would be filed under %. If you are undoing a switch made by mistake, confirm that you want to go back.',
      v_target.name, v_current.name, v_target.name
      using errcode = '55000';
  end if;

  update public.academic_sessions
  set is_current = false
  where tenant_id = v_tenant_id and is_current and id <> p_session_id;

  update public.academic_sessions
  set is_current = true
  where tenant_id = v_tenant_id and id = p_session_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No such academic year, or you may not change it';
  end if;

  return v_row;
end;
$function$;
