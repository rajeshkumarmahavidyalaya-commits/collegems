-- 0222 -- A value the boundary refuses, and a preview that never mentioned it.
--
-- `0221` gave the importer the guardian it had been collecting and dropping.
-- Probing that fix end to end -- two rows, one saying `mother` and one saying
-- `Grandmother` -- found the next thing along, and all three of its faces in
-- one screen:
--
--   validate ready                2 of 2
--   problems named by the preview none
--   apply                         2 applied, 0 failed
--   line 1 (mother)               student yes, guardians 1
--   line 2 (Grandmother)          student yes, guardians 0,
--     error: Student imported; the guardian could not be added: new row for
--            relation "guardian_student" violates check constraint
--            "guardian_student_relationship_check"
--
-- Rule 13's preview is *"editable rows a person can edit"*, and it told the
-- office the file was ready. The child went in, the mother did not, and the
-- sentence explaining why is a constraint name.
--
-- ## The asymmetry that says this was an oversight rather than a decision
--
-- `import_rows` collects three guardian columns and `gender`. **Gender has a
-- normaliser and a sentence; the relationship has neither** -- `normaliseGender`
-- turns `M`, `Male` and `boy` into `male`, and `import_validate_run` answers an
-- unrecognised one with *"Gender should be male, female, other or
-- undisclosed"*. The relationship column is passed through verbatim, so a
-- spreadsheet that says `Mother` -- which is what a spreadsheet says -- is
-- refused by a CHECK that only allows `mother`.
--
-- So case is normalised (the same value, differently typed) and an unknown word
-- is *named* rather than guessed at. `Grandmother` is not silently filed as
-- `guardian`: that is the office's decision, on a screen that now exists.
--
-- ## ...and the list of legal values now has exactly one owner
--
-- The convention says *"a list of valid values belongs in one place, and the
-- constraint is usually that place"* -- and then the gender message spells the
-- four words out a second time. They agree today, which is precisely
-- `library.fine_per_day`'s lesson: copies that agree cost nothing until the day
-- one of them has to change. `allowed_values()` reads the CHECK, so adding a
-- relationship stays one ALTER and every sentence about it follows.

begin;

-- ---------------------------------------------------------------------------
-- The constraint is the list, and this is how a sentence asks it
-- ---------------------------------------------------------------------------

-- Returns the literals of a `col = ANY (ARRAY[...])` CHECK, in the order the
-- constraint declares them -- which is the order a person wrote them in and so
-- the order to read them back out in.
--
-- Deliberately for **messages and validators**, never for enforcement: the
-- CHECK is the boundary and stays it. If a future constraint is reshaped past
-- what this recognises the array comes back empty, the validator stops naming
-- the problem, and the CHECK still refuses the write -- degrading to exactly
-- today's behaviour rather than to a hole.
create or replace function public.allowed_values(p_table regclass, p_column text)
returns text[]
language sql
stable
set search_path = 'public', 'extensions'
as $$
  with def as (
    select pg_catalog.pg_get_constraintdef(c.oid) as d
    from pg_catalog.pg_constraint c
    where c.conrelid = p_table
      and c.contype = 'c'
      and pg_catalog.pg_get_constraintdef(c.oid)
            like '%(' || p_column || ' = ANY (ARRAY[%'
    order by c.conname
    limit 1
  )
  select array_agg(m[1] order by ord)
  from def, lateral regexp_matches(def.d, '''([^'']*)''::text', 'g')
         with ordinality as t(m, ord);
$$;

comment on function public.allowed_values(regclass, text) is
  'The literals of a `col = ANY (ARRAY[...])` CHECK, so a validator and an '
  'error message can consult the constraint instead of carrying a second copy '
  'of the list. For wording, never for enforcement.';

-- `Intl.ListFormat` owns the conjunction, and there is no `Intl` in Postgres.
-- The word is English because every sentence it joins is: `import_rows.problems`
-- holds English strings written by this function's callers, and that is the
-- seam where translation would have to start -- named here rather than left as
-- an accident of this one helper.
create or replace function public.words_or(p_words text[])
returns text
language sql
immutable
as $$
  select case
    when p_words is null or cardinality(p_words) = 0 then ''
    when cardinality(p_words) = 1 then p_words[1]
    else array_to_string(p_words[1:cardinality(p_words) - 1], ', ')
         || ' or ' || p_words[cardinality(p_words)]
  end;
$$;

comment on function public.words_or(text[]) is
  'Joins words for a sentence: "a, b, c or d". English, because the problem '
  'sentences it appears in are.';

-- ---------------------------------------------------------------------------
-- The write function normalises case and refuses in words
-- ---------------------------------------------------------------------------

-- Two changes to `0221`'s body, both about the message rather than the rule:
--
--   * `lower()` on the relationship. `Mother` and `mother` are one value typed
--     two ways, and the column's domain is lower case.
--   * a `check_violation` handler that says which words are legal. Rule 4's
--     own note: *add a plain check ahead of it if the raw error would be
--     unreadable -- for the message, not for the enforcement.* Here the check
--     is behind rather than ahead, which costs nothing and cannot drift.
--
-- `guardian_student` carries exactly one CHECK (verified against
-- `pg_constraint`: `guardian_student_relationship_check` and nothing else), so
-- catching the class rather than the constraint name is not a net thrown wider
-- than the fish.
create or replace function public.guardian_link(
  p_guardian_id uuid,
  p_student_id uuid,
  p_relationship text default 'guardian',
  p_is_primary boolean default false,
  p_can_pickup boolean default true
)
returns public.guardian_student
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_link public.guardian_student;
  v_relationship text := coalesce(
    nullif(lower(btrim(coalesce(p_relationship, ''))), ''), 'guardian');
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not exists (select 1 from public.guardians g
                  where g.id = p_guardian_id and g.tenant_id = v_tenant_id) then
    raise exception 'No such guardian, or you cannot see them';
  end if;

  if not exists (select 1 from public.students s
                  where s.id = p_student_id and s.tenant_id = v_tenant_id) then
    raise exception 'No such student, or you cannot see them';
  end if;

  -- Demote the incumbent first, so the partial unique index never has to refuse
  -- this. Somebody naming a new primary contact has already decided; making
  -- them go and un-tick the old one is a rule the product is enforcing at the
  -- person instead of at the data.
  if p_is_primary then
    update public.guardian_student
    set is_primary = false
    where tenant_id = v_tenant_id
      and student_id = p_student_id
      and is_primary
      and guardian_id <> p_guardian_id;
  end if;

  begin
    insert into public.guardian_student (
      tenant_id, guardian_id, student_id, relationship, is_primary, can_pickup)
    values (
      v_tenant_id, p_guardian_id, p_student_id,
      v_relationship,
      coalesce(p_is_primary, false),
      coalesce(p_can_pickup, true))
    -- Linking somebody who is already linked is an edit, not an error: the
    -- office reaching for "add" when they meant "change the relationship"
    -- should get what they meant.
    on conflict (tenant_id, guardian_id, student_id) do update
      set relationship = excluded.relationship,
          is_primary   = excluded.is_primary,
          can_pickup   = excluded.can_pickup
    returning * into v_link;
  exception when check_violation then
    raise exception '"%" is not a relationship this product records. Use %.',
      btrim(coalesce(p_relationship, '')),
      public.words_or(public.allowed_values('public.guardian_student', 'relationship'));
  end;

  return v_link;
end;
$$;

comment on function public.guardian_link(uuid, uuid, text, boolean, boolean) is
  'Links an existing guardian to a child -- which is what a sibling is (rule 5). '
  'Upserts, because "add" when you meant "change the relationship" should do '
  'what you meant. Demotes the incumbent primary rather than letting the unique '
  'index refuse the write, lower-cases the relationship, and turns the CHECK''s '
  'own refusal into a sentence naming the words it accepts.';

-- ---------------------------------------------------------------------------
-- ...and the preview names it before anybody presses Apply
-- ---------------------------------------------------------------------------

-- The handler above is the last line of defence and is the wrong place to meet
-- this: by then the child is imported and the guardian is not, so the office is
-- reading an error about a row they can no longer fix in the preview. Rule 13
-- puts it one step earlier, where the rows are still editable.
--
-- Both value lists now come from `allowed_values()`, resolved **once** into a
-- variable rather than per row -- a catalogue lookup inside a `case` in an
-- `update ... from` runs for every line of the spreadsheet.
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
        case when btrim(coalesce(ir.guardian_name, '')) <> ''
                  and btrim(coalesce(ir.guardian_phone, '')) = ''
             then 'A guardian with no phone number cannot be contacted' end,
        -- Only when there is a guardian to record it about: a relationship
        -- typed against a blank guardian name is a column nobody filled in,
        -- not a problem with this child.
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

comment on function public.import_validate_run(uuid) is
  'Re-judges every row of a draft import and returns how many are ready. Since '
  '0222 it also names a guardian relationship the database will refuse, before '
  'the child is imported without their mother.';

commit;
