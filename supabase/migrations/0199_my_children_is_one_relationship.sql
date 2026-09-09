-- 0199  "My children" had three implementations, and the menu had none of them
-- ============================================================================
--
-- Rule 14 states the relationship once and names it: *"'My children' is a
-- relationship, not a visibility. RLS lets a teacher read every child they
-- teach; a home screen is not a roster."*  `mobile_my_students()` spells it
-- out, a test pins it, and the phone has been right about this since it
-- shipped.
--
-- The web app never called it. It grew two more answers instead:
--
--   `listMyChildren()`  src/app/(app)/exams/report-card-actions.ts
--   `listChildren()`    src/app/(app)/homework/actions.ts
--
-- and the second is not the relationship at all. It opens with
-- `if (!ctx?.guardianId) return []`, so a **student** signed in to their own
-- homework page is not one of their own children. The page works only because
-- it branches on `roleCode === "parent"` before it asks -- which is to say the
-- bug is real and a second branch is what hides it.
--
-- Three implementations of one sentence is rule 11's warning arriving in
-- TypeScript: *a second implementation is a second answer.*  So the
-- relationship becomes one function, in the database, where the rows are:
--
--   `family_my_students()`   the definition
--   `mobile_my_students()`   that, with the published contract's bound on it
--
-- The bound is the reason the wrapper stays rather than the mobile function
-- simply being renamed. Rule 14 requires every list in the mobile document to
-- be bounded **and to say its bound**, and ten is that bound. A web screen has
-- no such contract and no reason to silently drop an eleventh child, so the
-- definition is unbounded and the limit lives in the function that promised it.
--
-- `security invoker`, so RLS still decides which rows come back -- the
-- relationship narrows what a policy already permits, it does not widen it.

create or replace function public.family_my_students()
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  photo_path text,
  section_id uuid,
  section_label text,
  roll_number text,
  relationship text
)
language sql
stable
set search_path = public, extensions
as $$
  with me as (
    select up.tenant_id, up.student_id, up.guardian_id
    from public.user_profiles up
    where up.id = ( select auth.uid() )
  ),
  mine as (
    -- A student is their own single entry. This is the half the homework copy
    -- dropped.
    select me.student_id, 'self'::text as relationship
    from me where me.student_id is not null
    union all
    select gs.student_id, gs.relationship
    from me
    join public.guardian_student gs on gs.guardian_id = me.guardian_id
    where me.guardian_id is not null
  )
  select
    s.id,
    s.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    p.photo_path,
    en.section_id,
    (cl.name || ' ' || sec.name)::text,
    en.roll_number,
    mine.relationship
  from mine
  join public.students s on s.id = mine.student_id
  join public.people p on p.id = s.person_id
  left join public.enrolments en
    on en.student_id = s.id
   and en.status = 'active'
   and en.session_id = public.current_session_id(( select public.current_tenant_id() ))
  left join public.sections sec on sec.id = en.section_id
  left join public.class_levels cl on cl.id = sec.class_level_id
  -- Ordered, because rule 7 made an `order by` part of the contract for
  -- anything a caller may page: a family list is small, and the tiebreak on
  -- `s.id` costs nothing and stops two children of the same name and no
  -- enrolment swapping places between renders.
  order by cl.sequence nulls last, en.roll_number nulls last, p.first_name, s.id
$$;

comment on function public.family_my_students() is
  'The children this login is a family member of -- a relationship, not a '
  'visibility. A member of staff gets an empty list here even though RLS lets '
  'them read the same rows elsewhere. The one definition; mobile_my_students() '
  'wraps it with the published contract''s bound of ten.';

revoke all on function public.family_my_students() from public, anon;
grant execute on function public.family_my_students() to authenticated;

-- The mobile contract keeps its shape exactly -- same columns, same order,
-- same limit -- so this is not a rule-14 change. It is the same answer, from
-- one place.
create or replace function public.mobile_my_students()
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  photo_path text,
  section_id uuid,
  section_label text,
  roll_number text,
  relationship text
)
language sql
stable
set search_path = public, extensions
as $$
  -- Bounded at ten and the document says so (rule 14). A family larger than
  -- that is real; a mobile response larger than that is a bug.
  select * from public.family_my_students() limit 10
$$;

revoke all on function public.mobile_my_students() from public, anon;
grant execute on function public.mobile_my_students() to authenticated;
