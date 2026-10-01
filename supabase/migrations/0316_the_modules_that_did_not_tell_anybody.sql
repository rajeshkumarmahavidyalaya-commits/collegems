-- 0316: transport, hostel, promotion and front office tell the people concerned.
--
-- Four module docs ended "Nothing notifies anybody". Each is now one event in
-- rule 10's catalogue with one raiser, in the module's own words.
--
-- ## Where the raiser lives
--
-- 0314's homework raiser is called by the one server action that publishes.
-- A bus seat and a hostel bed are made by three callers each -- the transport
-- screen, the student's record, the admission form -- and by renewals, which
-- write a year's worth at once. Rule 6's question, *what else reaches this
-- row?*, has four answers here, so the announcement is an AFTER INSERT trigger
-- on the table: every way a seat or a bed is made tells the family, and a
-- fifth caller added next year does too.
--
-- Two rules keep a trigger from becoming a liability:
--
--   * **a failed announcement is not a failed arrangement.** The whole body is
--     inside `begin ... exception when others` -- a notification problem must
--     never roll back the seat a bursar just gave a child;
--   * **its words are its own** and its audience is the one child the row
--     names (rule 10, 0219). Nothing is taken from the caller.
--
-- A staff seat (0293) has no family, so it is not announced.
--
-- ## Promotion
--
-- Applying a run is one act over a cohort, so it is one notification to the
-- whole cohort, raised by `promotion_announce(run)` after the apply (definer,
-- gated on `promotion.manage`). Its words are deliberately general -- "your
-- class for next year has been decided" -- because one body goes to every
-- family, and a kept-back child's family must not read "promoted".
--
-- ## Front office
--
-- An online application (0268) arrives from somebody who is not a user, at an
-- hour nobody is watching. The admissions office is told, in the app: a
-- trigger on `enquiries` for rows the online form wrote, addressed
-- to the college's administrators.
--
-- All four are in-app by default; a college that wants an SMS for a bus seat
-- turns it on under notification settings.

begin;

insert into reference.notification_types (key, name, description, default_channels, stale_after)
values
  ('transport.assigned', 'Bus seat given',
   'A child was given a seat on a school bus: the route, the stop and the time.',
   array['in_app'], interval '14 days'),
  ('hostel.allocated', 'Hostel bed given',
   'A child was given a bed in a hostel: the hostel and the room.',
   array['in_app'], interval '14 days'),
  ('promotion.decided', 'Next year''s class decided',
   'The college has decided each child''s class for the coming year.',
   array['in_app'], interval '30 days'),
  ('admissions.application_received', 'Online application received',
   'Somebody applied for admission through the college''s online form.',
   array['in_app'], interval '7 days')
on conflict (key) do nothing;

-- ----------------------------------------------------------------- bus seats --

create or replace function public.transport_announce_seat()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_route text;
  v_stop text;
  v_time time;
  v_child text;
begin
  if new.student_id is null or new.status <> 'active' then
    return new;
  end if;
  begin
    select r.name into v_route from public.transport_routes r
    where r.id = new.route_id and r.tenant_id = new.tenant_id;
    select s.name, case when new.direction = 'drop' then s.drop_time else s.pickup_time end
      into v_stop, v_time
    from public.route_stops s where s.id = new.stop_id and s.tenant_id = new.tenant_id;
    select p.first_name into v_child from public.students st
    join public.people p on p.id = st.person_id
    where st.id = new.student_id and st.tenant_id = new.tenant_id;

    perform public.notify_send_for(
      new.tenant_id,
      'transport.assigned',
      format('Bus seat for %s', coalesce(v_child, 'your child')),
      format('%s has a seat on %s from %s%s, starting %s.',
             coalesce(v_child, 'Your child'), coalesce(v_route, 'a school bus'),
             coalesce(v_stop, 'their stop'),
             case when v_time is not null then ' at ' || to_char(v_time, 'HH24:MI') else '' end,
             to_char(new.starts_on, 'FMDD Mon YYYY')),
      jsonb_build_object('kind', 'students', 'student_ids', jsonb_build_array(new.student_id), 'who', 'both'),
      jsonb_build_object('route', v_route, 'stop', v_stop),
      null, auth.uid(), false);
  exception when others then
    raise warning 'transport.assigned was not announced: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.transport_announce_seat() from public, anon, authenticated;

create trigger transport_assignments_announce
  after insert on public.transport_assignments
  for each row execute function public.transport_announce_seat();

-- -------------------------------------------------------------------- hostel --

create or replace function public.hostel_announce_bed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hostel text;
  v_room text;
  v_child text;
begin
  if new.student_id is null or new.status <> 'active' then
    return new;
  end if;
  begin
    select h.name into v_hostel from public.hostels h where h.id = new.hostel_id and h.tenant_id = new.tenant_id;
    select r.room_number into v_room from public.hostel_rooms r where r.id = new.room_id and r.tenant_id = new.tenant_id;
    select p.first_name into v_child from public.students st
    join public.people p on p.id = st.person_id
    where st.id = new.student_id and st.tenant_id = new.tenant_id;

    perform public.notify_send_for(
      new.tenant_id,
      'hostel.allocated',
      format('Hostel bed for %s', coalesce(v_child, 'your child')),
      format('%s has a bed in %s, room %s, from %s.',
             coalesce(v_child, 'Your child'), coalesce(v_hostel, 'the hostel'),
             coalesce(v_room, '-'), to_char(new.starts_on, 'FMDD Mon YYYY')),
      jsonb_build_object('kind', 'students', 'student_ids', jsonb_build_array(new.student_id), 'who', 'both'),
      jsonb_build_object('hostel', v_hostel, 'room', v_room),
      null, auth.uid(), false);
  exception when others then
    raise warning 'hostel.allocated was not announced: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.hostel_announce_bed() from public, anon, authenticated;

create trigger hostel_allocations_announce
  after insert on public.hostel_allocations
  for each row execute function public.hostel_announce_bed();

-- ----------------------------------------------------------------- promotion --

create or replace function public.promotion_announce(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_run public.promotion_runs;
  v_year text;
  v_students jsonb;
  v_count integer;
  v_note public.notifications;
begin
  if v_tenant is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if not public.role_has_permission('promotion.manage') then
    raise exception 'Your role does not run promotions.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_run from public.promotion_runs where id = p_run_id and tenant_id = v_tenant;
  if v_run.id is null then
    raise exception 'No such promotion run.' using errcode = 'no_data_found';
  end if;
  if v_run.status <> 'applied' then
    raise exception 'Apply the run before telling the families.' using errcode = 'check_violation';
  end if;

  select name into v_year from public.academic_sessions where id = v_run.to_session_id and tenant_id = v_tenant;

  -- Everybody the run decided something for and who is still at the school:
  -- a graduate's family is told too, because "decided" is true of them.
  select coalesce(jsonb_agg(distinct d.student_id), '[]'::jsonb), count(distinct d.student_id)
    into v_students, v_count
  from public.promotion_decisions d
  where d.tenant_id = v_tenant and d.run_id = p_run_id and d.decision <> 'hold';

  if v_count = 0 then
    return jsonb_build_object('notification_id', null, 'students', 0);
  end if;

  select * into v_note from public.notify_send_for(
    v_tenant,
    'promotion.decided',
    format('Classes for %s', coalesce(v_year, 'next year')),
    format('The college has decided each child''s class for %s. Open the app to see your child''s.',
           coalesce(v_year, 'next year')),
    jsonb_build_object('kind', 'students', 'student_ids', v_students, 'who', 'both'),
    jsonb_build_object('year', v_year),
    null, auth.uid(), false);

  return jsonb_build_object('notification_id', v_note.id, 'students', v_count);
end;
$$;

revoke all on function public.promotion_announce(uuid) from public, anon;
grant execute on function public.promotion_announce(uuid) to authenticated;

-- -------------------------------------------------------------- front office --

create or replace function public.enquiries_announce_online()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- The online form (0268) writes source 'website' with nobody signed in;
  -- staff typing in an enquiry that came from the website are signed in.
  if new.source <> 'website' or auth.uid() is not null then
    return new;
  end if;
  begin
    perform public.notify_send_for(
      new.tenant_id,
      'admissions.application_received',
      format('Online application: %s %s', new.applicant_first_name, coalesce(new.applicant_last_name, '')),
      format('%s %s applied online%s. The enquiry is %s in Front office.',
             new.applicant_first_name, coalesce(new.applicant_last_name, ''),
             case when new.contact_name is not null then ' (contact: ' || new.contact_name || ')' else '' end,
             coalesce(new.enquiry_number, 'waiting')),
      jsonb_build_object('kind', 'role', 'role', 'admin'),
      jsonb_build_object('enquiry', new.enquiry_number),
      null, null, false);
  exception when others then
    raise warning 'admissions.application_received was not announced: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.enquiries_announce_online() from public, anon, authenticated;

create trigger enquiries_announce_online
  after insert on public.enquiries
  for each row execute function public.enquiries_announce_online();

commit;
