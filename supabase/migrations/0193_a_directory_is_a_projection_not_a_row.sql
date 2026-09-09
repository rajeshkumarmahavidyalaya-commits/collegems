-- 0193 -- "Not sensitive HR data" was a claim about columns, made by a policy
--          that governs rows.
--
-- Migration `0009` gave every signed-in member of a tenant a SELECT policy on
-- `public.staff`, under this comment:
--
--     -- Staff directory (name/designation/department) is not sensitive HR data
--     -- and is needed by every role to render things like "Class teacher: ...".
--
-- Both halves are wrong, and they are wrong in opposite directions. Measured on
-- this school, as a caller whose JWT says `role = parent`:
--
--   * **staff rows readable: 15.** Not the three columns the comment names --
--     the whole row, because a policy decides which *rows* an UPDATE or SELECT
--     may touch and has nothing to say about columns. `employee_code`,
--     `date_of_joining`, `status` and `date_of_leaving` came with it. A family
--     could read that a member of staff is `terminated`, and join it to
--     `timetable_entries` (276 rows readable) to work out whose Monday period
--     that was.
--   * **people rows readable: 0**, so `staff joined to a name` was **0** too.
--     The one thing the comment says the policy exists for -- rendering
--     "Class teacher: ..." -- has never worked for the two roles that only had
--     this policy. `timetable_for_section` left-joins `people`, so a parent has
--     always been shown a blank where the teacher's name goes.
--
-- So the policy granted exactly the employment facts the comment thought it was
-- excluding, and withheld the name it was written to provide.
--
-- ---------------------------------------------------------------------------
-- Why the fix is a function and not a narrower policy
--
-- `CLAUDE.md` already says **RLS cannot restrict columns**, and prescribes a
-- column-level GRANT beside the policy. That works for `notification_deliveries`
-- and `certificates` because there the rule separates *rows*: nobody else had
-- UPDATE at all. It cannot work here. A GRANT is role-wide, and every user of
-- this application -- parent, teacher, administrator alike -- is
-- `authenticated`. `grant select (id, designation) on staff` would take
-- `date_of_leaving` away from the payroll screen in the act of hiding it from a
-- parent.
--
-- That is the same fork `homework_submissions` reached and the same answer:
--
--   > When two roles need different **columns** of the same row, no policy and
--   > no grant can express it. The narrower role gets a `SECURITY DEFINER`
--   > function returning the projection, and no policy at all.
--
-- `staff_directory()` is that projection -- three columns, no employment facts,
-- every member of the tenant. The definer is what makes it a projection rather
-- than a view over a table the caller can also read directly.

create or replace function public.staff_directory()
returns table (
  staff_id uuid,
  full_name text,
  designation text,
  department text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- A hand-written tenant filter, which rule 11 forbids in a read model and
  -- which is mandatory here for the same reason: this is `SECURITY DEFINER`,
  -- so no policy runs and this predicate **is** the isolation rather than an
  -- optimisation on top of one. It is the only kind of function that may
  -- carry one.
  select
    s.id,
    (p.first_name || ' ' || p.last_name)::text,
    s.designation,
    s.department
  from public.staff s
  join public.people p on p.id = s.person_id
  where s.tenant_id = ( select public.current_tenant_id() )
    and p.tenant_id = ( select public.current_tenant_id() )
  order by p.first_name, p.last_name
$$;

comment on function public.staff_directory() is
  'Name, designation and department of everybody on the staff of the caller''s '
  'tenant. SECURITY DEFINER because a policy cannot restrict columns and a '
  'GRANT is role-wide: this is the only way to give a parent the class '
  'teacher''s name without also giving them the leaving date. Departed staff '
  'are included deliberately -- a name is needed to render records made before '
  'they left, and the row carries no fact about their employment.';

revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

-- And now the row policy goes. `staff roles view staff directory` (admin,
-- teacher, accountant, librarian) and `admins manage staff` are untouched --
-- those roles have business with an employment record. A custom role a tenant
-- adds later falls through to `staff_directory()`, which is the safer default
-- to fail into.
drop policy "tenant members view staff directory" on public.staff;


-- ---------------------------------------------------------------------------
-- The two readers a family actually opens.
--
-- Both left-join `staff` and `people` for one name, so both have been showing a
-- blank to the very roles the dropped policy was supposed to serve. Sourcing
-- the name from the projection fixes the leak and the blank in one edit: a
-- parent opening their child's timetable now sees who teaches each lesson,
-- which is what `0009` intended and never delivered.
--
-- `exams_report_cards` is deliberately **not** changed. It is run by staff to
-- produce a document, and rule 12 says a document a person keeps is frozen when
-- it is made -- so the name on a card comes from the run, not from a family's
-- read.

create or replace function public.timetable_for_section(p_section_id uuid)
returns table (
  id uuid, weekday integer, time_slot_id uuid, period_number integer,
  slot_label text, starts_at time, ends_at time,
  subject_id uuid, subject_name text, subject_code text,
  teacher_staff_id uuid, teacher_name text,
  class_room_id uuid, room_name text, note text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    e.id,
    e.weekday,
    e.time_slot_id,
    ts.period_number,
    ts.label,
    ts.starts_at,
    ts.ends_at,
    e.subject_id,
    sub.name,
    sub.code,
    e.teacher_staff_id,
    sd.full_name,
    e.class_room_id,
    cr.name,
    e.note
  from public.timetable_entries e
  join public.time_slots ts on ts.id = e.time_slot_id
  join public.subjects sub on sub.id = e.subject_id
  left join public.staff_directory() sd on sd.staff_id = e.teacher_staff_id
  left join public.class_rooms cr on cr.id = e.class_room_id
  where e.section_id = p_section_id
    and e.session_id = public.current_session_id(public.current_tenant_id())
  order by e.weekday, ts.period_number
$$;

create or replace function public.hostel_for_student(p_student_id uuid)
returns table (
  allocation_id uuid, hostel_name text, hostel_kind text,
  room_number text, floor text, monthly_fare numeric,
  starts_on date, ends_on date, effective_ends_on date,
  status text, warden_name text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    a.id, h.name, h.kind, r.room_number, r.floor, a.monthly_fare,
    a.starts_on, a.ends_on, a.effective_ends_on, a.status,
    sd.full_name
  from public.hostel_allocations a
  join public.hostels h on h.id = a.hostel_id
  join public.hostel_rooms r on r.id = a.room_id
  left join public.staff_directory() sd on sd.staff_id = h.warden_staff_id
  where a.student_id = p_student_id
  order by a.starts_on desc
$$;
