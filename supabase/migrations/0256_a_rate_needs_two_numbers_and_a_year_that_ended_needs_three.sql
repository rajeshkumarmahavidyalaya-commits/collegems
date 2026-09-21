-- 0256 — The pace, and why it takes three numbers rather than one
--
-- `0255` gave a course units and a class a record of what it covered. This is
-- the question that was the reason for both:
--
-- > *The year is two-thirds gone. Is Grade 6 Science going to finish?*
--
-- ---------------------------------------------------------------------------
-- Measured in teaching days, not calendar days
--
-- A syllabus is taught on the days the college is open, and this codebase
-- already has one definition of that — `academics_is_teaching_day`, with
-- `hr_working_days` as the counting wrapper `0153` made of it. Using calendar
-- days here would be a second answer to a question that has one, and it would
-- be wrong by the length of every holiday.
--
-- It is computed **once per call**, not per row: the elapsed fraction is a fact
-- about the year, and 96 courses asking the same question 96 times is the
-- `audit_actor_label` mistake — a scalar function over another table, run in a
-- projection.
--
-- ---------------------------------------------------------------------------
-- A rate needs two numbers, and this one needs three
--
-- Rule 12 says a rate hides what was never measured, and that a percentage
-- over an unknown denominator is worse than no percentage. Three separate
-- facts, and collapsing any pair of them loses something a person acts on:
--
--   * **`share_covered` is null, not 0, when no syllabus has been entered.**
--     *"Grade 4 Hindi: 0%"* is an accusation against a teacher who is teaching
--     perfectly well; the college simply has not written the course down. A
--     college that reads 0% goes and asks the wrong person.
--   * **`share_elapsed` is the year, not the course.** It is the same for every
--     row, and it is what makes 40% mean something.
--   * **`year_state` is `before` | `during` | `ended`**, because the honest
--     answer on this college today is not a percentage at all: the current
--     session ran 1 Apr 2025 to 31 Mar 2026 and it is now September 2026.
--     A naive elapsed fraction reads **173%**, and *"Grade 6 Science is 140%
--     behind"* is a sentence nobody can act on.
--
-- That last one is not a hypothetical about some other college — it is this
-- college's live data, which `academics_filing_problems()` already reports as a
-- stale `is_current` flag. The pace function does not second-guess that: it
-- reports on the year the college says it is working in and **says the year has
-- ended**, which is the true answer to a different question than the one the
-- reader was going to ask.

-- ---------------------------------------------------------------------------
-- What "behind" means is the college's to decide
-- ---------------------------------------------------------------------------
--
-- Rule 12: anything a college could reasonably disagree with is a rules
-- document, not an `if`. Two colleges will not agree on how far behind is far
-- enough to be told about — a board-exam year runs tight and a first-year
-- course does not — so the threshold is a setting with a conservative default.
insert into reference.settings_catalog
  (key, label, description, module, value_type, fields, default_value,
   is_required, permission_code, sort_order)
values (
  'academics.syllabus',
  'Syllabus pace',
  'How far behind the calendar a course has to fall before it is reported. '
  '0.15 means a course is named once it has covered 15 percentage points less '
  'of its syllabus than the share of the teaching year that has passed.',
  'Academics',
  'object',
  '[{"name":"behind_by","type":"number","label":"Report a course once it is this far behind (0-1)"}]'::jsonb,
  '{"behind_by":0.15}'::jsonb,
  false,
  'academics.manage',
  90
);

-- ---------------------------------------------------------------------------
-- One course, for one class: the screen a teacher ticks off
-- ---------------------------------------------------------------------------

create or replace function public.syllabus_for_section(
  p_section_id uuid,
  p_subject_id uuid
)
returns table (
  unit_id uuid,
  unit_position integer,
  title text,
  description text,
  planned_periods integer,
  status text,
  covered_on date,
  note text,
  recorded_by text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select u.id, u.position, u.title, u.description, u.planned_periods,
         -- Absence is 'pending'. `syllabus_progress` holds no row for a unit
         -- nobody has touched, so the reader supplies the third state rather
         -- than the table storing it 576 times.
         coalesce(p.status, 'pending'),
         p.covered_on, p.note,
         case when p.recorded_by_staff_id is null then null
              else (select trim(pe.first_name || ' ' || coalesce(pe.last_name, ''))
                      from public.staff st
                      join public.people pe on pe.id = st.person_id
                     where st.id = p.recorded_by_staff_id) end
  from public.syllabus_units u
  join public.sections sec on sec.id = p_section_id
  left join public.syllabus_progress p
    on p.unit_id = u.id and p.section_id = p_section_id
  where u.subject_id = p_subject_id
    and u.class_level_id = sec.class_level_id
    and u.session_id = sec.session_id
  order by u.position
$$;

comment on function public.syllabus_for_section(uuid, uuid) is
  'One course as one class sees it: every unit of the syllabus with that '
  'section''s progress against it. SECURITY INVOKER, so a family reading their '
  'own child''s course gets the units and no progress — they have a policy on '
  'syllabus_units and none on syllabus_progress, deliberately.';

-- ---------------------------------------------------------------------------
-- Recording what was taught
-- ---------------------------------------------------------------------------

create or replace function public.syllabus_mark(
  p_unit_id uuid,
  p_section_id uuid,
  p_status text,
  p_covered_on date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant uuid := ( select public.current_tenant_id() );
  v_unit public.syllabus_units;
  v_section public.sections;
  v_on date;
  v_staff uuid;
  v_n int;
begin
  if p_status not in ('in_progress', 'covered') then
    raise exception 'A unit is either in progress or covered. There is no third state to record — a unit nobody has started simply has no row.';
  end if;

  select * into v_unit from public.syllabus_units where id = p_unit_id;
  if v_unit.id is null then
    raise exception 'That syllabus unit does not exist, or it is not yours to see.';
  end if;

  select * into v_section from public.sections where id = p_section_id;
  if v_section.id is null then
    raise exception 'That class does not exist.';
  end if;

  -- The composite key would refuse this anyway; the check is here for the
  -- sentence, because a foreign-key error names two constraints and neither
  -- the class nor the course.
  if v_section.class_level_id <> v_unit.class_level_id then
    raise exception 'That unit belongs to a different class''s syllabus, so this class cannot have covered it.';
  end if;

  -- A covered unit needs a day, because the only thing the pace report does is
  -- compare what was taught with the calendar.
  v_on := case when p_status = 'covered' then coalesce(p_covered_on, current_date) else null end;

  if v_on is not null and v_on > current_date then
    raise exception 'That is a date in the future. Record a unit as covered on the day it was finished, not the day it is expected to be.';
  end if;

  select up.staff_id into v_staff from public.user_profiles up where up.id = auth.uid();

  insert into public.syllabus_progress
    (tenant_id, session_id, section_id, unit_id, class_level_id, subject_id,
     status, covered_on, recorded_by_staff_id, note)
  values
    (v_tenant, v_unit.session_id, p_section_id, p_unit_id,
     v_unit.class_level_id, v_unit.subject_id,
     p_status, v_on, v_staff, p_note)
  on conflict (tenant_id, section_id, unit_id) do update
    set status = excluded.status,
        covered_on = excluded.covered_on,
        recorded_by_staff_id = excluded.recorded_by_staff_id,
        note = excluded.note;

  get diagnostics v_n = row_count;
  -- 0254's lesson, applied at the point it was learned: a permissive policy
  -- that matches nothing does not refuse, and an upsert that wrote nothing
  -- would otherwise return a document saying it had.
  if v_n = 0 then
    raise exception 'You may not record teaching for this class. That needs the "syllabus.track" permission, and either "academics.manage" or a timetable that puts you in front of this class for this subject.'
      using errcode = '42501';
  end if;

  return jsonb_build_object('unit_id', p_unit_id, 'status', p_status, 'covered_on', v_on);
end;
$$;

create or replace function public.syllabus_unmark(p_unit_id uuid, p_section_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare v_n int;
begin
  -- Back to pending, which is the absence of a row rather than a third value.
  delete from public.syllabus_progress
   where unit_id = p_unit_id and section_id = p_section_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end;
$$;

comment on function public.syllabus_unmark(uuid, uuid) is
  'Returns a unit to "not covered" by deleting its progress row. It reports 0 '
  'rather than raising when there was nothing to remove: unmarking a unit that '
  'was never marked is the state the caller wanted, not an error. The write '
  'policy still decides whether the delete may touch anything.';

-- ---------------------------------------------------------------------------
-- Reordering a syllabus
-- ---------------------------------------------------------------------------

create or replace function public.syllabus_reorder(p_unit_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_n int;
  v_courses int;
begin
  if array_length(p_unit_ids, 1) is null then
    raise exception 'Give the units in the order they should appear.';
  end if;

  -- Every unit has to belong to one course, or "position 3" means three
  -- different things in one statement.
  select count(*) into v_courses from (
    select distinct session_id, class_level_id, subject_id
    from public.syllabus_units where id = any (p_unit_ids)
  ) c;
  if v_courses > 1 then
    raise exception 'Those units belong to % different courses. A syllabus is reordered one course at a time.', v_courses;
  end if;

  -- The whole reason `syllabus_units_one_per_position` is DEFERRABLE. Renumber
  -- 1..n in one statement and every intermediate state collides; deferring the
  -- check to commit is what makes a reorder one act rather than a renumber to
  -- temporary values and back.
  set constraints public.syllabus_units_one_per_position deferred;

  update public.syllabus_units u
     set position = o.ord
    from unnest(p_unit_ids) with ordinality as o(id, ord)
   where u.id = o.id;

  get diagnostics v_n = row_count;
  if v_n <> array_length(p_unit_ids, 1) then
    raise exception 'Only % of % units could be reordered — some are not yours to change. Nothing has been saved.',
      v_n, array_length(p_unit_ids, 1);
  end if;

  return jsonb_build_object('reordered', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- The pace
-- ---------------------------------------------------------------------------

create or replace function public.syllabus_pace(p_session_id uuid default null)
returns table (
  section_id uuid,
  section_label text,
  subject_id uuid,
  subject_name text,
  units integer,
  units_covered integer,
  periods_planned integer,
  periods_covered integer,
  share_covered numeric,
  share_elapsed numeric,
  year_state text,
  last_covered_on date
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_sess public.academic_sessions;
  v_total_days int;
  v_done_days int;
  v_state text;
  v_elapsed numeric;
begin
  select * into v_sess from public.academic_sessions
   where id = coalesce(p_session_id, ( select public.current_session_id(( select public.current_tenant_id() )) ));
  if v_sess.id is null then
    return;
  end if;

  -- Once, not per row. `hr_working_days` walks the calendar asking
  -- `academics_is_teaching_day`, and 96 courses asking the same question is a
  -- correlated subquery wearing a nicer name.
  v_total_days := public.hr_working_days(v_sess.start_date, v_sess.end_date);

  if current_date < v_sess.start_date then
    v_state := 'before';
    v_done_days := 0;
  elsif current_date > v_sess.end_date then
    v_state := 'ended';
    v_done_days := v_total_days;
  else
    v_state := 'during';
    v_done_days := public.hr_working_days(v_sess.start_date, current_date);
  end if;

  v_elapsed := case when v_total_days > 0
                    then round(v_done_days::numeric / v_total_days, 4) end;

  return query
  with courses as (
    -- Every course a class actually studies. Driven off `section_subjects`
    -- rather than off the syllabus, so a course with no syllabus at all is a
    -- row saying so instead of being absent.
    select distinct
      sec.id as sid,
      cl.name || ' · ' || sec.name as slabel,
      ss.subject_id as subid,
      sub.name as subname,
      sec.class_level_id as clid
    from public.sections sec
    join public.class_levels cl on cl.id = sec.class_level_id
    join public.section_subjects ss on ss.section_id = sec.id
    join public.subjects sub on sub.id = ss.subject_id
    where sec.session_id = v_sess.id
  ),
  planned as (
    select u.class_level_id, u.subject_id,
           count(*)::int as n_units,
           sum(u.planned_periods)::int as n_periods
    from public.syllabus_units u
    where u.session_id = v_sess.id
    group by 1, 2
  ),
  done as (
    select p.section_id, p.subject_id,
           count(*) filter (where p.status = 'covered')::int as n_units,
           coalesce(sum(u.planned_periods) filter (where p.status = 'covered'), 0)::int as n_periods,
           max(p.covered_on) as last_on
    from public.syllabus_progress p
    join public.syllabus_units u on u.id = p.unit_id
    where p.session_id = v_sess.id
    group by 1, 2
  )
  select
    c.sid, c.slabel, c.subid, c.subname,
    coalesce(pl.n_units, 0), coalesce(d.n_units, 0),
    coalesce(pl.n_periods, 0), coalesce(d.n_periods, 0),
    -- Null, not zero. A course with no syllabus written down has not covered
    -- 0% of it; there is nothing to have covered, and 0% blames a teacher for
    -- an empty table.
    case when coalesce(pl.n_periods, 0) = 0 then null
         else round(coalesce(d.n_periods, 0)::numeric / pl.n_periods, 4) end,
    v_elapsed,
    v_state,
    d.last_on
  from courses c
  left join planned pl on pl.class_level_id = c.clid and pl.subject_id = c.subid
  left join done d on d.section_id = c.sid and d.subject_id = c.subid
  -- Rule 7: an ORDER BY is part of the contract, and this one is also how a
  -- person reads a class list.
  order by c.slabel, c.subname;
end;
$$;

comment on function public.syllabus_pace(uuid) is
  'One row per course a class studies: how much of the syllabus it has '
  'covered, how much of the teaching year has passed, and whether the year is '
  'before, during or ended. share_covered is NULL where no syllabus has been '
  'written — that is a different fact from 0%.';

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------

create or replace function public.syllabus_problems()
returns table (severity text, message text)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_behind numeric;
  v_any int;
  v_no_syllabus int;
  v_total int;
  v_lagging int;
  v_worst text;
  v_unfinished int;
  v_misdated int;
  v_state text;
begin
  -- Gated on the permission held by somebody who may *act* on it. A teacher
  -- who reads "Grade 4 Hindi has no syllabus" cannot write one.
  if not ( select public.role_has_permission('academics.manage') ) then
    raise exception 'Reviewing syllabus pace needs the "academics.manage" permission.'
      using errcode = '42501';
  end if;

  v_behind := coalesce(
    (public.setting_value('academics.syllabus') ->> 'behind_by')::numeric, 0.15);

  select count(*) filter (where units > 0),
         count(*) filter (where units = 0),
         count(*),
         max(year_state)
    into v_any, v_no_syllabus, v_total, v_state
  from public.syllabus_pace();

  -- **Silent until the college has started.** A product that greets a new
  -- college with 48 findings about a module they have not opened is the critic
  -- this file already warns about — one people learn to ignore. Nothing here
  -- fires while no syllabus exists at all.
  if v_any = 0 then
    return;
  end if;

  if v_no_syllabus > 0 then
    return query select 'info'::text, format(
      '%s of %s courses have no syllabus written down, so there is nothing to '
      'measure them against. The other %s are being tracked.',
      v_no_syllabus, v_total, v_any);
  end if;

  if v_state = 'during' then
    select count(*), min(section_label || ' · ' || subject_name)
      into v_lagging, v_worst
    from public.syllabus_pace()
    where units > 0
      and share_elapsed is not null
      and share_covered < share_elapsed - v_behind;

    if v_lagging = 1 then
      return query select 'warning'::text, format(
        'One course is more than %s behind the teaching year: %s.',
        round(v_behind * 100) || ' percentage points', v_worst);
    elsif v_lagging > 1 then
      return query select 'warning'::text, format(
        '%s courses are more than %s behind the teaching year, the first being %s.',
        v_lagging, round(v_behind * 100) || ' percentage points', v_worst);
    end if;
  end if;

  if v_state = 'ended' then
    select count(*) into v_unfinished
    from public.syllabus_pace()
    where units > 0 and coalesce(share_covered, 0) < 1;

    if v_unfinished > 0 then
      -- Deliberately not "behind": the year is over, so there is nothing left
      -- to catch up on. What this is for is next year's plan.
      return query select 'info'::text, format(
        'The year has ended and %s course(s) did not finish their syllabus. '
        'That is a fact for next year''s planning rather than something to fix now.',
        v_unfinished);
    end if;
  end if;

  -- A unit recorded as covered on a day outside the year it belongs to —
  -- 0198's filing question, asked of this table.
  select count(*) into v_misdated
  from public.syllabus_progress p
  join public.academic_sessions a on a.id = p.session_id
  where p.covered_on is not null
    and (p.covered_on < a.start_date or p.covered_on > a.end_date);

  if v_misdated > 0 then
    return query select 'warning'::text, format(
      '%s unit(s) are recorded as covered on a date outside the academic year '
      'they belong to. Check the dates, or the year those classes are filed under.',
      v_misdated);
  end if;

  return;
end;
$$;

comment on function public.syllabus_problems() is
  'What is wrong with the college''s syllabus tracking. Deliberately silent '
  'until at least one course has a syllabus: a new college greeted with 48 '
  'findings about a module it has not opened learns to ignore the check page.';
