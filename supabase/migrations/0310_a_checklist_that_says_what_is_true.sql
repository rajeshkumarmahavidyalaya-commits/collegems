-- 0310: the setup checklist says what is true, and three small corrections.
--
-- ## 1. "Everything is set up" was false
--
-- Measured on the live college on 1 Oct 2026, `setup_progress()` reported all
-- nine steps done and the home page therefore drew no checklist at all, while:
--
--   * the current academic year was 2025-2026, which ended on 31 March, so
--     every step that asks "for the current year" was answering about a year
--     that is over (and 6,000 register rows had been filed into it);
--   * "Invite students and parents" was ticked because ONE student could sign
--     in. 301 of 302 children had nobody who could;
--   * no message had ever left by email or SMS, because no provider was
--     connected, and nothing on the checklist asked about it.
--
-- A checklist that ticks itself is the critic that fires on nothing: it tells
-- the one person who would act that there is nothing to do. So:
--
--   * `year`     -- the current year covers today, in the college's own day.
--                   Second in the order: every later step reads that year.
--   * `messages` -- email or SMS is switched on AND its provider answered.
--                   In-app is not enough: a family that is not signed in hears
--                   nothing, which is exactly the family being invited.
--   * `family_logins` is done at 80% of active students reached (a login of
--     their own, a guardian's, or a pending invitation for either), and the
--     step carries `have` and `of` so the card can say "1 of 302". Counts,
--     never ids: this is still a definer that projects booleans and numbers.
--
-- ## 2. Three functions had no fixed search_path
--
-- Supabase's security advisor named `words_or`, `sms_segments` and
-- `audit_changed_fields`. All three are pure (no table reads), so the risk was
-- small, and the fix is one line each.
--
-- ## 3. "time(s)"
--
-- Two sentences still said `time(s)`, the hedge rule 2's 0196 paragraph says
-- not to write. Both now agree in number.

begin;

create or replace function public.setup_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_me_staff uuid;
  v_today date;
  v_active integer;
  v_reached integer;
  v_steps jsonb := '[]'::jsonb;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  v_session := public.current_session_id(v_tenant);
  -- The college's own day: `tenants` is the tenant, keyed on id (rule 1).
  select (now() at time zone coalesce(t.timezone, 'Asia/Kolkata'))::date into v_today
  from public.tenants t where t.id = v_tenant;
  select up.staff_id into v_me_staff
  from public.user_profiles up
  where up.id = auth.uid() and up.tenant_id = v_tenant;

  if public.role_has_permission('settings.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'profile', 'done',
      not exists (select 1 from public.settings_problems() p where p.severity = 'warning'));
  end if;

  if public.role_has_permission('academics.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'year', 'done',
      exists (select 1 from public.academic_sessions a
              where a.tenant_id = v_tenant and a.is_current
                and v_today between a.start_date and a.end_date));
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

  if public.role_has_permission('settings.manage') then
    v_steps := v_steps || jsonb_build_object('key', 'messages', 'done',
      exists (select 1 from public.notification_channel_settings c
              where c.tenant_id = v_tenant and c.channel in ('email', 'sms', 'whatsapp')
                and c.is_enabled and coalesce(c.provider_configured, false)));
  end if;

  if public.role_has_permission('users.manage') then
    -- Somebody other than the caller: the person setting up is not their staff.
    v_steps := v_steps || jsonb_build_object('key', 'staff_logins', 'done',
      exists (select 1 from public.user_profiles up
              where up.tenant_id = v_tenant and up.staff_id is not null and up.id <> auth.uid())
      or exists (select 1 from public.invitations i
                 where i.tenant_id = v_tenant and i.staff_id is not null and i.status = 'pending'));

    select count(*)::integer,
           count(*) filter (where
             exists (select 1 from public.user_profiles up
                     where up.tenant_id = v_tenant and up.student_id = s.id)
             or exists (select 1 from public.guardian_student gs
                        join public.user_profiles up on up.guardian_id = gs.guardian_id
                        where gs.tenant_id = v_tenant and up.tenant_id = v_tenant
                          and gs.student_id = s.id)
             or exists (select 1 from public.invitations i
                        where i.tenant_id = v_tenant and i.status = 'pending'
                          and (i.student_id = s.id
                               or i.guardian_id in (select g2.guardian_id from public.guardian_student g2
                                                    where g2.tenant_id = v_tenant and g2.student_id = s.id))))::integer
      into v_active, v_reached
    from public.students s
    where s.tenant_id = v_tenant and s.status = 'active';

    v_steps := v_steps || jsonb_build_object('key', 'family_logins',
      'done', v_active > 0 and v_reached * 5 >= v_active * 4,
      'have', v_reached, 'of', v_active);
  end if;

  return jsonb_build_object('steps', v_steps);
end;
$function$;

alter function public.words_or(text[]) set search_path = public, extensions;
alter function public.sms_segments(text) set search_path = public, extensions;
alter function public.audit_changed_fields(jsonb, jsonb) set search_path = public, extensions;

create or replace function public.notify_template_problems()
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  with settings as (
    select * from public.notification_channel_settings
    where tenant_id = ( select public.current_tenant_id() )
  ),
  -- What was actually attempted and could not be sent. RLS on
  -- `notification_deliveries` scopes this to the caller, so an administrator
  -- sees the school's and nobody else sees anything they should not.
  skipped as (
    select n.event_key, nt.name as event_name, count(*) as skipped_count
    from public.notification_deliveries d
    join public.notifications n on n.id = d.notification_id
    join reference.notification_types nt on nt.key = n.event_key
    where d.channel = 'whatsapp'
      and d.status = 'skipped'
      and d.last_error like 'No WhatsApp template is registered%'
      and not exists (
        select 1 from public.notification_templates t
        where t.tenant_id = ( select public.current_tenant_id() )
          and t.event_key = n.event_key and t.channel = 'whatsapp'
          and t.is_active and t.provider_template_name is not null
      )
    group by n.event_key, nt.name
  )
  -- 0310: every count-dependent word agrees (CLAUDE.md rule 2, 0196).
  select format('%s WhatsApp %s for "%s" %s skipped: no template is registered for it, and '
         || 'WhatsApp only accepts templates approved in advance. Register one, or stop '
         || 'choosing WhatsApp for that event.',
         s.skipped_count,
         case when s.skipped_count = 1 then 'message' else 'messages' end,
         s.event_name,
         case when s.skipped_count = 1 then 'was' else 'were' end)
  from skipped s

  union all
  -- Switched on and entirely unused is worth one sentence, because it is the
  -- state a school reaches by enabling the channel and stopping.
  select 'WhatsApp is switched on, but this school has registered no templates at all, '
         || 'so nothing can be sent on it.'
  from settings s
  where s.channel = 'whatsapp' and s.is_enabled
    and not exists (
      select 1 from public.notification_templates t
      where t.tenant_id = ( select public.current_tenant_id() )
        and t.channel = 'whatsapp' and t.is_active
        and t.provider_template_name is not null
    )

  union all
  select 'The WhatsApp template "' || t.provider_template_name || '" for "' || nt.name
         || '" lists no parameters. If Meta''s copy has placeholders, they will be '
         || 'sent empty.'
  from public.notification_templates t
  join reference.notification_types nt on nt.key = t.event_key
  where t.tenant_id = ( select public.current_tenant_id() )
    and t.channel = 'whatsapp' and t.is_active
    and t.provider_template_name is not null
    and cardinality(t.provider_template_params) = 0

  union all
  -- A parameter naming a key the event never carries renders as a blank in a
  -- message somebody receives. Judged against the payloads this event has
  -- actually carried, and only once it has carried one -- "every parameter is
  -- unknown" on a fresh tenant would be noise rather than criticism.
  select 'The WhatsApp template for "' || nt.name || '" fills a placeholder from "'
         || p.key || '", which is not a variable this event''s messages have carried.'
  from public.notification_templates t
  join reference.notification_types nt on nt.key = t.event_key
  cross join lateral unnest(t.provider_template_params) as p(key)
  where t.tenant_id = ( select public.current_tenant_id() )
    and t.channel = 'whatsapp' and t.is_active
    and t.provider_template_name is not null
    and exists (
      select 1 from public.notifications n
      where n.tenant_id = t.tenant_id and n.event_key = t.event_key
    )
    and not exists (
      select 1
      from public.notifications n
      cross join lateral jsonb_object_keys(n.payload) as k(key)
      where n.tenant_id = t.tenant_id and n.event_key = t.event_key and k.key = p.key
    )
$$;

create or replace function public.notice_publish(p_notice_id uuid)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_n public.notices;
  v_result jsonb;
begin
  select * into v_n from public.notices where id = p_notice_id;
  if v_n.id is null then
    raise exception 'No such notice, or you cannot see it';
  end if;
  if coalesce(trim(v_n.title), '') = '' or coalesce(trim(v_n.body), '') = '' then
    raise exception 'A notice needs a title and something in it';
  end if;

  update public.notices
     set status = 'published',
         published_at = coalesce(published_at, now()),
         published_by = coalesce(published_by, ( select auth.uid() )),
         withdrawn_at = null,
         withdrawn_by = null,
         withdraw_reason = null
   where id = p_notice_id
  returning * into v_n;

  if v_n.id is null then
    -- No policy matched. Under RLS an update that matches nothing succeeds
    -- while touching nothing, and reporting that as a publish would be a lie.
    raise exception 'You cannot publish this notice';
  end if;

  -- Announce **only the first time**. A school reinstating a withdrawn circular
  -- is fixing a mistake, not making a new announcement, and four hundred phones
  -- should not buzz for it. Doing it again is `notice_announce`, deliberately.
  if v_n.announced_count = 0 then
    v_result := public.notice_announce(p_notice_id);
  else
    v_result := jsonb_build_object(
      'announced', false,
      'error', null,
      'note', format(
        'Already announced %s. Publishing again does not re-announce -- '
        'use "announce again" if that is what you want.',
        case when v_n.announced_count = 1 then 'once'
             else v_n.announced_count::text || ' times' end)
    );
  end if;

  return jsonb_build_object('notice_id', p_notice_id, 'status', 'published') || v_result;
end;
$$;

commit;
