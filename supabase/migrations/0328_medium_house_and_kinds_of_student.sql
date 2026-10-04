-- 0328: Medium, House and kinds of student, and a class that arrives with a
-- section.
--
-- The reference's SM Academic has Manage Medium, Manage House and Manage
-- Student type, and its admission form asks for all three. This product had
-- the third since 0281, filed under fee setup because it was built to change
-- what a child is charged, and neither of the other two.
--
-- 1. `mediums` and `houses`. A medium is the language a child is taught in; a
--    house is the inter-house team. Both are a short named list a college
--    writes once, and both describe the child rather than a year, so the
--    child's choice is a column on `students` (rule 2 scopes rows that record
--    a year; these record a person). Read by every member of the college --
--    a house name is printed on a sports day notice -- and written by the
--    administrator, the same pair of policies as `class_levels`.
--
--    A medium or house still on a child's record cannot be removed: the
--    foreign key keeps its default action, so the refusal is the database's,
--    and the screen says why. Rename it instead.
--
-- 2. Kinds of student a college starts with. 0281 seeded "Carry-over" into
--    the colleges of its day by a migration, which is 0300's lesson again: a
--    default seeded by a migration is a default for yesterday's colleges. So
--    the list is data, `reference.student_type_defaults`, and an AFTER INSERT
--    trigger on `tenants` copies it into every new college. Existing colleges
--    get only the ones they lack, matched by code, so a college that renamed
--    one keeps its name. A college adds its own on the Student types screen;
--    these are where it starts, not a closed list.
--
--    "Regular" is a kind like the others. No row in student_type_assignments
--    still means regular to the fee engine (0281), and a typed fee row only
--    replaces the untyped one where one is set, so a child marked Regular with
--    no Regular fee rows pays exactly what an untyped child pays.
--
-- 3. `class_level_add`. A class with no section cannot take a child: every
--    picker that enrols lists sections, because a section is the class in a
--    year. Measured on a college founded today: a class made at 07:12 with no
--    section, a child admitted at 07:21 with no class, the section added at
--    07:36. So adding a class now names its sections, "A" when nothing is
--    said, in one transaction, and its position in the list is the next one
--    -- a number nobody needs to type.

begin;

-- ---------------------------------------------------------------------------
-- 1. Mediums and houses

create table public.mediums (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index mediums_name_key on public.mediums (tenant_id, lower(trim(name)));

comment on table public.mediums is
  'The languages a college teaches in (Hindi medium, English medium). A child''s is students.medium_id (0328).';

create table public.houses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index houses_name_key on public.houses (tenant_id, lower(trim(name)));

comment on table public.houses is
  'A college''s houses (Red House, Tagore House). A child''s is students.house_id (0328).';

create trigger set_updated_at before update on public.mediums
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.houses
  for each row execute function public.set_updated_at();
create trigger audit_mediums after insert or update or delete on public.mediums
  for each row execute function public.audit_row_change();
create trigger audit_houses after insert or update or delete on public.houses
  for each row execute function public.audit_row_change();

alter table public.mediums enable row level security;
alter table public.houses enable row level security;

create policy "tenant members view mediums" on public.mediums
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage mediums" on public.mediums
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

create policy "tenant members view houses" on public.houses
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage houses" on public.houses
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

alter table public.students
  add column medium_id uuid,
  add column house_id uuid;

-- Same tenant by construction, and no action on removal: a medium in use is
-- refused rather than quietly taken off two hundred records.
alter table public.students
  add constraint students_medium_fkey foreign key (tenant_id, medium_id)
    references public.mediums (tenant_id, id),
  add constraint students_house_fkey foreign key (tenant_id, house_id)
    references public.houses (tenant_id, id);

create index students_medium_idx on public.students (medium_id) where medium_id is not null;
create index students_house_idx on public.students (house_id) where house_id is not null;

comment on column public.students.medium_id is 'The medium the child is taught in (0328). Null: not recorded.';
comment on column public.students.house_id is 'The child''s house (0328). Null: not in a house.';

-- ---------------------------------------------------------------------------
-- 2. The kinds of student a college starts with

create table reference.student_type_defaults (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null,
  description text not null,
  sort integer not null
);

comment on table reference.student_type_defaults is
  'The kinds of student every college starts with (0328). An AFTER INSERT trigger on tenants copies them; a college adds and renames its own.';

revoke all on reference.student_type_defaults from public, anon, authenticated;
grant select on reference.student_type_defaults to authenticated;

insert into reference.student_type_defaults (code, name, description, sort) values
  ('regular', 'Regular', 'Admitted in the ordinary way and studying full time.', 1),
  ('carry_forward', 'Carry Forward', 'Moved up with a subject carried forward to clear in the next year.', 2),
  ('carry_over', 'Carry-over', 'Promoted with papers still to clear. Pays the carry-over amount wherever one is set, and the regular amount everywhere else.', 3),
  ('private_candidate', 'Private Candidate', 'Sits the examinations without attending classes.', 4),
  ('management_quota', 'Management Quota', 'Admitted against the management seats.', 5),
  ('direct_admission', 'Direct Admission', 'Admitted directly by the college, not through counselling.', 6),
  ('counselling', 'Admission Through Counselling', 'Allotted a seat through the university or state counselling.', 7);

create or replace function public.student_type_seed_defaults(p_tenant_id uuid)
returns integer
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  insert into public.student_types (tenant_id, code, name, description)
  select p_tenant_id, d.code, d.name, d.description
  from reference.student_type_defaults d
  where not exists (
    select 1 from public.student_types x
    where x.tenant_id = p_tenant_id
      and (x.code = d.code or lower(x.name) = lower(d.name))
  )
  order by d.sort;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.student_type_seed_defaults(uuid) is
  'Copies reference.student_type_defaults into one college, skipping any it already has by code or name. Called by the tenants insert trigger; not by people.';

revoke all on function public.student_type_seed_defaults(uuid) from public, anon, authenticated;

create or replace function public.tenants_seed_student_types()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform public.student_type_seed_defaults(new.id);
  return new;
end;
$$;

revoke all on function public.tenants_seed_student_types() from public, anon, authenticated;

create trigger tenants_seed_student_types
  after insert on public.tenants
  for each row execute function public.tenants_seed_student_types();

select public.student_type_seed_defaults(t.id) from public.tenants t;

-- ---------------------------------------------------------------------------
-- 3. A class arrives with its sections

create or replace function public.class_level_add(p_name text, p_sections text[] default array['A'])
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_name text := trim(coalesce(p_name, ''));
  v_session uuid;
  v_sections text[];
  v_seq integer;
  v_id uuid;
  v_n integer;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college first.' using errcode = '42501';
  end if;
  -- Mirrors "admins manage class_levels" for the sentence: a refused INSERT
  -- raises a policy error, not a reason (0257).
  if (select public.current_role_code()) <> 'admin' then
    raise exception 'Only an administrator can add a class.' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'Give the class a name of up to 60 characters.' using errcode = '22023';
  end if;

  select coalesce(array_agg(s order by s), '{}')
  into v_sections
  from (select distinct trim(x) as s from unnest(coalesce(p_sections, '{}'::text[])) x) q
  where s <> '';
  if exists (select 1 from unnest(v_sections) s where length(s) > 40) then
    raise exception 'A section name is at most 40 characters.' using errcode = '22023';
  end if;
  if cardinality(v_sections) = 0 then
    raise exception 'Name at least one section, such as A. A class with no section cannot take a child.' using errcode = '22023';
  end if;

  v_session := public.current_session_id(v_tenant);
  if v_session is null then
    raise exception 'There is no current academic year. Set one under Academic years first.';
  end if;

  if exists (select 1 from public.class_levels cl where cl.tenant_id = v_tenant and lower(cl.name) = lower(v_name)) then
    raise exception 'There is already a class called "%".', v_name using errcode = '23505';
  end if;

  -- The next position is a fact about other rows (rule 4): taken under a lock
  -- so two classes added at once do not both become number 7.
  perform pg_advisory_xact_lock(hashtextextended('class_levels:' || v_tenant::text, 0));
  select coalesce(max(cl.sequence), 0) + 1 into v_seq
  from public.class_levels cl where cl.tenant_id = v_tenant;

  insert into public.class_levels (tenant_id, name, sequence)
  values (v_tenant, v_name, v_seq)
  returning id into v_id;

  insert into public.sections (tenant_id, class_level_id, session_id, name)
  select v_tenant, v_id, v_session, s from unnest(v_sections) s;
  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'id', v_id,
    'sequence', v_seq,
    'sections', v_n,
    'session', (select a.name from public.academic_sessions a where a.id = v_session));
end;
$$;

comment on function public.class_level_add(text, text[]) is
  'Add a class with its sections for the current year, in one transaction; its list position is the next one (0328). INVOKER: the admin policies on class_levels and sections are the boundary.';

revoke all on function public.class_level_add(text, text[]) from public, anon;
grant execute on function public.class_level_add(text, text[]) to authenticated;

commit;
