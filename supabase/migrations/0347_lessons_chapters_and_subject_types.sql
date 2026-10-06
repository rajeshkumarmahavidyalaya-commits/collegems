-- 0347: Lessons in chapters, subject types, and subjects assigned in bulk.
--
-- The reference has three things here that this product half had:
--
--   * **Chapters and Lessons.** A chapter is a titled unit of a subject for a
--     class; this product has had exactly that since 0255 as `syllabus_units`
--     (per year, class and subject, ordered, with coverage). A lesson is a
--     title, a file or a link, and a description, placed in a chapter; that is
--     `study_material` with a chapter. So a lesson is not a new table: it is
--     `study_material.unit_id`. A second table holding titles, files and links
--     would be a second upload path and a second set of policies free to
--     disagree with the first (rule 12, "who else does this?").
--
--     The chapter must be of the material's own subject, which is one table
--     away: the composite-key device carries `subject_id` into the key, so a
--     lesson whose chapter is another subject's cannot be written (rule 4).
--     The chapter must also be of the material's own class, which is two
--     tables away (section -> class level): a trigger checks it and says so
--     in a sentence, because a plain insert through PostgREST routes around
--     any function (0205).
--
--   * **Subject Types** (Theory, Practical, Language, Elective...), a short
--     list a college writes, like mediums and houses (0328). `subjects.kind`
--     stays: it is theory or practical, and the timetable and mark sheets read
--     it. A type is a label a college chooses; a kind is a rule the product
--     enforces. They are different questions.
--
--   * **Assign Subject in Bulk.** `academics_add_subject` (0275) already gives
--     one new subject to several classes in one transaction;
--     `academics_assign_subjects` gives several existing subjects to several
--     classes. An assignment that exists is left alone (its teacher kept), and
--     the answer counts both.

begin;

-- ---------------------------------------------------------------------------
-- 1. Subject types

create table public.subject_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index subject_types_name_key on public.subject_types (tenant_id, lower(trim(name)));

comment on table public.subject_types is
  'A college''s own labels for its subjects (Theory, Language, Elective). A subject''s is subjects.subject_type_id. Not subjects.kind, which is the theory/practical rule the timetable reads (0347).';

create trigger set_updated_at before update on public.subject_types
  for each row execute function public.set_updated_at();
create trigger audit_subject_types after insert or update or delete on public.subject_types
  for each row execute function public.audit_row_change();

alter table public.subject_types enable row level security;

create policy "tenant members view subject_types" on public.subject_types
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage subject_types" on public.subject_types
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

alter table public.subjects add column subject_type_id uuid;
alter table public.subjects
  add constraint subjects_subject_type_fkey foreign key (tenant_id, subject_type_id)
  references public.subject_types (tenant_id, id);
create index subjects_subject_type_idx on public.subjects (subject_type_id);

-- ---------------------------------------------------------------------------
-- 2. A lesson is study material in a chapter

alter table public.syllabus_units
  add constraint syllabus_units_subject_key unique (tenant_id, id, subject_id);

alter table public.study_material add column unit_id uuid;
-- MATCH SIMPLE: material with no chapter (or no subject) is not a lesson and
-- the key is skipped. Deleting a chapter turns its lessons back into plain
-- study material rather than deleting somebody's upload.
alter table public.study_material
  add constraint study_material_unit_fkey foreign key (tenant_id, unit_id, subject_id)
  references public.syllabus_units (tenant_id, id, subject_id)
  on delete set null (unit_id);
alter table public.study_material
  add constraint study_material_unit_needs_subject_chk check (unit_id is null or subject_id is not null);
create index study_material_unit_idx on public.study_material (unit_id);

create function public.study_material_chapter_fits()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_unit public.syllabus_units;
  v_level uuid;
begin
  if new.unit_id is null then
    return new;
  end if;
  select * into v_unit from public.syllabus_units u where u.id = new.unit_id;
  if new.section_id is null then
    raise exception 'A lesson belongs to a class: choose the class as well as the chapter.' using errcode = '22023';
  end if;
  select sec.class_level_id into v_level from public.sections sec where sec.id = new.section_id;
  if v_unit.id is null or v_level is distinct from v_unit.class_level_id or v_unit.session_id is distinct from new.session_id then
    raise exception 'That chapter is not in this class''s syllabus for this year. Choose one of the class''s own chapters.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function public.study_material_chapter_fits() is
  'A lesson''s chapter is of its own class and year: two tables away (section -> class level), so a trigger says it in a sentence. The subject match is the composite key (0347).';

create trigger study_material_chapter_fits
  before insert or update of unit_id, section_id, session_id on public.study_material
  for each row execute function public.study_material_chapter_fits();

-- ---------------------------------------------------------------------------
-- 3. Several subjects to several classes

create function public.academics_assign_subjects(p_subject_ids uuid[], p_section_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_subjects int;
  v_sections int;
  v_found int;
  v_created int;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college to assign subjects.' using errcode = '42501';
  end if;
  -- The policy on section_subjects admits the administrator; an INSERT it
  -- refuses would raise its own error, so it is said here first (rule 6).
  if (select public.current_role_code()) is distinct from 'admin' then
    raise exception 'Only an administrator can assign subjects to classes.' using errcode = '42501';
  end if;

  select count(distinct s) into v_subjects from unnest(p_subject_ids) s where s is not null;
  select count(distinct s) into v_sections from unnest(p_section_ids) s where s is not null;
  if v_subjects = 0 or v_sections = 0 then
    raise exception 'Choose at least one subject and at least one class.' using errcode = '22023';
  end if;
  if v_subjects * v_sections > 2000 then
    raise exception 'That is % assignments at once; choose at most 2,000.', v_subjects * v_sections using errcode = '22023';
  end if;

  v_session := public.current_session_id(v_tenant);
  if v_session is null then
    raise exception 'This college has no current academic year, so there are no classes to assign to.' using errcode = '22023';
  end if;

  select count(*) into v_found from public.sections sec where sec.id = any (p_section_ids) and sec.session_id = v_session;
  if v_found <> v_sections then
    raise exception 'One of the chosen classes is not in the current academic year. Reload the page and choose again.'
      using errcode = '22023';
  end if;
  select count(*) into v_found from public.subjects sub where sub.id = any (p_subject_ids) and sub.is_active;
  if v_found <> v_subjects then
    raise exception 'One of the chosen subjects is inactive or no longer exists. Reload the page and choose again.'
      using errcode = '22023';
  end if;

  insert into public.section_subjects (tenant_id, session_id, section_id, subject_id)
  select v_tenant, v_session, sec_id, sub_id
  from (select distinct s as sec_id from unnest(p_section_ids) s where s is not null) a
  cross join (select distinct s as sub_id from unnest(p_subject_ids) s where s is not null) b
  on conflict (tenant_id, session_id, section_id, subject_id) do nothing;
  get diagnostics v_created = row_count;

  return jsonb_build_object('created', v_created, 'already', v_subjects * v_sections - v_created);
end;
$$;

comment on function public.academics_assign_subjects(uuid[], uuid[]) is
  'The reference''s Assign Subject in Bulk: every chosen subject to every chosen class this year, in one transaction. An existing assignment keeps its teacher and is counted as already there. INVOKER, administrator only, said before the insert (0347).';

revoke all on function public.academics_assign_subjects(uuid[], uuid[]) from public, anon;
grant execute on function public.academics_assign_subjects(uuid[], uuid[]) to authenticated;

commit;
