-- ---------------------------------------------------------------------------
-- Phase 5.2 — two things the first billing run showed
--
-- Both found by reading real output rather than by reasoning about it, and
-- neither would have failed a test that only called the function one student at
-- a time.
-- ---------------------------------------------------------------------------

-- ### 1. A `limit 1` inside a CTE is not a guarantee once the function inlines
--
-- `fees_billable_lines` resolved the student's class level in a CTE and joined
-- it:
--
--     with class_level as (select cl.id from ... limit 1)
--     select ... from fee_structures fs join class_level c on c.id = fs.class_level_id
--
-- Called on its own that is correct, and it was: five structure lines and one
-- transport line, exactly right. Called as
-- `students cross join lateral fees_billable_lines(id, ...)` — which is how a
-- screen listing a class would call it — every line came back three times, with
-- three different class levels' tuition. Postgres inlines a `language sql`
-- function into the calling query, and the correlated CTE did not survive that
-- rewrite the way the standalone call implies.
--
-- The fix is not a better CTE. It is to make the fan-out **impossible by
-- construction**: a scalar subquery returns exactly one value or null, so there
-- is no join for the planner to widen.
--
-- The general rule, worth remembering: when a value must be singular, express
-- it as a scalar subquery, not as a one-row relation you promise not to join
-- twice.
create or replace function public.fees_billable_lines(
  p_student_id uuid,
  p_as_of date default null,
  p_fee_head_ids uuid[] default null
)
returns table (
  fee_head_id uuid,
  description text,
  amount numeric,
  source text
)
language sql
stable
set search_path = public, extensions
as $$
  select fs.fee_head_id, fh.name::text, fs.amount, 'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    and fs.class_level_id = (
      select s.class_level_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      where e.student_id = p_student_id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
      limit 1
    )
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))

  union all

  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, p_as_of) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
$$;

revoke all on function public.fees_billable_lines(uuid, date, uuid[]) from public, anon;
grant execute on function public.fees_billable_lines(uuid, date, uuid[]) to authenticated;

-- ### 2. The same head, fed by two sources, bills the family twice
--
-- The demo tenant has carried a class-level "Transport fee" in `fee_structures`
-- since migration 0025 — a flat ₹4,800 for everybody in the class. Pointing a
-- route's fare at that same head means a child on a bus is billed both: the
-- class's flat charge *and* their stop's fare.
--
-- This is not a demo-data quirk. It is what happens to **any** school that
-- moves a fee from "everyone in Class 6 pays this" to "you pay for where you
-- board", which is the entire point of this module, and the failure is silent:
-- the invoice looks plausible and is wrong by one line.
--
-- What this codebase does with that kind of problem is criticise it in
-- Postgres and return sentences — `grading_scheme_problems()` is the pattern —
-- rather than quietly deleting a school's fee structure. Deciding which of the
-- two charges is the real one is the bursar's call, not a migration's.
create or replace function public.transport_billing_conflicts()
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  select (
    'Class ' || cl.name || ' has a "' || fh.name || '" fee of ' ||
    to_char(fs.amount, 'FM999999990.00') ||
    ' in its fee structure, and route ' || tr.code ||
    ' charges its own fare against the same head. Any child in that class on a bus is billed both. Remove the class-level charge, or point the route at a different head.'
  )::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  join public.class_levels cl on cl.id = fs.class_level_id
  join public.transport_routes tr
    on tr.fee_head_id = fs.fee_head_id
   and tr.session_id = fs.session_id
  where fs.amount > 0
    and tr.is_active
  group by cl.name, fh.name, fs.amount, tr.code
  order by cl.name, tr.code
$$;

revoke all on function public.transport_billing_conflicts() from public, anon;
grant execute on function public.transport_billing_conflicts() to authenticated;

comment on function public.transport_billing_conflicts() is
  'Sentences, not error codes: where a fee head is charged both by a class-level fee structure and by a transport route, every child in that class who rides a bus is billed twice. Deliberately not a constraint -- a school mid-migration may legitimately have both for a while.';
