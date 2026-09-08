-- 0190 — The critics were the cost, and one of them lied to a teacher.
--
-- Migration 0188 put eight critics behind one call, and measuring it **as the
-- caller** rather than as `postgres` gave the honest number: 849 ms first call,
-- ~660 ms after. Per critic, under RLS:
--
--     fees.concessions   845 ms      staff.left        176 ms
--     students.left      414 ms      templates         118 ms
--     schedules.reach     52 ms      settings.filled    29 ms
--     academics.session   26 ms      fees.billing        9 ms
--
-- `concession_problems` costs 845 ms on a school with **zero concessions**.
-- Almost none of that is rows.
--
-- It is a `union all` of three branches, and all three share the same FROM:
--
--     student_concessions -> fee_concessions -> students -> people
--
-- `students` and `people` each carry several permissive policies, and every one
-- of those is a function call. So the expensive join is planned and executed
-- **three times** to answer three questions about the same rows.
-- `student_exit_problems` does the same thing twice over `students -> people`,
-- for 414 ms.
--
-- The fix is not to touch a single policy — rule 1 says the policy is the
-- boundary, and rewriting the boundary to make a page faster is the wrong trade
-- and the wrong risk. It is to **ask the expensive question once**:
-- `with ... as materialized`, the join runs once, the flags each branch needs
-- are computed there, and the branches read a handful of rows.
--
-- `as materialized` is deliberate rather than incidental. Without it Postgres
-- inlines the CTE into each branch and nothing changes; this is the one place
-- where the optimisation fence CLAUDE.md complains about elsewhere is the thing
-- being asked for.
--
-- ---------------------------------------------------------------------------
-- And the third instance of the quiet lie
--
-- `student_concessions` has three policies: finance roles (admin, accountant)
-- read the tenant, parents read their children, students read themselves. A
-- **teacher has no policy at all** — they see zero awards.
--
-- So `concession_problems` answered a teacher `ok`. Not "you cannot see this":
-- *nothing to report*, about a table they cannot read a single row of. That is
-- `substitution_gaps` again — an invoker function over row-ownership RLS
-- answering a narrower caller with a plausible smaller number — and it is the
-- third time this shape has appeared, after `substitution_gaps` and
-- `student_exit_problems`.
--
-- `concessions.view` is held by teachers; `concessions.manage` is held by
-- exactly the two roles whose RLS on the table is tenant-wide. So the check
-- moves, for the same reason `students.left` moved in 0189: **a critic may only
-- be shown to a caller who can see everything it is counting.**

update reference.checks
set required_permission = 'concessions.manage'
where key = 'fees.concessions';

-- ---------------------------------------------------------------------------
-- One scan, three questions
-- ---------------------------------------------------------------------------

create or replace function public.concession_problems()
returns table (student_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with ctx as (
    select public.current_session_id(public.current_tenant_id()) as session_id
  ),
  -- `materialized` on purpose: this join is the whole cost of the function, and
  -- inlining it would put it back in all three branches.
  live as materialized (
    select
      sc.student_id,
      sc.ends_on,
      fc.name as concession_name,
      fc.is_active as concession_active,
      p.first_name,
      p.last_name,
      exists (
        select 1 from public.enrolments e
        where e.student_id = sc.student_id
          and e.session_id = sc.session_id
          and e.status = 'active'
      ) as is_enrolled
    from public.student_concessions sc
    join public.fee_concessions fc on fc.id = sc.concession_id
    join public.students st on st.id = sc.student_id
    join public.people p on p.id = st.person_id
    cross join ctx
    where sc.status = 'active'
      and sc.session_id = ctx.session_id
  )
  -- An award pointing at a concession the school has switched off. The award
  -- still looks live on the child's record and credits nothing.
  select
    l.student_id,
    'warning'::text,
    format(
      '%s %s holds "%s", but that concession is switched off, so nothing is '
      'being taken off their bill.',
      l.first_name, l.last_name, l.concession_name
    )
  from live l
  where not l.concession_active

  union all

  -- An award that has quietly expired. Not a fault -- a one-term scholarship is
  -- meant to end -- but it belongs on a list somebody reads, because the family
  -- is about to get a bigger bill without being told.
  select
    l.student_id,
    'info'::text,
    format(
      '%s %s''s "%s" ended on %s. Their next invoice will be the full amount.',
      l.first_name, l.last_name, l.concession_name, to_char(l.ends_on, 'FMDD Mon YYYY')
    )
  from live l
  where l.ends_on is not null
    and l.ends_on < current_date

  union all

  -- An award on a child who is no longer enrolled. Harmless until somebody
  -- re-admits them and wonders why the fees are wrong.
  select
    l.student_id,
    'info'::text,
    format(
      '%s %s holds "%s" but is not actively enrolled this year.',
      l.first_name, l.last_name, l.concession_name
    )
  from live l
  where not l.is_enrolled

  order by 2, 3
$$;

revoke all on function public.concession_problems() from public, anon;
grant execute on function public.concession_problems() to authenticated;

comment on function public.concession_problems() is
  'Sentences, not a constraint -- every one is a child whose bill is wrong in a '
  'way nobody notices until a parent rings. One materialised scan rather than '
  'three, because the RLS join was the whole cost (migration 0190). Shown only '
  'to roles whose RLS on `student_concessions` is tenant-wide.';

-- ---------------------------------------------------------------------------
-- Same shape, same fix
-- ---------------------------------------------------------------------------

create or replace function public.student_exit_problems()
returns table (student_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  with ctx as (
    select public.current_session_id(public.current_tenant_id()) as session_id
  ),
  live as materialized (
    select
      st.id,
      st.status,
      p.first_name,
      p.last_name,
      exists (select 1 from public.enrolments e
              where e.student_id = st.id and e.status = 'active') as any_enrolment,
      exists (select 1 from public.enrolments e, ctx
              where e.student_id = st.id and e.session_id = ctx.session_id
                and e.status = 'active') as enrolled_now,
      -- `> current_date`, not `>=`: an arrangement ending today is one that has
      -- been ended. See migration 0175.
      exists (select 1 from public.transport_assignments ta
              where ta.student_id = st.id and ta.status = 'active'
                and ta.effective_ends_on > current_date) as has_seat,
      exists (select 1 from public.hostel_allocations ha
              where ha.student_id = st.id and ha.status = 'active'
                and ha.effective_ends_on > current_date) as has_bed
    from public.students st
    join public.people p on p.id = st.person_id
    where st.status in ('transferred', 'alumni', 'expelled', 'active')
  )
  select
    l.id,
    'warning'::text,
    format(
      '%s %s is marked %s but %s. They will keep being billed.',
      l.first_name, l.last_name, l.status,
      array_to_string(array_remove(array[
        case when l.any_enrolment then 'is still enrolled' end,
        case when l.has_seat then 'still has a bus seat' end,
        case when l.has_bed then 'still has a hostel bed' end
      ], null), ' and ')
    )
  from live l
  where l.status in ('transferred', 'alumni', 'expelled')
    and (l.any_enrolment or l.has_seat or l.has_bed)

  union all

  select
    l.id,
    'warning'::text,
    format(
      '%s %s is active but has no enrolment this year, so they appear on no '
      'register. Re-enrol them, or record that they have left.',
      l.first_name, l.last_name
    )
  from live l
  where l.status = 'active'
    and not l.enrolled_now

  order by 2, 3
$$;

revoke all on function public.student_exit_problems() from public, anon;
grant execute on function public.student_exit_problems() to authenticated;

comment on function public.student_exit_problems() is
  'Children whose record and whose relationships disagree. One materialised '
  'scan of `students` rather than two (migration 0190). The second branch asks '
  'what is *missing*, so this is gated on `students.manage` -- see 0189.';
