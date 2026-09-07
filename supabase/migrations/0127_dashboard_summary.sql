-- ---------------------------------------------------------------------------
-- The dashboard, in one call
-- ---------------------------------------------------------------------------
--
-- WHY THIS IS A FUNCTION AND NOT A REPORT
--
-- Rule 11 says a question with parameters is a catalog row, not a screen, and
-- migration 0126 obeyed it three times. The dashboard is the other shape: it
-- has no parameters, it is nine questions at once, and its job is to be *one
-- round trip*. Assembled in the page it is a dozen queries fired on every load
-- by every member of staff every morning -- which is the same argument
-- `mobile_home()` already makes for the phone.
--
-- BOUNDED, per rule 7, and the bound is in the code rather than in a comment:
-- every figure below is an aggregate, so one row crosses the wire however many
-- children the school has. The one thing that reads a set rather than a count
-- -- fee balances -- is summed in SQL for the same reason.
--
-- WHAT IT IS NOT ALLOWED TO DO
--
-- It must not answer a question the module it borrows from would answer
-- differently. Every figure either aggregates a module's own read path
-- (`fees_student_balances`, `fees_day_book`, `hr_attendance_sheet`) or counts
-- the frozen table a module writes (`exam_results`). A dashboard free to
-- disagree with the screen the money is actually taken on is worse than a
-- dashboard without the number on it.
--
-- WHY IT CHECKS PERMISSIONS ITSELF
--
-- `SECURITY INVOKER`, so RLS still decides what each caller can see -- but RLS
-- alone would make this dishonest rather than safe. A teacher may read only
-- their *own* row of `staff_attendance`, so an ungated staff-attendance tile
-- would tell them "1 present, 39 unmarked" about a school where forty people
-- were marked in. Silence is not the answer either: a tile that is simply
-- absent reads as a bug.
--
-- So each block is gated on the permission matrix the same way `report_run`
-- gates a report -- inside the function that produces the data -- and every
-- block withheld is *named* in `withheld`, so the screen can say "your role
-- does not see fee figures" instead of showing a zero or a gap. That is the
-- `grading_scheme_problems()` instinct applied to a home page: say what is
-- missing and why, in Postgres, where the decision was made.

create or replace function public.dashboard_summary()
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant_id  uuid := public.current_tenant_id();
  v_session_id uuid;
  v_today      date;
  v_out        jsonb;
  v_withheld   text[] := '{}';
  v_block      jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  -- The school's today, not the server's. Vercel and Supabase both run in UTC
  -- and a 9am dashboard in Kolkata must not report yesterday's register.
  v_today := public.mobile_today();

  v_out := jsonb_build_object(
    'today', v_today,
    'role', public.current_role_code(),
    'session_id', v_session_id
  );

  -- -- The roll ----------------------------------------------------------
  if public.current_role_allows('students.view') then
    v_out := v_out || jsonb_build_object(
      'school', jsonb_build_object(
        'students', (select count(*) from public.students s where s.status = 'active'),
        'sections', (
          select count(*) from public.sections sec
          where v_session_id is null or sec.session_id = v_session_id
        ),
        'staff', case
          when public.current_role_allows('staff.view')
            then (select count(*) from public.staff s where s.status = 'active')
          else null
        end
      )
    );
  else
    v_withheld := v_withheld || 'school';
  end if;

  -- -- Today's student register -------------------------------------------
  if public.current_role_allows('attendance.view') then
    select jsonb_build_object(
      'present', count(*) filter (where a.status in ('present', 'late')),
      'late',    count(*) filter (where a.status = 'late'),
      'absent',  count(*) filter (where a.status = 'absent'),
      'excused', count(*) filter (where a.status = 'excused'),
      'marked',  count(*)
    )
    into v_block
    from public.attendance_records a
    where a.attendance_date = v_today
      and (v_session_id is null or a.session_id = v_session_id);

    v_out := v_out || jsonb_build_object('student_attendance', v_block);
  else
    v_withheld := v_withheld || 'student_attendance';
  end if;

  -- -- Today's staff register ---------------------------------------------
  -- Through `hr_attendance_sheet`, which is what the HR screen shows. It
  -- returns a row per active member of staff with a null status where nobody
  -- has been marked, so `roll - marked` is the honest "not taken yet" figure
  -- rather than a silent absence.
  if public.current_role_allows('hr.view') then
    select jsonb_build_object(
      'present',  count(*) filter (where h.status = 'present'),
      'absent',   count(*) filter (where h.status = 'absent'),
      'half_day', count(*) filter (where h.status = 'half_day'),
      'on_leave', count(*) filter (where h.status = 'on_leave'),
      'on_duty',  count(*) filter (where h.status = 'on_duty'),
      'marked',   count(*) filter (where h.status is not null),
      'roll',     count(*),
      'is_working_day', coalesce(bool_or(h.is_working_day), true)
    )
    into v_block
    from public.hr_attendance_sheet(v_today) h;

    v_out := v_out || jsonb_build_object('staff_attendance', v_block);
  else
    v_withheld := v_withheld || 'staff_attendance';
  end if;

  -- -- Money ---------------------------------------------------------------
  -- `fees_student_balances` is the fees module's own read path, so the
  -- outstanding figure here and the outstanding figure on the collection
  -- screen are the same number by construction. A parent holds `fees.view`
  -- too, and RLS narrows the same call to their own children -- which is why
  -- this block is worth showing to them rather than hiding.
  if public.current_role_allows('fees.view') then
    select jsonb_build_object(
      'billed',         coalesce(sum(b.charged + b.fines), 0),
      'collected',      coalesce(sum(b.paid), 0),
      'outstanding',    coalesce(sum(b.balance), 0),
      'students_owing', count(*) filter (where b.balance > 0)
    )
    into v_block
    from public.fees_student_balances(null, false) b;

    v_out := v_out || jsonb_build_object(
      'fees',
      v_block || (
        select jsonb_build_object(
          'collected_today', coalesce(sum(d.amount), 0),
          'receipts_today', count(*)
        )
        from public.fees_day_book(v_today, v_today) d
        where d.entry_type = 'payment' and not d.is_reversal
      )
    );
  else
    v_withheld := v_withheld || 'fees';
  end if;

  -- -- Pass and fail --------------------------------------------------------
  -- The most recently published exam, counted off `exam_results` -- the frozen
  -- rows the exam module wrote, never a recomputation from `marks`. With no
  -- published exam the key is null, which the screen renders as "no results
  -- published yet". A pass rate of zero would be a lie in exactly the term
  -- somebody is looking at.
  if public.current_role_allows('exams.view') then
    select jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'published_at', e.published_at,
      'passed',     count(r.id) filter (where r.result = 'pass'),
      'failed',     count(r.id) filter (where r.result = 'fail'),
      'incomplete', count(r.id) filter (where r.result = 'incomplete'),
      'graded',     count(r.id),
      'average_percent', round(avg(r.percentage), 1),
      'pass_percent', case
        when count(r.id) filter (where r.result in ('pass', 'fail')) = 0 then null
        else round(
          100.0 * count(r.id) filter (where r.result = 'pass')
          / count(r.id) filter (where r.result in ('pass', 'fail')), 1)
      end
    )
    into v_block
    from public.exams e
    left join public.exam_results r on r.exam_id = e.id
    where e.status = 'published'
    group by e.id, e.name, e.published_at
    order by e.published_at desc nulls last
    limit 1;

    v_out := v_out || jsonb_build_object('exam', v_block);
  else
    v_withheld := v_withheld || 'exam';
  end if;

  -- -- The library ----------------------------------------------------------
  if public.current_role_allows('library.view') then
    select jsonb_build_object(
      'issued',  count(*) filter (where i.status = 'issued'),
      'overdue', count(*) filter (where i.status = 'issued' and i.due_at < v_today)
    )
    into v_block
    from public.book_issues i;

    v_out := v_out || jsonb_build_object('library', v_block);
  else
    v_withheld := v_withheld || 'library';
  end if;

  return v_out || jsonb_build_object('withheld', to_jsonb(v_withheld));
end;
$$;

revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;

comment on function public.dashboard_summary() is
  'One jsonb brief for the home screen: roll, both registers, money, the latest '
  'published exam''s pass rate and the library, in a single round trip. '
  'SECURITY INVOKER, so every figure is the caller''s own view through RLS, and '
  'each block is additionally gated on the permission matrix -- the blocks a '
  'role may not see are named in "withheld" rather than silently missing.';
