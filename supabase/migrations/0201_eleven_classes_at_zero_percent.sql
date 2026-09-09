-- 0201  Eleven classes at 0.0%, and none of them true
-- ============================================================================
--
-- Migration `0189` found this shape once and wrote the rule down:
--
--   > A critic built on `not exists` asks which rows are **missing**, and under
--   > row-ownership RLS absence and invisibility are the same shape. An
--   > under-report is a missing sentence; this is an accusation.
--
-- It is here too, in the two functions that answer *"which registers were never
-- taken"* -- and this time the accusation is shown to the person who is meant
-- to act on it, every day, on the page they open to take the register.
--
-- Both functions compare two sets:
--
--   sections   read from `public.sections`, which is **tenant-wide**
--   marked     read from `attendance_records` + `enrolments`, which are
--              **row-ownership**: a teacher sees the children they teach, a
--              parent their own
--
-- One wide side, one narrow side, and a `not exists` between them. Measured on
-- the demo school over 1 Aug - 9 Sep 2026, as each caller rather than as
-- `postgres`:
--
--   attendance_coverage       admin  12 rows, 0 at zero percent, worst 58.8%
--                             teacher 12 rows, **11 at 0.0%**, worst "0.0%"
--
--   report_attendance_gaps    admin   168 findings
--                             teacher **388**, parent **388**
--
-- The coverage function's own comment says *"worst covered first: the list is
-- read to find the class nobody has been taking a register for"*. To a class
-- teacher it puts eleven classes at 0.0% at the top of that list, every one of
-- them false, and buries Grade 1 A -- which genuinely is the worst at 58.8% --
-- underneath them. 220 of the report's 388 rows are fabrications about
-- colleagues.
--
-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------
--
-- > **A `not exists` is only honest when both sides are narrowed by the same
-- > policy.** Narrow the wide side to the rows the caller could have seen the
-- > evidence for -- not to the rows that happen to have evidence, which is the
-- > thing being measured.
--
-- Here that is one predicate: a section is in scope when the caller can see who
-- is *in* it. `enrolments` carries the same row-ownership policies as
-- `attendance_records`, and seeing the children is exactly the precondition for
-- "was a register taken for these children" to be a question this caller can
-- answer. Measured, the narrowing lands where it should:
--
--   sections visible          admin 12   teacher 12   parent 12
--   sections with a visible
--   active enrolment          admin 12   teacher  1   parent  1
--
-- Note what this is **not**: it is not `where tenant_id =` (rule 11 forbids
-- that in a read model, and it would not help -- both callers are in the same
-- tenant), and it is not a definer function. The policies were always right;
-- only one half of the query was consulting them.
--
-- ---------------------------------------------------------------------------
-- ...and the permission, which alone would have fixed nothing
-- ---------------------------------------------------------------------------
--
-- `attendance.gaps` was catalogued on `attendance.view`, which a parent and a
-- student hold. Rule 4's answer to that is 0189's: gate a critic on the
-- permission a school gives to somebody who may **act** on it -- here
-- `attendance.mark`, held by the administrator and the teacher, who are the
-- people who can go and take the missing register.
--
-- Both halves, and in that order, because **the gate is not the fix**: a
-- teacher holds `attendance.mark`, so moving the permission on its own would
-- have left them looking at the same 388. That is rule 4's `substitution_gaps`
-- lesson from the other side -- a permission check cannot make a read model
-- stop lying.

-- ---------------------------------------------------------------------------
-- What a section actually wrote down
-- ---------------------------------------------------------------------------

create or replace function public.attendance_coverage(
  p_from date,
  p_to date,
  p_section_id uuid default null
)
returns table (
  section_id uuid,
  section_label text,
  working_days integer,
  days_marked integer,
  days_missing integer,
  coverage_percent numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with days as (
    select c.day from public.attendance_calendar(p_from, p_to) c where c.is_working
  ),
  sections as (
    select
      s.id,
      (cl.name || ' ' || s.name)::text as label
    from public.sections s
    join public.class_levels cl on cl.id = s.class_level_id
    where s.session_id = public.current_session_id(public.current_tenant_id())
      and (p_section_id is null or s.id = p_section_id)
      -- The narrowing. `sections` is tenant-wide and `marked` below is not, so
      -- without this a class whose register the caller may not read is
      -- indistinguishable from a class nobody took a register for. It also
      -- drops a section with no active enrolment at all, which is correct:
      -- an empty class has no register to take.
      and exists (
        select 1 from public.enrolments e
        where e.section_id = s.id and e.status = 'active'
      )
  ),
  marked as (
    select distinct e.section_id, ar.attendance_date
    from public.attendance_records ar
    join public.enrolments e on e.id = ar.enrolment_id
    where ar.attendance_date between p_from and least(p_to, p_from + 400)
  )
  select
    sec.id,
    sec.label,
    (select count(*) from days)::integer,
    count(m.attendance_date)::integer,
    ((select count(*) from days) - count(m.attendance_date))::integer,
    case
      when (select count(*) from days) = 0 then null
      else round(100.0 * count(m.attendance_date) / (select count(*) from days), 1)
    end
  from sections sec
  left join marked m
    on m.section_id = sec.id
   and m.attendance_date in (select day from days)
  group by sec.id, sec.label
  -- Worst covered first: the list is read to find the class nobody has been
  -- taking a register for.
  order by 6 nulls last, sec.label
$$;

revoke all on function public.attendance_coverage(date, date, uuid) from public, anon;
grant execute on function public.attendance_coverage(date, date, uuid) to authenticated;

comment on function public.attendance_coverage(date, date, uuid) is
  'Working days against days a register exists for, per section. The number '
  'every attendance percentage in this codebase deliberately cannot express. '
  'Scoped to sections whose enrolments the caller may read, because the days '
  'side is scoped that way and a one-sided comparison reports invisibility as '
  'absence (migration 0201).';

-- ---------------------------------------------------------------------------
-- ...and which days, exactly
-- ---------------------------------------------------------------------------

create or replace function public.report_attendance_gaps(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  with bounds as (
    select
      public.report_param_date(
        p_params, 'from', (public.mobile_today() - 30)) as from_date,
      public.report_param_date(p_params, 'to', public.mobile_today()) as to_date
  ),
  days as (
    select c.day, c.reason
    from bounds b, public.attendance_calendar(b.from_date, b.to_date) c
    where c.is_working
  ),
  sections as (
    select s.id, (cl.name || ' ' || s.name)::text as label, cl.sequence
    from public.sections s
    join public.class_levels cl on cl.id = s.class_level_id
    where s.session_id = public.current_session_id(public.current_tenant_id())
      and (
        public.report_param_uuid(p_params, 'section') is null
        or s.id = public.report_param_uuid(p_params, 'section')
      )
      -- Same narrowing, same reason. See the header.
      and exists (
        select 1 from public.enrolments e
        where e.section_id = s.id and e.status = 'active'
      )
  ),
  marked as (
    select distinct e.section_id, ar.attendance_date
    from public.attendance_records ar
    join public.enrolments e on e.id = ar.enrolment_id, bounds b
    where ar.attendance_date between b.from_date and b.to_date
  )
  select to_jsonb(t)
  from (
    select
      sec.label as section,
      d.day as missing_on,
      to_char(d.day, 'FMDay') as weekday
    from sections sec
    cross join days d
    where not exists (
      select 1 from marked m
      where m.section_id = sec.id and m.attendance_date = d.day
    )
    order by d.day desc, sec.sequence, sec.label
  ) t
$$;

revoke all on function public.report_attendance_gaps(jsonb) from public, anon;
grant execute on function public.report_attendance_gaps(jsonb) to authenticated;

-- The gate, which is the second half and not the fix.
update reference.reports
   set required_permission = 'attendance.mark',
       description = 'One row per class per school day with no register at all. '
                     'The complement to the attendance percentage, which is '
                     'deliberately over what was marked and therefore cannot show '
                     'a day nobody marked. Weekends and holidays are excluded, and '
                     'so are classes whose register you may not read -- otherwise '
                     'a class you cannot see reads as a class nobody marked.'
 where key = 'attendance.gaps';
