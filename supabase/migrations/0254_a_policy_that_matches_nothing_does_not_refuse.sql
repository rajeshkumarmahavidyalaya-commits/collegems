-- 0254 — "Refused by the write policy" was a comment, not a mechanism
--
-- `0251`'s `exam_seat_move` carried this sentence on its own function comment:
--
--     'Refused once the plan is published, by the write policy rather than by
--      a check here.'
--
-- Probed, on a published plan:
--
--     exam_seat_move(...) -> {"moved": true, "swapped": true, "seat_no": 7}
--     rows actually changed: 0
--
-- The policy did exactly what it should. **It is the function that lied.** This
-- file has the rule written down already, in rule 6, and it was written about a
-- test rather than about a caller:
--
-- > An `UPDATE` that no policy matches **succeeds** under RLS while touching
-- > nothing, so a test that only asserts an error passes whatever the policy
-- > says. Assert the count.
--
-- A caller is not different from a test here. `exam_seat_move` ran two updates,
-- neither matched a row, neither raised, and the function returned a document
-- saying where the candidate now sits. The examination officer closes the
-- dialog, the toast says *moved*, and on the morning of the exam the child is
-- in the seat nobody moved them out of.
--
-- Two things generalise, and the second is the one that made this worth its own
-- migration rather than a quiet line:
--
--   * **A comment that names the mechanism is the thing to check first.** The
--     sentence *"refused by the write policy"* is exactly the shape this file
--     warns about — *if a comment names a function, open it* — and the same is
--     true when it names a policy. It described what the author expected the
--     policy to do, and the expectation was of the wrong kind of thing: a
--     permissive policy grants, it never refuses.
--   * **Every write function in this module now asserts its own row count.**
--     `exam_seat_plan_publish`, `_unpublish` and `_discard` already did, which
--     is why they were correct and this was not — they were written as "update
--     and check", and this one was written as "update".
--
-- The state check is also made explicit and up front, so the common case gets a
-- sentence naming the state rather than a sentence naming a permission. The
-- row-count assertion stays underneath it, because the other way to match no
-- row is to have lost `exams.manage` between reading the seat and moving it,
-- and a caller who is told "publish it again" when the real answer is "your
-- role changed" has been sent to fix the wrong thing.

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
  v_n int;
begin
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why this candidate is being moved. A seating plan that differs from the rules without a reason is one nobody can check next year.';
  end if;

  select * into v_alloc from public.exam_seat_allocations where id = p_allocation_id;
  if v_alloc.id is null then
    raise exception 'That seat does not exist.';
  end if;

  -- The state, named before the permission. A published plan is the ordinary
  -- reason a move cannot happen, and the officer's next action is to reopen it.
  if v_alloc.run_status <> 'draft' then
    raise exception 'This plan has been published, so nobody can be moved. Reopen it first — which withdraws it from the candidates who have already been told where to sit, and is why it is a deliberate act rather than a side effect of this one.';
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
    -- constraint was made deferrable in 0251.
    set constraints public.exam_seat_allocations_one_per_seat deferred;
    update public.exam_seat_allocations
       set room_id = v_alloc.room_id, seat_no = v_alloc.seat_no,
           planned_capacity = v_alloc.planned_capacity, room_name = v_alloc.room_name,
           is_override = true, note = p_note
     where id = v_target.id;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Your role may no longer move candidates in this plan, so nothing was changed. That needs the "exams.manage" permission.'
        using errcode = '42501';
    end if;
    v_swapped := true;
  end if;

  update public.exam_seat_allocations
     set room_id = p_room_id, seat_no = p_seat_no,
         planned_capacity = v_room.capacity, room_name = v_room.name,
         is_override = true, note = p_note
   where id = v_alloc.id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Your role may no longer move candidates in this plan, so nothing was changed. That needs the "exams.manage" permission.'
      using errcode = '42501';
  end if;

  return jsonb_build_object('moved', true, 'swapped', v_swapped,
                            'room', v_room.name, 'seat_no', p_seat_no);
end;
$$;

comment on function public.exam_seat_move(uuid, uuid, integer, text) is
  'Moves one candidate, swapping with whoever is in the target seat. Both rows '
  'are marked is_override with the reason — rule 13''s difference between "the '
  'rules decided" and "the examination officer decided", and both are in the '
  'audit log. Every UPDATE here asserts its own row count: a permissive policy '
  'that matches nothing does not raise, so without that this function reported '
  'a move it had not made.';
