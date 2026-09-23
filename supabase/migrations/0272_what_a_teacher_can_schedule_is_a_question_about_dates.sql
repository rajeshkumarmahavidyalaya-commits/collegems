-- ---------------------------------------------------------------------------
-- What a teacher can schedule for is a question about dates, not a flag
-- ---------------------------------------------------------------------------
--
-- The schedule dialog needs a list of courses -- *Grade 2 B, Mathematics* --
-- and the reflex is the class picker's list, which is the current session's
-- sections (rule 2, `listSections`). On the demo college that list is
-- **useless for this**: the flag still says 2025-2026, a year that ended on
-- 31 March, so all 96 of its courses could only take a lesson in the past, and
-- `live_class_schedule` refuses each one in a sentence (probed as the
-- administrator: *That lesson would already be over*).
--
-- Rule 2 already names this: *is this list "now", or is it "ever"?* A schedule
-- looks **forward**, so it is neither -- it is **every year that has not
-- ended**. That is arithmetic on the calendar (`end_date >= today`, where the
-- college is), not the `is_current` flag, which is a decision the office has
-- not taken yet.
--
-- And the honest consequence on the demo college, stated rather than hidden:
-- this returns **0** courses today, because 2026-2027 has twelve sections and
-- no subjects assigned to any of them. That is the true answer -- nothing can
-- be taught live in a class that studies nothing -- and the screen says which
-- screen fixes it, rather than showing an empty dropdown.
--
-- Whose courses: the write policies' own predicate -- the administrator every
-- course, a teacher the courses they teach -- so the dialog cannot offer a
-- course the insert will refuse (rule 4, and `0271`'s lesson one table over).

begin;

create or replace function public.live_class_courses()
returns table (
  session_id uuid,
  session_name text,
  section_id uuid,
  subject_id uuid,
  label text,
  teacher_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    ss.session_id,
    a.name,
    ss.section_id,
    ss.subject_id,
    cl.name || ' ' || s.name || ' -- ' || sub.name,
    sd.full_name
  from public.section_subjects ss
  join public.academic_sessions a on a.id = ss.session_id
  join public.sections s on s.id = ss.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = ss.subject_id
  join public.tenants t on t.id = ss.tenant_id
  left join public.staff_directory() sd on sd.staff_id = ss.teacher_staff_id
  where a.end_date >= (now() at time zone coalesce(t.timezone, 'Asia/Kolkata'))::date
    and (
      ( select public.current_role_code() ) = 'admin'
      or (( select public.current_role_code() ) = 'teacher'
          and exists (select 1 from public.user_profiles up
                      where up.id = ( select auth.uid() )
                        and up.staff_id is not null
                        and up.staff_id = ss.teacher_staff_id))
    )
  order by a.start_date, cl.sequence, s.name, sub.name, ss.id
$$;

comment on function public.live_class_courses() is
  'The courses the caller may schedule a live lesson for: every year that has '
  'not ended (a date question, not the is_current flag), and the write '
  'policies'' own predicate for whose. INVOKER. Migration 0272.';

revoke all on function public.live_class_courses() from public, anon;
grant execute on function public.live_class_courses() to authenticated;

commit;
