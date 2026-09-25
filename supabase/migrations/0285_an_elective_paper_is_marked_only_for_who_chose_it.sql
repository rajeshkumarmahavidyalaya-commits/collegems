-- 0285: a paper in an elective is marked only for the children who chose it.
--
-- 0282 let a class choose electives -- "Language electives: choose 1 of
-- Sanskrit, Urdu, French" -- and left every exam function reading the class
-- roll. So a French paper listed all forty children for marks entry, and the
-- result engine gave the thirty who chose Sanskrit an unmarked French paper:
-- their result read "incomplete" and could never be anything else. Silent on
-- the demo college only because it has no elective groups yet, which is the
-- "a bug that needs somebody to use the feature is a bug that ships" shape.
--
-- One definition of "does this child take this subject", used by all three:
--
-- - `student_takes_subject()` -- yes for any subject not offered in an elective
--   group for the child's class that year (a compulsory subject), and yes for
--   an elective only if the child chose it.
-- - `exams_mark_sheet` lists only the children who take the paper's subject.
-- - `exams_subject_breakdown` -- which `exams_result_sheet`, `exams_publish`
--   and the report card all read -- builds a child's papers from the same test.
-- - `exams_enter_marks` refuses a mark for a child who does not take the
--   subject, by name, rather than writing a row every result then ignores.
--
-- Why SECURITY DEFINER for the helper: it is read by invoker functions called
-- by teachers, parents and students, and by `exams_publish` (a definer).
-- `student_subject_choices` has policies for the administrator, teachers, the
-- student and their parents only, so as an invoker it would answer an
-- accountant "nobody chose French" and drop the paper from every child's
-- result on their screen -- the invoker-over-row-ownership lie (rule 4). So it
-- filters by tenant itself and returns one boolean about a child the caller is
-- already reading, never the evidence.
--
-- The three function bodies below are 0110's, unchanged but for the lines
-- marked (0285).

create or replace function public.student_takes_subject(
  p_student_id uuid,
  p_subject_id uuid,
  p_session_id uuid,
  p_class_level_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'extensions'
as $function$
  select
    not exists (
      select 1
      from public.subject_group_options o
      join public.subject_groups g on g.id = o.group_id
      where g.tenant_id = public.current_tenant_id()
        and o.subject_id = p_subject_id
        and g.session_id = p_session_id
        and g.class_level_id = p_class_level_id
    )
    or exists (
      select 1
      from public.student_subject_choices c
      join public.subject_groups g on g.id = c.group_id
      where c.tenant_id = public.current_tenant_id()
        and c.student_id = p_student_id
        and c.subject_id = p_subject_id
        and g.session_id = p_session_id
        and g.class_level_id = p_class_level_id
    );
$function$;

comment on function public.student_takes_subject(uuid, uuid, uuid, uuid) is
  'Does this child take this subject in that year: yes for a compulsory subject, and for an elective only if chosen (0285). Definer, tenant-filtered, boolean only.';

revoke all on function public.student_takes_subject(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.student_takes_subject(uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.exams_mark_sheet(p_exam_subject_id uuid)
returns table (
  student_id uuid,
  admission_number text,
  student_name text,
  roll_number text,
  marks_obtained numeric,
  is_absent boolean,
  remarks text,
  -- Keyed by component id, so the grid can find a cell without matching on
  -- position -- the one thing that goes wrong when a part is added later.
  component_marks jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  select
    en.student_id,
    st.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    en.roll_number,
    m.marks_obtained,
    coalesce(m.is_absent, false),
    m.remarks,
    comp.cells
  from public.exam_subjects es
  join public.enrolments en
    on en.section_id = es.section_id
   and en.session_id = es.session_id
   and en.status = 'active'
  join public.sections sec on sec.id = es.section_id
  join public.students st on st.id = en.student_id
  join public.people p on p.id = st.person_id
  left join public.marks m
    on m.exam_subject_id = es.id and m.student_id = en.student_id
   and m.exam_component_id is null
  left join lateral (
    select jsonb_object_agg(
      ec.id::text,
      jsonb_build_object(
        'marks', cm.marks_obtained,
        'absent', coalesce(cm.is_absent, false)
      )
    ) as cells
    from public.exam_components ec
    left join public.marks cm
      on cm.exam_component_id = ec.id and cm.student_id = en.student_id
    where ec.exam_subject_id = es.id
  ) comp on true
  where es.id = p_exam_subject_id
    -- Only the children who take this subject: everybody in the class for a
    -- compulsory one, and only those who chose it for an elective (0285).
    and public.student_takes_subject(en.student_id, es.subject_id, es.session_id, sec.class_level_id)
  order by en.roll_number nulls last, p.first_name
$$;

create or replace function public.exams_subject_breakdown(
  p_exam_id uuid,
  p_student_id uuid default null
)
returns table (
  student_id uuid,
  exam_subject_id uuid,
  subject_id uuid,
  subject_code text,
  subject_name text,
  max_marks numeric,
  pass_marks numeric,
  weight numeric,
  is_optional boolean,
  marks_obtained numeric,
  is_absent boolean,
  entered boolean,
  grace_marks numeric,
  effective_marks numeric,
  percentage numeric,
  passed boolean,
  counted boolean,
  component_detail jsonb,
  note text
)
language sql
stable
set search_path = public, extensions
as $$
  with cfg as (
    select
      coalesce((src.r -> 'grace' ->> 'max_marks')::numeric, 0)       as grace_max,
      coalesce((src.r -> 'grace' ->> 'max_subjects')::integer, 0)    as grace_subjects,
      coalesce(src.r -> 'aggregate' ->> 'method', 'weighted')        as agg_method,
      (src.r -> 'aggregate' ->> 'best_of')::integer                  as best_of,
      coalesce((src.r -> 'optional_subject' ->> 'replaces_worst')::boolean, false) as opt_replaces,
      coalesce((src.r -> 'components' ->> 'must_pass_each')::boolean, false)       as comp_must_pass
    from (select public.exams_rules_for(p_exam_id) as r) src
  ),
  papers as (
    select
      en.student_id,
      es.id as exam_subject_id,
      es.subject_id,
      sub.code as subject_code,
      sub.name as subject_name,
      es.max_marks,
      es.pass_marks,
      es.weight,
      es.is_optional,
      -- A split paper's mark is the sum of its parts, and an unsplit one's is
      -- the single row it has always been. Whichever does not match the
      -- paper's own structure is ignored rather than added in; `exams_problems`
      -- reports the leftovers.
      case when comp.component_count > 0 then comp.total else m.marks_obtained end as marks_obtained,
      case
        when comp.component_count > 0 then comp.absent_count = comp.component_count
        else coalesce(m.is_absent, false)
      end as is_absent,
      -- "Resolved" for a split paper means every part has a mark or an
      -- absence, and at least one has a mark. Absent from the practical but
      -- present for the theory is a real, markable state, and it must not
      -- leave the result stuck at "incomplete" forever.
      case
        when comp.component_count > 0
          then comp.marked + comp.absent_count = comp.component_count and comp.marked > 0
        else m.marks_obtained is not null
      end as entered,
      coalesce(comp.short_count, 0) as short_count,
      comp.short_names,
      comp.detail as component_detail
    from public.exam_subjects es
    join public.subjects sub on sub.id = es.subject_id
    -- The roll is the enrolment, not the marks: a student with no mark row yet
    -- must still appear, or a result sheet would silently shrink as it is being
    -- filled in.
    join public.enrolments en
      on en.section_id = es.section_id
     and en.session_id = es.session_id
     and en.status = 'active'
    join public.sections sec on sec.id = es.section_id
    left join public.marks m
      on m.exam_subject_id = es.id and m.student_id = en.student_id
     and m.exam_component_id is null
    -- An aggregate in a lateral always returns exactly one row, so
    -- `component_count = 0` is how "this paper is not split" arrives, with no
    -- second query and no null-join to reason about.
    left join lateral (
      select
        count(*)                                                   as component_count,
        count(*) filter (where cm.marks_obtained is not null)      as marked,
        count(*) filter (where coalesce(cm.is_absent, false))       as absent_count,
        sum(cm.marks_obtained)                                      as total,
        count(*) filter (
          where (cm.marks_obtained is not null and cm.marks_obtained < ec.pass_marks)
             or (coalesce(cm.is_absent, false) and ec.pass_marks > 0)
        ) as short_count,
        string_agg(ec.name, ', ' order by ec.position, ec.code) filter (
          where (cm.marks_obtained is not null and cm.marks_obtained < ec.pass_marks)
             or (coalesce(cm.is_absent, false) and ec.pass_marks > 0)
        ) as short_names,
        jsonb_agg(
          jsonb_build_object(
            'id', ec.id,
            'code', ec.code,
            'name', ec.name,
            'max', ec.max_marks,
            'pass', ec.pass_marks,
            'obtained', cm.marks_obtained,
            'absent', coalesce(cm.is_absent, false)
          )
          order by ec.position, ec.code
        ) as detail
      from public.exam_components ec
      left join public.marks cm
        on cm.exam_component_id = ec.id and cm.student_id = en.student_id
      where ec.exam_subject_id = es.id
    ) comp on true
    where es.exam_id = p_exam_id
      and (p_student_id is null or en.student_id = p_student_id)
      -- A paper in an elective the child did not choose is not their paper:
      -- without this it is an unmarked paper, and the result reads
      -- "incomplete" for ever (0285).
      and public.student_takes_subject(en.student_id, es.subject_id, es.session_id, sec.class_level_id)
  ),
  gapped as (
    select p.*,
      greatest(p.pass_marks - coalesce(p.marks_obtained, 0), 0) as gap,
      (
        p.entered and not p.is_absent
        and coalesce(p.marks_obtained, 0) < p.pass_marks
        and (p.pass_marks - coalesce(p.marks_obtained, 0)) <= c.grace_max
        and c.grace_max > 0
      ) as grace_eligible
    from papers p cross join cfg c
  ),
  -- Cheapest gap first: the allowance converts as many failures as it can,
  -- which is what a school means by grace.
  grace_ranked as (
    select g.*,
      row_number() over (
        partition by g.student_id
        order by (case when g.grace_eligible then 0 else 1 end), g.gap, g.exam_subject_id
      ) as grace_rank
    from gapped g
  ),
  scored as (
    select g.*,
      case when g.grace_eligible and g.grace_rank <= c.grace_subjects then g.gap else 0 end as grace_marks,
      c.comp_must_pass
    from grace_ranked g cross join cfg c
  ),
  flagged as (
    select s.*,
      (coalesce(s.marks_obtained, 0) + s.grace_marks) as effective_marks,
      (
        s.entered and not s.is_absent
        and (coalesce(s.marks_obtained, 0) + s.grace_marks) >= s.pass_marks
        -- Step 3's second half. A paper can be passed on the total and still
        -- failed on a part, and which of those a school means is its own
        -- decision, not ours.
        and not (s.comp_must_pass and s.short_count > 0)
      ) as passed
    from scored s
  ),
  ranked as (
    select f.*,
      round(100.0 * f.effective_marks / nullif(f.max_marks, 0), 3) as percentage,
      row_number() over (
        partition by f.student_id, (not f.is_optional and not f.passed)
        order by f.effective_marks / nullif(f.max_marks, 0), f.exam_subject_id
      ) as fail_rank,
      row_number() over (
        partition by f.student_id, (f.is_optional and f.passed)
        order by f.effective_marks / nullif(f.max_marks, 0) desc, f.exam_subject_id
      ) as opt_rank
    from flagged f
  ),
  swaps as (
    select
      r.student_id,
      case when c.opt_replaces then least(
        count(*) filter (where not r.is_optional and not r.passed),
        count(*) filter (where r.is_optional and r.passed)
      ) else 0 end as substitutions
    from ranked r cross join cfg c
    group by r.student_id, c.opt_replaces
  ),
  pooled as (
    select r.*,
      s.substitutions,
      case
        when r.is_optional then (r.passed and r.opt_rank <= s.substitutions)
        else not (not r.passed and r.fail_rank <= s.substitutions)
      end as in_pool
    from ranked r
    join swaps s on s.student_id = r.student_id
  ),
  best as (
    select p.*,
      row_number() over (
        partition by p.student_id, p.in_pool
        order by p.effective_marks / nullif(p.max_marks, 0) desc, p.exam_subject_id
      ) as best_rank
    from pooled p
  )
  select
    b.student_id,
    b.exam_subject_id,
    b.subject_id,
    b.subject_code,
    b.subject_name,
    b.max_marks,
    b.pass_marks,
    b.weight,
    b.is_optional,
    b.marks_obtained,
    b.is_absent,
    b.entered,
    b.grace_marks,
    b.effective_marks,
    b.percentage,
    b.passed,
    (
      b.in_pool
      and (c.agg_method <> 'best_of' or c.best_of is null or b.best_rank <= c.best_of)
    ) as counted,
    b.component_detail,
    nullif(concat_ws(
      '; ',
      case when b.grace_marks > 0
        then 'Grace of ' || public.format_quantity(b.grace_marks) || ' applied' end,
      case when b.short_count > 0 and b.comp_must_pass
        then 'Below the minimum in ' || b.short_names end,
      -- Said out loud rather than left silent: a minimum that is recorded and
      -- not applied is exactly the sort of thing a school discovers from a
      -- parent.
      case when b.short_count > 0 and not b.comp_must_pass
        then 'Below the minimum in ' || b.short_names || ', which this scheme does not enforce' end,
      case when not b.is_optional and not b.in_pool
        then 'Replaced by an additional subject' end,
      case when b.is_optional and b.in_pool
        then 'Counted in place of a failed subject' end,
      case when b.in_pool and c.agg_method = 'best_of' and c.best_of is not null
             and b.best_rank > c.best_of
        then 'Dropped by best-of-' || c.best_of::text end,
      case when b.is_absent then 'Absent' end,
      case when not b.entered and not b.is_absent then 'Not marked yet' end
    ), '') as note
  from best b cross join cfg c
  order by b.student_id, b.is_optional, b.subject_code
$$;

create or replace function public.exams_enter_marks(
  p_exam_subject_id uuid,
  p_entries jsonb
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_paper public.exam_subjects;
  v_exam public.exams;
  v_components integer;
  v_written integer := 0;
  v_whole integer;
  v_parts integer;
  v_orphans integer;
  v_not_taking integer;
  v_not_taking_name text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_paper from public.exam_subjects es
  where es.tenant_id = v_tenant_id and es.id = p_exam_subject_id;

  if v_paper.id is null then
    raise exception 'That paper does not exist';
  end if;

  select * into v_exam from public.exams e where e.id = v_paper.exam_id;

  -- A published result is what a parent has already been shown. Changing the
  -- marks underneath it would leave the frozen `exam_results` row disagreeing
  -- with the marks it was computed from, which is exactly the drift freezing
  -- exists to prevent.
  if v_exam.status = 'published' then
    raise exception 'This exam is published. Unpublish it before changing marks.';
  end if;

  select count(*) into v_components
  from public.exam_components ec where ec.exam_subject_id = v_paper.id;

  -- A CTE rather than a temporary table, for the same reason as
  -- `exams_set_components`: a temporary table cannot be created twice in one
  -- transaction, and nothing about this function should make it un-retryable.
  with entries as (
    select
      (e ->> 'student_id')::uuid                      as student_id,
      nullif(e ->> 'exam_component_id', '')::uuid     as exam_component_id
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  )
  select
    count(*) filter (where en.exam_component_id is null),
    count(*) filter (where en.exam_component_id is not null),
    count(*) filter (
      where en.exam_component_id is not null
        and not exists (
          select 1 from public.exam_components ec
          where ec.id = en.exam_component_id and ec.exam_subject_id = v_paper.id
        )
    )
  into v_whole, v_parts, v_orphans
  from entries en;

  if v_components > 0 then
    if v_whole > 0 then
      raise exception 'This paper is split into % parts, so every mark has to say which part it is for.', v_components;
    end if;
    if v_orphans > 0 then
      raise exception 'A mark was sent for a part that does not belong to this paper';
    end if;
  elsif v_parts > 0 then
    raise exception 'This paper is not split into parts, so a mark cannot be against one.';
  end if;

  -- A mark for a child who does not take this subject would be written and
  -- then ignored by every result, silently (0285). Refused here, naming them.
  select count(*), min(p.first_name || ' ' || p.last_name)
  into v_not_taking, v_not_taking_name
  from (
    select distinct (e ->> 'student_id')::uuid as student_id
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
  ) en
  join public.students st on st.id = en.student_id
  join public.people p on p.id = st.person_id
  where not public.student_takes_subject(
    en.student_id, v_paper.subject_id, v_paper.session_id,
    (select sec.class_level_id from public.sections sec where sec.id = v_paper.section_id)
  );

  if v_not_taking > 0 then
    raise exception '% did not choose this subject%, so there is no mark to enter. Their elective choices are on My subjects, or the office can change them.',
      v_not_taking_name,
      case when v_not_taking > 1 then format(' (nor did %s others)', v_not_taking - 1) else '' end;
  end if;

  if v_components > 0 then
    with entries as (
      select
        (e ->> 'student_id')::uuid                      as student_id,
        nullif(e ->> 'exam_component_id', '')::uuid     as exam_component_id,
        nullif(e ->> 'marks_obtained', '')::numeric     as marks_obtained,
        coalesce((e ->> 'is_absent')::boolean, false)   as is_absent,
        nullif(e ->> 'remarks', '')                     as remarks
      from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
    )
    insert into public.marks (
      tenant_id, session_id, exam_subject_id, student_id,
      exam_component_id, component_max_marks,
      marks_obtained, is_absent, remarks, max_marks, entered_by
    )
    select
      v_tenant_id, v_paper.session_id, v_paper.id, en.student_id,
      ec.id, ec.max_marks,
      -- An absent student has no mark, whatever the payload said. Enforced here
      -- as well as by `marks_absent_chk`, so the caller gets a saved row rather
      -- than a constraint violation for a combination the UI can produce.
      case when en.is_absent then null else en.marks_obtained end,
      en.is_absent,
      en.remarks,
      v_paper.max_marks,
      auth.uid()
    from entries en
    join public.exam_components ec on ec.id = en.exam_component_id
    on conflict (tenant_id, exam_subject_id, student_id, exam_component_id)
      where exam_component_id is not null
    do update set
      marks_obtained = excluded.marks_obtained,
      is_absent = excluded.is_absent,
      remarks = excluded.remarks,
      entered_by = excluded.entered_by;
  else
    with entries as (
      select
        (e ->> 'student_id')::uuid                      as student_id,
        nullif(e ->> 'marks_obtained', '')::numeric     as marks_obtained,
        coalesce((e ->> 'is_absent')::boolean, false)   as is_absent,
        nullif(e ->> 'remarks', '')                     as remarks
      from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
    )
    insert into public.marks (
      tenant_id, session_id, exam_subject_id, student_id,
      marks_obtained, is_absent, remarks, max_marks, entered_by
    )
    select
      v_tenant_id, v_paper.session_id, v_paper.id, en.student_id,
      case when en.is_absent then null else en.marks_obtained end,
      en.is_absent,
      en.remarks,
      v_paper.max_marks,
      auth.uid()
    from entries en
    on conflict (tenant_id, exam_subject_id, student_id)
      where exam_component_id is null
    do update set
      marks_obtained = excluded.marks_obtained,
      is_absent = excluded.is_absent,
      remarks = excluded.remarks,
      entered_by = excluded.entered_by;
  end if;

  get diagnostics v_written = row_count;

  return v_written;
end;
$$;
