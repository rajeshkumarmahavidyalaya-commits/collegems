-- 0364: apply 0349 (promotion_undo counts tickets) to the live database.
--
-- 0349 was written to be pasted into the SQL editor by hand, because the
-- database connector holds any statement whose text contains a DELETE, and
-- promotion_undo's body does. It was never pasted: on 27 Oct 2026 the live
-- function still had no tickets row, so undoing a promotion would leave a
-- ticket raised in the new year about a class the child is no longer in.
--
-- This makes the same one-line change from the live body, checked as 0358
-- does: the anchor line must occur exactly once or nothing changes. It does
-- nothing when tickets are already counted, so a database that ran 0349 is
-- left as it is. create or replace keeps the function's grants.

begin;

do $$
declare
  v_def text;
  v_found integer;
  v_anchor text := '(''staff_ratings'', ''created_at'', '''', ''staff rating'', ''staff ratings'')';
begin
  select pg_get_functiondef('public.promotion_undo(uuid)'::regprocedure) into v_def;
  if position('''tickets''' in v_def) > 0 then
    return;
  end if;
  v_found := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_found <> 1 then
    raise exception '0364: promotion_undo has % copies of the staff_ratings row, expected 1; its body changed since 0345', v_found;
  end if;
  execute replace(v_def, v_anchor,
    v_anchor || E',\n      (''tickets'', ''created_at'', '''', ''ticket'', ''tickets'')');
end;
$$;

commit;
