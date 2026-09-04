-- ---------------------------------------------------------------------------
-- The engine learns that a paper can have parts
-- ---------------------------------------------------------------------------
--
-- EVALUATION ORDER, which is part of the contract (rule 12) and is pinned to
-- exact numbers in tests/exams/component-engine.test.ts:
--
--   0. components   sum the parts into the paper's raw mark
--   1. component    check each part against its own minimum, on the RAW mark
--      minimums
--   2. grace        add the allowance to the paper total
--   3. pass         paper total (after grace) >= the paper's pass mark, AND
--                   no unmet component minimum if the scheme requires each
--   4. substitution an additional subject replaces a failed compulsory one
--   5. best-of      keep the best N of what is left
--
-- Step 1 deliberately runs before step 2 and reads the raw mark: grace is an
-- allowance a school grants on an aggregate that just missed, whereas a
-- component minimum is a competency gate -- "you must be able to do the
-- practical". A school that wants leniency there lowers the component's
-- `pass_marks`, which is one number in one place and says what it means.
--
-- Whether a shortfall in a part fails the whole paper is `must_pass_each`, and
-- it defaults to FALSE. That is not the usual conservative-default reasoning of
-- rule 12 -- it is narrower. Defaulting it to true would silently change the
-- meaning of every scheme already saved, failing children who had passed;
-- a false default changes nothing and is a no-op anyway while the components'
-- own `pass_marks` are left at zero. What makes the default honest is that
-- `exams_problems()` says out loud when a paper carries minimums the scheme
-- will not enforce.

-- ---------------------------------------------------------------------------
-- Per student, per paper, after every rule
-- ---------------------------------------------------------------------------

-- Return type changes (one new column), so it has to be dropped rather than
-- replaced. Nothing depends on it structurally -- the callers are other
-- functions, which Postgres does not track -- but every one of them is
-- recreated below where its output changes.
drop function if exists public.exams_subject_breakdown(uuid, uuid);

create function public.exams_subject_breakdown(
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

revoke all on function public.exams_subject_breakdown(uuid, uuid) from public, anon;
grant execute on function public.exams_subject_breakdown(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The aggregate, carrying the split down onto the card
-- ---------------------------------------------------------------------------

-- Identical to 0047 apart from one key in `detail`. It has to be here: `detail`
-- is what `exam_results` freezes at publish, so a report card printed from a
-- frozen row can only show "Theory 55/70, Practical 24/30" if the split was in
-- the jsonb when the row was written.
create or replace function public.exams_result_sheet(
  p_exam_id uuid,
  p_section_id uuid default null
)
returns table (
  student_id uuid,
  admission_number text,
  student_name text,
  roll_number text,
  section_label text,
  total_marks numeric,
  max_marks numeric,
  percentage numeric,
  grade text,
  grade_point numeric,
  result text,
  subjects_counted integer,
  subjects_failed integer,
  subjects_unmarked integer,
  detail jsonb
)
language sql
stable
set search_path = public, extensions
as $$
  with rules as (select public.exams_rules_for(p_exam_id) as r),
  breakdown as (
    select * from public.exams_subject_breakdown(p_exam_id, null)
  ),
  agg as (
    select
      b.student_id,
      sum(b.effective_marks * b.weight) filter (where b.counted) as total_weighted,
      sum(b.max_marks * b.weight) filter (where b.counted)       as max_weighted,
      count(*) filter (where b.counted)::integer                 as subjects_counted,
      count(*) filter (where b.counted and not b.passed)::integer as subjects_failed,
      count(*) filter (where b.counted and not b.entered and not b.is_absent)::integer as subjects_unmarked,
      jsonb_agg(
        jsonb_build_object(
          'subject', b.subject_name,
          'code', b.subject_code,
          'max', b.max_marks,
          'pass', b.pass_marks,
          'obtained', b.marks_obtained,
          'grace', b.grace_marks,
          'effective', b.effective_marks,
          'percent', b.percentage,
          'passed', b.passed,
          'counted', b.counted,
          'optional', b.is_optional,
          'absent', b.is_absent,
          'components', b.component_detail,
          'note', b.note
        )
        order by b.is_optional, b.subject_code
      ) as detail
    from breakdown b
    group by b.student_id
  ),
  scored as (
    select
      a.*,
      round(100.0 * a.total_weighted / nullif(a.max_weighted, 0), 3) as percentage
    from agg a
  )
  select
    s.student_id,
    st.admission_number,
    (p.first_name || ' ' || p.last_name)::text,
    en.roll_number,
    (cl.name || ' ' || sec.name)::text,
    round(s.total_weighted, 2),
    round(s.max_weighted, 2),
    s.percentage,
    g.code,
    g.point,
    case
      when s.subjects_unmarked > 0 then 'incomplete'
      when s.subjects_failed > 0 then 'fail'
      when s.percentage < coalesce((r.r -> 'pass' ->> 'aggregate_min_percent')::numeric, 0)
        then 'fail'
      else 'pass'
    end,
    s.subjects_counted,
    s.subjects_failed,
    s.subjects_unmarked,
    s.detail
  from scored s
  cross join rules r
  join public.students st on st.id = s.student_id
  join public.people p on p.id = st.person_id
  join public.enrolments en
    on en.student_id = s.student_id
   and en.session_id = (select e.session_id from public.exams e where e.id = p_exam_id)
   and en.status = 'active'
  join public.sections sec on sec.id = en.section_id
  join public.class_levels cl on cl.id = sec.class_level_id
  left join lateral public.grading_grade_for(r.r, s.percentage) g on true
  where p_section_id is null or en.section_id = p_section_id
  order by cl.name, sec.name, en.roll_number, p.first_name
$$;

revoke all on function public.exams_result_sheet(uuid, uuid) from public, anon;
grant execute on function public.exams_result_sheet(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Defining the parts
-- ---------------------------------------------------------------------------

-- The whole set at once, because "the parts add up to the paper" is a rule
-- about several rows and no constraint sees a second row. Under an advisory
-- lock, with the numbers in the message, exactly as `hostel_allocate` counts
-- beds and `accounts_post_voucher` counts debits.
--
-- SECURITY INVOKER: `exam_components` has an admin policy and it is the real
-- gate. The explicit check below only exists so a non-admin gets a sentence
-- rather than a delete that silently matches nothing followed by an insert that
-- raises 42501.
create or replace function public.exams_set_components(
  p_exam_subject_id uuid,
  p_components jsonb
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_paper public.exam_subjects;
  v_exam public.exams;
  v_count integer;
  v_sum numeric;
  v_dupe text;
  v_bad_max text;
  v_bad_pass text;
  v_unnamed text;
  v_removed text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can change how a paper is split';
  end if;

  select * into v_paper from public.exam_subjects es
  where es.tenant_id = v_tenant_id and es.id = p_exam_subject_id;

  if v_paper.id is null then
    raise exception 'That paper does not exist';
  end if;

  select * into v_exam from public.exams e where e.id = v_paper.exam_id;

  if v_exam.status = 'published' then
    raise exception 'This exam is published. Unpublish it before changing how a paper is split.';
  end if;

  -- Serialise the whole replace, so two people editing the same paper cannot
  -- each see a set that adds up and leave one that does not.
  perform pg_advisory_xact_lock(hashtextextended(p_exam_subject_id::text, 0));

  -- One statement for every shape question the payload can fail, so the caller
  -- gets the first real problem rather than the first query that happened to
  -- run. A CTE rather than a temporary table: this function may be called twice
  -- in one transaction, and `create temporary table` cannot be.
  with payload as (
    select
      btrim(c ->> 'code')                                       as code,
      btrim(c ->> 'name')                                       as name,
      (c ->> 'max_marks')::numeric                              as max_marks,
      coalesce((c ->> 'pass_marks')::numeric, 0)                as pass_marks,
      coalesce((c ->> 'position')::integer, (ord - 1)::integer) as position
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality as t(c, ord)
  )
  select
    count(*),
    coalesce(sum(p.max_marks), 0),
    (select string_agg(d.code, ', ') from (select code from payload group by code having count(*) > 1) d),
    (select string_agg(x.name, ', ') from payload x where x.max_marks is null or x.max_marks <= 0),
    (select string_agg(x.name, ', ') from payload x where x.pass_marks > x.max_marks),
    (select string_agg(x.name, ', ') from payload x where x.code is null or x.code = '' or x.name is null or x.name = '')
  into v_count, v_sum, v_dupe, v_bad_max, v_bad_pass, v_unnamed
  from payload p;

  if v_count = 1 then
    raise exception 'A paper split into one part is a paper. Give it two or more parts, or none at all.';
  end if;

  if v_unnamed is not null then
    raise exception 'Every part needs a code and a name';
  end if;

  if v_dupe is not null then
    raise exception 'Two parts share the code %. Each part needs its own.', v_dupe;
  end if;

  if v_bad_max is not null then
    raise exception 'Each part needs a maximum above zero (%).', v_bad_max;
  end if;

  if v_bad_pass is not null then
    raise exception 'A part cannot need more marks to pass than it is out of (%).', v_bad_pass;
  end if;

  if v_count > 0 then
    if v_sum <> v_paper.max_marks then
      raise exception 'The parts add up to % but the paper is out of %, so they are % %.',
        public.format_quantity(v_sum),
        public.format_quantity(v_paper.max_marks),
        public.format_quantity(abs(v_sum - v_paper.max_marks)),
        case when v_sum < v_paper.max_marks then 'short' else 'over' end;
    end if;

    -- Splitting a paper that has already been marked as a whole would leave
    -- those marks unreadable by the engine. Deleting them silently is the worse
    -- of the two answers, so this refuses and says which screen to use.
    if exists (
      select 1 from public.marks m
      where m.exam_subject_id = v_paper.id and m.exam_component_id is null
        and (m.marks_obtained is not null or m.is_absent)
    ) then
      raise exception 'This paper already has marks entered against it as a whole. Clear the sheet before splitting it into parts.';
    end if;
  else
    if exists (
      select 1 from public.marks m
      where m.exam_subject_id = v_paper.id and m.exam_component_id is not null
        and (m.marks_obtained is not null or m.is_absent)
    ) then
      raise exception 'The parts of this paper already carry marks. Clear them before merging it back into one paper.';
    end if;
  end if;

  -- A part being taken away takes its marks with it, because the foreign key
  -- cascades. Naming it and refusing is the only way somebody finds out before
  -- rather than after.
  with payload as (
    select btrim(c ->> 'code') as code
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
  )
  select string_agg(ec.name, ', ' order by ec.position, ec.code) into v_removed
  from public.exam_components ec
  where ec.exam_subject_id = v_paper.id
    and not exists (select 1 from payload p where p.code = ec.code)
    and exists (
      select 1 from public.marks m
      where m.exam_component_id = ec.id and (m.marks_obtained is not null or m.is_absent)
    );
  if v_removed is not null then
    raise exception 'These parts already carry marks and cannot be removed: %.', v_removed;
  end if;

  with payload as (
    select btrim(c ->> 'code') as code
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
  )
  delete from public.exam_components ec
  where ec.exam_subject_id = v_paper.id
    and not exists (select 1 from payload p where p.code = ec.code);

  with payload as (
    select
      btrim(c ->> 'code')                                       as code,
      btrim(c ->> 'name')                                       as name,
      (c ->> 'max_marks')::numeric                              as max_marks,
      coalesce((c ->> 'pass_marks')::numeric, 0)                as pass_marks,
      coalesce((c ->> 'position')::integer, (ord - 1)::integer) as position
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality as t(c, ord)
  )
  insert into public.exam_components (
    tenant_id, session_id, exam_subject_id, code, name, max_marks, pass_marks, position
  )
  select
    v_tenant_id, v_paper.session_id, v_paper.id, p.code, p.name, p.max_marks, p.pass_marks, p.position
  from payload p
  on conflict (tenant_id, exam_subject_id, code) do update set
    name = excluded.name,
    max_marks = excluded.max_marks,
    pass_marks = excluded.pass_marks,
    position = excluded.position;

  return v_count;
end;
$$;

revoke all on function public.exams_set_components(uuid, jsonb) from public, anon;
grant execute on function public.exams_set_components(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- One paper's column, for the marks-entry grid
-- ---------------------------------------------------------------------------

drop function if exists public.exams_mark_sheet(uuid);

create function public.exams_mark_sheet(p_exam_subject_id uuid)
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
  order by en.roll_number nulls last, p.first_name
$$;

revoke all on function public.exams_mark_sheet(uuid) from public, anon;
grant execute on function public.exams_mark_sheet(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Entering marks
-- ---------------------------------------------------------------------------

-- Still one paper's whole grid in one call, and now that grid may be several
-- columns wide. Each entry names the part it is against, or names none for an
-- unsplit paper; a split paper's entire sheet -- forty students times three
-- parts -- is one atomic write, which is the whole reason this function exists.
--
-- SECURITY INVOKER: the subject-teacher policy on `marks` still decides which
-- papers this caller may touch. The function only adds atomicity.
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

revoke all on function public.exams_enter_marks(uuid, jsonb) from public, anon;
grant execute on function public.exams_enter_marks(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The critic, for a whole exam
-- ---------------------------------------------------------------------------

-- `grading_scheme_problems` criticises a rules document on its own. Some of the
-- things worth saying, though, are only true of a scheme *and* a set of papers
-- together -- a minimum recorded on a part that the scheme will never enforce
-- is the motivating one -- so this is the same idea one level up, and it
-- includes the scheme's own sentences so a screen has one list to render.
--
-- Sentences, not error codes, and in Postgres rather than the browser: the
-- thing that judges an exam lives next to the thing that evaluates it.
create or replace function public.exams_problems(p_exam_id uuid)
returns table (problem text)
language sql
stable
set search_path = public, extensions
as $$
  with e as (
    select ex.id, ex.tenant_id, public.exams_rules_for(ex.id) as rules
    from public.exams ex where ex.id = p_exam_id
  ),
  papers as (
    select
      es.id,
      es.max_marks,
      (cl.name || ' ' || sec.name || ' · ' || sub.name)::text as label
    from public.exam_subjects es
    join public.sections sec on sec.id = es.section_id
    join public.class_levels cl on cl.id = sec.class_level_id
    join public.subjects sub on sub.id = es.subject_id
    where es.exam_id = p_exam_id
  ),
  parts as (
    select
      p.id, p.label, p.max_marks,
      count(ec.id) as component_count,
      coalesce(sum(ec.max_marks), 0) as component_total,
      count(*) filter (where ec.pass_marks > 0) as with_minimum
    from papers p
    left join public.exam_components ec on ec.exam_subject_id = p.id
    group by p.id, p.label, p.max_marks
  )
  select gp.problem from e, lateral public.grading_scheme_problems(e.rules) gp

  union all
  -- Only reachable by writing `exam_components` directly, which an admin's RLS
  -- policy permits; `exams_set_components` refuses it. Worth saying anyway,
  -- because the paper would quietly mark out of the wrong total.
  select 'The parts of ' || pt.label || ' add up to ' || public.format_quantity(pt.component_total)
         || ' but the paper is out of ' || public.format_quantity(pt.max_marks)
         || ', so its marks will not add up either.'
  from parts pt
  where pt.component_count > 0 and pt.component_total <> pt.max_marks

  union all
  select 'The parts of ' || pt.label || ' carry a minimum of their own, but this exam''s scheme does not '
         || 'require passing each part, so those minimums will not fail anybody. Set '
         || '"components": { "must_pass_each": true } in the scheme if they should.'
  from parts pt, e
  where pt.with_minimum > 0
    and not coalesce((e.rules -> 'components' ->> 'must_pass_each')::boolean, false)

  union all
  select 'This exam''s scheme requires every part of a paper to be passed, but no paper in it is '
         || 'split into parts, so the rule will never do anything.'
  from e
  where coalesce((e.rules -> 'components' ->> 'must_pass_each')::boolean, false)
    and not exists (select 1 from parts where component_count > 0)

  union all
  -- The leftover state the engine deliberately ignores rather than adds in.
  select 'Marks exist against ' || pt.label || ' as a whole as well as against its parts. '
         || 'Only the parts are counted; the older marks are ignored.'
  from parts pt
  where pt.component_count > 0
    and exists (
      select 1 from public.marks m
      where m.exam_subject_id = pt.id and m.exam_component_id is null
        and (m.marks_obtained is not null or m.is_absent)
    )
$$;

revoke all on function public.exams_problems(uuid) from public, anon;
grant execute on function public.exams_problems(uuid) to authenticated;
