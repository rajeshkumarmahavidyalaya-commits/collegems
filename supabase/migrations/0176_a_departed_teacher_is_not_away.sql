-- ---------------------------------------------------------------------------
-- A departed teacher is not away. Their classes have nobody, and nothing said so
-- ---------------------------------------------------------------------------
--
-- `0174` closed this for children. The same question asked about staff found a
-- sharper version of it, and this one is **true in the demo data right now**:
--
--     Rudra Rai            status: terminated
--     staff_is_away(today) false
--     lessons today        3
--     substitution_gaps    0 of them flagged
--
-- Across the timetable that one departure leaves **19 lessons**, **2 sections**
-- whose class teacher has gone, and **6 section-subject assignments**.
--
-- Payroll and the staff register already handle a leaver -- `payroll_preview`
-- and `hr_attendance_sheet` both read `date_of_leaving`, from the payroll-gaps
-- work. The timetable side was never taught: `substitution_gaps`,
-- `timetable_for_section` and `staff_is_away` all ignore employment entirely.
--
-- WHY "MARK THEM AWAY" IS THE WRONG ONE-LINE FIX
--
-- It is tempting: `staff_is_away` returns true for a leaver and the roster
-- lights up. But *away* means temporarily absent, and the answer to a temporary
-- absence is cover -- a substitution row, arranged this morning, for today.
-- A departed teacher's lessons do not need covering every day until July; they
-- need **a different teacher**. Conflating the two would have the office
-- arranging the same emergency four hundred times.
--
--   > "Nobody is here today" and "nobody teaches this any more" are different
--   > problems for different people. The morning roster wants the first; the
--   > person who owns the timetable wants the second. A screen that shows only
--   > one of them makes the other invisible.
--
-- AND WHY UNASSIGNING ALONE WOULD TRADE ONE SILENCE FOR ANOTHER
--
-- `staff_exit` clears `teacher_staff_id` on those lessons, because a timetable
-- entry's teacher is a statement about **now** -- migration `0155`'s
-- distinction, where a statement about a day that has passed gets frozen
-- instead, which is what `substitutions` does. But `substitution_gaps` required
-- `teacher_staff_id is not null`, so nulling them would have removed those
-- lessons from the morning list altogether: a quieter bug than the one being
-- fixed. So the roster learns about unassigned lessons **first**, and only then
-- is it safe to unassign.

-- ---------------------------------------------------------------------------
-- The roster sees a lesson with nobody on it
-- ---------------------------------------------------------------------------
--
-- One new column, `reason`, rather than a second function: the morning list is
-- one list. `away` is a stopgap somebody arranges today; `unassigned` is a hole
-- in the timetable that will be there tomorrow too, and the screen says so.

-- `create or replace` cannot widen a set-returning function's row type, so the
-- old one goes first. Same name, same argument, one extra column -- every
-- caller maps fields by name and is unaffected.
drop function if exists public.substitution_gaps(date);

create or replace function public.substitution_gaps(p_date date default null)
returns table (
  timetable_entry_id uuid,
  time_slot_id uuid,
  period_number integer,
  starts_at time,
  section_label text,
  subject_name text,
  absent_staff_id uuid,
  absent_teacher text,
  substitute_staff_id uuid,
  substitute_teacher text,
  note text,
  arranged boolean,
  reason text
)
language sql
stable
set search_path = public, extensions
as $$
  with day as (
    select
      coalesce(p_date, public.mobile_today()) as on_date,
      extract(isodow from coalesce(p_date, public.mobile_today()))::integer as weekday
  )
  select
    e.id,
    e.time_slot_id,
    ts.period_number,
    ts.starts_at,
    (cl.name || ' ' || sec.name)::text,
    sub.name,
    e.teacher_staff_id,
    coalesce((ap.first_name || ' ' || ap.last_name), 'Nobody assigned')::text,
    s.substitute_staff_id,
    (sp.first_name || ' ' || sp.last_name)::text,
    s.note,
    s.id is not null,
    case when e.teacher_staff_id is null then 'unassigned' else 'away' end::text
  from public.timetable_entries e
  cross join day d
  join public.time_slots ts on ts.id = e.time_slot_id
  join public.sections sec on sec.id = e.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  join public.subjects sub on sub.id = e.subject_id
  left join public.staff ast on ast.id = e.teacher_staff_id
  left join public.people ap on ap.id = ast.person_id
  left join public.substitutions s
    on s.timetable_entry_id = e.id and s.on_date = d.on_date
  left join public.staff sst on sst.id = s.substitute_staff_id
  left join public.people sp on sp.id = sst.person_id
  where e.weekday = d.weekday
    and e.session_id = public.current_session_id(public.current_tenant_id())
    and (
      -- Somebody is away and the class needs covering today...
      (e.teacher_staff_id is not null and public.staff_is_away(d.on_date, e.teacher_staff_id))
      -- ...or nobody teaches it at all, which is a class with nobody in front
      -- of it just as surely, and was invisible before this migration.
      or e.teacher_staff_id is null
    )
    and (select c.is_working from public.attendance_calendar(d.on_date, d.on_date) c)
  order by (s.id is not null), ts.period_number, 5
$$;

revoke all on function public.substitution_gaps(date) from public, anon;
grant execute on function public.substitution_gaps(date) to authenticated;

comment on function public.substitution_gaps(date) is
  'Lessons with nobody in front of them today: `reason = away` (cover it) or '
  '`reason = unassigned` (the timetable needs a teacher, and will again '
  'tomorrow). See migration 0176.';

-- ---------------------------------------------------------------------------
-- A vacant post is a real answer to "who was away"
-- ---------------------------------------------------------------------------
--
-- `substitutions.absent_staff_id` was `not null`, which made an unassigned
-- lesson uncoverable: there is nobody to name. A school does put somebody in
-- front of that class while it recruits, so null is widened in and **means
-- something specific** -- the post was vacant, as against a named person being
-- absent. Two different mornings, and a nullable column is what distinguishes
-- them.

alter table public.substitutions alter column absent_staff_id drop not null;

comment on column public.substitutions.absent_staff_id is
  'Who was away, frozen at arrangement (migration 0155). NULL means the post '
  'was vacant -- nobody was away because nobody taught it. See migration 0176.';

-- `substitution_problems` inner-joined `staff` on the absent teacher, which
-- would now drop every vacant-post arrangement out of the critic entirely --
-- the same "quieter bug than the one being fixed" this migration is about.
create or replace function public.substitution_problems(p_date date default null)
returns table (timetable_entry_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with day as (select coalesce(p_date, public.mobile_today()) as on_date),
  arranged as (
    select
      s.*,
      coalesce((ap.first_name || ' ' || ap.last_name), 'the vacant post')::text as absent_name,
      (sp.first_name || ' ' || sp.last_name)::text as sub_name,
      ts.period_number
    from public.substitutions s
    cross join day d
    left join public.staff ast on ast.id = s.absent_staff_id
    left join public.people ap on ap.id = ast.person_id
    join public.time_slots ts on ts.id = s.time_slot_id
    left join public.staff sst on sst.id = s.substitute_staff_id
    left join public.people sp on sp.id = sst.person_id
    where s.on_date = d.on_date
  )
  select a.timetable_entry_id, 'warning'::text, format(
    '%s is not marked away any more, but period %s is still covered by %s. '
    'Clear it, or the class has two teachers and another has none.',
    a.absent_name, a.period_number, coalesce(a.sub_name, 'nobody'))
  from arranged a, day d
  where a.absent_staff_id is not null
    and not public.staff_is_away(d.on_date, a.absent_staff_id)

  union all

  select a.timetable_entry_id, 'error'::text, format(
    '%s is covering period %s and is now marked away as well. That class has '
    'nobody.', a.sub_name, a.period_number)
  from arranged a, day d
  where a.substitute_staff_id is not null
    and public.staff_is_away(d.on_date, a.substitute_staff_id)

  union all

  select a.timetable_entry_id, 'error'::text, format(
    '%s is covering period %s, but now teaches their own class in that period. '
    'The timetable changed after this was arranged.', a.sub_name, a.period_number)
  from arranged a
  cross join day d
  join public.timetable_entries e on e.id = a.timetable_entry_id
  where a.substitute_staff_id is not null
    and exists (
      select 1 from public.timetable_entries te
      where te.teacher_staff_id = a.substitute_staff_id
        and te.time_slot_id = a.time_slot_id
        and te.weekday = extract(isodow from d.on_date)::integer
        and te.session_id = e.session_id
    )

  union all

  select a.timetable_entry_id, 'info'::text, format(
    'Period %s (for %s) has no substitute. Make sure somebody knows those '
    'children are being merged or supervised.', a.period_number, a.absent_name)
  from arranged a
  where a.substitute_staff_id is null
$$;

revoke all on function public.substitution_problems(date) from public, anon;
grant execute on function public.substitution_problems(date) to authenticated;

-- `substitution_arrange` refuses a lesson whose teacher is not marked away.
-- An unassigned lesson has no teacher to be away, so it would refuse those too
-- -- and covering one for a day is a perfectly reasonable thing to do while the
-- timetable is sorted out.
create or replace function public.substitution_arrange(
  p_timetable_entry_id uuid,
  p_date date,
  p_substitute_staff_id uuid default null,
  p_note text default null
)
returns public.substitutions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_e public.timetable_entries;
  v_row public.substitutions;
  v_name text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_e from public.timetable_entries where id = p_timetable_entry_id;
  if v_e.id is null then
    raise exception 'No such lesson, or you cannot see it';
  end if;

  if v_e.weekday <> extract(isodow from p_date)::integer then
    raise exception 'That lesson is not taught on a %', to_char(p_date, 'FMDay');
  end if;

  -- An unassigned lesson is coverable without anybody being away: there is
  -- nobody to be away. `absent_staff_id` is nullable for exactly this.
  if v_e.teacher_staff_id is not null
     and not public.staff_is_away(p_date, v_e.teacher_staff_id) then
    select (p.first_name || ' ' || p.last_name) into v_name
    from public.staff s join public.people p on p.id = s.person_id
    where s.id = v_e.teacher_staff_id;

    raise exception
      '% is not marked away on %. Approve their leave or mark the register first.',
      v_name, to_char(p_date, 'FMDD Mon YYYY');
  end if;

  begin
    insert into public.substitutions (
      tenant_id, session_id, on_date, timetable_entry_id,
      absent_staff_id, time_slot_id, substitute_staff_id, note, arranged_by
    )
    values (
      v_tenant_id, v_e.session_id, p_date, v_e.id,
      v_e.teacher_staff_id, v_e.time_slot_id, p_substitute_staff_id,
      nullif(trim(coalesce(p_note, '')), ''), ( select auth.uid() )
    )
    on conflict (timetable_entry_id, on_date) do update
      set substitute_staff_id = excluded.substitute_staff_id,
          note = excluded.note,
          arranged_by = excluded.arranged_by
    returning * into v_row;
  exception when unique_violation then
    select (p.first_name || ' ' || p.last_name) into v_name
    from public.staff s join public.people p on p.id = s.person_id
    where s.id = p_substitute_staff_id;

    raise exception
      '% is already covering another class in that period on %.',
      coalesce(v_name, 'That teacher'), to_char(p_date, 'FMDD Mon YYYY');
  end;

  if v_row.id is null then
    raise exception 'You cannot arrange cover for this lesson';
  end if;

  return v_row;
end;
$$;

revoke all on function public.substitution_arrange(uuid, date, uuid, text) from public, anon;
grant execute on function public.substitution_arrange(uuid, date, uuid, text) to authenticated;
