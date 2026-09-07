-- ---------------------------------------------------------------------------
-- "Who is away today" is a question about the school, not only about a class
-- ---------------------------------------------------------------------------
--
-- `student_leave_on` already handles `p_section_id is null` -- the predicate is
-- written `(p_section_id is null or e.section_id = p_section_id)` -- but the
-- parameter had no default, so the only way to ask about the whole school was
-- to pass a null explicitly, which PostgREST callers cannot omit and which the
-- generated types therefore made a required argument.
--
-- The body is unchanged. This is the signature catching up with what the body
-- already meant: a class teacher asks about their section, and the office asks
-- about the day.

create or replace function public.student_leave_on(
  p_section_id uuid default null,
  p_date date default null
)
returns table (
  student_id uuid,
  leave_id uuid,
  kind text,
  reason text,
  starts_on date,
  ends_on date
)
language sql
stable
set search_path = public, extensions
as $$
  select
    l.student_id,
    l.id,
    l.kind,
    l.reason,
    l.starts_on,
    l.ends_on
  from public.student_leave_requests l
  join public.enrolments e
    on e.student_id = l.student_id
   and e.session_id = l.session_id
   and e.status = 'active'
  where l.status = 'approved'
    and (p_section_id is null or e.section_id = p_section_id)
    and coalesce(p_date, public.mobile_today()) between l.starts_on and l.ends_on
$$;

revoke all on function public.student_leave_on(uuid, date) from public, anon;
grant execute on function public.student_leave_on(uuid, date) to authenticated;

comment on function public.student_leave_on(uuid, date) is
  'Approved leave covering a date. SECURITY INVOKER, so a class teacher sees '
  'their own section and the office sees the school -- exactly the boundary '
  'the register itself draws. Null section means every class.';
