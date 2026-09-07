-- ---------------------------------------------------------------------------
-- The brief carries its own chart
-- ---------------------------------------------------------------------------
--
-- The dashboard has shown enrolment by year group since the app was scaffolded,
-- and the page built it by pulling *every active enrolment* and its student's
-- person row across the wire to count them in JavaScript -- three hundred rows
-- to draw twelve bars, and a shape that gets slower exactly as a school grows.
--
-- Rule 7 is the reason to move it rather than leave it: what makes a request
-- handler unsafe is unbounded work, and "one row per child" is unbounded even
-- when the *chart* it feeds has one bar per year group. Counted in Postgres it
-- is bounded by the number of class levels a school has, which is a number
-- between eight and fourteen everywhere.
--
-- It goes in `dashboard_summary()` rather than beside it because the sentence
-- in 0127 was "its whole job is to be one round trip", and a second query on
-- the same page would have made that sentence false the week it was written.
--
-- Gender rides along with it. Two facts, one pass over the same join: the
-- alternative is a second aggregate over the same rows to answer a question
-- about the same children, which is the shape this migration exists to remove.
-- Null gender is a real state -- `people.gender` is nullable and two demo rows
-- have it -- so it is counted as `unstated` rather than dropped, because a
-- donut whose slices do not add up to the roll is a bug report waiting to
-- happen.

create or replace function public.dashboard_enrolment_by_grade()
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(t order by t.sequence), '[]'::jsonb)
  from (
    select
      cl.name as grade,
      cl.sequence,
      count(*) as students,
      count(*) filter (where p.gender = 'male')   as male,
      count(*) filter (where p.gender = 'female') as female,
      count(*) filter (where p.gender is not null and p.gender not in ('male', 'female')) as other,
      count(*) filter (where p.gender is null)    as unstated
    from public.enrolments en
    join public.students st on st.id = en.student_id and st.status = 'active'
    join public.people p on p.id = st.person_id
    join public.sections sec on sec.id = en.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    where en.status = 'active'
      and en.session_id = public.current_session_id(public.current_tenant_id())
    group by cl.name, cl.sequence
  ) t
$$;

revoke all on function public.dashboard_enrolment_by_grade() from public, anon;
grant execute on function public.dashboard_enrolment_by_grade() to authenticated;

comment on function public.dashboard_enrolment_by_grade() is
  'Active enrolment for the current session, one row per year group with its '
  'gender split. Bounded by the number of class levels, not by the roll -- '
  'which is why the dashboard may call it inline.';

-- Fold it into the brief, under the same permission as the rest of the roll.
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
      ),
      'enrolment', public.dashboard_enrolment_by_grade()
    );
  else
    v_withheld := v_withheld || 'school'::text;
  end if;

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
    v_withheld := v_withheld || 'student_attendance'::text;
  end if;

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
    v_withheld := v_withheld || 'staff_attendance'::text;
  end if;

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
    v_withheld := v_withheld || 'fees'::text;
  end if;

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
    v_withheld := v_withheld || 'exam'::text;
  end if;

  if public.current_role_allows('library.view') then
    select jsonb_build_object(
      'issued',  count(*) filter (where i.status = 'issued'),
      'overdue', count(*) filter (where i.status = 'issued' and i.due_at < v_today)
    )
    into v_block
    from public.book_issues i;

    v_out := v_out || jsonb_build_object('library', v_block);
  else
    v_withheld := v_withheld || 'library'::text;
  end if;

  return v_out || jsonb_build_object('withheld', to_jsonb(v_withheld));
end;
$$;
