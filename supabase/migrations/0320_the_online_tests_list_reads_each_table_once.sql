-- 0320: the online tests list reads each table once.
--
-- online_tests_list() counted questions, marks, sittings and submissions with
-- four correlated subqueries, two on online_test_questions and two on
-- online_test_attempts. Each one brought that table's row-level policies
-- into the plan (137 init plans), so the function took 193-486 ms on a quiet
-- database for a college with no tests, against 1-12 ms for its own join, and
-- under load 3-34 s -- past the 8 s statement timeout, so /online-tests
-- showed its error boundary to an administrator in the 3 Oct 2026 sweep.
--
-- Now each table is read once, grouped by test, and joined. Same signature,
-- so its grants are kept. Checked before applying, in a rolled-back
-- transaction on the test college with two tests, two questions and two
-- attempts (one submitted): old and new returned the same rows (0 differing),
-- and the new one ran in 68-99 ms against 155-289 ms.

create or replace function public.online_tests_list()
returns table(id uuid, title text, status text, opens_at timestamptz, closes_at timestamptz, duration_minutes integer, reveal_answers boolean, section_id uuid, class_label text, subject_name text, timezone text, question_count integer, total_marks numeric, sittings integer, submitted integer)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with t as (
    select t.* from public.online_tests t where t.closes_at > now() - interval '120 days'
  ),
  q as (
    select q.test_id, count(*)::integer as n, coalesce(sum(q.marks), 0) as marks
    from public.online_test_questions q
    where q.test_id in (select t.id from t)
    group by q.test_id
  ),
  a as (
    select a.test_id, count(*)::integer as n,
           count(*) filter (where a.submitted_at is not null)::integer as done
    from public.online_test_attempts a
    where a.test_id in (select t.id from t)
    group by a.test_id
  )
  select t.id, t.title, t.status, t.opens_at, t.closes_at, t.duration_minutes, t.reveal_answers,
         t.section_id,
         cl.name || ' ' || s.name,
         sub.name,
         coalesce(tn.timezone, 'Asia/Kolkata'),
         coalesce(q.n, 0), coalesce(q.marks, 0), coalesce(a.n, 0), coalesce(a.done, 0)
  from t
  join public.sections s on s.id = t.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  join public.subjects sub on sub.id = t.subject_id
  join public.tenants tn on tn.id = t.tenant_id
  left join q on q.test_id = t.id
  left join a on a.test_id = t.id
  order by t.opens_at desc, t.id
$function$;
