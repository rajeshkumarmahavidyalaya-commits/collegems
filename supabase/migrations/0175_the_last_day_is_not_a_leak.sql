-- ---------------------------------------------------------------------------
-- A fencepost, found by probing rather than by reading
-- ---------------------------------------------------------------------------
--
-- `0174`'s critic reported a child whose exit had just been performed
-- correctly:
--
--     student_exit(...) -> closed: {enrolments: 1, transport: 1, hostel: 1}
--     student_exit_problems() -> "Vihaan Singh is marked transferred but
--                                 still has a bus seat and still has a hostel
--                                 bed. They will keep being billed."
--
-- He did not. The billing check agreed with the exit and not with the critic:
-- `fees_billable_lines` for the following day returned **nothing**.
--
-- The two predicates look the same and mean different things:
--
--     transport_fee_lines   ends_on >= as_of     -- charged ON the last day: right
--     student_exit_problems ends_on >= today     -- "still has a seat" ON the
--                                                --  last day: wrong
--
-- A seat that ends today is a seat that has been given up. The charge runs to
-- the final day inclusive because the child rode the bus that morning; the
-- *relationship* is over from the moment it is ended. Same column, same
-- operator, opposite question -- which is why this was only visible by running
-- the thing and reading what it said.
--
--   > A critic that fires on a correctly finished action teaches people to
--   > ignore it, which costs more than the check was worth. The bar for a
--   > `problems()` function is not "could this be wrong" but "is somebody
--   > going to have to do something about it".

create or replace function public.student_exit_problems()
returns table (student_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  select
    st.id,
    'warning'::text,
    format(
      '%s %s is marked %s but %s. They will keep being billed.',
      p.first_name, p.last_name, st.status,
      array_to_string(array_remove(array[
        case when exists (select 1 from public.enrolments e
                          where e.student_id = st.id and e.status = 'active')
             then 'is still enrolled' end,
        -- `> current_date`, not `>=`: an assignment ending today is one that
        -- has been ended. See this migration's header.
        case when exists (select 1 from public.transport_assignments ta
                          where ta.student_id = st.id and ta.status = 'active'
                            and (ta.ends_on is null or ta.ends_on > current_date))
             then 'still has a bus seat' end,
        case when exists (select 1 from public.hostel_allocations ha
                          where ha.student_id = st.id and ha.status = 'active'
                            and (ha.ends_on is null or ha.ends_on > current_date))
             then 'still has a hostel bed' end
      ], null), ' and ')
    )
  from public.students st
  join public.people p on p.id = st.person_id
  where st.status in ('transferred', 'alumni', 'expelled')
    and (
      exists (select 1 from public.enrolments e
              where e.student_id = st.id and e.status = 'active')
      or exists (select 1 from public.transport_assignments ta
                 where ta.student_id = st.id and ta.status = 'active'
                   and (ta.ends_on is null or ta.ends_on > current_date))
      or exists (select 1 from public.hostel_allocations ha
                 where ha.student_id = st.id and ha.status = 'active'
                   and (ha.ends_on is null or ha.ends_on > current_date))
    )

  union all

  select
    st.id,
    'warning'::text,
    format(
      '%s %s is active but has no enrolment this year, so they appear on no '
      'register. Re-enrol them, or record that they have left.',
      p.first_name, p.last_name
    )
  from public.students st
  join public.people p on p.id = st.person_id
  where st.status = 'active'
    and not exists (
      select 1 from public.enrolments e
      where e.student_id = st.id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
    )

  order by 2, 3
$$;

revoke all on function public.student_exit_problems() from public, anon;
grant execute on function public.student_exit_problems() to authenticated;

comment on function public.student_exit_problems() is
  'Children marked gone who are still attached to something, and children on '
  'the roll with nowhere to be. An assignment ending today counts as ended -- '
  'see migration 0175 for why that fencepost matters.';
