-- 0251 — The interleave is the whole point
--
-- `0249` gave a seat a room and a number. This decides *which* number, and the
-- deciding is the only interesting part of the module: seating a section in its
-- own classroom is what a college gets for free, and it puts 25 candidates
-- writing the identical paper in five rows of five.
--
-- ---------------------------------------------------------------------------
-- Spreading each paper over the unit interval
--
-- The textbook answer is round-robin: one candidate from each paper in turn.
-- It is correct when the papers are the same size and poor when they are not —
-- with papers of 100, 50 and 10 it exhausts the small ones early and leaves the
-- big one to sit next to itself for the last fifty seats.
--
-- So each paper's candidates are spread **evenly over [0, 1)** and the sitting
-- is read off in that order:
--
--     position = (rank_within_paper - 0.5) / size_of_paper
--
-- A paper of 100 lands every 0.01, one of 10 every 0.1, and the two interleave
-- in proportion rather than in lockstep. For papers of equal size it is
-- exactly round-robin, which is why the demo college's twelve papers of 25-27
-- come out perfectly alternating.
--
-- **It cannot always succeed, and the honest half is that nothing here claims
-- it did.** If one paper holds more than half the candidates at a sitting then
-- two of its candidates must sit together, whatever the arrangement — that is
-- the pigeonhole principle, not a weakness of this expression. So the
-- arrangement is generated and then `exam_seating_problems()` **measures the
-- result that exists**, rather than the generator reporting on its own
-- intentions. A number that describes what the algorithm meant to do is this
-- file's oldest recurring defect.
--
-- ---------------------------------------------------------------------------
-- What `is_optional` cannot tell anybody
--
-- 12 of this college's papers are flagged `is_optional`, and **there is no
-- per-student elective register anywhere in the schema** — `section_subjects`
-- maps a section to a subject and nothing maps a child to the optional paper
-- they chose. So the candidate list for an optional paper is *everybody in the
-- section*, which is too many.
--
-- That is not something to guess at. The generator counts it and returns the
-- number, and the critic says it in a sentence, because the office can check a
-- list of 27 against their own elective register in a minute and cannot undo a
-- seating plan built on an invented one. A column recording an intention with
-- no executable half is this file's other recurring defect; naming it is
-- cheaper than modelling electives inside a seating module.

-- ---------------------------------------------------------------------------
-- A swap is one act, so it must be one statement
-- ---------------------------------------------------------------------------
--
-- `exam_seat_move` below exchanges two candidates when the target seat is
-- taken, which is what an examination officer actually does — the alternative
-- is a two-step dance that the unique index refuses halfway through, leaving
-- one candidate in limbo.
--
-- A single UPDATE that swaps two values still fails against a non-deferrable
-- unique index, because the index is maintained as each row is written rather
-- than at the end of the statement, so the first row collides with the second's
-- old value. Making the constraint deferrable is the fix, and it weakens
-- nothing: `initially immediate` means every ordinary write is checked exactly
-- as before, and only a statement that explicitly defers it gets the window.
alter table public.exam_seat_allocations
  drop constraint exam_seat_allocations_one_per_seat;
alter table public.exam_seat_allocations
  add constraint exam_seat_allocations_one_per_seat
  unique (tenant_id, plan_id, room_id, seat_no)
  deferrable initially immediate;

-- ---------------------------------------------------------------------------
-- The rules, with the conservative reading of every missing key
-- ---------------------------------------------------------------------------

create or replace function public.exam_seating_rules(p_rules jsonb default null)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  -- One place applies a default, so the generator, the screen and the critic
  -- cannot disagree about what `{}` means. An unrecognised value reads as the
  -- conservative choice rather than raising: a half-finished settings document
  -- must still be savable (rule 12), and a seating plan that refuses to
  -- generate because somebody typed "Spread" is worse than one that spreads.
  select jsonb_build_object(
    'fill',
      case when r ->> 'fill' in ('pack', 'spread') then r ->> 'fill' else 'spread' end,
    -- True unless the college has explicitly said otherwise. A college that
    -- wants leniency will say so; a college that gets candidates writing one
    -- paper side by side finds out from an invigilator.
    'separate_same_paper',
      case when r ->> 'separate_same_paper' = 'false' then false else true end,
    'order',
      case when r ->> 'order' in ('roll', 'admission', 'name') then r ->> 'order' else 'roll' end,
    'reserve_per_room',
      case when r ->> 'reserve_per_room' ~ '^[0-9]+$'
           then least((r ->> 'reserve_per_room')::int, 1000) else 0 end
  )
  from (select coalesce(p_rules, public.setting_value('exams.seating'), '{}'::jsonb) as r) s
$$;

comment on function public.exam_seating_rules(jsonb) is
  'Normalises a seating-rules document, applying the default for every missing '
  'or unrecognised key. Called with no argument it reads the tenant''s '
  'exams.seating setting; a plan calls it with its own frozen copy.';

-- ---------------------------------------------------------------------------
-- Who sits at this sitting
-- ---------------------------------------------------------------------------

create or replace function public.exam_seat_candidates(
  p_exam_id uuid,
  p_sits_on date,
  p_time_slot_id uuid default null
)
returns table (
  student_id uuid,
  exam_subject_id uuid,
  section_id uuid,
  paper text,
  section_label text,
  roll_number text,
  admission_number text,
  student_name text,
  is_optional boolean,
  roll_sort text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    en.student_id,
    es.id,
    es.section_id,
    sub.name,
    cl.name || ' · ' || sec.name,
    en.roll_number,
    st.admission_number,
    trim(pe.first_name || ' ' || coalesce(pe.last_name, '')),
    es.is_optional,
    -- A roll number is `text`, so '10' sorts before '2'. Pad the ones that are
    -- entirely digits and leave the rest alone, because '7A' is a real roll
    -- number and padding it would put it in the wrong place twice over.
    case when en.roll_number ~ '^[0-9]+$' then lpad(en.roll_number, 12, '0')
         else coalesce(en.roll_number, '~') end
  from public.exam_subjects es
  join public.sections sec on sec.id = es.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  join public.subjects sub on sub.id = es.subject_id
  join public.enrolments en
    on en.section_id = es.section_id and en.status = 'active'
  join public.students st on st.id = en.student_id
  join public.people pe on pe.id = st.person_id
  where es.exam_id = p_exam_id
    and es.exam_date = p_sits_on
    -- `is not distinct from` rather than `=`, so a null slot matches a null
    -- slot. A college that sets no periods has null on both sides, and that is
    -- 96 of 96 dated papers here.
    and es.time_slot_id is not distinct from p_time_slot_id
$$;

comment on function public.exam_seat_candidates(uuid, date, uuid) is
  'Everybody due to sit a paper of this exam on this date and in this period, '
  'one row per candidate per paper. SECURITY INVOKER, so a teacher sees the '
  'children they teach and an administrator sees the cohort. For an OPTIONAL '
  'paper this is every child in the section, because nothing in the schema '
  'records who elected it.';

-- ---------------------------------------------------------------------------
-- The generator
-- ---------------------------------------------------------------------------

create or replace function public.exam_seat_plan_generate(
  p_exam_id uuid,
  p_sits_on date,
  p_time_slot_id uuid default null,
  p_room_ids uuid[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant uuid := ( select public.current_tenant_id() );
  v_exam public.exams;
  v_rules jsonb := public.exam_seating_rules();
  v_fill text := v_rules ->> 'fill';
  v_order text := v_rules ->> 'order';
  v_reserve int := (v_rules ->> 'reserve_per_room')::int;
  v_plan_id uuid;
  v_total int;
  v_papers int;
  v_optional_papers int;
  v_optional_seats int;
  v_twice int;
  v_rooms int;
  v_usable int;
  v_depth int;
  v_quota int;
  v_placed int;
begin
  -- The write policies would refuse this anyway; the check is here for the
  -- sentence. A caller met by silence cannot tell "no permission" from
  -- "nobody is sitting that day".
  if not ( select public.role_has_permission('exams.manage') ) then
    raise exception 'Your role may not prepare a seating plan. That needs the "exams.manage" permission.'
      using errcode = '42501';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if v_exam.id is null then
    raise exception 'That exam does not exist, or it is not yours to see.';
  end if;

  select count(*),
         count(distinct c.exam_subject_id),
         count(distinct c.exam_subject_id) filter (where c.is_optional),
         count(*) filter (where c.is_optional)
    into v_total, v_papers, v_optional_papers, v_optional_seats
  from public.exam_seat_candidates(p_exam_id, p_sits_on, p_time_slot_id) c;

  if v_total = 0 then
    raise exception 'Nobody is sitting a paper of % on %. Check the paper dates first — a paper with no date is not part of any sitting.',
      v_exam.name, to_char(p_sits_on, 'DD Mon YYYY');
  end if;

  -- A candidate resolving twice means two papers of this exam are timetabled
  -- for one section at one sitting. `exam_seat_allocations_one_per_student`
  -- would refuse the second row with a constraint error naming neither the
  -- child nor the clash, so it is caught here instead.
  select count(*) into v_twice from (
    select 1 from public.exam_seat_candidates(p_exam_id, p_sits_on, p_time_slot_id)
    group by student_id having count(*) > 1
  ) d;
  if v_twice > 0 then
    raise exception '% candidate(s) are down for two papers at this sitting, so they cannot be given one seat. Give the papers different dates, or different periods on the same date.',
      v_twice;
  end if;

  select count(*), coalesce(sum(greatest(cr.capacity - v_reserve, 0)), 0)
    into v_rooms, v_usable
  from public.class_rooms cr
  where cr.tenant_id = v_tenant
    and cr.is_active
    and (p_room_ids is null or cr.id = any (p_room_ids));

  if v_rooms = 0 then
    raise exception 'No active room was offered for this sitting. Add one under Academics, or choose fewer rooms to hold back.';
  end if;

  if v_usable < v_total then
    raise exception '% candidates and % usable seats across % room(s)%. Open another room, or lower the seats held back per room.',
      v_total, v_usable, v_rooms,
      case when v_reserve > 0 then format(' (%s held back in each)', v_reserve) else '' end;
  end if;

  -- How deep each room is filled. `pack` fills a room before opening the next;
  -- `spread` fills every room offered to the same depth.
  v_depth := ceil(v_total::numeric / v_rooms)::int;

  if v_fill <> 'pack' then
    select coalesce(sum(least(greatest(cr.capacity - v_reserve, 0), v_depth)), 0)
      into v_quota
    from public.class_rooms cr
    where cr.tenant_id = v_tenant
      and cr.is_active
      and (p_room_ids is null or cr.id = any (p_room_ids));

    -- Only reachable when the rooms are of very different sizes: spreading to
    -- an equal depth wastes the big ones. Say which setting fixes it rather
    -- than silently packing, because which of the two a college wants is a
    -- decision and not an optimisation.
    if v_quota < v_total then
      raise exception 'Spreading % candidates evenly over % room(s) needs % seats in each and the rooms are too uneven for that — only % seats are reachable. Set Seating arrangement to fill rooms by "pack", or offer rooms of a similar size.',
        v_total, v_rooms, v_depth, v_quota;
    end if;
  end if;

  begin
    insert into public.exam_seat_plans
      (tenant_id, session_id, exam_id, sits_on, time_slot_id, rules, created_by)
    values
      (v_tenant, v_exam.session_id, p_exam_id, p_sits_on, p_time_slot_id, v_rules, auth.uid())
    returning id into v_plan_id;
  exception when unique_violation then
    raise exception 'There is already a seating plan for that sitting. Discard it first, or edit the one that exists — two plans for one morning disagree, and whichever is published second silently wins.';
  end;

  with cand as (
    select c.*,
           case v_order
             when 'admission' then c.admission_number
             when 'name' then lower(c.student_name)
             else c.roll_sort
           end as sort_key
    from public.exam_seat_candidates(p_exam_id, p_sits_on, p_time_slot_id) c
  ),
  sized as (
    select cand.*,
           count(*) over (partition by exam_subject_id) as paper_size,
           row_number() over (partition by exam_subject_id
                              order by sort_key, student_id) as rank_in_paper
    from cand
  ),
  seq as (
    -- The interleave. See the header: each paper's candidates are spread over
    -- [0, 1) and the sitting is read off in that order, so a large paper and a
    -- small one alternate in proportion instead of in lockstep.
    select sized.*,
           row_number() over (
             order by (rank_in_paper::numeric - 0.5) / paper_size,
                      paper_size desc, exam_subject_id, student_id
           ) as pos
    from sized
  ),
  room_list as (
    select cr.id, cr.name, cr.capacity,
           greatest(cr.capacity - v_reserve, 0) as usable,
           row_number() over (order by cr.name) as room_pos
    from public.class_rooms cr
    where cr.tenant_id = v_tenant
      and cr.is_active
      and (p_room_ids is null or cr.id = any (p_room_ids))
  ),
  quota as (
    select room_list.*,
           case when v_fill = 'pack' then usable else least(usable, v_depth) end as seats_here
    from room_list
  ),
  bounds as (
    select quota.*,
           coalesce(
             sum(seats_here) over (order by room_pos
                                   rows between unbounded preceding and 1 preceding),
             0) as seats_before
    from quota
  )
  insert into public.exam_seat_allocations
    (tenant_id, plan_id, run_status, student_id, exam_subject_id,
     room_id, planned_capacity, room_name, seat_no)
  select v_tenant, v_plan_id, 'draft', s.student_id, s.exam_subject_id,
         b.id, b.capacity, b.name, (s.pos - b.seats_before)::int
  from seq s
  join bounds b
    on s.pos > b.seats_before
   and s.pos <= b.seats_before + b.seats_here;

  get diagnostics v_placed = row_count;

  -- Belt and braces, and it raises rather than returning a smaller number: a
  -- plan that seats 298 of 302 and says so is a plan somebody publishes at
  -- half past eight in the morning.
  if v_placed <> v_total then
    raise exception 'Only % of % candidates could be given a seat. Nothing has been saved.',
      v_placed, v_total;
  end if;

  return jsonb_build_object(
    'plan_id', v_plan_id,
    'sits_on', p_sits_on,
    'candidates', v_total,
    'seated', v_placed,
    'papers', v_papers,
    'rooms_used', (select count(distinct room_id) from public.exam_seat_allocations
                    where plan_id = v_plan_id),
    'biggest_paper', (select max(n) from (
        select count(*) as n from public.exam_seat_allocations
         where plan_id = v_plan_id group by exam_subject_id) x),
    -- Reported rather than hidden: see the header. The office checks these
    -- against their own elective register.
    'optional_papers', v_optional_papers,
    'optional_seats', v_optional_seats,
    'rules', v_rules
  );
end;
$$;

comment on function public.exam_seat_plan_generate(uuid, date, uuid, uuid[]) is
  'Rule 13''s dry run for a seating arrangement: it materialises every seat as '
  'an editable row rather than producing a report. SECURITY INVOKER, so the '
  'allocations are written through the caller''s own policies.';

-- ---------------------------------------------------------------------------
-- Publishing: one UPDATE on the parent
-- ---------------------------------------------------------------------------

create or replace function public.exam_seat_plan_publish(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_n int;
  v_seats int;
begin
  -- Rule 13 says the apply step writes what the rows say rather than
  -- recomputing. Here there is nothing to write into: **the rows are the
  -- deliverable**, so the whole apply is a freeze. That is what makes this one
  -- statement rather than a row-by-row loop with an error column.
  update public.exam_seat_plans
     set status = 'published', published_at = now(), published_by = auth.uid()
   where id = p_plan_id and status = 'draft';
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'That plan is not a draft, or it is not yours to publish.';
  end if;

  select count(*) into v_seats
  from public.exam_seat_allocations where plan_id = p_plan_id;

  -- The count is read back after the cascade, so it is the number of rows that
  -- actually became visible to candidates rather than the number this function
  -- believes it froze.
  return jsonb_build_object('plan_id', p_plan_id, 'published', v_seats);
end;
$$;

create or replace function public.exam_seat_plan_unpublish(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare v_n int;
begin
  update public.exam_seat_plans
     set status = 'draft', published_at = null, published_by = null
   where id = p_plan_id and status = 'published';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'That plan is not published, or it is not yours to change.';
  end if;
  return jsonb_build_object('plan_id', p_plan_id, 'reopened', true);
end;
$$;

comment on function public.exam_seat_plan_unpublish(uuid) is
  'Reopens a published plan for editing. The cascade takes every allocation '
  'back to draft, which withdraws it from the candidates who could see it — so '
  '"the hall changed on Thursday" is an audited unpublish/republish pair and '
  'never a quiet edit to a document somebody has already read.';

create or replace function public.exam_seat_plan_discard(p_plan_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare v_n int;
begin
  -- Only a draft. Discarding a published plan directly would have to null
  -- `published_at` to satisfy exam_seat_plans_published_chk, which erases the
  -- fact that candidates were once told where to sit. Unpublish first: two
  -- deliberate acts, two audit rows.
  update public.exam_seat_plans set status = 'discarded'
   where id = p_plan_id and status = 'draft';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Only a draft plan can be discarded. Reopen it first if it has been published.';
  end if;
  return jsonb_build_object('plan_id', p_plan_id, 'discarded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- The override: rule 13's named children
-- ---------------------------------------------------------------------------

create or replace function public.exam_seat_move(
  p_allocation_id uuid,
  p_room_id uuid,
  p_seat_no integer,
  p_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant uuid := ( select public.current_tenant_id() );
  v_alloc public.exam_seat_allocations;
  v_target public.exam_seat_allocations;
  v_room public.class_rooms;
  v_swapped boolean := false;
begin
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why this candidate is being moved. A seating plan that differs from the rules without a reason is one nobody can check next year.';
  end if;

  select * into v_alloc from public.exam_seat_allocations where id = p_allocation_id;
  if v_alloc.id is null then
    raise exception 'That seat does not exist, or the plan has been published — reopen it to move anybody.';
  end if;

  select * into v_room from public.class_rooms
   where id = p_room_id and tenant_id = v_tenant;
  if v_room.id is null then
    raise exception 'That room does not exist.';
  end if;
  if not v_room.is_active then
    raise exception '% is closed, so nobody can be seated in it.', v_room.name;
  end if;
  if p_seat_no < 1 or p_seat_no > v_room.capacity then
    raise exception '% has % seats, so seat % is not in it.', v_room.name, v_room.capacity, p_seat_no;
  end if;

  select * into v_target from public.exam_seat_allocations
   where tenant_id = v_tenant and plan_id = v_alloc.plan_id
     and room_id = p_room_id and seat_no = p_seat_no;

  if v_target.id = v_alloc.id then
    return jsonb_build_object('moved', false, 'swapped', false,
                              'reason', 'That candidate is already in that seat.');
  end if;

  if v_target.id is not null then
    -- A swap, not a refusal: it is what the officer is actually doing, and the
    -- alternative — move A out, then B in — is a sequence the unique index
    -- refuses halfway through. Deferring it for this statement is why the
    -- constraint was made deferrable above.
    set constraints public.exam_seat_allocations_one_per_seat deferred;
    update public.exam_seat_allocations
       set room_id = v_alloc.room_id, seat_no = v_alloc.seat_no,
           planned_capacity = v_alloc.planned_capacity, room_name = v_alloc.room_name,
           is_override = true, note = p_note
     where id = v_target.id;
    v_swapped := true;
  end if;

  update public.exam_seat_allocations
     set room_id = p_room_id, seat_no = p_seat_no,
         planned_capacity = v_room.capacity, room_name = v_room.name,
         is_override = true, note = p_note
   where id = v_alloc.id;

  return jsonb_build_object('moved', true, 'swapped', v_swapped,
                            'room', v_room.name, 'seat_no', p_seat_no);
end;
$$;

comment on function public.exam_seat_move(uuid, uuid, integer, text) is
  'Moves one candidate, swapping with whoever is in the target seat. Both rows '
  'are marked is_override with the reason — rule 13''s difference between "the '
  'rules decided" and "the examination officer decided", and both are in the '
  'audit log. Refused once the plan is published, by the write policy rather '
  'than by a check here.';

-- ---------------------------------------------------------------------------
-- The invigilator's sheet
-- ---------------------------------------------------------------------------

create or replace function public.exam_seat_chart(p_plan_id uuid)
returns table (
  room_id uuid,
  room_name text,
  planned_capacity integer,
  seat_no integer,
  student_id uuid,
  student_name text,
  roll_number text,
  admission_number text,
  paper text,
  section_label text,
  is_override boolean,
  note text
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select a.room_id, a.room_name, a.planned_capacity, a.seat_no,
         a.student_id,
         trim(pe.first_name || ' ' || coalesce(pe.last_name, '')),
         en.roll_number, st.admission_number,
         sub.name, cl.name || ' · ' || sec.name,
         a.is_override, a.note
  from public.exam_seat_allocations a
  join public.students st on st.id = a.student_id
  join public.people pe on pe.id = st.person_id
  join public.exam_subjects es on es.id = a.exam_subject_id
  join public.subjects sub on sub.id = es.subject_id
  join public.sections sec on sec.id = es.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  left join public.enrolments en
    on en.student_id = a.student_id and en.section_id = es.section_id
   and en.status = 'active'
  where a.plan_id = p_plan_id
  -- Rule 7's export note: every read model's ORDER BY is part of the contract,
  -- and this one is also the physical order of the room.
  order by a.room_name, a.seat_no
$$;

comment on function public.exam_seat_chart(uuid) is
  'One sitting, in room and seat order: the list an invigilator carries. '
  'SECURITY INVOKER, so a candidate calling it sees their own published seat '
  'and nothing else.';

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------

create or replace function public.exam_seating_problems(p_plan_id uuid)
returns table (severity text, message text)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_tenant uuid := ( select public.current_tenant_id() );
  v_plan public.exam_seat_plans;
  v_rules jsonb;
  v_adjacent int;
  v_example text;
  v_unseated int;
  v_stale int;
  v_changed int;
  v_closed int;
  v_optional int;
  v_optional_seats int;
begin
  -- Refuse, do not return empty. A critic that answered nothing to a caller
  -- without the permission is indistinguishable from a plan with no problems,
  -- which is the failure being removed.
  if not ( select public.role_has_permission('exams.manage') ) then
    raise exception 'Your role may not review a seating plan. That needs the "exams.manage" permission.'
      using errcode = '42501';
  end if;

  select * into v_plan from public.exam_seat_plans where id = p_plan_id;
  if v_plan.id is null then
    return;
  end if;
  v_rules := public.exam_seating_rules(v_plan.rules);

  -- 1. Two candidates writing one paper in consecutive seats.
  --
  -- Measured from the rows that exist, never from what the generator intended
  -- — the officer has been moving people around since, and a number that
  -- describes the algorithm rather than the arrangement is the defect this
  -- file records most often.
  if (v_rules ->> 'separate_same_paper') = 'true' then
    with pairs as (
      select a.room_name, a.seat_no, a.exam_subject_id,
             lead(a.exam_subject_id) over (partition by a.room_id order by a.seat_no) as next_paper,
             lead(a.seat_no) over (partition by a.room_id order by a.seat_no) as next_seat
      from public.exam_seat_allocations a
      where a.plan_id = p_plan_id
    )
    select count(*),
           min(room_name || ', seats ' || seat_no || ' and ' || next_seat)
      into v_adjacent, v_example
    from pairs
    -- Consecutive, not merely next in the room: a held-back seat between two
    -- candidates is a gap, and they are not sitting together.
    where next_paper = exam_subject_id and next_seat = seat_no + 1;

    if v_adjacent = 1 then
      return query select 'warning'::text, format(
        'One pair of candidates writing the same paper is sitting together (%s). '
        'If one paper holds more than half the candidates at a sitting, no '
        'arrangement can separate everybody — otherwise, moving one candidate fixes it.',
        v_example);
    elsif v_adjacent > 1 then
      return query select 'warning'::text, format(
        '%s pairs of candidates writing the same paper are sitting together, '
        'the first at %s. If one paper holds more than half the candidates at a '
        'sitting, no arrangement can separate them all.',
        v_adjacent, v_example);
    end if;
  end if;

  -- 2. Somebody due to sit who has no seat. The candidate list is the narrow
  --    side here (it reads `enrolments`, which is row-scoped), so this
  --    under-reports for a teacher rather than accusing them of anything.
  select count(*) into v_unseated
  from public.exam_seat_candidates(v_plan.exam_id, v_plan.sits_on, v_plan.time_slot_id) c
  where not exists (
    select 1 from public.exam_seat_allocations a
     where a.plan_id = p_plan_id and a.student_id = c.student_id
  );
  if v_unseated = 1 then
    return query select 'error'::text,
      'One candidate is due to sit this paper and has no seat. Generate the '
      'plan again, or seat them by hand.';
  elsif v_unseated > 1 then
    return query select 'error'::text, format(
      '%s candidates are due to sit and have no seat. They were probably '
      'admitted after this plan was made — generate it again.', v_unseated);
  end if;

  -- 3. Seated, but no longer due to sit — a child who has left, or whose paper
  --    has moved to another day.
  --
  --    `not exists` is only honest when both sides are narrowed by the same
  --    policy. `exam_seat_allocations` is readable tenant-wide by anybody with
  --    `exams.view`, while the candidate list is row-scoped through
  --    `enrolments` — so without the second predicate a class teacher would be
  --    shown every other class's 277 candidates as "no longer due to sit".
  --    `attendance_coverage`'s answer: narrow the wide side to the rows the
  --    caller could have seen the evidence for.
  select count(*) into v_stale
  from public.exam_seat_allocations a
  where a.plan_id = p_plan_id
    and exists (
      select 1 from public.enrolments e
       where e.tenant_id = v_tenant and e.student_id = a.student_id
    )
    and not exists (
      select 1 from public.exam_seat_candidates(v_plan.exam_id, v_plan.sits_on, v_plan.time_slot_id) c
       where c.student_id = a.student_id
    );
  if v_stale > 0 then
    return query select 'warning'::text, format(
      '%s seated candidate(s) are no longer down to sit at this sitting — they '
      'have left, or their paper has moved. The seat is still reserved for them.',
      v_stale);
  end if;

  -- 4. The room is not the room the plan was made against. This is only
  --    detectable *because* planned_capacity is frozen and free to disagree
  --    with the live room — the same property that lets a substitution record
  --    a morning the timetable has since changed.
  select count(*) filter (where cr.capacity <> a.planned_capacity),
         count(*) filter (where not cr.is_active)
    into v_changed, v_closed
  from (select distinct room_id, planned_capacity from public.exam_seat_allocations
         where plan_id = p_plan_id) a
  join public.class_rooms cr on cr.id = a.room_id;

  if v_closed > 0 then
    return query select 'error'::text, format(
      '%s room(s) in this plan have since been closed. Move those candidates '
      'before the morning of the exam.', v_closed);
  end if;
  if v_changed > 0 then
    return query select 'warning'::text, format(
      '%s room(s) have a different number of seats now than when this plan was '
      'made. The plan still says what it said; check that the seats it uses exist.',
      v_changed);
  end if;

  -- 5. The optional papers, and what this product cannot know about them.
  select count(distinct c.exam_subject_id), count(*)
    into v_optional, v_optional_seats
  from public.exam_seat_candidates(v_plan.exam_id, v_plan.sits_on, v_plan.time_slot_id) c
  where c.is_optional;

  if v_optional > 0 then
    return query select 'info'::text, format(
      '%s paper(s) at this sitting are optional, and nothing in this product '
      'records which candidates elected them — so all %s children in those '
      'sections have been given a seat. Check the list against your own '
      'elective register.', v_optional, v_optional_seats);
  end if;

  return;
end;
$$;

comment on function public.exam_seating_problems(uuid) is
  'What is wrong with one seating plan, in sentences. Deliberately NOT a '
  'reference.checks row: it takes a plan id, and a college-wide check that '
  'fired about an exam which finished in July would be the critic that teaches '
  'people to ignore it. It is read beside the plan, like audit_history is read '
  'beside a record.';
