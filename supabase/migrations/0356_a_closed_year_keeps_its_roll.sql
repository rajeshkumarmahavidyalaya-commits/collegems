-- 0356: a closed year keeps its roll.
--
-- The second half of "after promotion the previous data vanished" (0355 is the
-- first). Opening 2025-2026 in the college that reported it, the fee balances
-- answered 0 rows for a year holding 344 invoices: promotion_apply marks every
-- enrolment of the year it closes `promoted` or `repeated`, and the read
-- models count only `status = 'active'`. So a closed year's classes read as
-- empty, and so did the old year between applying a promotion in March and
-- switching years in April, while those children were still in their classes.
--
-- An enrolment is on its year's roll when it is active, promoted or repeated.
-- `promoted` and `repeated` are only ever written by promotion, onto the year
-- it closes, so in a year nobody has closed this changes nothing. `withdrawn`
-- and `transferred_out` still mean the child left.
--
-- The rewrite is done here from each function's live body, and checked: each
-- named function must contain exactly the expected number of
-- `<alias>.status = 'active'` tests on its enrolment alias, or the migration
-- stops and changes nothing. The functions were chosen because a screen reads
-- a year through them. Ones that mean "active" literally are left alone:
-- student_exit_problems (an active enrolment of a child who left is the
-- finding), the setup checklist, the login and birthday lists, the gate
-- register, subject choices, and the writers (concession_award and the two
-- invoice runs).
--
-- create or replace keeps every grant and comment.

begin;

do $$
declare
  r record;
  v_def text;
  v_found integer;
  v_pattern text;
begin
  for r in
    select * from (values
      ('fees_student_balances', 'e', 1),
      ('attendance_coverage', 'e', 1),
      ('report_attendance_summary', 'e', 1),
      ('report_attendance_gaps', 'e', 1),
      ('report_exam_subjects', 'e', 1),
      ('report_concessions', 'en', 1),
      ('timetable_for_section', 'en', 1),
      ('dashboard_enrolment_by_grade', 'en', 1),
      ('family_exam_papers', 'e', 1),
      ('family_my_students', 'en', 1),
      ('mobile_student', 'en', 1),
      ('fees_billable_lines', 'e', 1),
      ('fees_instalment_preview', 'e', 1),
      ('my_school_figures', 'e', 2),
      ('report_transport_invoices', 'e', 1),
      ('module_cards', 'e', 2),
      ('module_overview', 'e', 1)
    ) as t(fn, alias, expected)
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.proname = r.fn and p.pronamespace = 'public'::regnamespace;
    if v_def is null then
      raise exception '0356: % does not exist', r.fn;
    end if;
    v_pattern := '\m' || r.alias || '\.status\s*=\s*''active''';
    select count(*) into v_found from regexp_matches(v_def, v_pattern, 'g');
    if v_found <> r.expected then
      raise exception '0356: % has % enrolment tests on %, expected %; its body changed since this was written',
        r.fn, v_found, r.alias, r.expected;
    end if;
    execute regexp_replace(v_def, v_pattern, r.alias || '.status in (''active'', ''promoted'', ''repeated'')', 'g');
  end loop;
end;
$$;

commit;
