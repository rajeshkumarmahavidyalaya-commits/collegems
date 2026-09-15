-- 0236 -- One spreadsheet, two contact columns, two different people.
--
-- The roadmap said *"302 active students, one email between them"* and filed it
-- under office work: somebody has to type them in. Reading the importer first —
-- because 302 of 302 students arrived through it — says otherwise.
--
-- ## The bare `Phone` column and the bare `Email` column go to different people
--
-- `IMPORT_COLUMNS` matches a heading against a list of aliases:
--
--     guardianPhone   "guardian phone", "parent phone", **"phone"**, "mobile", "contact"
--     email           **"email"**, "e-mail"                        → the student
--
-- A school roll has one *Phone* column and one *Email* column, and they are the
-- same person's: the parent's. The importer put the number on the guardian and
-- the address on the **child** — who, on the row above it, has a date of birth
-- in 2018.
--
-- > **Two contact columns of one spreadsheet must land on one person.** Which
-- > person is a judgement call; that they agree is not.
--
-- And the consequence is exactly the thing `0227`–`0233` were built for: the
-- guardian, who is the one who will actually sign in, ends an import with a
-- phone and **no email**, so an email invitation cannot reach them; while the
-- child holds an address that no invitation will ever be sent to, because a
-- student login needs the student's own invitation and nobody creates one.
--
-- ## The write path was ready and the caller never filled it in
--
-- `guardian_add` has read `p_person ->> 'email'` since `0221`. `import_apply_run`
-- builds that jsonb with `first_name`, `last_name` and `phone`, and stops. So
-- this is `0224`'s shape a second time — a column the schema was waiting for,
-- and a caller that never passed it — rather than a missing feature.
--
-- ## …and a third column nothing has ever written
--
-- `import_rows.phone` exists, `import_apply_run` passes it to `admit_student`
-- as the student's own number, and **the insert in `actions.ts` never fills
-- it**: there is no student-phone column in `IMPORT_COLUMNS` at all. A read of
-- a column with no writer, which is `library_waive_staff_fine`'s `p_note`
-- wearing a table. It gets a writer here rather than being deleted, because
-- this product's first customer is a *mahavidyalaya* — a college, whose
-- students have their own phones and their own addresses, and for whom a
-- student login is the ordinary case rather than the exception.
--
-- ## What this deliberately does not do
--
-- **It does not refuse an import for want of an email.** A school whose roll
-- has no addresses at all must still be able to load its children; `0235`'s
-- report already names every child left without one, per state, the moment the
-- import finishes. The importer collects what the spreadsheet has; the report
-- says who is left.
--
-- **It does not add an inline editor for the new columns.** Rule 13's preview
-- is editable where a row is *wrong*; a missing address is not wrong, and the
-- guardian editor on `/students/[id]` has existed since `0221`.

begin;

alter table public.import_rows
  add column if not exists guardian_email text;

comment on column public.import_rows.guardian_email is
  'The guardian''s email. The bare "Email" heading of a school roll lands here '
  'and not on the child, because the bare "Phone" heading already lands on the '
  'guardian and one spreadsheet''s two contact columns are one person''s.';

comment on column public.import_rows.phone is
  'The student''s own phone. Read by import_apply_run since the module shipped '
  'and written by nothing until 0236 -- a college student has their own number, '
  'and a school child''s row simply leaves it empty.';

-- ---------------------------------------------------------------------------
-- Validation: a guardian needs a way to be reached, not a phone specifically
-- ---------------------------------------------------------------------------

create or replace function public.import_validate_run(p_run_id uuid)
returns integer
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_run public.import_runs;
  v_ready integer;
  v_genders text[] := public.allowed_values('public.people', 'gender');
  v_relationships text[] := public.allowed_values('public.guardian_student', 'relationship');
  -- Deliberately loose. The job is to catch `n/a`, `-` and `not given`, which
  -- is what a spreadsheet column actually contains when it is empty, not to
  -- adjudicate RFC 5322 -- and `people.email` has no CHECK, so without this a
  -- non-address is stored and every invitation to it fails one at a time.
  v_email constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
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
                  and cardinality(v_genders) > 0
                  and ir.gender <> all (v_genders)
             then 'Gender should be ' || public.words_or(v_genders) end,
        case when ir.date_of_birth is not null and ir.date_of_birth > current_date
             then 'The date of birth is in the future' end,
        case when ir.section_id is null
             then 'No class matched — pick one, or the child is admitted without a class' end,
        -- A phone **or** an email. The old rule said a phone, which was right
        -- while a phone was the only thing collected; an email-only guardian
        -- is contactable, and 0233 made the invitation go by both.
        case when btrim(coalesce(ir.guardian_name, '')) <> ''
                  and btrim(coalesce(ir.guardian_phone, '')) = ''
                  and btrim(coalesce(ir.guardian_email, '')) = ''
             then 'A guardian with no phone number and no email cannot be contacted' end,
        case when btrim(coalesce(ir.guardian_email, '')) <> ''
                  and btrim(ir.guardian_email) !~ v_email
             then '"' || btrim(ir.guardian_email)
                  || '" is not an email address, so no invitation could reach it' end,
        case when btrim(coalesce(ir.email, '')) <> ''
                  and btrim(ir.email) !~ v_email
             then '"' || btrim(ir.email)
                  || '" is not an email address' end,
        case when btrim(coalesce(ir.guardian_name, '')) <> ''
                  and btrim(coalesce(ir.guardian_relationship, '')) <> ''
                  and cardinality(v_relationships) > 0
                  and lower(btrim(ir.guardian_relationship)) <> all (v_relationships)
             then '"' || btrim(ir.guardian_relationship)
                  || '" is not a relationship this product records — use '
                  || public.words_or(v_relationships) end
      ], null) as list
    from public.import_rows ir
    where ir.run_id = p_run_id and not ir.skipped
  ) p
  where r.id = p.id;

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

-- ---------------------------------------------------------------------------
-- Apply: the guardian gets the address the spreadsheet gave them
-- ---------------------------------------------------------------------------

create or replace function public.import_apply_run(p_run_id uuid)
returns table (applied integer, failed integer)
language plpgsql
set search_path = 'public', 'extensions'
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
          -- The student's own, and only ever from a column that says so.
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

      -- The guardian, in its own block: a guardian that fails to save must not
      -- lose the child who is already in.
      if btrim(coalesce(v_row.guardian_name, '')) <> '' then
        begin
          perform public.guardian_add(
            v_student.id,
            jsonb_build_object(
              -- One name column in a spreadsheet is one name. Splitting on the
              -- first space would turn "Sunita Khanna" into a first and last
              -- name correctly and "Rakesh Kumar Malhotra" into a wrong one --
              -- so the whole string is the first name and the office fixes it
              -- on a screen that now exists.
              'first_name', btrim(v_row.guardian_name),
              'last_name', '',
              'phone', v_row.guardian_phone,
              -- `guardian_add` has read this key since 0221 and no caller ever
              -- set it. The whole of the family-login story runs through it.
              'email', v_row.guardian_email
            ),
            coalesce(nullif(btrim(coalesce(v_row.guardian_relationship, '')), ''), 'guardian'),
            null,
            -- The first guardian a child has is their primary contact. There is
            -- exactly one per imported row, so this is a statement of fact
            -- rather than a guess.
            true,
            true
          );
        exception when others then
          update public.import_rows
          set apply_error = 'Student imported; the guardian could not be added: ' || sqlerrm
          where id = v_row.id;
        end;
      end if;
    exception when others then
      update public.import_rows
      set apply_error = sqlerrm
      where id = v_row.id;

      v_failed := v_failed + 1;
    end;
  end loop;

  update public.import_runs
  set status = 'applied',
      applied_at = now(),
      applied_by = auth.uid(),
      applied_count = v_applied
  where id = p_run_id;

  return query select v_applied, v_failed;
end;
$$;

commit;
