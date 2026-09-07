-- ---------------------------------------------------------------------------
-- The same question, asked by somebody with narrower eyes
-- ---------------------------------------------------------------------------
--
-- `substitution_gaps` returns **nothing at all** to a teacher, and that is not
-- a bug in it. It is derived from `staff_is_away`, which reads
-- `staff_attendance` -- and RLS there is row-ownership: a teacher may read
-- their own register row and nobody else's. So for a teacher every colleague
-- is "not away", every lesson is somebody's ordinary Tuesday, and the morning
-- list is empty.
--
-- Probed rather than assumed, as an administrator *and* as a teacher:
--
--   as admin    substitution_gaps() -> 4 rows, staff_attendance -> 51 rows
--                                              across every member of staff
--   as teacher  substitution_gaps() -> 0 rows, staff_attendance -> 51 rows
--                                              across exactly 1 member of staff
--
-- Note the shape of that failure, because it is the general one:
--
--   > An INVOKER function that derives its answer from a table with
--   > **row-ownership** RLS does not refuse a narrower caller. It answers them,
--   > with a smaller number, and the number is plausible.
--
-- A permission error is loud. "No cover needed today" is quiet, and it is what
-- a teacher would have been shown every morning. The dashboard's `withheld`
-- list (migration 0129) is the same lesson learned in the other direction: say
-- what is not being answered, or give the narrower caller their own question.
--
-- This does the second, because a teacher's question genuinely is a different
-- one. The office asks *"which classes have nobody in front of them"*; a
-- teacher asks *"where do I have to be"*. The second reads `substitutions`
-- directly -- every member of staff may, by the policy in 0155 -- so it is
-- answerable without seeing who is off sick, which is exactly the fact a
-- teacher should not be able to enumerate.
--
-- The screen therefore gates the office's list on `substitutions.manage` and
-- shows this one otherwise. Showing the same empty list to both would be the
-- worst of the three, and the one nobody would report.

create or replace function public.substitution_my_covers(p_date date default null)
returns table (
  on_date date,
  period_number integer,
  starts_at time,
  ends_at time,
  section_label text,
  subject_name text,
  room text,
  covering_for text,
  note text
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select up.staff_id
    from public.user_profiles up
    where up.id = ( select auth.uid() ) and up.staff_id is not null
  ),
  day as (select coalesce(p_date, public.mobile_today()) as d)
  select
    s.on_date,
    ts.period_number,
    ts.starts_at,
    ts.ends_at,
    coalesce(cl.name || ' ' || sec.name, 'Class unknown')::text,
    coalesce(sub.name, '--')::text,
    cr.name,
    (ap.first_name || ' ' || ap.last_name)::text,
    s.note
  from public.substitutions s
  join me on me.staff_id = s.substitute_staff_id
  join day on day.d = s.on_date
  join public.time_slots ts on ts.id = s.time_slot_id
  join public.staff ast on ast.id = s.absent_staff_id
  join public.people ap on ap.id = ast.person_id
  left join public.timetable_entries e on e.id = s.timetable_entry_id
  left join public.sections sec on sec.id = e.section_id
  left join public.class_levels cl on cl.id = sec.class_level_id
  left join public.subjects sub on sub.id = e.subject_id
  left join public.class_rooms cr on cr.id = e.class_room_id
  order by ts.period_number
$$;

revoke all on function public.substitution_my_covers(date) from public, anon;
grant execute on function public.substitution_my_covers(date) to authenticated;

comment on function public.substitution_my_covers(date) is
  'What this member of staff is covering on a day. Deliberately not derived '
  'from `staff_is_away`: a teacher cannot read a colleague''s register row, so '
  'anything built on that answers them with a plausible zero. See 0158''s '
  'header.';
