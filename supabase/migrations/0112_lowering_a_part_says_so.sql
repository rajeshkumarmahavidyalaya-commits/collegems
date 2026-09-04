-- ---------------------------------------------------------------------------
-- Lowering a part below a mark already awarded says so
-- ---------------------------------------------------------------------------
--
-- The refusal itself was already there, and it came from the right place: the
-- composite foreign key cascades a new `max_marks` onto every mark row, and
-- `marks_within_max_chk` re-evaluates and fails. That is the enforcement, and
-- it is not moving.
--
-- What a person saw was:
--
--   new row for relation "marks" violates check constraint "marks_within_max_chk"
--   DETAIL: Failing row contains (e6ce1263-..., 2d15d1fc-..., 24.00, f, null, ...)
--
-- which is the exact case CLAUDE.md's own rule anticipates -- "add a plain
-- check ahead of it in the write function if the raw foreign-key error would be
-- unreadable, for the message, not for the enforcement". So this adds one query
-- and one sentence, and changes nothing about what is or is not allowed.

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
  v_lowered text;
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

  perform pg_advisory_xact_lock(hashtextextended(p_exam_subject_id::text, 0));

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

  -- The sentence for the cascade's refusal. The foreign key would stop this on
  -- its own; what it would not do is name the part or the mark.
  with payload as (
    select
      btrim(c ->> 'code')          as code,
      (c ->> 'max_marks')::numeric as max_marks
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
  )
  select string_agg(
    ec.name || ' (' || public.format_quantity(hi.top) || ' already awarded)',
    ', ' order by ec.position, ec.code
  )
  into v_lowered
  from public.exam_components ec
  join payload p on p.code = ec.code
  cross join lateral (
    select max(m.marks_obtained) as top from public.marks m where m.exam_component_id = ec.id
  ) hi
  where ec.exam_subject_id = v_paper.id
    and hi.top is not null
    and p.max_marks < hi.top;
  if v_lowered is not null then
    raise exception 'A part cannot be lowered below a mark already awarded in it: %.', v_lowered;
  end if;

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
