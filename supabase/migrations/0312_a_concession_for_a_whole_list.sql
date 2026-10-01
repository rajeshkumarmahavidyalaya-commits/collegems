-- 0312: award one concession to many children at once.
--
-- `docs/modules/concessions.md` named it: "Granting the sibling discount to
-- forty families is currently forty clicks." Rule 13 says the shape -- the
-- person choosing is standing at the screen, so the preview is the list they
-- tick -- and rule 6 says the write: **through the module's own function**, so
-- every award made in bulk is checked exactly as one made by hand (the year,
-- the reason, the child enrolled this year, not already holding it).
--
-- `concession_award_many` therefore validates nothing of its own beyond the
-- bound. It calls `concession_award` once per child inside its own
-- sub-transaction, so one refusal does not undo the rest (rule 13: "apply
-- partially and record why"), and returns each refusal as the sentence the
-- single award would have shown. INVOKER, like `concession_award`, so RLS on
-- `student_concessions` is still the gate.

begin;

create or replace function public.concession_award_many(
  p_concession_id uuid,
  p_student_ids uuid[],
  p_reason text,
  p_ends_on date default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_student uuid;
  v_awarded integer := 0;
  v_refused jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_student_ids), 0) = 0 then
    raise exception 'Tick at least one child.';
  end if;
  -- A bound said out loud (rule 7): a class is tens of children, a whole
  -- college a few hundred. Past this, award class by class.
  if cardinality(p_student_ids) > 500 then
    raise exception 'That is % children at once; award at most 500 at a time, a class or two each.',
      cardinality(p_student_ids);
  end if;

  foreach v_student in array (select array_agg(distinct x) from unnest(p_student_ids) x)
  loop
    begin
      perform public.concession_award(v_student, p_concession_id, p_reason, p_ends_on);
      v_awarded := v_awarded + 1;
    exception when others then
      v_refused := v_refused || jsonb_build_object('student_id', v_student, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('awarded', v_awarded, 'refused', v_refused);
end;
$$;

revoke all on function public.concession_award_many(uuid, uuid[], text, date) from public, anon;
grant execute on function public.concession_award_many(uuid, uuid[], text, date) to authenticated;

comment on function public.concession_award_many(uuid, uuid[], text, date) is
  'Awards one concession to up to 500 children, each through concession_award in '
  'its own sub-transaction, and returns how many were awarded and each refusal '
  'in its own words (0312).';

commit;
