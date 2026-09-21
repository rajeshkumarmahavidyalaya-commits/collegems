-- 0257 — 0254's lesson applied to the wrong kind of statement
--
-- `0256`'s `syllabus_mark` ends with this, copied from `0254` two days after
-- writing it:
--
--     get diagnostics v_n = row_count;
--     if v_n = 0 then
--       raise exception 'You may not record teaching for this class. …';
--     end if;
--
-- Probed as the Science teacher of Grade 1 A, marking an **English** unit for
-- the same class — the exact case the write policy exists to refuse:
--
--     refused — new row violates row-level security policy
--               for table "syllabus_progress"
--
-- The policy refused it correctly. The **sentence never ran**, and a teacher
-- got Postgres's own words on their screen.
--
-- > **An `UPDATE` that no policy matches writes nothing and raises nothing. An
-- > `INSERT` whose `WITH CHECK` fails *raises*.** They are opposite failure
-- > modes, and `get diagnostics` is the tool for the first one only.
--
-- `0254` was about two UPDATEs and the assertion was right there. Copying it
-- onto an INSERT without asking which statement kind the lesson was about
-- produced a branch that can never execute, sitting exactly where a reader
-- would believe the refusal was handled — which is worse than no branch,
-- because it answers the question somebody was about to ask.
--
-- This file already has the general form of that mistake written down, about
-- comments: *a comment that names the mechanism is the first thing to go and
-- check.* Here the comment was code, and it was still describing an intention.
--
-- ---------------------------------------------------------------------------
-- What replaces it
--
-- An explicit check **before** the write, naming the class and the subject,
-- because *"you are not down to teach English to Grade 1 A"* is a sentence
-- somebody can act on and *"new row violates row-level security policy"* is
-- one they forward to the office.
--
-- The row-count assertion stays underneath it and is now commented for what it
-- actually covers: the `on conflict do update` path, where a row exists that
-- the caller's `USING` clause cannot see. That one really does touch nothing
-- and really does not raise.
--
-- The pre-check is not the boundary. The policy is, and it is unchanged —
-- rule 4's first sentence, and the reason this function stays SECURITY
-- INVOKER rather than becoming a definer that checks the same thing twice.

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
  v_subject text;
  v_class text;
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

  -- The authorization sentence. See the header: without this the caller meets
  -- `new row violates row-level security policy for table "syllabus_progress"`,
  -- because an INSERT refused by WITH CHECK raises rather than writing nothing.
  if not ( select public.role_has_permission('syllabus.track') ) then
    raise exception 'Your role may not record what a class has been taught. That needs the "syllabus.track" permission.'
      using errcode = '42501';
  end if;

  if not ( ( select public.role_has_permission('academics.manage') )
           or public.staff_teaches(p_section_id, v_unit.subject_id) ) then
    select sub.name, cl.name || ' · ' || v_section.name
      into v_subject, v_class
    from public.subjects sub, public.class_levels cl
    where sub.id = v_unit.subject_id and cl.id = v_section.class_level_id;

    -- Named, because "you are not down to teach English to Grade 1 A" is a
    -- sentence somebody acts on — by fixing the routine, or by asking the
    -- office — and a policy error is one they forward.
    raise exception 'You are not down to teach % to %. Only the class teacher, somebody the routine puts in front of that class for that subject, or the academics office can record this.',
      coalesce(v_subject, 'that subject'), coalesce(v_class, 'that class')
      using errcode = '42501';
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
  -- This covers the UPDATE half only, and that is the half it is for: a row
  -- exists, the caller's USING clause cannot see it, the update touches
  -- nothing and raises nothing. The INSERT half is handled by the checks
  -- above, because it raises instead.
  if v_n = 0 then
    raise exception 'Nothing was recorded — that unit already has an entry for this class which your role may not change.'
      using errcode = '42501';
  end if;

  return jsonb_build_object('unit_id', p_unit_id, 'status', p_status, 'covered_on', v_on);
end;
$$;

comment on function public.syllabus_mark(uuid, uuid, text, date, text) is
  'Records a unit as in progress or covered for one class. Checks authority '
  'before writing and names the class and the subject when it refuses: an '
  'INSERT refused by a WITH CHECK policy raises, so a row-count assertion '
  'after it can never run and the caller would meet Postgres''s own words.';
