-- 0178 — An open-ended arrangement is not an eternal one.
--
-- `transport_assignments`, `hostel_allocations` and `student_concessions` all
-- carry `session_id`, and all three let `ends_on` be null with a comment saying
-- what null means:
--
--     -- Open-ended by default: most arrangements run to the end of the year
--     -- and nobody types a date for that.
--
-- That sentence was never implemented. To every reader, null meant *for ever*.
-- Five symptoms of the one root cause, the first four measured on the demo
-- tenant rather than argued from the schema, the fifth found by this migration
-- refusing to be created:
--
--   1. `transport_fee_lines` and `hostel_fee_lines` match on a student and a
--      date window and never look at the session. All 46 bus seats and 14 beds
--      in the demo school are open-ended, and both functions still bill them
--      on 15 June 2027 — a stop on a route belonging to a year that ended
--      fifteen months earlier.
--   2. `hostel_occupancy` counts the same way, so 14 beds are occupied for ever
--      by children who have left. Next April the warden cannot allocate
--      anybody: every room is full of last year.
--   3. The roster is session-scoped and the bill is not, so from 1 April the
--      transport screen for the new year is empty while 40 families are still
--      being charged. Neither screen is wrong on its own.
--   4. `transport_assignments_no_overlap` builds `daterange(starts_on,
--      ends_on, '[]')`, and an open-ended range overlaps every future one — so
--      giving the same child a seat for 2026-27 is refused outright. Probed:
--      `23P01 conflicting key value violates exclusion constraint`, which the
--      module renders as *"That child already has a transport arrangement
--      covering those dates. End the current one first."* — said in April
--      about a seat that ended in March.
--   5. Found by this migration, on the way in, in the school's own data: a bed
--      in Tagore House A-201 **starting 4 September 2026**, on a session that
--      ended 31 March 2026. `hostel_allocate` checks that the *room* belongs
--      to the current session and then defaults `starts_on` to `current_date`
--      without ever comparing the two. Nothing in the product could have
--      reported it; the constraint refused to be created until it was placed.
--
-- The fix is not to teach the readers about the session. There are six of them
-- and the seventh is the one somebody writes next year (CLAUDE.md rule 12, the
-- `student_exit` argument). It is to make the row itself say when it ends.
--
-- This is the composite-key device (CLAUDE.md rule 4), carrying a **boundary**:
-- the session's own `end_date` is held on the child by a foreign key, and one
-- generated column resolves what every reader wanted:
--
--     effective_ends_on = coalesce(ends_on, session_ends_on)
--
-- One key carries both bounds, which is the `marks.component_max_marks` shape
-- rather than a sixth kind of carried column: `session_starts_on` says the
-- arrangement cannot begin before its year, `session_ends_on` says it cannot
-- outlast it.
--
-- `on update cascade` does the second half — correcting a session's end date
-- moves every arrangement's implicit end with it, and a correction that would
-- pull the year in behind an explicitly-typed end date is refused by the CHECK.
-- Same shape as refusing to lower a paper's maximum below an awarded mark.

-- ---------------------------------------------------------------------------
-- The key the device needs.
--
-- `academic_sessions` is referenced by `session_id` alone everywhere in this
-- schema, so it has never needed a composite key. It needs one now.
-- ---------------------------------------------------------------------------

alter table public.academic_sessions
  add constraint academic_sessions_dates_key unique (tenant_id, id, start_date, end_date);

comment on constraint academic_sessions_dates_key on public.academic_sessions is
  'The target of the session-boundary foreign keys added in migration 0178. '
  'Carrying the year''s own dates onto a session-scoped arrangement is what '
  'lets a null `ends_on` mean "to the end of this year" rather than "for ever".';

-- Two keys, because two different questions are being asked of the same
-- parent. An arrangement with a start date of its own needs both bounds; an
-- award, which is dated by the day somebody decided rather than by the year,
-- needs only the end. `id` is the primary key, so both are trivially unique --
-- they exist to be pointed at, not to enforce anything here.
alter table public.academic_sessions
  add constraint academic_sessions_end_date_key unique (tenant_id, id, end_date);

-- ---------------------------------------------------------------------------
-- The one row that had to be placed first.
--
-- Deliberately a move, not a deletion and not a sentence in a `problems()`
-- function. Which session a bed starting 4 September 2026 belongs to is not a
-- judgement anybody has to make -- exactly one session contains that date --
-- and a row that cannot be placed that way stops the migration by name rather
-- than being quietly dropped.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text;
begin
  update public.hostel_allocations ha
  set session_id = better.id
  from public.academic_sessions cur, public.academic_sessions better
  where cur.id = ha.session_id
    and better.tenant_id = ha.tenant_id
    and ha.starts_on between better.start_date and better.end_date
    and (ha.starts_on < cur.start_date or ha.starts_on > cur.end_date);

  update public.transport_assignments ta
  set session_id = better.id
  from public.academic_sessions cur, public.academic_sessions better
  where cur.id = ta.session_id
    and better.tenant_id = ta.tenant_id
    and ta.starts_on between better.start_date and better.end_date
    and (ta.starts_on < cur.start_date or ta.starts_on > cur.end_date)
    -- The route is session-scoped too, so a seat can only move to a year
    -- whose route list already contains its route.
    and exists (select 1 from public.transport_routes tr
                where tr.id = ta.route_id and tr.session_id = better.id);

  select string_agg(x.what, '; ') into v_bad from (
    select format('hostel allocation %s starts %s, outside %s',
                  ha.id, ha.starts_on, s.name) as what
    from public.hostel_allocations ha
    join public.academic_sessions s on s.id = ha.session_id
    where ha.starts_on not between s.start_date and s.end_date
    union all
    select format('transport assignment %s starts %s, outside %s',
                  ta.id, ta.starts_on, s.name)
    from public.transport_assignments ta
    join public.academic_sessions s on s.id = ta.session_id
    where ta.starts_on not between s.start_date and s.end_date
  ) x;

  if v_bad is not null then
    raise exception
      'Some arrangements start outside their own session and no other session '
      'contains that date: %', v_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Transport.
-- ---------------------------------------------------------------------------

alter table public.transport_assignments
  add column session_starts_on date,
  add column session_ends_on date;

update public.transport_assignments ta
set session_starts_on = s.start_date, session_ends_on = s.end_date
from public.academic_sessions s
where s.id = ta.session_id;

alter table public.transport_assignments
  alter column session_starts_on set not null,
  alter column session_ends_on set not null;

alter table public.transport_assignments
  add constraint transport_assignments_session_dates_fkey
  foreign key (tenant_id, session_id, session_starts_on, session_ends_on)
  references public.academic_sessions (tenant_id, id, start_date, end_date)
  on update cascade;

-- An arrangement that runs past its own year is not a long arrangement, it is
-- next year's arrangement. Say so at the constraint rather than letting the
-- date window quietly straddle a rollover.
alter table public.transport_assignments
  add constraint transport_assignments_within_session_chk
  check (
    starts_on between session_starts_on and session_ends_on
    and (ends_on is null or ends_on <= session_ends_on)
  );

alter table public.transport_assignments
  add column effective_ends_on date
  generated always as (coalesce(ends_on, session_ends_on)) stored;

comment on column public.transport_assignments.effective_ends_on is
  'The day this seat actually stops -- the typed end date, or the last day of '
  'the session it was made for. Every reader uses this; nobody reads `ends_on` '
  'directly except the screen that shows what somebody typed.';

-- The exclusion constraint has to move with the readers, or last year's seat
-- keeps refusing this year's (probed: 23P01 on an otherwise valid 2026-27
-- assignment).
alter table public.transport_assignments
  drop constraint transport_assignments_no_overlap;

alter table public.transport_assignments
  add constraint transport_assignments_no_overlap
  exclude using gist (
    tenant_id with =,
    student_id with =,
    daterange(starts_on, effective_ends_on, '[]') with &&
  ) where (status = 'active');

-- ---------------------------------------------------------------------------
-- Hostel.
-- ---------------------------------------------------------------------------

alter table public.hostel_allocations
  add column session_starts_on date,
  add column session_ends_on date;

update public.hostel_allocations ha
set session_starts_on = s.start_date, session_ends_on = s.end_date
from public.academic_sessions s
where s.id = ha.session_id;

alter table public.hostel_allocations
  alter column session_starts_on set not null,
  alter column session_ends_on set not null;

alter table public.hostel_allocations
  add constraint hostel_allocations_session_dates_fkey
  foreign key (tenant_id, session_id, session_starts_on, session_ends_on)
  references public.academic_sessions (tenant_id, id, start_date, end_date)
  on update cascade;

alter table public.hostel_allocations
  add constraint hostel_allocations_within_session_chk
  check (
    starts_on between session_starts_on and session_ends_on
    and (ends_on is null or ends_on <= session_ends_on)
  );

alter table public.hostel_allocations
  add column effective_ends_on date
  generated always as (coalesce(ends_on, session_ends_on)) stored;

comment on column public.hostel_allocations.effective_ends_on is
  'The day this bed is free again. Null `ends_on` means the last day of the '
  'session, not never -- which is what `hostel_occupancy` was counting.';

alter table public.hostel_allocations
  drop constraint hostel_allocations_no_overlap;

alter table public.hostel_allocations
  add constraint hostel_allocations_no_overlap
  exclude using gist (
    tenant_id with =,
    student_id with =,
    daterange(starts_on, effective_ends_on, '[]') with &&
  ) where (status = 'active');

-- ---------------------------------------------------------------------------
-- Concessions.
--
-- This one was not billing for ever -- `fees_concession_lines` filters on
-- `current_session_id()`, so the award already stopped at the year boundary.
-- It is here because that filter is a *second* mechanism for the same fact,
-- and it disagrees with the first: the function takes an `as_of` date and then
-- ignores it in favour of whichever session happens to be current, so a
-- back-dated invoice raised after a rollover credits nothing. One fact, one
-- definition (CLAUDE.md rule 12) -- so the boundary goes on the row here too
-- and migration 0179 drops the filter.
-- ---------------------------------------------------------------------------

alter table public.student_concessions add column session_ends_on date;

update public.student_concessions sc
set session_ends_on = s.end_date
from public.academic_sessions s
where s.id = sc.session_id;

alter table public.student_concessions
  alter column session_ends_on set not null;

alter table public.student_concessions
  add constraint student_concessions_session_end_fkey
  foreign key (tenant_id, session_id, session_ends_on)
  references public.academic_sessions (tenant_id, id, end_date)
  on update cascade;

-- Only the end is bound here, and the asymmetry is deliberate. `starts_on` on
-- a bus seat is the day a child starts riding, so it happens inside the year.
-- `granted_on` is the day a person *decided*, which is legitimately before the
-- year begins -- a scholarship awarded in February for the coming September is
-- not a data error.

alter table public.student_concessions
  add constraint student_concessions_within_session_chk
  check (ends_on is null or ends_on <= session_ends_on);

alter table public.student_concessions
  add column effective_ends_on date
  generated always as (coalesce(ends_on, session_ends_on)) stored;

comment on column public.student_concessions.effective_ends_on is
  'The last day this award is worth anything. An award is for a year; a school '
  'that wants it again next year grants it again, deliberately -- see '
  'docs/modules/concessions.md.';
