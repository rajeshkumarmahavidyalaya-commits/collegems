-- 0303: behaviour and skills.
--
-- The one module the eSkooly comparison found there and not here: a grade for
-- each child on things that are not a paper -- discipline, punctuality,
-- teamwork, art, sport -- printed on the report card beside the marks. CBSE
-- calls it co-scholastic assessment and grades it A to E; most boards ask for
-- something like it.
--
-- ## Two tables, both built from shapes this schema already has
--
-- `behaviour_traits` is the college's list of what it grades, as data (rule
-- 12): a school that grades "Yoga" and not "Art" edits a row. It is seeded
-- from `reference.behaviour_trait_defaults` into every college, and into every
-- college founded later by an AFTER INSERT trigger on tenants -- the lesson
-- 0300 learned the expensive way about certificate templates: *a default
-- seeded by `insert ... select from tenants` never reaches tomorrow's college.*
--
-- `behaviour_ratings` is exam_remarks' shape exactly, one grade per child per
-- trait per exam instead of one sentence:
--
--   * it carries `exam_status`, held equal to `exams.status` by the composite
--     key (rule 4's status device), and every write policy requires 'draft' --
--     so publishing the exam freezes every rating in one UPDATE, and a family
--     reads them only once it is published;
--   * the class teacher writes their own section's children; the exams office
--     (`exams.manage`) writes any.
--
-- ## Gated on the matrix, not on role codes -- and not on exams.view
--
-- exam_remarks (0077) compares `current_role_code()`. A new table does not
-- copy that: the write policies ask `role_has_permission()`, so a college that
-- lets its examination officer grade behaviour grants a permission rather than
-- waiting for a policy rewrite (rule 4's permissions section).
--
-- The staff read is deliberately **not** `exams.view`. 0249 is the reason:
-- exams.view is held by every parent and student, and a tenant-wide policy on
-- it published every child's seat to every family. Staff read on the
-- permissions only staff hold (exams.remark, exams.grade, exams.manage);
-- families read their own children's published rows through row-scoped
-- policies of their own.
--
-- ## The scale
--
-- A to E, as CBSE's five-point co-scholastic scale. Stored as the letter,
-- because the letter is what is printed and a number would need a second
-- mapping that could drift from the card. A school on a three-point scale uses
-- A to C; a scale that needs different words is a follow-up with its own
-- catalogue row, not a reason to guess one now.

begin;

-- ---------------------------------------------------------------------------
-- What a college grades
-- ---------------------------------------------------------------------------

create table reference.behaviour_trait_defaults (
  name text primary key,
  kind text not null check (kind in ('behaviour', 'skill')),
  sort integer not null
);

revoke all on reference.behaviour_trait_defaults from public, anon, authenticated;
grant select on reference.behaviour_trait_defaults to authenticated;

insert into reference.behaviour_trait_defaults (name, kind, sort) values
  ('Discipline', 'behaviour', 10),
  ('Punctuality', 'behaviour', 20),
  ('Cleanliness and neatness', 'behaviour', 30),
  ('Respect for others', 'behaviour', 40),
  ('Honesty', 'behaviour', 50),
  ('Work education', 'skill', 60),
  ('Art education', 'skill', 70),
  ('Health and physical education', 'skill', 80),
  ('Teamwork', 'skill', 90),
  ('Communication', 'skill', 100);

create table public.behaviour_traits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('behaviour', 'skill')),
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint behaviour_traits_name_chk check (length(btrim(name)) between 1 and 80),
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create trigger set_updated_at before update on public.behaviour_traits
  for each row execute function public.set_updated_at();
create trigger audit_behaviour_traits
  after insert or update or delete on public.behaviour_traits
  for each row execute function public.audit_row_change();

alter table public.behaviour_traits enable row level security;

-- The list of what is graded is the report card's vocabulary: every member of
-- the college may read it, a family included, because their child's card
-- prints its names.
create policy "members view behaviour_traits" on public.behaviour_traits
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy "exams office manages behaviour_traits" on public.behaviour_traits
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.role_has_permission('exams.manage')))
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.role_has_permission('exams.manage')));

create or replace function public.behaviour_seed_traits(p_tenant_id uuid)
returns integer
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  insert into public.behaviour_traits (tenant_id, name, kind, sort)
  select p_tenant_id, d.name, d.kind, d.sort
  from reference.behaviour_trait_defaults d
  where not exists (
    select 1 from public.behaviour_traits x
    where x.tenant_id = p_tenant_id and x.name = d.name
  )
  order by d.sort;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.behaviour_seed_traits(uuid) from public, anon, authenticated;

create or replace function public.tenants_seed_behaviour_traits()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform public.behaviour_seed_traits(new.id);
  return new;
end;
$$;

revoke all on function public.tenants_seed_behaviour_traits() from public, anon, authenticated;

create trigger tenants_seed_behaviour_traits
  after insert on public.tenants
  for each row execute function public.tenants_seed_behaviour_traits();

select public.behaviour_seed_traits(t.id) from public.tenants t;

-- ---------------------------------------------------------------------------
-- One grade per child per trait per exam
-- ---------------------------------------------------------------------------

create table public.behaviour_ratings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_id uuid not null,
  -- Held equal to exams.status by the key below; never written by hand.
  exam_status text not null default 'draft',
  student_id uuid not null,
  trait_id uuid not null,
  grade text not null check (grade in ('A', 'B', 'C', 'D', 'E')),
  rated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, exam_id, student_id, trait_id),

  constraint behaviour_ratings_exam_fkey
    foreign key (tenant_id, exam_id, exam_status)
    references public.exams (tenant_id, id, status)
    on update cascade on delete cascade,
  constraint behaviour_ratings_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint behaviour_ratings_trait_fkey
    foreign key (tenant_id, trait_id)
    references public.behaviour_traits (tenant_id, id) on delete cascade
);

create index behaviour_ratings_student_idx on public.behaviour_ratings (tenant_id, student_id);
create index behaviour_ratings_trait_idx on public.behaviour_ratings (tenant_id, trait_id);
create index behaviour_ratings_session_idx on public.behaviour_ratings (session_id);
create index behaviour_ratings_rater_idx on public.behaviour_ratings (rated_by);

create trigger set_updated_at before update on public.behaviour_ratings
  for each row execute function public.set_updated_at();
create trigger audit_behaviour_ratings
  after insert or update or delete on public.behaviour_ratings
  for each row execute function public.audit_row_change();

alter table public.behaviour_ratings enable row level security;

-- Staff read on permissions only staff hold -- never exams.view (0249).
create policy "staff view behaviour_ratings" on public.behaviour_ratings
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and ((select public.role_has_permission('exams.remark'))
         or (select public.role_has_permission('exams.grade'))
         or (select public.role_has_permission('exams.manage')))
  );

create policy "students view own published behaviour_ratings" on public.behaviour_ratings
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exam_status = 'published'
    and student_id = (select up.student_id from public.user_profiles up where up.id = (select auth.uid()))
  );

create policy "guardians view children's published behaviour_ratings" on public.behaviour_ratings
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exam_status = 'published'
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

create policy "exams office manages draft behaviour_ratings" on public.behaviour_ratings
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.manage'))
    and exam_status = 'draft'
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.manage'))
    and exam_status = 'draft'
  );

create policy "class teachers manage own section draft behaviour_ratings" on public.behaviour_ratings
  for all to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.remark'))
    and exam_status = 'draft'
    and student_id in (
      select e.student_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = (select auth.uid())
        and e.session_id = behaviour_ratings.session_id
        and e.status = 'active'
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.role_has_permission('exams.remark'))
    and exam_status = 'draft'
    and student_id in (
      select e.student_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      join public.user_profiles up on up.staff_id = s.class_teacher_staff_id
      where up.id = (select auth.uid())
        and e.session_id = behaviour_ratings.session_id
        and e.status = 'active'
    )
  );

-- Rule 1's grants: the four statements RLS can see, and nothing else.
revoke truncate, trigger, references, maintain on public.behaviour_traits from anon, authenticated;
revoke truncate, trigger, references, maintain on public.behaviour_ratings from anon, authenticated;

comment on table public.behaviour_ratings is
  'One A-E grade per child per trait per exam (0303). Writable only while the exam is a draft -- exam_status is carried by the composite key, as on exam_remarks -- and read by a family only once it is published.';

commit;
