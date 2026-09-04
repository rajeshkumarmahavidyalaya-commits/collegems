-- ---------------------------------------------------------------------------
-- Bulk import — validate, and apply what the rows say
-- ---------------------------------------------------------------------------

-- Criticise a row and return sentences. Lives in Postgres, next to the tables
-- it checks against, for the reason `grading_scheme_problems` does: the thing
-- that judges a row and the thing that writes it must not drift.
--
-- It re-checks **every** row every time, and that is the point -- a person
-- edits row 14 and rows 1 to 40 are re-judged, so a duplicate admission number
-- introduced by the fix is caught before apply rather than during it.
create or replace function public.import_validate_run(p_run_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_run public.import_runs;
  v_ready integer;
begin
  select * into v_run from public.import_runs r where r.id = p_run_id;
  if v_run.id is null then
    raise exception 'That import does not exist';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'This import was already %', v_run.status;
  end if;

  update public.import_rows r
  set problems = coalesce(p.list, '{}'::text[])
  from (
    select
      ir.id,
      array_remove(array[
        case when btrim(coalesce(ir.first_name, '')) = ''
             then 'A first name is required' end,
        case when btrim(coalesce(ir.admission_number, '')) = ''
             then 'An admission number is required' end,
        -- Two different duplicate checks, because they fail for two different
        -- reasons and a person fixes them differently.
        case when btrim(coalesce(ir.admission_number, '')) <> '' and exists (
               select 1 from public.students s
               where s.tenant_id = ir.tenant_id
                 and lower(s.admission_number) = lower(btrim(ir.admission_number))
             )
             then 'Admission number ' || btrim(ir.admission_number)
                  || ' already belongs to a student in the school' end,
        case when btrim(coalesce(ir.admission_number, '')) <> '' and exists (
               select 1 from public.import_rows other
               where other.run_id = ir.run_id
                 and other.id <> ir.id
                 and not other.skipped
                 and lower(btrim(coalesce(other.admission_number, ''))) = lower(btrim(ir.admission_number))
             )
             then 'Admission number ' || btrim(ir.admission_number)
                  || ' appears more than once in this file' end,
        case when ir.gender is not null
                  and ir.gender not in ('male', 'female', 'other', 'undisclosed')
             then 'Gender should be male, female, other or undisclosed' end,
        case when ir.date_of_birth is not null and ir.date_of_birth > current_date
             then 'The date of birth is in the future' end,
        case when ir.section_id is null
             then 'No class matched — pick one, or the child is admitted without a class' end,
        case when btrim(coalesce(ir.guardian_name, '')) <> ''
                  and btrim(coalesce(ir.guardian_phone, '')) = ''
             then 'A guardian with no phone number cannot be contacted' end
      ], null) as list
    from public.import_rows ir
    where ir.run_id = p_run_id and not ir.skipped
  ) p
  where r.id = p.id;

  -- A skipped row is not judged: the person has already decided it is not going
  -- in, and leaving stale problems on it makes the count of what is wrong lie.
  update public.import_rows r
  set problems = '{}'::text[]
  where r.run_id = p_run_id and r.skipped and array_length(r.problems, 1) > 0;

  select count(*)::integer into v_ready
  from public.import_rows r
  where r.run_id = p_run_id
    and not r.skipped
    and array_length(r.problems, 1) is null;

  return v_ready;
end;
$$;

revoke all on function public.import_validate_run(uuid) from public, anon;
grant execute on function public.import_validate_run(uuid) to authenticated;

-- What the run looks like now: the numbers somebody needs before pressing
-- apply, and the reason the button says what it says.
create or replace function public.import_run_summary(p_run_id uuid)
returns table (
  total integer,
  ready integer,
  with_problems integer,
  skipped integer,
  applied integer,
  failed integer
)
language sql
stable
set search_path = public, extensions
as $$
  select
    count(*)::integer,
    count(*) filter (where not skipped and array_length(problems, 1) is null
                       and applied_student_id is null)::integer,
    count(*) filter (where not skipped and array_length(problems, 1) > 0)::integer,
    count(*) filter (where skipped)::integer,
    count(*) filter (where applied_student_id is not null)::integer,
    count(*) filter (where apply_error is not null)::integer
  from public.import_rows
  where run_id = p_run_id
$$;

revoke all on function public.import_run_summary(uuid) from public, anon;
grant execute on function public.import_run_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Apply
-- ---------------------------------------------------------------------------

-- Writes **what the rows say**, not what the file said -- rule 13's central
-- requirement. It calls `admit_student`, so an imported child goes through the
-- same one admission path as a child typed in by hand or admitted from an
-- enquiry.
--
-- Idempotent on `applied_student_id`: a row that already produced a student is
-- skipped, so a retry after a timeout tops up rather than duplicating. A row
-- that fails keeps its reason in `apply_error` instead of aborting the batch --
-- the alternative, stopping at the first failure, leaves the office with half
-- an import and no list of what did not go in.
--
-- Bounded by the 500-row cap on the run itself (rule 7).
create or replace function public.import_apply_run(p_run_id uuid)
returns table (applied integer, failed integer)
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_run public.import_runs;
  v_row record;
  v_student public.students;
  v_applied integer := 0;
  v_failed integer := 0;
  v_ready integer;
begin
  select * into v_run from public.import_runs r where r.id = p_run_id;
  if v_run.id is null then
    raise exception 'That import does not exist';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'This import was already %', v_run.status;
  end if;

  -- Re-validate first. Between the last check and this click somebody may have
  -- admitted a student by hand with one of these admission numbers.
  v_ready := public.import_validate_run(p_run_id);
  if v_ready = 0 then
    raise exception 'No row is ready to import. Fix the problems listed, or skip those rows.';
  end if;

  for v_row in
    select * from public.import_rows r
    where r.run_id = p_run_id
      and not r.skipped
      and array_length(r.problems, 1) is null
      and r.applied_student_id is null
    order by r.line_number
  loop
    begin
      v_student := public.admit_student(
        jsonb_build_object(
          'first_name', v_row.first_name,
          'middle_name', v_row.middle_name,
          'last_name', coalesce(v_row.last_name, ''),
          'date_of_birth', v_row.date_of_birth,
          'gender', v_row.gender,
          'phone', v_row.phone,
          'email', v_row.email,
          'address_line1', v_row.address_line1,
          'city', v_row.city
        ),
        btrim(v_row.admission_number),
        coalesce(v_row.admission_date, current_date),
        v_row.section_id,
        v_row.roll_number
      );

      update public.import_rows
      set applied_student_id = v_student.id, apply_error = null
      where id = v_row.id;

      v_applied := v_applied + 1;
    exception when others then
      -- The row keeps its reason and the batch carries on. A partial import the
      -- office can see and finish beats an all-or-nothing one that fails on
      -- line 340 and tells them nothing.
      update public.import_rows
      set apply_error = sqlerrm
      where id = v_row.id;

      v_failed := v_failed + 1;
    end;
  end loop;

  -- One UPDATE on the parent. The cascade rewrites every row's `run_status`
  -- and the draft-only write policy stops matching -- so what was imported
  -- becomes a permanent record rather than a scratchpad.
  update public.import_runs
  set status = 'applied',
      applied_at = now(),
      applied_by = auth.uid(),
      applied_count = v_applied
  where id = p_run_id;

  return query select v_applied, v_failed;
end;
$$;

revoke all on function public.import_apply_run(uuid) from public, anon;
grant execute on function public.import_apply_run(uuid) to authenticated;

create or replace function public.import_discard_run(p_run_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_rows integer;
begin
  update public.import_runs
  set status = 'discarded'
  where id = p_run_id and status = 'draft';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'That import does not exist, or has already been applied';
  end if;
  return true;
end;
$$;

revoke all on function public.import_discard_run(uuid) from public, anon;
grant execute on function public.import_discard_run(uuid) to authenticated;

-- Match a class name from the file to a section, so the office does not pick
-- one per row. Deliberately forgiving about spacing and case, and deliberately
-- **not** forgiving about ambiguity: two sections matching means the row keeps
-- no section and says so, rather than guessing.
create or replace function public.import_match_section(p_label text)
returns uuid
language sql
stable
set search_path = public, extensions
as $$
  with candidates as (
    select s.id
    from public.sections s
    join public.class_levels cl on cl.id = s.class_level_id
    where s.session_id = public.current_session_id(public.current_tenant_id())
      and regexp_replace(lower(cl.name || ' ' || s.name), '\s+', '', 'g')
          = regexp_replace(lower(coalesce(p_label, '')), '\s+', '', 'g')
  )
  select id from candidates
  -- Exactly one, or nothing. A guess here puts a child in the wrong class.
  where (select count(*) from candidates) = 1
$$;

revoke all on function public.import_match_section(text) from public, anon;
grant execute on function public.import_match_section(text) to authenticated;
