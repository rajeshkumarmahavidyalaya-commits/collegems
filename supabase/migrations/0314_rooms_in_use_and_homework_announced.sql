-- 0314: how much each room is used, and families told when homework is set.
--
-- ## Rooms
--
-- `docs/modules/timetable.md`: "No room-utilisation view. The data supports it
-- (`timetable_busy_in_slot` already answers the per-period question); nothing
-- renders it." Rule 11 decides the shape: a catalogue report, not a screen.
-- Per room, this year: how many periods a week are booked out of the periods
-- the college teaches (its teaching days times its lesson periods), the share,
-- and which classes use it -- so an office looking for a room for a new
-- section reads the emptiest first. INVOKER over `timetable_entries`, gated on
-- `academics.view` like the two timetable reports beside it.
--
-- ## Homework
--
-- `docs/modules/homework.md`: "No notification on publish." A family learns
-- about homework by opening the app. `homework_announce` is the fifth raiser
-- in rule 10's shape (0219): definer, gated on the permission of the act it
-- announces (`homework.manage`), its own words, its own audience -- the
-- children actively enrolled in the class this year and their families -- and
-- nothing taken from the caller but the homework's id. Raised after publishing
-- by the server action, and a failed announcement is not a failed publish.
-- Off-channel by default: in-app only, because a school that wants an SMS per
-- piece of homework will say so, and one that gets it by accident pays for it.

begin;

-- ----------------------------------------------------------------------- rooms --

create or replace function public.report_room_use(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with session as (
    select public.current_session_id(public.current_tenant_id()) as id
  ),
  teaching_days as (
    select count(*) as n
    from generate_series(1, 6) d
    where not exists (
      select 1 from public.weekends w where w.weekday = d and not w.is_teaching)
  ),
  periods as (
    select count(*) as n from public.time_slots s where s.kind = 'class' and not s.is_break
  ),
  booked as (
    select te.class_room_id,
           count(*) as used,
           string_agg(distinct cl.name || ' ' || sec.name, ', ' order by cl.name || ' ' || sec.name) as classes
    from public.timetable_entries te
    join session on te.session_id = session.id
    join public.sections sec on sec.id = te.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    where te.class_room_id is not null
    group by te.class_room_id
  )
  select to_jsonb(t) - 'sort_share'
  from (
    select
      r.name as room,
      r.capacity,
      coalesce(b.used, 0) as booked,
      (select n from teaching_days) * (select n from periods) as available,
      case when (select n from teaching_days) * (select n from periods) = 0 then null
           else round(100.0 * coalesce(b.used, 0) / ((select n from teaching_days) * (select n from periods)), 1)
      end as share,
      coalesce(b.classes, '') as classes,
      coalesce(b.used, 0) as sort_share
    from public.class_rooms r
    left join booked b on b.class_room_id = r.id
    where r.is_active
    order by sort_share, r.name, r.id
  ) t
$$;

revoke all on function public.report_room_use(jsonb) from public, anon;
grant execute on function public.report_room_use(jsonb) to authenticated;

insert into reference.reports (
  key, name, description, module, required_permission, function_name,
  parameters, columns, sort_order, audience)
values (
  'timetable.rooms', 'How much each room is used',
  'Every room this year, emptiest first: how many periods a week it is booked out of the periods the college teaches, the share, and which classes use it. Read it when a new section needs a room.',
  'Timetable', 'academics.view', 'report_room_use',
  '[]'::jsonb,
  '[
     {"key": "room", "type": "text", "label": "Room"},
     {"key": "capacity", "type": "number", "label": "Seats", "align": "right"},
     {"key": "booked", "type": "number", "label": "Periods booked", "align": "right"},
     {"key": "available", "type": "number", "label": "Periods a week", "align": "right"},
     {"key": "share", "type": "percent", "label": "In use", "align": "right"},
     {"key": "classes", "type": "text", "label": "Classes"}
   ]'::jsonb,
  23, 'staff'
)
on conflict (key) do nothing;

-- -------------------------------------------------------------------- homework --

insert into reference.notification_types (key, name, description, default_channels, stale_after)
values (
  'homework.assigned', 'Homework set',
  'A teacher published homework for a class. Sent to the children in the class and their families.',
  array['in_app'], interval '7 days'
)
on conflict (key) do nothing;

create or replace function public.homework_announce(p_homework_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_hw public.homework;
  v_subject text;
  v_students jsonb;
  v_count integer;
  v_note public.notifications;
begin
  if v_tenant is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if not public.role_has_permission('homework.manage') then
    raise exception 'Your role does not set homework.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_hw from public.homework where id = p_homework_id and tenant_id = v_tenant;
  if v_hw.id is null then
    raise exception 'No such homework.' using errcode = 'no_data_found';
  end if;
  if v_hw.status <> 'published' then
    raise exception 'Publish the homework before telling anybody about it.' using errcode = 'check_violation';
  end if;

  select s.name into v_subject from public.subjects s where s.id = v_hw.subject_id and s.tenant_id = v_tenant;

  select coalesce(jsonb_agg(distinct e.student_id), '[]'::jsonb), count(distinct e.student_id)
    into v_students, v_count
  from public.enrolments e
  where e.tenant_id = v_tenant and e.section_id = v_hw.section_id
    and e.session_id = v_hw.session_id and e.status = 'active';

  if v_count = 0 then
    return jsonb_build_object('notification_id', null, 'students', 0);
  end if;

  select * into v_note from public.notify_send_for(
    v_tenant,
    'homework.assigned',
    format('%s homework: %s', coalesce(v_subject, 'New'), v_hw.title),
    format('%s homework has been set: %s.%s It is on the homework page.',
           coalesce(v_subject, 'New'), v_hw.title,
           case when v_hw.due_on is not null
                then ' Due ' || to_char(v_hw.due_on, 'FMDD Mon YYYY') || '.' else '' end),
    jsonb_build_object('kind', 'students', 'student_ids', v_students, 'who', 'both'),
    jsonb_build_object('title', v_hw.title, 'subject', v_subject, 'due_on', v_hw.due_on),
    null,
    (select auth.uid()),
    false
  );

  return jsonb_build_object('notification_id', v_note.id, 'students', v_count);
end;
$$;

revoke all on function public.homework_announce(uuid) from public, anon;
grant execute on function public.homework_announce(uuid) to authenticated;

commit;
