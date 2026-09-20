-- 0252 — The measurement said one, and one is every time
--
-- `0251` spread each paper's candidates over [0, 1) and read the sitting off in
-- that order. Measured on the live college it produced **1 same-paper
-- neighbour out of 290 adjacent pairs**, against 290 of 290 for the
-- arrangement it replaces — which looked like a win, and was the wrong thing to
-- ship.
--
-- > The one was not bad luck. This sitting is **one paper of 27 and eleven of
-- > 25**, and the 27-paper's candidates drift against the 25-papers' by 0.003
-- > of the interval each time, so twice a sitting two of them land in the same
-- > gap. It is a property of the shape, not of the data: **every plan this
-- > college generates would open with a warning.**
--
-- And a critic that fires on a correctly finished action is the one this file
-- already warns about — it teaches people to ignore it, which costs more than
-- the check was worth. A warning that is present every single time is not a
-- finding, it is a label.
--
-- ---------------------------------------------------------------------------
-- The construction that is actually optimal, and is simpler
--
-- Lay the candidates out grouped by paper, **largest paper first**, into one
-- list. Then deal the first half into the even seats and the rest into the odd
-- ones:
--
--     list index i  ->  seat  2i          when i < ceil(n/2)
--                       seat  2(i - ceil(n/2)) + 1   otherwise
--
-- That is one `row_number()` and two multiplications — less code than the
-- fractional spread it replaces, and it is the standard rearrangement for
-- "no two identical items adjacent". Two neighbouring seats always come from
-- list positions at least ceil(n/2) apart, so they can only hold one paper if
-- that paper is more than half the sitting — which is exactly the case where
-- no arrangement can separate them.
--
-- Verified rather than asserted, because the first attempt to check it used
-- the wrong floor. A dominant paper of m candidates among n admits at least
-- `max(0, 2m - n - 1)` adjacent pairs — the other n-m candidates open n-m+1
-- gaps to spread m into — and an earlier draft of this comment used
-- `m - ceil(n/2)`, which is about half that, and would have recorded this
-- construction as *"suboptimal"* on three shapes where it is exactly optimal.
-- **The algorithm was fine and the instrument was not**, which is this file's
-- oldest recurring mistake arriving in a sanity check.
--
-- Measured with the corrected floor:
--
--     1 x 27 + 11 x 25  (the live sitting)   0 adjacent, minimum 0   optimal
--     12 x 25                                0 adjacent, minimum 0   optimal
--     200 / 5                              194 adjacent, minimum 194 optimal
--     one paper of 25                       24 adjacent, minimum 24  optimal
--     100 / 50 / 10                         40 adjacent, minimum 39  +1
--
--     3,000 random shapes (1-14 papers, 1-40 candidates each):
--     worst excess over the theoretical minimum = 1.
--
-- So the critic keeps its adjacency check and keeps its sentence about the
-- pigeonhole case — but it is now silent on a plan that has nothing wrong with
-- it, which is the only state in which anybody reads a critic.
--
-- Only the ordering changes. The rooms, the quotas, the refusals, the returned
-- document and every constraint are `0251`'s, unaltered.

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
  v_half int;
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
  v_half  := ceil(v_total::numeric / 2)::int;

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
  listed as (
    -- One list, grouped by paper, largest paper first. See the header.
    select sized.*,
           row_number() over (
             order by paper_size desc, exam_subject_id, rank_in_paper, student_id
           ) - 1 as list_ix
    from sized
  ),
  seq as (
    -- Deal the first half into the even seats and the rest into the odd ones.
    -- `v_half` is ceil(total / 2), so this is a permutation of 1..total: the
    -- even branch produces 0, 2, ... and the odd branch 1, 3, ... with no
    -- overlap and nothing left out.
    select listed.*,
           1 + case when list_ix < v_half then 2 * list_ix
                    else 2 * (list_ix - v_half) + 1 end as pos
    from listed
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
  'allocations are written through the caller''s own policies. The order is '
  '0252''s: grouped by paper largest-first, dealt into the even seats then the '
  'odd ones, which separates every candidate from their own paper unless that '
  'paper is more than half the sitting.';
