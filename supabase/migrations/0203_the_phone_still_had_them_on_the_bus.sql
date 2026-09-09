-- 0203  The phone still had them on the bus
-- ============================================================================
--
-- Migrations `0178` and `0179` gave an open-ended arrangement a boundary,
-- because a null `ends_on` was being read as *"for ever"* by eleven callers.
-- Rule 2 states the fix in one sentence:
--
--   > A null end date means the end of the row's own session, never "for ever".
--   > **Say that with a column, not with a predicate in every reader.**
--
-- The column arrived. `effective_ends_on` is `coalesce(ends_on,
-- session_ends_on)`, stored and generated, and the eleven readers were rewritten
-- to ask `effective_ends_on >= <date>`.
--
-- The **published mobile contract** was not one of the eleven, and it re-exported
-- the raw columns instead. Probed as the mother of a child in Grade 6 A, on
-- 9 September 2026, this is what `mobile_student()` sends to her phone:
--
--   {
--     "status":            "active",        <- raw column
--     "ends_on":           null,            <- raw column
--     "effective_ends_on": "2026-03-31",    <- the boundary, correct
--     "route_name":        "Ring Road (morning only)",
--     "pickup_time":       "06:55:00",
--     "monthly_fare":      800.00
--   }
--
-- Three fields in one document that contradict each other. The seat ended with
-- the 2025-2026 session on 31 March — **162 days before** — and the app renders
-- *"Active · Ring Road · pickup 06:55"*. The one field that tells the truth is a
-- third key no client is going to subtract from the other two, which is rule 2's
-- sentence arriving one layer out: publishing a predicate is not saying it.
--
-- ---------------------------------------------------------------------------
-- Two mistakes, and the second is why nobody noticed the first
-- ---------------------------------------------------------------------------
--
-- 1. **`limit 1` over a history is "the latest", not "the current one".**
--    `transport_for_student` and `hostel_for_student` return every arrangement a
--    child has ever had, `order by starts_on desc` -- correct, because the
--    transport screen shows that history. The card took the first row of it and
--    published it as *the* arrangement.
--
-- 2. **The card has a date and these two blocks never used it.**
--    `mobile_student_card` computes `day` and every other date-sensitive block
--    consults it -- `timetable_today` filters on its weekday, `attendance`
--    passes it through. Transport and hostel ignored it entirely.
--
-- The second is why this survived: on the day an arrangement is made the latest
-- one *is* the current one, and the two answers only diverge after it ends. A
-- bug that needs a year to pass is a bug that ships.
--
-- ---------------------------------------------------------------------------
-- What changes, and what rule 14 allows
-- ---------------------------------------------------------------------------
--
-- Rule 14 is additive-only within a version: a new key is safe, a renamed or
-- removed one is not. **No key changes here.** `transport` and `hostel` already
-- publish `null` when a child has no arrangement -- that is what a day scholar
-- gets today -- so a lapsed one becoming `null` is a value the contract already
-- produces and every client already renders.
--
-- The predicate is the one the other eleven readers use, copied rather than
-- reinvented:
--
--   status = 'active'
--   and starts_on <= <the card's date>
--   and effective_ends_on >= <the card's date>
--
-- `order by starts_on desc` stays, so a child with two arrangements in one year
-- gets the later one -- and it is now a tiebreak among *current* rows rather
-- than the whole selection.

create or replace function public.mobile_student_card(p_student_id uuid, p_on date default null)
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with day as (select coalesce(p_on, public.mobile_today()) as on_date),
  student as (
    select * from public.mobile_my_students() m where m.student_id = p_student_id
  )
  select jsonb_build_object(
    'student', to_jsonb(s),
    'timetable_today', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period', t.period_number,
        'slot', t.slot_label,
        'starts_at', t.starts_at,
        'ends_at', t.ends_at,
        'subject', t.subject_name,
        'subject_code', t.subject_code,
        'teacher', t.teacher_name,
        'room', t.room_name
      ) order by t.period_number)
      from day, public.timetable_for_section(s.section_id) t
      where t.weekday = extract(isodow from day.on_date)::integer
    ), '[]'::jsonb),
    'attendance', (
      select to_jsonb(a) from public.exams_attendance_summary(
        p_student_id,
        public.current_session_id(( select public.current_tenant_id() )),
        (select on_date from day)
      ) a
    ),
    'fees', (
      select jsonb_build_object(
        'charged', b.charged, 'paid', b.paid, 'balance', b.balance,
        'last_payment_at', b.last_payment_at)
      from public.fees_student_balances(s.section_id, false) b
      where b.student_id = p_student_id
    ),
    'homework_due', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.homework_id,
        'title', h.title,
        'subject', h.subject_name,
        'due_on', h.due_on,
        'status', h.status,
        'collects_submissions', h.collects_submissions
      ) order by h.due_on)
      from (
        select * from public.homework_for_student(p_student_id, false) hh
        order by hh.due_on limit 20
      ) h
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exam_id', r.exam_id,
        'exam', r.exam_name,
        'ends_on', r.ends_on,
        'percentage', r.percentage,
        'grade', r.grade,
        'result', r.result,
        'rank_in_cohort', r.rank_in_cohort,
        'cohort_size', r.cohort_size
      ) order by r.published_at desc)
      from (
        select * from public.exams_published_for_student(p_student_id) rr
        order by rr.published_at desc limit 8
      ) r
    ), '[]'::jsonb),
    -- The arrangement that is running **on this card's date**, not merely the
    -- most recent one ever made. `null` when there is none, which is exactly
    -- what a day scholar already gets.
    'transport', (
      select to_jsonb(tr)
      from day, public.transport_for_student(p_student_id) tr
      where tr.status = 'active'
        and tr.starts_on <= day.on_date
        and tr.effective_ends_on >= day.on_date
      order by tr.starts_on desc
      limit 1
    ),
    'hostel', (
      select to_jsonb(ho)
      from day, public.hostel_for_student(p_student_id) ho
      where ho.status = 'active'
        and ho.starts_on <= day.on_date
        and ho.effective_ends_on >= day.on_date
      order by ho.starts_on desc
      limit 1
    )
  )
  from student s
$$;

revoke all on function public.mobile_student_card(uuid, date) from public, anon;
grant execute on function public.mobile_student_card(uuid, date) to authenticated;

comment on function public.mobile_student_card(uuid, date) is
  'One child''s screen as one document. Every block wraps a module''s own read '
  'path (rule 11) and every date-sensitive one asks the card''s own date -- '
  'including transport and hostel, which took the latest arrangement rather than '
  'the current one until migration 0203.';
