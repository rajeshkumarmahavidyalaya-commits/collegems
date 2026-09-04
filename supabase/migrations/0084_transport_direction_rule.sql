-- ---------------------------------------------------------------------------
-- Phase 5.2 — a child cannot be dropped home by a bus that only does pickups
--
-- A route runs `pickup`, `drop`, or `both`. So does an arrangement. The rule
-- between them is **compatibility, not equality**: a `both` route will take a
-- child who only needs the morning, but a `pickup` route cannot drop anybody.
--
-- The reflex is a trigger, because the rule spans two tables. It does not have
-- to: carry the route's direction onto the assignment inside a composite
-- foreign key, exactly as `marks` carries its paper's `max_marks`, and then the
-- rule is a plain CHECK over two columns of one row.
--
--   route  | assignment allowed
--   -------|-------------------
--   both   | pickup, drop, both
--   pickup | pickup
--   drop   | drop
--
-- This is the fifth use of the device in the codebase, and the first where the
-- carried column feeds a **comparison** rather than an equality: a flag
-- (`time_slots.schedulable`), a value (`marks.max_marks`), a status
-- (`payslips.run_status`), an identity (`transport_assignments.route_id`), and
-- now a term in a rule.
--
-- Separate from 0083 because 0083 is applied and migrations are immutable. In a
-- fresh build it would have been one table definition.
-- ---------------------------------------------------------------------------

alter table public.transport_routes
  add constraint transport_routes_direction_key unique (tenant_id, id, direction);

alter table public.transport_assignments
  add column route_direction text not null default 'both';

alter table public.transport_assignments
  add constraint transport_assignments_route_direction_fkey
  foreign key (tenant_id, route_id, route_direction)
  references public.transport_routes (tenant_id, id, direction)
  on update cascade on delete restrict;

-- The rule itself. Changing a route from `both` to `pickup` now cascades into
-- every assignment on it and this CHECK re-evaluates — so the route change is
-- refused while a child on it still needs dropping, which is the correct answer
-- rather than a side effect.
alter table public.transport_assignments
  add constraint transport_assignments_direction_chk check (
    route_direction = 'both' or direction = route_direction
  );

comment on column public.transport_assignments.route_direction is
  'A copy of the route''s direction, held in step by ON UPDATE CASCADE. It exists so "a pickup-only route cannot drop a child" is a CHECK over one row instead of a trigger reaching into another table.';
