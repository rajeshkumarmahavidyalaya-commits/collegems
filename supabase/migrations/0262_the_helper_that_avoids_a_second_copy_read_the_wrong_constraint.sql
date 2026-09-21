-- 0262 -- `allowed_values` returned another constraint's list, and `0261` is
--         how it was found.
--
-- `0222` added `allowed_values(table, column)` so *"a validator and an error
-- message can consult the constraint instead of carrying a second copy of the
-- list"*. `0261` added `sale` to `stock_movements_kind_check`, and the first
-- thing asked of it was the sanity check:
--
--   select array_length(allowed_values('public.stock_movements', 'kind'), 1);
--   -- 2
--
-- Six kinds, answer two. It was matching **any** CHECK whose text contains
-- `kind = ANY (ARRAY[`, taking the first by name, and
--
--   stock_movements_cost_chk
--     CHECK (((unit_cost IS NULL) OR (kind = ANY (ARRAY['receipt', 'adjustment']))))
--
-- sorts before `stock_movements_kind_check`. So the helper written to stop a
-- second copy of a list was quietly reading **a different constraint's list** --
-- `receipt, adjustment`, which is where a *cost* may be recorded and has
-- nothing to do with which kinds exist.
--
-- > This file's oldest recurring defect, in the one place built to prevent it:
-- > **a plausible answer rather than an error.** Two is a number somebody
-- > quotes.
--
-- ## Why nobody had seen it
--
-- Both live callers ask about a column with exactly one matching CHECK --
-- `guardian_student.relationship` and `people.gender`. Measured across the five
-- columns anything asks about, the loose pattern matches **two** constraints
-- for `stock_movements.kind` and **two** for `ledger_entries.entry_type` (the
-- second being `ledger_entries_method_chk`, which `0261` itself widened). The
-- anchored pattern matches exactly **one** for all five.
--
-- So: anchor on `CHECK ((col = ANY (ARRAY[`, which is how Postgres renders a
-- constraint that *is* the column's value list and not one that merely mentions
-- it -- and **return null when the match is not unique**, rather than picking
-- one. `0222` already wrote down the right failure mode: the array comes back
-- empty, the sentence stops naming the values, and **the CHECK still refuses
-- the write**. It degrades to the old behaviour rather than to a wrong answer.
--
-- ## …and the second copy this was always about
--
-- `stock_record_movement` opens with its own list of kinds beside the
-- constraint that already holds one. They agreed, so nothing was refused
-- wrongly, and `0261` could not add `sale` without editing both -- which is
-- migration `0101`'s defect exactly, in the module `0101`'s own convention
-- names. The function consults the constraint now, and the refusal quotes it,
-- so the next kind is one `ALTER`.

begin;

create or replace function public.allowed_values(p_table regclass, p_column text)
returns text[]
language sql
stable
set search_path = 'public', 'extensions'
as $$
  with def as (
    select pg_catalog.pg_get_constraintdef(c.oid) as d
    from pg_catalog.pg_constraint c
    where c.conrelid = p_table
      and c.contype = 'c'
      -- Anchored: a constraint that *is* this column's value list, rather than
      -- any constraint whose text happens to mention it. `stock_movements` has
      -- both, and the other one sorts first.
      and pg_catalog.pg_get_constraintdef(c.oid)
            like 'CHECK ((' || p_column || ' = ANY (ARRAY[%'
  ),
  -- Exactly one, or nothing. Choosing between two would be the bug this is
  -- fixing, one name along. (`having count(*) = 1` without a `group by` makes
  -- the whole query an aggregate and cannot project `d`; a window count can.)
  only_one as (
    select d from (select d, count(*) over () as n from def) q where q.n = 1
  )
  select array_agg(m[1] order by ord)
  from only_one, lateral regexp_matches(only_one.d, '''([^'']*)''::text', 'g')
         with ordinality as t(m, ord);
$$;

comment on function public.allowed_values(regclass, text) is
  'The literals of a `col = ANY (ARRAY[...])` CHECK, so a validator and an '
  'error message can consult the constraint instead of carrying a second copy '
  'of the list. For wording, never for enforcement. Matches the constraint '
  'that IS the column''s value list -- anchored, because one that merely '
  'mentions the column can sort first and hand back its own list (migration '
  '0262) -- and returns null rather than choosing when two match.';

create or replace function public.stock_record_movement(
  p_item_id uuid,
  p_kind text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_issued_to_staff_id uuid default null,
  p_issued_to_note text default null,
  p_supplier text default null,
  p_reference text default null,
  p_note text default null,
  p_happened_on date default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_on date := coalesce(p_happened_on, current_date);
  v_item record;
  v_on_hand numeric;
  v_signed numeric;
  v_kinds text[];
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- `happened_on` is already a column on the row; the year follows it rather
  -- than the flag, so a delivery back-dated to March files under March's year.
  v_session_id := public.academics_session_for_date_or_raise(v_on);

  -- The list of kinds lives in `stock_movements_kind_check` and nowhere else.
  -- A copy here is migration `0101`'s defect: it agreed with the constraint
  -- right up until somebody added a kind to one of them.
  v_kinds := public.allowed_values('public.stock_movements', 'kind');
  if v_kinds is null or not (p_kind = any (v_kinds)) then
    raise exception 'Unknown movement kind: %. It has to be one of %',
      coalesce(p_kind, '(none)'),
      coalesce(array_to_string(v_kinds, ', '), 'the kinds the constraint allows');
  end if;

  -- A sale takes money as well as stock, so it has its own function
  -- (`stock_sell_to_student`) and is refused here. Letting it through would
  -- move the goods and bill nobody -- which is worse than refusing, because the
  -- shelf is short and the ledger says the school is square.
  if p_kind = 'sale' then
    raise exception
      'A sale is recorded with stock_sell_to_student, which also charges the family';
  end if;

  if p_kind <> 'adjustment' and coalesce(p_quantity, 0) <= 0 then
    raise exception 'Enter how many, as a positive number';
  end if;
  if p_kind = 'adjustment' and coalesce(p_quantity, 0) = 0 then
    raise exception 'An adjustment of zero changes nothing';
  end if;

  select i.id, i.name, i.unit, i.is_active into v_item
  from public.inventory_items i where i.id = p_item_id;

  if v_item.id is null then
    raise exception 'That item does not exist';
  end if;
  if not v_item.is_active and p_kind = 'receipt' then
    raise exception '% is no longer stocked', v_item.name;
  end if;

  v_signed := case p_kind
    when 'issue' then -abs(p_quantity)
    when 'write_off' then -abs(p_quantity)
    when 'adjustment' then p_quantity
    else abs(p_quantity)
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text, 0));

  if v_signed < 0 and p_kind <> 'adjustment' then
    select coalesce(sum(m.quantity), 0) into v_on_hand
    from public.stock_movements m where m.item_id = p_item_id;

    if v_on_hand + v_signed < 0 then
      raise exception 'There are % % of % on hand and you are taking out %',
        public.format_quantity(v_on_hand), v_item.unit, v_item.name,
        public.format_quantity(abs(v_signed));
    end if;
  end if;

  insert into public.stock_movements (
    tenant_id, session_id, item_id, kind, quantity, unit_cost,
    issued_to_staff_id, issued_to_note, supplier, reference, note,
    happened_on, recorded_by
  )
  values (
    v_tenant_id, v_session_id, p_item_id, p_kind, v_signed,
    case when p_kind in ('receipt', 'adjustment') then p_unit_cost end,
    p_issued_to_staff_id,
    nullif(btrim(coalesce(p_issued_to_note, '')), ''),
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_on,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

commit;
