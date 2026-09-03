-- A week of homework, and a reading list.
--
-- Shaped rather than uniform, because the screens are only worth looking at if
-- the data has the problems a real week has:
--
--   * one assignment in three, not one per subject per class -- a demo where
--     every teacher set homework on the same day is a stress test, not a school
--   * a quarter of it is done in an exercise book (`collects_submissions` off),
--     which is what stops the submissions list becoming a wall of permanently
--     pending rows
--   * half is marked out of something and half is not
--   * due dates spread either side of today, so the overdue state is visible
--   * submissions split roughly evenly between not handed in, handed in, and
--     marked and returned
--
-- Deterministic: every mark and status comes from a hash of the homework and
-- student ids, so the demo is identical on every machine and every re-run.
--
-- No files are seeded. A migration cannot put an object in a bucket, and a row
-- in `homework_files` pointing at nothing would be worse than an empty
-- attachment list -- the signed-URL path would fail on a file that was never
-- there. The screens' empty states cover it.

do $$
declare
  v_row record;
  v_homework_id uuid;
  v_seq integer;
  v_titles text[] := array[
    'Read the chapter and answer the questions',
    'Practice worksheet',
    'Revision exercise',
    'Project: prepare a short presentation',
    'Complete the problems from class'
  ];
  v_i integer;
begin
  for v_row in
    select
      ss.tenant_id, ss.session_id, ss.section_id, ss.subject_id, ss.teacher_staff_id,
      row_number() over (partition by ss.tenant_id order by ss.section_id, ss.subject_id) as seq
    from public.section_subjects ss
    join public.academic_sessions a
      on a.id = ss.session_id and a.is_current and a.tenant_id = ss.tenant_id
  loop
    -- `row_number()` is bigint and `date + bigint` has no operator, so the
    -- sequence is narrowed once here rather than cast at four call sites.
    v_seq := v_row.seq::integer;
    continue when v_seq % 3 <> 0;

    v_i := (v_seq / 3) % array_length(v_titles, 1) + 1;

    insert into public.homework (
      tenant_id, session_id, section_id, subject_id, title, instructions,
      assigned_on, due_on, max_marks, collects_submissions,
      status, published_at, assigned_by_staff_id
    ) values (
      v_row.tenant_id, v_row.session_id, v_row.section_id, v_row.subject_id,
      v_titles[v_i],
      'Work through it carefully and show your method. Ask in class if anything is unclear.',
      current_date - 4,
      current_date + ((v_seq % 7) - 2),
      case when v_seq % 2 = 0 then 20 else null end,
      v_seq % 4 <> 0,
      'published', now() - interval '4 days',
      v_row.teacher_staff_id
    )
    returning id into v_homework_id;

    insert into public.homework_submissions (
      tenant_id, session_id, homework_id, student_id, status, max_marks,
      submitted_at, marks_obtained, graded_at
    )
    select
      v_row.tenant_id, v_row.session_id, v_homework_id, en.student_id,
      case h.bucket
        when 0 then 'pending'
        when 1 then 'pending'
        when 2 then 'submitted'
        when 3 then 'submitted'
        else 'returned'
      end,
      hw.max_marks,
      case when h.bucket >= 2 then now() - interval '1 day' else null end,
      case when h.bucket >= 4 and hw.max_marks is not null
           then round(hw.max_marks * (0.55 + (h.spread % 45) / 100.0), 0)
           else null end,
      case when h.bucket >= 4 then now() - interval '12 hours' else null end
    from public.enrolments en
    cross join (select max_marks, collects_submissions from public.homework where id = v_homework_id) hw
    cross join lateral (
      -- bit(32) casts to a *signed* int, so half the hashes come out negative
      -- and `%` would then produce negative marks.
      select abs(('x' || substr(md5(v_homework_id::text || en.student_id::text), 1, 8))::bit(32)::int::bigint) as raw
    ) seed
    cross join lateral (select (seed.raw % 6) as bucket, (seed.raw / 6) as spread) h
    where en.tenant_id = v_row.tenant_id
      and en.session_id = v_row.session_id
      and en.section_id = v_row.section_id
      and en.status = 'active'
      and hw.collects_submissions
    on conflict (tenant_id, homework_id, student_id) do nothing;
  end loop;
end $$;

-- One link per subject. A link needs no bucket and no upload, so the study
-- material screen has something real to show before anybody has posted a file.
insert into public.study_material (
  tenant_id, session_id, section_id, subject_id, title, description,
  kind, external_url, is_published
)
select distinct
  ss.tenant_id, ss.session_id, null::uuid, ss.subject_id,
  'Reference video: ' || s.name,
  'A short introduction to this term''s topics.',
  'video',
  'https://www.youtube.com/results?search_query=' || replace(s.name, ' ', '+'),
  true
from public.section_subjects ss
join public.academic_sessions a
  on a.id = ss.session_id and a.is_current and a.tenant_id = ss.tenant_id
join public.subjects s on s.id = ss.subject_id;
