-- ---------------------------------------------------------------------------
-- Phase 5.2 — one sentence per problem, and a demo that bills correctly
-- ---------------------------------------------------------------------------

-- ### One sentence per problem
--
-- `transport_billing_conflicts()` shipped in 0089 emitting one row per
-- (class, route) pair. Six classes and two routes produced twelve sentences
-- saying the same thing, which defeats the point: the reason this returns
-- sentences instead of an error code is that somebody reads them, and nobody
-- reads the same warning twelve times.
--
-- The problem belongs to the (class, fee head) pair. How many routes happen to
-- charge against that head is detail, so it becomes a count inside one
-- sentence rather than a row each.
--
-- (0089 is applied, and applied migrations are immutable -- hence a second
-- migration for what would otherwise have been an edit.)
create or replace function public.transport_billing_conflicts()
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  select (
    'Class ' || cl.name || ' has a "' || fh.name || '" fee of ' ||
    to_char(fs.amount, 'FM999999990.00') ||
    ' in its fee structure, and ' ||
    count(distinct tr.id) ||
    case when count(distinct tr.id) = 1 then ' route charges its own fare'
         else ' routes charge their own fares' end ||
    ' against the same head (' || string_agg(distinct tr.code, ', ') ||
    '). Any child in that class on a bus is billed both. Remove the class-level charge, or point the routes at a different head.'
  )::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  join public.class_levels cl on cl.id = fs.class_level_id
  join public.transport_routes tr
    on tr.fee_head_id = fs.fee_head_id
   and tr.session_id = fs.session_id
  where fs.amount > 0
    and tr.is_active
  group by cl.name, fh.name, fs.amount
  order by cl.name
$$;

revoke all on function public.transport_billing_conflicts() from public, anon;
grant execute on function public.transport_billing_conflicts() to authenticated;

-- ### The demo's own double billing
--
-- The demo tenant has charged a flat class-level "Transport fee" of 4,800 since
-- migration 0025, from before stop-based fares existed. Pointing R1 and R2 at
-- that same head meant every demo child on a bus was billed twice, and the
-- detector above said so twelve times over.
--
-- Fixed here for the demo tenant only, and only for the exact overlap the
-- detector names -- a fee structure whose head an active route also charges
-- against. **This is deliberately not done for every tenant.** Which of the two
-- charges is the real one is a bursar's decision; a migration that guesses it
-- silently changes what families owe. Demo data, by contrast, should be
-- correct, because it is what somebody evaluating this reads first.
delete from public.fee_structures fs
using public.tenants t, public.transport_routes tr
where t.slug = 'rajesh-kumar-mahavidyalaya'
  and fs.tenant_id = t.id
  and tr.tenant_id = t.id
  and tr.session_id = fs.session_id
  and tr.fee_head_id = fs.fee_head_id;
