-- 0282: students choose their electives, from the subjects allotted to them.
--
-- Subjects were taught to a whole class (`section_subjects`), and nothing let
-- a student say which of several optional papers they take -- which a college
-- (B.A. Hindi or Sanskrit or Urdu, pick two of four languages) cannot run
-- without. The model:
--
--   subject_groups          per class and year: "Language electives, choose 2"
--                           with min/max, and a window the office opens.
--   subject_group_options   the subjects allotted to that group.
--   student_subject_choices one row per chosen subject, per student, per year.
--
-- Three things make "a student sees only what is allotted to them" true in the
-- database rather than in a screen:
--
-- 1. A choice carries (group_id, subject_id) inside a foreign key onto
--    `subject_group_options`, so a subject that was never allotted to the group
--    cannot be chosen, whatever a client sends (rule 4's composite key, the
--    identity use).
-- 2. A choice carries its session inside a foreign key onto the group, and its
--    (session, student) inside one onto `enrolments`: a choice can only exist
--    for a year the student is enrolled in, in that year's group.
-- 3. The class match is two tables away (enrolment -> section -> class level),
--    so it is checked in the one write function, with a sentence (rule 4:
--    "two tables away, use a function check and say so").
--
-- Students have **no write policy** on choices: they write through
-- `subject_choice_save`, SECURITY DEFINER, which checks the window, the count
-- and the class -- the homework_submit shape. A migration that tidily "adds the
-- missing student insert policy" lets a student pick any number of subjects,
-- after the window, for any class, so the absence is the mechanism.

create table public.subject_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null references public.academic_sessions (id) on delete cascade,
  class_level_id uuid not null references public.class_levels (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  min_choices integer not null default 1 check (min_choices >= 0),
  max_choices integer not null default 1 check (max_choices >= 1),
  is_open boolean not null default false,
  closes_on date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_choices <= max_choices),
  unique (tenant_id, id),
  unique (tenant_id, id, session_id),
  unique (tenant_id, session_id, class_level_id, name)
);

comment on table public.subject_groups is
  'A choice students make, per class and year (0282): "Language electives, choose 2". Opened and closed by the office.';

create table public.subject_group_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  group_id uuid not null,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, subject_id),
  constraint subject_group_options_group_fkey
    foreign key (tenant_id, group_id) references public.subject_groups (tenant_id, id) on delete cascade
);

create index subject_group_options_subject_idx on public.subject_group_options (subject_id);

create table public.student_subject_choices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  group_id uuid not null,
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, student_id, group_id, subject_id),
  -- Only a subject allotted to the group.
  constraint student_subject_choices_option_fkey
    foreign key (group_id, subject_id) references public.subject_group_options (group_id, subject_id) on delete cascade,
  -- In the group's own year.
  constraint student_subject_choices_group_fkey
    foreign key (tenant_id, group_id, session_id) references public.subject_groups (tenant_id, id, session_id) on delete cascade,
  -- By a student enrolled in that year.
  constraint student_subject_choices_enrolment_fkey
    foreign key (tenant_id, session_id, student_id) references public.enrolments (tenant_id, session_id, student_id) on delete cascade
);

create index student_subject_choices_group_idx on public.student_subject_choices (tenant_id, group_id, subject_id);
create index student_subject_choices_session_student_idx on public.student_subject_choices (tenant_id, session_id, student_id);

comment on table public.student_subject_choices is
  'The electives a student chose, one row per subject (0282). Written by subject_choice_save; students have no write policy.';

create trigger set_updated_at before update on public.subject_groups
  for each row execute function public.set_updated_at();
create trigger audit_subject_groups after insert or update or delete on public.subject_groups
  for each row execute function public.audit_row_change();
create trigger set_updated_at before update on public.subject_group_options
  for each row execute function public.set_updated_at();
create trigger audit_subject_group_options after insert or update or delete on public.subject_group_options
  for each row execute function public.audit_row_change();
create trigger set_updated_at before update on public.student_subject_choices
  for each row execute function public.set_updated_at();
create trigger audit_student_subject_choices after insert or update or delete on public.student_subject_choices
  for each row execute function public.audit_row_change();

alter table public.subject_groups enable row level security;
alter table public.subject_group_options enable row level security;
alter table public.student_subject_choices enable row level security;

-- What is on offer is not sensitive: every member of the college may read it,
-- like `subjects` and `section_subjects`. Only the administrator arranges it.
create policy "tenant members view subject_groups" on public.subject_groups
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage subject_groups" on public.subject_groups
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

create policy "tenant members view subject_group_options" on public.subject_group_options
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
create policy "admins manage subject_group_options" on public.subject_group_options
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

-- Who chose what. The administrator manages all of it; teachers read it, since
-- they teach the elective and need its roll; a student reads their own and a
-- guardian their children's. There is deliberately NO student or guardian
-- write policy: see the header.
create policy "admins manage student_subject_choices" on public.student_subject_choices
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'admin');

create policy "teachers view student_subject_choices" on public.student_subject_choices
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role_code()) = 'teacher');

create policy "students view own subject choices" on public.student_subject_choices
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) = 'student'
    and student_id = (select up.student_id from public.user_profiles up where up.id = (select auth.uid()))
  );

create policy "parents view own children subject choices" on public.student_subject_choices
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_role_code()) = 'parent'
    and student_id in (
      select gs.student_id from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = (select auth.uid())
    )
  );

-- Save one group's choice for one student, replacing what was there.
--
-- DEFINER because the narrower party (a student) has no write policy, and this
-- is the only way their choice is written. Everything a policy would have
-- checked is checked here, and the tenant is filtered by hand because no
-- policy runs inside (rule 4). A student saves only their own choice, only
-- while the group is open; an administrator saves anybody's, at any time.
create or replace function public.subject_choice_save(
  p_group_id uuid,
  p_subject_ids uuid[],
  p_student_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role text := public.current_role_code();
  v_student uuid;
  v_group public.subject_groups;
  v_class uuid;
  v_ids uuid[] := coalesce(array(select distinct x from unnest(p_subject_ids) x where x is not null), '{}');
  v_n integer := coalesce(cardinality(array(select distinct x from unnest(p_subject_ids) x where x is not null)), 0);
  v_bad integer;
  v_written integer;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college first.' using errcode = '42501';
  end if;

  if v_role = 'student' then
    select up.student_id into v_student from public.user_profiles up
    where up.id = auth.uid() and up.tenant_id = v_tenant;
    if v_student is null then
      raise exception 'This login is not linked to a student record, so there is nobody to choose for. Ask the office.';
    end if;
    if p_student_id is not null and p_student_id <> v_student then
      raise exception 'You can only choose your own subjects.' using errcode = '42501';
    end if;
  elsif v_role = 'admin' then
    v_student := p_student_id;
    if v_student is null then
      raise exception 'Say which student this choice is for.';
    end if;
  else
    raise exception 'Only a student, or the office on their behalf, can choose electives.' using errcode = '42501';
  end if;

  select * into v_group from public.subject_groups g
  where g.id = p_group_id and g.tenant_id = v_tenant;
  if v_group.id is null then
    raise exception 'That choice does not exist.';
  end if;

  if v_role = 'student' then
    if not v_group.is_open then
      raise exception '"%" is not open for choosing. The office opens it when choices are due.', v_group.name;
    end if;
    if v_group.closes_on is not null and current_date > v_group.closes_on then
      raise exception '"%" closed on %. Ask the office if you need to change it.', v_group.name, to_char(v_group.closes_on, 'FMDD Mon YYYY');
    end if;
  end if;

  -- The class match is two tables away, so it is checked here (rule 4).
  select s.class_level_id into v_class
  from public.enrolments e join public.sections s on s.id = e.section_id
  where e.tenant_id = v_tenant and e.session_id = v_group.session_id
    and e.student_id = v_student and e.status = 'active';
  if v_class is null then
    raise exception 'This student is not enrolled in the year this choice is for.';
  end if;
  if v_class <> v_group.class_level_id then
    raise exception '"%" is for a different class, so it is not one this student can choose.', v_group.name;
  end if;

  if v_n < v_group.min_choices or v_n > v_group.max_choices then
    raise exception '"%" needs % subject%, and % % chosen.',
      v_group.name,
      case when v_group.min_choices = v_group.max_choices then v_group.max_choices::text
           else format('%s to %s', v_group.min_choices, v_group.max_choices) end,
      case when v_group.max_choices = 1 then '' else 's' end,
      v_n,
      case when v_n = 1 then 'was' else 'were' end;
  end if;

  select count(*)::integer into v_bad
  from unnest(v_ids) x
  where not exists (
    select 1 from public.subject_group_options o where o.group_id = v_group.id and o.subject_id = x
  );
  if v_bad > 0 then
    raise exception '% of the chosen subjects % not offered in "%".', v_bad, case when v_bad = 1 then 'is' else 'are' end, v_group.name;
  end if;

  delete from public.student_subject_choices c
  where c.tenant_id = v_tenant and c.group_id = v_group.id and c.student_id = v_student
    and not (c.subject_id = any (v_ids));

  insert into public.student_subject_choices (tenant_id, session_id, student_id, group_id, subject_id)
  select v_tenant, v_group.session_id, v_student, v_group.id, x from unnest(v_ids) x
  on conflict (tenant_id, student_id, group_id, subject_id) do nothing;

  select count(*)::integer into v_written from public.student_subject_choices c
  where c.tenant_id = v_tenant and c.group_id = v_group.id and c.student_id = v_student;
  if v_written <> v_n then
    raise exception 'Expected % choices saved and found %. Nothing was changed.', v_n, v_written;
  end if;

  return jsonb_build_object('group', v_group.name, 'chosen', v_n);
end;
$function$;

comment on function public.subject_choice_save(uuid, uuid[], uuid) is
  'Save a student''s electives for one group (0282). A student saves their own while the group is open; the administrator saves anybody''s. Checks the class, the count and that each subject is allotted.';

revoke all on function public.subject_choice_save(uuid, uuid[], uuid) from public, anon;
grant execute on function public.subject_choice_save(uuid, uuid[], uuid) to authenticated;

-- What one student sees: their compulsory subjects, and each group allotted to
-- their class this year with its options and what they chose. INVOKER, so a
-- student reads their own, a guardian their child's, and a caller who may not
-- see the child's choices sees none. The student defaults to the caller's own.
create or replace function public.subject_choices_for_student(p_student_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid := public.current_session_id(v_tenant);
  v_student uuid := p_student_id;
  v_section uuid;
  v_class uuid;
  v_label text;
begin
  if v_student is null then
    select up.student_id into v_student from public.user_profiles up where up.id = auth.uid();
  end if;
  if v_student is null then
    return jsonb_build_object('enrolled', false);
  end if;

  select e.section_id, s.class_level_id, cl.name || ' ' || s.name
    into v_section, v_class, v_label
  from public.enrolments e
  join public.sections s on s.id = e.section_id
  join public.class_levels cl on cl.id = s.class_level_id
  where e.student_id = v_student and e.session_id = v_session and e.status = 'active';

  if v_section is null then
    return jsonb_build_object('enrolled', false);
  end if;

  return jsonb_build_object(
    'enrolled', true,
    'studentId', v_student,
    'classLabel', v_label,
    'compulsory', coalesce((
      select jsonb_agg(jsonb_build_object('id', sub.id, 'name', sub.name, 'code', sub.code) order by sub.name)
      from public.section_subjects ss
      join public.subjects sub on sub.id = ss.subject_id
      where ss.section_id = v_section and ss.session_id = v_session
        and not exists (
          select 1 from public.subject_group_options o
          join public.subject_groups g on g.id = o.group_id
          where o.subject_id = ss.subject_id and g.class_level_id = v_class and g.session_id = v_session
        )
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'min', g.min_choices,
        'max', g.max_choices,
        'isOpen', g.is_open and (g.closes_on is null or current_date <= g.closes_on),
        'closesOn', g.closes_on,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'subjectId', sub.id,
            'name', sub.name,
            'code', sub.code,
            'chosen', exists (
              select 1 from public.student_subject_choices c
              where c.group_id = g.id and c.subject_id = sub.id and c.student_id = v_student
            )
          ) order by sub.name)
          from public.subject_group_options o join public.subjects sub on sub.id = o.subject_id
          where o.group_id = g.id
        ), '[]'::jsonb)
      ) order by g.sort_order, g.name)
      from public.subject_groups g
      where g.class_level_id = v_class and g.session_id = v_session
    ), '[]'::jsonb)
  );
end;
$function$;

comment on function public.subject_choices_for_student(uuid) is
  'One student''s subjects this year: compulsory ones, and each elective group allotted to their class with what they chose (0282). INVOKER.';

-- The office's view: every group this year with how many chose each option and
-- how many of the class have not chosen yet. INVOKER, and its counts are only
-- true for a caller who can read every enrolment and every choice -- the
-- administrator. A teacher reads the enrolments of their own classes only, so
-- "enrolled" would be a plausible, smaller number (rule 4's invoker lie); the
-- screen that calls this is gated on academics.manage for that reason.
create or replace function public.subject_group_overview()
returns jsonb
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'classLevelId', g.class_level_id,
    'classLevel', cl.name,
    'min', g.min_choices,
    'max', g.max_choices,
    'isOpen', g.is_open,
    'closesOn', g.closes_on,
    'enrolled', (
      select count(*) from public.enrolments e join public.sections s on s.id = e.section_id
      where e.session_id = g.session_id and e.status = 'active' and s.class_level_id = g.class_level_id
    ),
    'chosen', (
      select count(distinct c.student_id) from public.student_subject_choices c where c.group_id = g.id
    ),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subjectId', sub.id, 'name', sub.name,
        'count', (select count(*) from public.student_subject_choices c where c.group_id = g.id and c.subject_id = sub.id)
      ) order by sub.name)
      from public.subject_group_options o join public.subjects sub on sub.id = o.subject_id
      where o.group_id = g.id
    ), '[]'::jsonb)
  ) order by cl.sequence, g.sort_order, g.name), '[]'::jsonb)
  from public.subject_groups g
  join public.class_levels cl on cl.id = g.class_level_id
  where g.session_id = public.current_session_id(public.current_tenant_id());
$function$;

revoke all on function public.subject_choices_for_student(uuid) from public, anon;
grant execute on function public.subject_choices_for_student(uuid) to authenticated;
revoke all on function public.subject_group_overview() from public, anon;
grant execute on function public.subject_group_overview() to authenticated;

-- promotion_undo asks every table that ties a student to a year, and
-- `student_subject_choices` is one now: its foreign key cascades on the
-- enrolment, so without this line an undo would silently delete electives a
-- student chose after the promotion. Unchanged otherwise; grants kept.

create or replace function public.promotion_undo(p_run_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.promotion_runs;
  v_from public.academic_sessions;
  v_to public.academic_sessions;
  v_reason text;
  v_created uuid[];
  v_movers uuid[];
  v_moved_from uuid[];
  v_grads uuid[];
  v_grad_from uuid[];
  v_dep record;
  v_n integer;
  v_blockers text[] := '{}';
  v_changed text[] := '{}';
  v_not_restored text[] := '{}';
  v_removed integer := 0;
  v_restored integer := 0;
  v_students integer := 0;
  v_concessions integer := 0;
  v_library integer := 0;
  v_seats integer := 0;
  v_beds integer := 0;
  v_expected integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can undo a promotion run';
  end if;

  select * into v_run from public.promotion_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;
  if v_run.id is null then
    raise exception 'That promotion run does not exist';
  end if;
  if v_run.status <> 'applied' then
    raise exception 'This run is %, so there is nothing to undo', v_run.status;
  end if;

  select * into v_from from public.academic_sessions where id = v_run.from_session_id;
  select * into v_to from public.academic_sessions where id = v_run.to_session_id;
  v_reason := format('Graduated from %s', v_from.name);

  -- Undoing puts this run back to draft, and only one draft may exist for a
  -- pair of years (0276). Say so rather than meeting the unique index.
  if exists (
    select 1 from public.promotion_runs r
    where r.tenant_id = v_tenant_id
      and r.from_session_id = v_run.from_session_id
      and r.to_session_id = v_run.to_session_id
      and r.status = 'draft'
  ) then
    raise exception 'There is already a draft run from % to %. Undoing puts this run back to draft, and two drafts for the same two years would disagree. Discard the other draft first.',
      v_from.name, v_to.name;
  end if;

  select
    coalesce(array_agg(d.applied_enrolment_id) filter (where d.created_enrolment and d.applied_enrolment_id is not null), '{}'),
    coalesce(array_agg(d.student_id) filter (where d.created_enrolment and d.applied_enrolment_id is not null), '{}'),
    coalesce(array_agg(d.from_enrolment_id) filter (where d.decision in ('promote', 'repeat')), '{}'),
    coalesce(array_agg(d.student_id) filter (where d.decision = 'graduate'), '{}'),
    coalesce(array_agg(d.from_enrolment_id) filter (where d.decision = 'graduate'), '{}')
  into v_created, v_movers, v_moved_from, v_grads, v_grad_from
  from public.promotion_decisions d
  where d.run_id = p_run_id and d.tenant_id = v_tenant_id;

  -- 1. What hangs off the children this run moved, in the year it moved them
  --    into. Registers are counted by enrolment because that is what their
  --    foreign key cascades on: deleting the enrolment would delete them.
  select count(*)::integer into v_n from public.attendance_records a
  where a.tenant_id = v_tenant_id and a.enrolment_id = any(v_created);
  if v_n > 0 then
    v_blockers := v_blockers || format('%s %s', v_n, case when v_n = 1 then 'register entry' else 'register entries' end);
  end if;

  for v_dep in
    select * from (values
      ('marks', 'created_at', '', 'mark', 'marks'),
      ('exam_results', 'created_at', '', 'exam result', 'exam results'),
      ('exam_remarks', 'created_at', '', 'report-card remark', 'report-card remarks'),
      ('homework_submissions', 'created_at', '', 'homework submission', 'homework submissions'),
      ('online_test_attempts', 'started_at', '', 'online test attempt', 'online test attempts'),
      ('invoices', 'created_at', '', 'invoice', 'invoices'),
      ('ledger_entries', 'created_at', '', 'fee account entry', 'fee account entries'),
      ('payment_intents', 'created_at', '', 'online payment', 'online payments'),
      ('student_concessions', 'created_at', ' and x.status = ''active''', 'fee concession', 'fee concessions'),
      ('transport_assignments', 'created_at', ' and x.status = ''active''', 'bus seat', 'bus seats'),
      ('hostel_allocations', 'created_at', ' and x.status = ''active''', 'hostel bed', 'hostel beds'),
      ('certificates', 'created_at', '', 'certificate', 'certificates'),
      ('student_leave_requests', 'created_at', '', 'leave application', 'leave applications'),
      ('visitors', 'created_at', '', 'gate visit', 'gate visits'),
      ('student_type_assignments', 'created_at', '', 'student type', 'student types'),
      ('student_subject_choices', 'created_at', '', 'elective choice', 'elective choices')
    ) as t(tbl, made_at, extra, one, many)
  loop
    -- The table and column names and the extra predicate are the literals
    -- above, never input; the values are bound. Only rows made since the run
    -- was applied: a bed booked for 2026-2027 before anybody was promoted was
    -- never written against this run's enrolments, and is exactly where it was
    -- before once the run is undone (0280).
    execute format(
      'select count(*)::integer from public.%I x where x.tenant_id = $1 and x.session_id = $2 and x.student_id = any($3) and x.%I >= $4%s',
      v_dep.tbl, v_dep.made_at, v_dep.extra
    ) into v_n using v_tenant_id, v_run.to_session_id, v_movers, v_run.applied_at;
    if v_n > 0 then
      v_blockers := v_blockers || format('%s %s', v_n, case when v_n = 1 then v_dep.one else v_dep.many end);
    end if;
  end loop;

  -- A later run that starts from these enrolments: its decisions cascade on
  -- them too.
  select count(*)::integer into v_n from public.promotion_decisions d
  where d.tenant_id = v_tenant_id and d.from_enrolment_id = any(v_created);
  if v_n > 0 then
    v_blockers := v_blockers || format('%s %s', v_n, case when v_n = 1 then 'decision in a later promotion run' else 'decisions in a later promotion run' end);
  end if;

  if cardinality(v_blockers) > 0 then
    raise exception 'This run cannot be undone: in %, the children it moved already have %. Those were written against the enrolments this run made, so removing the enrolments would delete them or leave them belonging to nobody.',
      v_to.name,
      case when cardinality(v_blockers) = 1 then v_blockers[1]
           else array_to_string(v_blockers[1:cardinality(v_blockers) - 1], ', ') || ' and ' || v_blockers[cardinality(v_blockers)] end;
  end if;

  -- 2. Rows this run wrote that somebody has changed since.
  select count(*)::integer into v_n from public.enrolments e
  where e.tenant_id = v_tenant_id and e.id = any(v_created) and e.status <> 'active';
  if v_n > 0 then
    v_changed := v_changed || format('%s %s in %s', v_n, case when v_n = 1 then 'child is no longer active' else 'children are no longer active' end, v_to.name);
  end if;

  select count(*)::integer into v_n from public.enrolments e
  where e.tenant_id = v_tenant_id
    and (e.id = any(v_moved_from) and e.status not in ('promoted', 'repeated')
         or e.id = any(v_grad_from) and e.status <> 'promoted');
  if v_n > 0 then
    v_changed := v_changed || format('%s %s in %s changed since', v_n, case when v_n = 1 then 'enrolment' else 'enrolments' end, v_from.name);
  end if;

  select count(*)::integer into v_n from public.students s
  where s.tenant_id = v_tenant_id and s.id = any(v_grads)
    and (s.status <> 'alumni' or s.exit_reason is distinct from v_reason);
  if v_n > 0 then
    v_changed := v_changed || format('%s %s been re-admitted, transferred or given another leaving reason', v_n, case when v_n = 1 then 'graduate has' else 'graduates have' end);
  end if;

  if cardinality(v_changed) > 0 then
    raise exception 'This run cannot be undone, because what it wrote has changed since: %. Putting the old values back would overwrite those later decisions.',
      array_to_string(v_changed, '; ');
  end if;

  -- 3. Undo. The enrolments this run created, and nothing it adopted.
  delete from public.enrolments e
  where e.tenant_id = v_tenant_id and e.id = any(v_created);
  get diagnostics v_removed = row_count;
  if v_removed <> cardinality(v_created) then
    raise exception 'Expected to remove % enrolments from % and removed %. Nothing was changed.',
      cardinality(v_created), v_to.name, v_removed;
  end if;

  -- The outgoing year's enrolments, active again: movers and graduates alike.
  update public.enrolments e
  set status = 'active'
  where e.tenant_id = v_tenant_id and e.id = any(v_moved_from || v_grad_from);
  get diagnostics v_restored = row_count;
  v_expected := cardinality(v_moved_from) + cardinality(v_grad_from);
  if v_restored <> v_expected then
    raise exception 'Expected to reopen % enrolments in % and reopened %. Nothing was changed.',
      v_expected, v_from.name, v_restored;
  end if;

  -- 4. Graduates. Only what the apply's own transaction ended.
  if cardinality(v_grads) > 0 then
    update public.students s
    set status = 'active',
        date_of_leaving = case when s.date_of_leaving = v_from.end_date then null else s.date_of_leaving end,
        exit_reason = null
    where s.tenant_id = v_tenant_id and s.id = any(v_grads)
      and s.status = 'alumni' and s.exit_reason = v_reason;
    get diagnostics v_students = row_count;
    if v_students <> cardinality(v_grads) then
      raise exception 'Expected to bring back % graduates and brought back %. Nothing was changed.',
        cardinality(v_grads), v_students;
    end if;

    update public.student_concessions c
    set status = 'active', revoked_at = null, revoked_by = null, revoke_reason = null
    where c.tenant_id = v_tenant_id and c.student_id = any(v_grads)
      and c.status = 'revoked' and c.revoke_reason = v_reason
      and c.updated_at = v_run.applied_at;
    get diagnostics v_concessions = row_count;

    select count(*)::integer into v_n from public.student_concessions c
    where c.tenant_id = v_tenant_id and c.student_id = any(v_grads)
      and c.status = 'revoked' and c.revoke_reason = v_reason;
    if v_n > 0 then
      v_not_restored := v_not_restored || format('%s %s revoked at graduation %s been changed since, so %s left revoked.',
        v_n, case when v_n = 1 then 'concession' else 'concessions' end,
        case when v_n = 1 then 'has' else 'have' end,
        case when v_n = 1 then 'it is' else 'they are' end);
    end if;

    update public.members m
    set status = 'active'
    where m.tenant_id = v_tenant_id and m.student_id = any(v_grads)
      and m.status = 'expired' and m.updated_at = v_run.applied_at;
    get diagnostics v_library = row_count;

    -- A future seat or bed that graduation cancelled comes back. The
    -- exclusion constraint still has the last word: if one was arranged again
    -- since, restoring this one would overlap it.
    begin
      update public.transport_assignments a
      set status = 'active'
      where a.tenant_id = v_tenant_id and a.student_id = any(v_grads)
        and a.status = 'cancelled' and a.starts_on > v_from.end_date
        and a.updated_at = v_run.applied_at;
      get diagnostics v_seats = row_count;

      update public.hostel_allocations a
      set status = 'active'
      where a.tenant_id = v_tenant_id and a.student_id = any(v_grads)
        and a.status = 'cancelled' and a.starts_on > v_from.end_date
        and a.updated_at = v_run.applied_at;
      get diagnostics v_beds = row_count;
    exception when exclusion_violation then
      raise exception 'This run cannot be undone: a bus seat or hostel bed that graduation cancelled overlaps one arranged since for the same child. Cancel the newer one first. Nothing was changed.';
    end;

    -- A seat or bed that graduation *ended* lost its old end date; there is no
    -- exact value to put back, so it is named rather than guessed.
    select count(*)::integer into v_n from (
      select 1 from public.transport_assignments a
      where a.tenant_id = v_tenant_id and a.student_id = any(v_grads)
        and a.status = 'active' and a.ends_on = v_from.end_date and a.updated_at = v_run.applied_at
      union all
      select 1 from public.hostel_allocations a
      where a.tenant_id = v_tenant_id and a.student_id = any(v_grads)
        and a.status = 'active' and a.ends_on = v_from.end_date and a.updated_at = v_run.applied_at
    ) x;
    if v_n > 0 then
      v_not_restored := v_not_restored || format('%s %s ended on %s at graduation and %s been left ended. Arrange %s again for any child who is staying.',
        v_n, case when v_n = 1 then 'seat or bed was' else 'seats and beds were' end,
        to_char(v_from.end_date, 'FMDD Mon YYYY'),
        case when v_n = 1 then 'has' else 'have' end,
        case when v_n = 1 then 'it' else 'them' end);
    end if;
  end if;

  -- 5. The run: back to a draft somebody can correct and apply again.
  update public.promotion_decisions d
  set applied_enrolment_id = null, created_enrolment = false
  where d.run_id = p_run_id and d.tenant_id = v_tenant_id
    and d.applied_enrolment_id is not null;

  update public.promotion_runs r
  set status = 'draft', applied_at = null, applied_by = null,
      left_behind = '[]'::jsonb,
      undone_at = now(), undone_by = auth.uid()
  where r.id = p_run_id and r.tenant_id = v_tenant_id and r.status = 'applied';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'The run could not be put back to draft. Nothing was changed.';
  end if;

  return jsonb_build_object(
    'removed', v_removed,
    'reopened', v_restored,
    'graduates', v_students,
    'concessions', v_concessions,
    'library', v_library,
    'seats', v_seats,
    'beds', v_beds,
    'notRestored', to_jsonb(v_not_restored)
  );
end;
$function$;
