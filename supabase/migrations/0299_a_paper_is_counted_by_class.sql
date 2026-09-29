-- 0299: "How each paper went" counted children the caller cannot place.
--
-- Probed as a teacher the moment 0297 applied: 16 rows, and for Mathematics
-- "Grade 4 A, 25 sat" beside "(no class), 272 sat". exam_results is readable
-- by staff school-wide; enrolments are row-owned, 25 rows for this teacher. A
-- left join from the wide side to the narrow one made a figure about classes
-- the teacher does not teach and filed it under no class at all -- rule 4's
-- invoker-over-row-ownership shape, arriving in the report written the same
-- afternoon as the rule's latest paragraph.
--
-- The fix is the one 0201 names: narrow the wide side to the rows the caller
-- could have seen the evidence for. A result counts where the caller can read
-- the child's enrolment. The administrator's 96 rows are unchanged, which is
-- the check that the fix removed the bucket and nothing else.

create or replace function public.report_exam_subjects(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      x.name as exam,
      cl.name || ' ' || sec.name as class,
      d ->> 'subject' as subject,
      count(*) filter (where not coalesce((d ->> 'absent')::boolean, false)) as sat,
      count(*) filter (where coalesce((d ->> 'absent')::boolean, false)) as absent,
      count(*) filter (where coalesce((d ->> 'passed')::boolean, false)
                        and not coalesce((d ->> 'absent')::boolean, false)) as passed,
      round(100.0 * count(*) filter (where coalesce((d ->> 'passed')::boolean, false)
                                      and not coalesce((d ->> 'absent')::boolean, false))
            / nullif(count(*) filter (where not coalesce((d ->> 'absent')::boolean, false)), 0), 1)
        as pass_rate,
      round(avg((d ->> 'percent')::numeric)
            filter (where not coalesce((d ->> 'absent')::boolean, false)), 1) as average,
      max((d ->> 'percent')::numeric) as highest,
      x.id as exam_id,
      sec.id as section_id
    from public.exam_results r
    join public.exams x on x.id = r.exam_id
    cross join lateral jsonb_array_elements(coalesce(r.detail, '[]'::jsonb)) d
    -- Inner joins (0299): a result counts only where the caller can place the
    -- child in a class. exam_results is readable school-wide by staff and
    -- enrolments are row-owned, so a left join gave a teacher their own class
    -- plus a class-less row of 272 children they do not teach.
    join public.enrolments e
      on e.student_id = r.student_id and e.session_id = r.session_id and e.status = 'active'
    join public.sections sec on sec.id = e.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    where r.session_id = (select public.current_session_id(public.current_tenant_id()))
      and (public.report_param_uuid(p_params, 'exam_id') is null
           or r.exam_id = public.report_param_uuid(p_params, 'exam_id'))
      and (public.report_param_uuid(p_params, 'section_id') is null
           or e.section_id = public.report_param_uuid(p_params, 'section_id'))
    group by x.id, x.name, sec.id, cl.name, sec.name, cl.sequence, d ->> 'subject'
    order by x.name, cl.sequence nulls last, sec.name, d ->> 'subject', x.id, sec.id
  ) t
$$;
