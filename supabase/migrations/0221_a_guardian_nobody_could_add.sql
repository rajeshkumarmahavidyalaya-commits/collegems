-- 0221 -- The guardian write path, and the import that threw one away.
--
-- `guardian_student` decides which family sees which child. Every family-facing
-- screen in this product -- the fee account, the timetable, `/arrangements`,
-- the absence notice, the whole mobile contract -- resolves through it. And
-- **nothing in the application could create a row in it.**
--
-- Swept before writing this: `guardians` and `guardian_student` appear in
-- `src/` nowhere but the generated types, and of the 295 functions in `public`,
-- **eleven mention `guardian_student` and all eleven are readers.** The 555
-- links on the demo college came from the seed.
--
-- ## The live half, which is worse than the missing half
--
-- The bulk import collects a guardian. `import_validate_run` even refuses a row
-- for it: *"A guardian with no phone number cannot be contacted"*. Then
-- `import_apply_run` calls `admit_student` and **never mentions a guardian
-- again** -- 0 occurrences of the word in its whole body.
--
-- Measured on the demo college, and the numbers meet in the middle:
--
--   import rows naming a guardian     3
--   students with no guardian         3   (of 303)
--   guardians created by the import   0
--
--   ADM-2026-001  Sunita Khanna    +919800002001   -> 0 guardians
--   ADM-2026-002  Rakesh Malhotra  +919800002002   -> 0 guardians
--   ADM-2026-006  Arjun Bhatia     (no phone)      -> 0 guardians
--
-- **A field collected, validated, and dropped** -- `0220`'s defect in a second
-- module, found because that one taught what to look for. The office typed a
-- mother's name and telephone number, the importer checked the number was
-- there, and the child arrived at a school that cannot contact anybody.
--
-- ## One definition, consulted by both
--
-- `guardian_add` is the only way a guardian is made, and `import_apply_run`
-- calls it. Rule 6's sentence about billing, applied to people: *one definition
-- of "what would this child be charged", consulted by everything -- a second
-- implementation is a second answer.* The importer and the office screen cannot
-- disagree about what a guardian is, because there is one of them.

begin;

-- ---------------------------------------------------------------------------
-- At most one primary guardian per child
-- ---------------------------------------------------------------------------

-- `is_primary` has been a bare boolean since `0003`, so nothing stopped a child
-- having three. `students/actions.ts` does `links.find((l) => l.is_primary)`
-- and the ID card does the same -- which means the *first row the join happens
-- to return*, and two screens could name different parents for one child.
--
-- Rule 4's second-row rule: no CHECK can see another row, so this is an index.
-- Partial, because `is_primary = false` may repeat freely -- a child has one
-- primary contact and any number of other guardians.
--
-- Verified clear before adding it: 0 children currently have two.
create unique index if not exists guardian_student_one_primary
  on public.guardian_student (tenant_id, student_id)
  where is_primary;

comment on index public.guardian_student_one_primary is
  'One primary guardian per child. `is_primary` was a bare boolean, so the two '
  'readers that pick "the primary one" were really picking whichever row the '
  'join returned first.';

-- ---------------------------------------------------------------------------
-- Making one
-- ---------------------------------------------------------------------------

-- `SECURITY INVOKER`, like `admit_student` and for the same reason: the write
-- policies on `people`, `guardians` and `guardian_student` are all
-- administrator-only, and running as the caller is what keeps that true. A
-- teacher calling this is refused by Postgres, not by a check in here.
--
-- **Promoting the new guardian to primary demotes the old one**, in the same
-- statement, because the index above would otherwise refuse the insert with
-- `23505` and the office would be told to go and un-tick a box somewhere else
-- first. The constraint is the boundary; this is the manners.
create or replace function public.guardian_add(
  p_student_id uuid,
  p_person jsonb,
  p_relationship text default 'guardian',
  p_occupation text default null,
  p_is_primary boolean default false,
  p_can_pickup boolean default true
)
returns public.guardians
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_person_id uuid;
  v_guardian public.guardians;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if coalesce(btrim(p_person ->> 'first_name'), '') = '' then
    raise exception 'A guardian needs a name';
  end if;

  if not exists (select 1 from public.students s
                  where s.id = p_student_id and s.tenant_id = v_tenant_id) then
    raise exception 'No such student, or you cannot see them';
  end if;

  insert into public.people (
    tenant_id, first_name, middle_name, last_name, date_of_birth, gender,
    blood_group, email, phone, address_line1, address_line2, city, state,
    postal_code, country
  )
  values (
    v_tenant_id,
    btrim(p_person ->> 'first_name'),
    nullif(btrim(coalesce(p_person ->> 'middle_name', '')), ''),
    coalesce(nullif(btrim(coalesce(p_person ->> 'last_name', '')), ''), ''),
    (nullif(btrim(coalesce(p_person ->> 'date_of_birth', '')), ''))::date,
    nullif(btrim(coalesce(p_person ->> 'gender', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'blood_group', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'email', '')), '')::citext,
    nullif(btrim(coalesce(p_person ->> 'phone', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'address_line1', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'address_line2', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'city', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'state', '')), ''),
    nullif(btrim(coalesce(p_person ->> 'postal_code', '')), ''),
    coalesce(nullif(btrim(coalesce(p_person ->> 'country', '')), ''), 'India')
  )
  returning id into v_person_id;

  insert into public.guardians (tenant_id, person_id, occupation)
  values (v_tenant_id, v_person_id, nullif(btrim(coalesce(p_occupation, '')), ''))
  returning * into v_guardian;

  perform public.guardian_link(
    v_guardian.id, p_student_id, p_relationship, p_is_primary, p_can_pickup);

  return v_guardian;
end;
$$;

comment on function public.guardian_add(uuid, jsonb, text, text, boolean, boolean) is
  'Creates a guardian and links them to one child, atomically. The only way a '
  'guardian is made -- the office screen and `import_apply_run` both call it, '
  'so they cannot disagree about what a guardian is.';

-- ---------------------------------------------------------------------------
-- ...and linking one who already exists, which is what siblings are
-- ---------------------------------------------------------------------------

-- Rule 5 lists sibling linking as one of the four things the identity model
-- exists to keep representable, and until now nothing could do it. A second
-- child of the same mother is **a second row in `guardian_student`**, not a
-- second guardian -- and creating a duplicate person would split her contact
-- details in two and leave one of them stale.
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

  insert into public.guardian_student (
    tenant_id, guardian_id, student_id, relationship, is_primary, can_pickup)
  values (
    v_tenant_id, p_guardian_id, p_student_id,
    coalesce(nullif(btrim(coalesce(p_relationship, '')), ''), 'guardian'),
    coalesce(p_is_primary, false),
    coalesce(p_can_pickup, true))
  -- Linking somebody who is already linked is an edit, not an error: the office
  -- reaching for "add" when they meant "change the relationship" should get
  -- what they meant.
  on conflict (tenant_id, guardian_id, student_id) do update
    set relationship = excluded.relationship,
        is_primary   = excluded.is_primary,
        can_pickup   = excluded.can_pickup
  returning * into v_link;

  return v_link;
end;
$$;

comment on function public.guardian_link(uuid, uuid, text, boolean, boolean) is
  'Links an existing guardian to a child -- which is what a sibling is (rule 5). '
  'Upserts, because "add" when you meant "change the relationship" should do '
  'what you meant. Demotes the incumbent primary rather than letting the unique '
  'index refuse the write.';

-- ---------------------------------------------------------------------------
-- Editing, and unlinking
-- ---------------------------------------------------------------------------

create or replace function public.guardian_update(
  p_guardian_id uuid,
  p_person jsonb,
  p_occupation text default null
)
returns public.guardians
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_guardian public.guardians;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_guardian from public.guardians g
  where g.id = p_guardian_id and g.tenant_id = v_tenant_id;

  if v_guardian.id is null then
    raise exception 'No such guardian, or you cannot see them';
  end if;

  if coalesce(btrim(p_person ->> 'first_name'), '') = '' then
    raise exception 'A guardian needs a name';
  end if;

  update public.people
  set first_name    = btrim(p_person ->> 'first_name'),
      middle_name   = nullif(btrim(coalesce(p_person ->> 'middle_name', '')), ''),
      last_name     = coalesce(nullif(btrim(coalesce(p_person ->> 'last_name', '')), ''), ''),
      email         = nullif(btrim(coalesce(p_person ->> 'email', '')), '')::citext,
      phone         = nullif(btrim(coalesce(p_person ->> 'phone', '')), ''),
      address_line1 = nullif(btrim(coalesce(p_person ->> 'address_line1', '')), ''),
      city          = nullif(btrim(coalesce(p_person ->> 'city', '')), ''),
      state         = nullif(btrim(coalesce(p_person ->> 'state', '')), '')
  where id = v_guardian.person_id and tenant_id = v_tenant_id;

  update public.guardians
  set occupation = nullif(btrim(coalesce(p_occupation, '')), '')
  where id = p_guardian_id
  returning * into v_guardian;

  return v_guardian;
end;
$$;

comment on function public.guardian_update(uuid, jsonb, text) is
  'Edits the person behind a guardian. One guardian may have several children, '
  'so this reaches every one of them -- which is the point of not duplicating a '
  'mother per child.';

-- Unlinks a guardian from one child. Deliberately does **not** delete the
-- guardian: they may have other children here, and a person who is nobody's
-- guardian any more is still the person who paid last year's fees. Same
-- instinct as `student_exit` ending a bus seat rather than cancelling it.
create or replace function public.guardian_unlink(p_guardian_id uuid, p_student_id uuid)
returns integer
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_removed integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  delete from public.guardian_student
  where tenant_id = v_tenant_id
    and guardian_id = p_guardian_id
    and student_id = p_student_id;
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

comment on function public.guardian_unlink(uuid, uuid) is
  'Removes one guardian-child link. Never deletes the guardian: they may have '
  'other children here, and a person who is nobody''s guardian any more is '
  'still the person who paid last year''s fees.';

-- ---------------------------------------------------------------------------
-- ...and the importer finally keeps the guardian it insisted on
-- ---------------------------------------------------------------------------

-- The only change is one block inside the loop. `import_validate_run` already
-- refuses a row whose guardian has no phone number, so by the time a row
-- reaches here the school has been told the guardian matters -- and then the
-- name went nowhere.
--
-- **The guardian is created in its own sub-block.** A guardian that fails to
-- save must not lose the child: the admission is the thing being imported, and
-- rule 13's *"apply partially and record why"* says the batch carries on with
-- the reason attached rather than stopping. So a failed guardian appends to
-- `apply_error` and the student stays imported -- `applied_student_id` is
-- already set by then, which is what makes the row re-runnable for the guardian
-- alone.
--
-- `relationship` defaults to `guardian` rather than guessing from the name.
-- `guardian_relationship` is null on all three demo rows, and inferring
-- "father" from a masculine first name is exactly the kind of cleverness that
-- is wrong in front of the one family it is wrong about.
create or replace function public.import_apply_run(p_run_id uuid)
returns table(applied integer, failed integer)
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
              'phone', v_row.guardian_phone
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

comment on function public.import_apply_run(uuid) is
  'Applies a validated import. Since 0221 it also creates the guardian the row '
  'named -- `import_validate_run` refuses a row whose guardian has no phone '
  'number, and until now the name was checked and then dropped.';

commit;
