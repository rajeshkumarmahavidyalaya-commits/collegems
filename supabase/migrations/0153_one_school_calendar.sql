-- ---------------------------------------------------------------------------
-- One definition of "is the school open today"
-- ---------------------------------------------------------------------------
--
-- Migration 0152 added `attendance_calendar` and its header claimed it was a
-- second reader of the same fact as `hr_working_days`, pinned by a test. That
-- was already one more than the codebase should have, and it was also wrong
-- about the count: there were **three**.
--
--   `academics_is_teaching_day(date)`   0031 -- a boolean, for one day
--   `hr_working_days(from, to)`         0057 -- a count, for payroll
--   `attendance_calendar(from, to)`     0152 -- a day and a reason
--
-- CLAUDE.md is not ambiguous about this: *a second implementation is a second
-- answer*. So the three become one, and this migration is the tidy 0152 should
-- have been rather than the pinning test it promised.
--
-- THE DISAGREEMENT THAT WAS ALREADY THERE
--
-- The three did not agree, and the difference is a real latent bug rather than
-- a stylistic one. `academics_is_teaching_day` filters holidays by
-- `session_id`; `hr_working_days` filters only by date. So a query about last
-- April would count last year's Diwali as a working day in one function and a
-- closure in the other.
--
-- > **The date is the discriminator, not the session.** A holiday row already
-- > says which year it belongs to, in its own date range. Filtering by the
-- > *current* session is redundant inside that session and wrong outside it --
-- > which is precisely when somebody is looking at history and least able to
-- > tell the answer is wrong.
--
-- The date-only reading wins, so `academics_is_teaching_day` changes behaviour
-- for historical dates. That is the fix, not a regression.
--
-- The demo tenant has no holiday rows, so the two readings agree there today
-- and this is being corrected while it is still latent. Verified numerically
-- before the switch: 26 = 26 over August 2026, 313 = 313 over the whole
-- 2025-26 session.

-- ---------------------------------------------------------------------------
-- Refuse an oversized range rather than truncating it
-- ---------------------------------------------------------------------------
--
-- 0152 capped the range with `least(p_to, p_from + 400)`, which silently
-- returns a year for a caller who asked for five. Rule 13 already threw that
-- shape out once, for bulk import: *"Silently importing the first 500 of 900
-- children is the worst available outcome, because nobody notices until
-- April."* A working-day count silently taken over the wrong range is the same
-- mistake with a payslip on the end of it, so it raises and says the bound.

create or replace function public.attendance_calendar(
  p_from date,
  p_to date
)
returns table (day date, is_working boolean, reason text)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'A calendar needs a from and a to date';
  end if;
  if p_to < p_from then
    raise exception 'The last day cannot be before the first';
  end if;
  if p_to - p_from > 400 then
    raise exception
      'That range is % days. This answers at most 400 at a time -- ask for a '
      'term or a year.', p_to - p_from;
  end if;

  return query
  select
    d.day::date,
    not (coalesce(weekend.closed, false) or closure.name is not null) as is_working,
    case
      when closure.name is not null then closure.name
      when coalesce(weekend.closed, false) then 'Weekly holiday'
    end as reason
  from generate_series(p_from, p_to, interval '1 day') as d(day)
  left join lateral (
    -- A weekday with no row at all counts as teaching. A school that has
    -- configured nothing has a six-day week, not a closed one.
    select true as closed
    from public.weekends w
    where w.weekday = extract(isodow from d.day)::integer
      and not w.is_teaching
    limit 1
  ) weekend on true
  left join lateral (
    -- By date, not by session. See the header.
    select h.name
    from public.holidays h
    where d.day::date between h.starts_on and h.ends_on
    order by h.starts_on
    limit 1
  ) closure on true;
end;
$$;

revoke all on function public.attendance_calendar(date, date) from public, anon;
grant execute on function public.attendance_calendar(date, date) to authenticated;

comment on function public.attendance_calendar(date, date) is
  'The one definition of the school calendar: one row per day, whether the '
  'school is open and, when it is not, why. `academics_is_teaching_day` and '
  '`hr_working_days` are wrappers over it. Refuses a range over 400 days '
  'rather than truncating it.';

-- ---------------------------------------------------------------------------
-- ...and the two that were already there become wrappers
-- ---------------------------------------------------------------------------

create or replace function public.academics_is_teaching_day(p_date date)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select c.is_working from public.attendance_calendar(p_date, p_date) c
$$;

revoke all on function public.academics_is_teaching_day(date) from public, anon;
grant execute on function public.academics_is_teaching_day(date) to authenticated;

comment on function public.academics_is_teaching_day(date) is
  'A wrapper over attendance_calendar. Was a second implementation until '
  'migration 0153, and disagreed with hr_working_days about any holiday '
  'outside the current session.';

-- Payroll prorates on this in six places, so the wrapper is exactly the old
-- arithmetic: count the days the calendar calls working. The change is that
-- there is now one place to be wrong rather than three to drift.
create or replace function public.hr_working_days(p_from date, p_to date)
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select count(*)::integer
  from public.attendance_calendar(p_from, p_to) c
  where c.is_working
$$;

revoke all on function public.hr_working_days(date, date) from public, anon;
grant execute on function public.hr_working_days(date, date) to authenticated;

comment on function public.hr_working_days(date, date) is
  'School working days in a closed date range. A wrapper over '
  'attendance_calendar since migration 0153 -- payroll prorates on this, and '
  'it must not be able to disagree with the register about what a school day '
  'is.';
