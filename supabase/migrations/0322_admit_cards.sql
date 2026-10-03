-- 0322: Admit cards -- the reference's "Manage Exam Admit Cards", built from
-- what an exam already records.
--
-- An admit card says who may sit which papers, when, and where. Every part of
-- that is already a row:
--
--   who      the class's active enrolments in the exam's year
--   which    the class's papers (exam_subjects), narrowed by
--            student_takes_subject() -- the one definition 0285 made of who
--            sits a paper, so an elective nobody chose is not printed on the
--            card of a child who did not choose it
--   when     the paper's date and its exam period (time_slots)
--   where    the child's seat on a PUBLISHED seat plan (0249). A draft plan
--            is the officer's working copy and may still move a child, so it
--            is not printed; a paper with no published seat says so.
--
-- So nothing is stored and nothing is "generated": the reference's Generate
-- step is the moment a seat plan is published. Printing is the browser's
-- (rule 7: a class at a time is a page load, a whole school is not), so the
-- function takes a class and refuses to answer for the whole exam.
--
-- INVOKER, gated inside on exams.manage -- the office prints these -- and
-- refuses anybody else in a sentence rather than answering with an empty set
-- (rule 4: an empty class reads exactly like a class with no papers).

begin;

create or replace function public.exams_admit_cards(p_exam_id uuid, p_section_id uuid)
returns table (
  student_id uuid,
  admission_number text,
  full_name text,
  roll_number text,
  date_of_birth date,
  class_name text,
  section_name text,
  papers jsonb
)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_exam public.exams;
  v_class_level uuid;
begin
  if v_tenant is null then
    raise exception 'No tenant in session';
  end if;
  if not public.role_has_permission('exams.manage') then
    raise exception 'Admit cards are printed by the examination office, which needs exams.manage.';
  end if;
  if p_section_id is null then
    raise exception 'Choose a class: admit cards are printed a class at a time.';
  end if;

  select * into v_exam from public.exams e where e.id = p_exam_id;
  if v_exam.id is null then
    raise exception 'That exam does not exist.';
  end if;
  select sec.class_level_id into v_class_level from public.sections sec where sec.id = p_section_id;
  if v_class_level is null then
    raise exception 'That class does not exist.';
  end if;

  return query
  with roll as (
    select st.id, st.admission_number,
           trim(both ' ' from p.first_name || ' ' || coalesce(p.middle_name || ' ', '') || coalesce(p.last_name, '')) as full_name,
           e.roll_number, p.date_of_birth
    from public.enrolments e
    join public.students st on st.id = e.student_id
    join public.people p on p.id = st.person_id
    where e.section_id = p_section_id
      and e.session_id = v_exam.session_id
      and e.status = 'active'
      and st.status = 'active'
  ),
  paper as (
    select es.id, es.subject_id, sub.name as subject_name, sub.code as subject_code,
           es.exam_date, es.max_marks, ts.starts_at, ts.ends_at, ts.label as slot_label
    from public.exam_subjects es
    join public.subjects sub on sub.id = es.subject_id
    left join public.time_slots ts on ts.id = es.time_slot_id
    where es.exam_id = v_exam.id and es.section_id = p_section_id
  )
  select r.id, r.admission_number, r.full_name, r.roll_number, r.date_of_birth,
         (select cl.name from public.class_levels cl where cl.id = v_class_level),
         (select sec.name from public.sections sec where sec.id = p_section_id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'exam_subject_id', pa.id,
                    'subject', pa.subject_name,
                    'code', pa.subject_code,
                    'date', pa.exam_date,
                    'starts_at', pa.starts_at,
                    'ends_at', pa.ends_at,
                    'slot', pa.slot_label,
                    'max_marks', pa.max_marks,
                    'room', seat.room_name,
                    'seat_no', seat.seat_no)
                  order by pa.exam_date nulls last, pa.starts_at nulls last, pa.subject_name)
           from paper pa
           left join lateral (
             select a.room_name, a.seat_no
             from public.exam_seat_allocations a
             where a.student_id = r.id
               and a.exam_subject_id = pa.id
               and a.run_status = 'published'
             limit 1
           ) seat on true
           where public.student_takes_subject(r.id, pa.subject_id, v_exam.session_id, v_class_level)
         ), '[]'::jsonb)
  from roll r
  order by r.roll_number nulls last, r.full_name, r.id;
end;
$$;

comment on function public.exams_admit_cards(uuid, uuid) is
  'One class''s admit cards for an exam: each active child, the papers they sit (student_takes_subject), each paper''s date and period, and their seat on a published plan (0322). INVOKER; refuses without exams.manage.';

revoke all on function public.exams_admit_cards(uuid, uuid) from public, anon;
grant execute on function public.exams_admit_cards(uuid, uuid) to authenticated;

commit;
