-- ---------------------------------------------------------------------------
-- The Cancel button asks the policy's question, not a similar one
-- ---------------------------------------------------------------------------
--
-- `0270`'s read model told a screen whether to draw *Cancel* with
--
--   lc.teacher_staff_id = the caller's staff id
--
-- -- the teacher **frozen onto the lesson** when it was scheduled. The write
-- policy asks something else: whether the caller teaches **the course**
-- (`section_subjects.teacher_staff_id`) now. Probed as a teacher in a
-- rolled-back transaction, on a lesson for a course they teach that had been
-- written with no teacher on it:
--
--   can_manage = false      and      live_class_cancel(...) succeeds
--
-- and the other direction follows from the same two lines: when a course moves
-- to a new teacher mid-year, the old one would be offered a *Cancel* the
-- policy refuses, and the new one would not be offered one it allows. Rule 4:
-- **the menu and the boundary must not disagree, and only one of them is
-- load-bearing.** The flag now asks the policy's question, word for word.
--
-- The name shown beside a lesson keeps the frozen teacher -- who was teaching
-- it when it was scheduled is the fact a family was told -- and falls back to
-- the course's teacher only when none was recorded.

begin;

create or replace function public.live_classes_between(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  provider text,
  join_url text,
  status text,
  cancel_reason text,
  section_id uuid,
  section_label text,
  subject_name text,
  teacher_name text,
  timezone text,
  can_manage boolean
)
language sql
stable
set search_path = public, extensions
as $$
  select
    lc.id, lc.title, lc.starts_at, lc.ends_at, lc.provider, lc.join_url,
    lc.status, lc.cancel_reason, lc.section_id,
    (cl.name || ' ' || s.name),
    sub.name,
    sd.full_name,
    t.timezone,
    -- The write policies' own predicate: the administrator, or the teacher of
    -- the course as it stands today.
    (( select public.current_role_code() ) = 'admin'
      or (( select public.current_role_code() ) = 'teacher'
          and exists (select 1 from public.user_profiles up
                      where up.id = ( select auth.uid() )
                        and up.staff_id is not null
                        and up.staff_id = ss.teacher_staff_id)))
  from public.live_classes lc
  join public.section_subjects ss
    on ss.tenant_id = lc.tenant_id and ss.session_id = lc.session_id
   and ss.section_id = lc.section_id and ss.subject_id = lc.subject_id
  join public.sections s on s.id = lc.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = lc.subject_id
  join public.tenants t on t.id = lc.tenant_id
  left join public.staff_directory() sd
    on sd.staff_id = coalesce(lc.teacher_staff_id, ss.teacher_staff_id)
  where lc.starts_at < p_to and lc.ends_at > p_from
  order by lc.starts_at, cl.sequence, s.name, lc.id
  limit 500
$$;

commit;
