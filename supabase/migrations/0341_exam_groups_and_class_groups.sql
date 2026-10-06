-- 0341: Exam groups and class groups, the reference's two grouping lists.
--
-- 1. `exam_groups` ("Exam Groups": Exam Group, Status, Action). A college
--    files its exams under a group -- "First Term", "Annual" -- so an exam
--    form asks which one, and a report can gather a term's exams together.
--    The group outlives a year, so it carries no session (rule 2 scopes rows
--    that record a year; a group is a name). An exam's group is
--    `exams.exam_group_id`, optional, held to the same college by a composite
--    key. An inactive group is no longer offered for a new exam and stays on
--    the exams already filed under it. Removing a group in use is refused by
--    the key, and the screen says so: switch it off instead.
--
-- 2. `class_groups` ("Class Groups": Class Group Name, Classes, Head of
--    Group). A college groups its classes -- "Science", "Arts", "Primary" --
--    under a member of staff who heads the group. A class is in at most one
--    group, so the membership is `class_levels.class_group_id`. Removing a
--    group ungroups its classes rather than being refused: a group is a label
--    over classes, not a record anything else hangs off. Removing the head's
--    staff record clears the head, never the group. Both are `on delete set
--    null (col)`, the column-list form, because the plain form on a composite
--    key would null `tenant_id` too and so could never fire (0288's finding).
--
--    `class_group_save` writes a group and its classes in one transaction:
--    the name and head on the group, then which classes are in it. Invoker,
--    so the administrator policies on both tables are the gate, and it checks
--    the row count of every write (rule 6).
--
-- Both lists are read by every member of the college and written by the
-- administrator, the policies `exams` and `class_levels` already have.

begin;

-- ---------------------------------------------------------------------------
-- 1. Exam groups

create table public.exam_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index exam_groups_name_key on public.exam_groups (tenant_id, lower(btrim(name)));

comment on table public.exam_groups is
  'The groups a college files its exams under (First Term, Annual). An exam''s is exams.exam_group_id (0341).';

create trigger set_updated_at before update on public.exam_groups
  for each row execute function public.set_updated_at();
create trigger audit_exam_groups after insert or update or delete on public.exam_groups
  for each row execute function public.audit_row_change();

alter table public.exam_groups enable row level security;

create policy "tenant members view exam_groups" on public.exam_groups
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage exam_groups" on public.exam_groups
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

alter table public.exams add column exam_group_id uuid;
alter table public.exams
  add constraint exams_exam_group_fkey foreign key (tenant_id, exam_group_id)
    references public.exam_groups (tenant_id, id);
create index exams_exam_group_idx on public.exams (exam_group_id) where exam_group_id is not null;

comment on column public.exams.exam_group_id is 'The group this exam is filed under (0341). Null: none.';

-- ---------------------------------------------------------------------------
-- 2. Class groups

create table public.class_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  head_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint class_groups_head_fkey foreign key (tenant_id, head_staff_id)
    references public.staff (tenant_id, id) on delete set null (head_staff_id)
);
create unique index class_groups_name_key on public.class_groups (tenant_id, lower(btrim(name)));
create index class_groups_head_idx on public.class_groups (head_staff_id) where head_staff_id is not null;

comment on table public.class_groups is
  'Groups of classes (Science, Arts, Primary) with the member of staff who heads each. A class''s group is class_levels.class_group_id (0341).';

create trigger set_updated_at before update on public.class_groups
  for each row execute function public.set_updated_at();
create trigger audit_class_groups after insert or update or delete on public.class_groups
  for each row execute function public.audit_row_change();

alter table public.class_groups enable row level security;

create policy "tenant members view class_groups" on public.class_groups
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage class_groups" on public.class_groups
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

alter table public.class_levels add column class_group_id uuid;
alter table public.class_levels
  add constraint class_levels_class_group_fkey foreign key (tenant_id, class_group_id)
    references public.class_groups (tenant_id, id) on delete set null (class_group_id);
create index class_levels_class_group_idx on public.class_levels (class_group_id) where class_group_id is not null;

comment on column public.class_levels.class_group_id is 'The class group this class is in (0341). Null: none.';

create function public.class_group_save(
  p_id uuid,
  p_name text,
  p_head_staff_id uuid,
  p_class_level_ids uuid[]
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_wanted integer := (select count(distinct x) from unnest(coalesce(p_class_level_ids, '{}')) x);
  v_rows integer;
begin
  if v_tenant is null then
    raise exception 'No college in session';
  end if;
  if length(v_name) not between 1 and 80 then
    raise exception 'Give the group a name of up to 80 characters.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.class_groups (tenant_id, name, head_staff_id)
    values (v_tenant, v_name, p_head_staff_id)
    returning id into v_id;
  else
    update public.class_groups
    set name = v_name, head_staff_id = p_head_staff_id
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Only an administrator can change a class group.' using errcode = '42501';
    end if;
  end if;

  -- Classes taken out of the group.
  update public.class_levels
  set class_group_id = null
  where class_group_id = v_id
    and not (id = any (coalesce(p_class_level_ids, '{}')));

  -- Classes put in it, moved from any other group they were in.
  if v_wanted > 0 then
    update public.class_levels
    set class_group_id = v_id
    where id = any (p_class_level_ids)
      and class_group_id is distinct from v_id;
    select count(*) into v_rows
    from public.class_levels
    where id = any (p_class_level_ids) and class_group_id = v_id;
    if v_rows <> v_wanted then
      raise exception 'Only an administrator can put classes in a group, and only this college''s classes.'
        using errcode = '42501';
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.class_group_save(uuid, text, uuid, uuid[]) is
  'Creates (p_id null) or changes a class group and sets exactly which classes are in it, moving a class out of any other group. INVOKER: the administrator policies on class_groups and class_levels are the gate; every write is checked by its row count (0341).';

commit;
