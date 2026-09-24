-- 0281: a fee can differ by the kind of student paying it.
--
-- `fee_structures` is keyed on (session, class, head), so every child in a
-- class paid the same for every head. A college does not work that way: a
-- carry-over student -- promoted with papers still to clear -- pays a different
-- examination fee from a regular one in the same class, and a college may have
-- other kinds (private candidates, a management quota) with their own rates.
--
-- The model, and why each part is the shape it is:
--
-- 1. `student_types` is a per-college list (rule 12: a school decides what
--    kinds of student it has). Seeded with one, *Carry-over*. There is no
--    "Regular" row: a student with no type is the ordinary case, and the
--    ordinary fee is the one with no type on it.
--
-- 2. `student_type_assignments` says which kind a child is **in a year**
--    (rule 2): carry-over is a fact about 2026-2027, not about the child for
--    ever. One row per (session, student), and a composite foreign key onto
--    `enrolments (tenant_id, session_id, student_id)` so a child can only be
--    given a type for a year they are enrolled in. It is its own table rather
--    than a column on `enrolments` because the people who decide fees -- an
--    administrator and an accountant, the `fee_structures` policy -- are not
--    the people who may rewrite a child's enrolment, which only an
--    administrator may. Readable by the same finance roles and nobody else:
--    whether a child is carrying papers is not something another family
--    should be able to read (unlike the fee catalogue, which is public to the
--    college).
--
-- 3. `fee_structures.student_type_id`, null meaning *every student*. A row
--    with a type **replaces** the untyped row for the same class and head, for
--    children of that type only -- it does not add to it. An amount of 0 on a
--    typed row means "this kind of student does not pay this head". The unique
--    key gains the column with NULLS NOT DISTINCT, so there is still exactly
--    one untyped row per (session, class, head).
--
-- 4. `fees_billable_lines` -- the one definition of "what would this child be
--    charged" (rule 6) -- applies it, so the invoice run, a single invoice and
--    every preview agree. The line names the type ("Exam fee (Carry-over)"),
--    because a family reading a bill larger than their neighbour's deserves to
--    see why.
--
-- `fees_roll_forward_structures` copies typed rows too; its old ON CONFLICT
-- target named the old key and would have raised once the key changed.

create table public.student_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (length(trim(name)) between 2 and 60),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

comment on table public.student_types is
  'The kinds of student a college charges differently (0281), e.g. Carry-over. A student with no type is a regular student and pays the untyped fee.';

create trigger set_updated_at before update on public.student_types
  for each row execute function public.set_updated_at();
create trigger audit_student_types after insert or update or delete on public.student_types
  for each row execute function public.audit_row_change();

alter table public.student_types enable row level security;

create policy "tenant members view student_types" on public.student_types
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy "finance roles manage student_types" on public.student_types
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = any (array['admin', 'accountant']))
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_role_code()) = any (array['admin', 'accountant']));

insert into public.student_types (tenant_id, code, name, description)
select t.id, 'carry_over', 'Carry-over',
       'Promoted with papers still to clear. Pays the carry-over amount wherever one is set, and the regular amount everywhere else.'
from public.tenants t
on conflict (tenant_id, code) do nothing;

create table public.student_type_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  student_type_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, session_id, student_id),
  -- A type is given for a year the child is enrolled in. Cascade: removing the
  -- enrolment (a promotion undone) removes what was said about that year.
  constraint student_type_assignments_enrolment_fkey
    foreign key (tenant_id, session_id, student_id)
    references public.enrolments (tenant_id, session_id, student_id) on delete cascade,
  -- Restrict: a type in use cannot be deleted, only switched off.
  constraint student_type_assignments_type_fkey
    foreign key (tenant_id, student_type_id)
    references public.student_types (tenant_id, id) on delete restrict
);

create index student_type_assignments_type_idx
  on public.student_type_assignments (tenant_id, student_type_id);

comment on table public.student_type_assignments is
  'Which kind of student a child is in one academic year (0281). No row means a regular student.';

create trigger set_updated_at before update on public.student_type_assignments
  for each row execute function public.set_updated_at();
create trigger audit_student_type_assignments after insert or update or delete on public.student_type_assignments
  for each row execute function public.audit_row_change();

alter table public.student_type_assignments enable row level security;

-- Finance roles only, deliberately: a family has no policy here, and neither
-- does a teacher. Whether a child is carrying papers is a fact about them, and
-- the invoice line already tells their own family why the amount differs.
create policy "finance roles manage student_type_assignments" on public.student_type_assignments
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_role_code()) = any (array['admin', 'accountant']))
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_role_code()) = any (array['admin', 'accountant']));

alter table public.fee_structures
  add column student_type_id uuid;

alter table public.fee_structures
  add constraint fee_structures_student_type_fkey
    foreign key (tenant_id, student_type_id)
    references public.student_types (tenant_id, id) on delete restrict;

alter table public.fee_structures
  drop constraint fee_structures_tenant_id_session_id_class_level_id_fee_head_key;

alter table public.fee_structures
  add constraint fee_structures_one_per_type
    unique nulls not distinct (tenant_id, session_id, class_level_id, fee_head_id, student_type_id);

comment on column public.fee_structures.student_type_id is
  'Null: what every student in the class pays. Set: what students of that type pay instead, for this head only (0281). An amount of 0 exempts them.';

-- The one definition of what a child would be charged (rule 6). Unchanged
-- except the structure branch: a row for the child's own type replaces the
-- untyped row for the same head. Same signature, so grants are kept.
create or replace function public.fees_billable_lines(p_student_id uuid, p_instalment_id uuid default null::uuid, p_as_of date default null::date, p_fee_head_ids uuid[] default null::uuid[])
returns table(fee_head_id uuid, description text, amount numeric, source text)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with period as (
    select fi.collects, fi.period_start, fi.due_date
    from public.fee_instalments fi
    where fi.id = p_instalment_id
  ),
  as_of as (
    select coalesce(
      p_as_of,
      (select coalesce(period_start, due_date) from period),
      current_date
    ) as d
  )
  select fs.fee_head_id,
         (fh.name || coalesce(' (' || st.name || ')', ''))::text,
         fs.amount,
         'structure'::text
  from public.fee_structures fs
  join public.fee_heads fh on fh.id = fs.fee_head_id
  left join public.student_types st on st.id = fs.student_type_id
  where fs.session_id = public.current_session_id(public.current_tenant_id())
    and fs.class_level_id = (
      select s.class_level_id
      from public.enrolments e
      join public.sections s on s.id = e.section_id
      where e.student_id = p_student_id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
      limit 1
    )
    -- The child's own type's amount where one is set; otherwise the amount
    -- everybody pays. Scalar subqueries, not a CTE: this function is inlined
    -- into its callers (0089).
    and (
      fs.student_type_id = (
        select a.student_type_id
        from public.student_type_assignments a
        where a.student_id = p_student_id
          and a.session_id = public.current_session_id(public.current_tenant_id())
      )
      or (
        fs.student_type_id is null
        and not exists (
          select 1
          from public.fee_structures o
          where o.tenant_id = fs.tenant_id
            and o.session_id = fs.session_id
            and o.class_level_id = fs.class_level_id
            and o.fee_head_id = fs.fee_head_id
            and o.student_type_id = (
              select a.student_type_id
              from public.student_type_assignments a
              where a.student_id = p_student_id
                and a.session_id = public.current_session_id(public.current_tenant_id())
            )
        )
      )
    )
    and fh.is_active
    and fs.amount > 0
    and (p_fee_head_ids is null or fs.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where fs.frequency = any (pp.collects))
    )

  union all

  select t.fee_head_id, t.description, t.amount, 'transport'::text
  from public.transport_fee_lines(p_student_id, (select d from as_of)) t
  join public.fee_heads fh on fh.id = t.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or t.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )

  union all

  select hl.fee_head_id, hl.description, hl.amount, 'hostel'::text
  from public.hostel_fee_lines(p_student_id, (select d from as_of)) hl
  join public.fee_heads fh on fh.id = hl.fee_head_id
  where fh.is_active
    and (p_fee_head_ids is null or hl.fee_head_id = any (p_fee_head_ids))
    and (
      p_instalment_id is null
      or exists (select 1 from period pp where 'monthly' = any (pp.collects))
    )
$function$;

-- Copies typed rows too, and names the new key. Same signature.
create or replace function public.fees_roll_forward_structures(p_from_session_id uuid, p_to_session_id uuid)
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_created integer;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college first.' using errcode = '42501';
  end if;
  -- Mirrors "finance roles manage fee_structures", for the message: a failed
  -- INSERT policy raises, and not in a sentence (0257).
  if (select public.current_role_code()) not in ('admin', 'accountant') then
    raise exception 'Only an administrator or an accountant can set fees.' using errcode = '42501';
  end if;

  perform public.academics_require_later_year(p_from_session_id, p_to_session_id);

  insert into public.fee_structures (tenant_id, session_id, class_level_id, fee_head_id, amount, frequency, student_type_id)
  select f.tenant_id, p_to_session_id, f.class_level_id, f.fee_head_id, f.amount, f.frequency, f.student_type_id
  from public.fee_structures f
  where f.tenant_id = v_tenant
    and f.session_id = p_from_session_id
  on conflict (tenant_id, session_id, class_level_id, fee_head_id, student_type_id) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$function$;

-- Give a child a type for the current year, or take it away (null). INVOKER:
-- the policy above is the boundary, mirrored here for the sentence, because a
-- refused INSERT raises a policy error and a refused DELETE touches nothing.
create or replace function public.student_type_assign(p_student_id uuid, p_student_type_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_session uuid;
  v_session_name text;
  v_type public.student_types;
  v_n integer;
begin
  if v_tenant is null then
    raise exception 'Sign in to a college first.' using errcode = '42501';
  end if;
  if (select public.current_role_code()) not in ('admin', 'accountant') then
    raise exception 'Only an administrator or an accountant can change what kind of student somebody is, because it changes what they are charged.' using errcode = '42501';
  end if;

  v_session := public.current_session_id(v_tenant);
  select s.name into v_session_name from public.academic_sessions s where s.id = v_session;

  if not exists (
    select 1 from public.enrolments e
    where e.tenant_id = v_tenant and e.session_id = v_session and e.student_id = p_student_id
  ) then
    raise exception 'This student is not enrolled in %, so there is no year to say what kind of student they are in.', v_session_name;
  end if;

  if p_student_type_id is null then
    delete from public.student_type_assignments a
    where a.tenant_id = v_tenant and a.session_id = v_session and a.student_id = p_student_id;
    get diagnostics v_n = row_count;
    return jsonb_build_object('type', null, 'changed', v_n > 0);
  end if;

  select * into v_type from public.student_types t
  where t.id = p_student_type_id and t.tenant_id = v_tenant;
  if v_type.id is null then
    raise exception 'That kind of student does not exist in this college.';
  end if;
  if not v_type.is_active then
    raise exception '"%" is switched off. Switch it back on under Fee setup before giving it to anybody.', v_type.name;
  end if;

  insert into public.student_type_assignments (tenant_id, session_id, student_id, student_type_id)
  values (v_tenant, v_session, p_student_id, p_student_type_id)
  on conflict (tenant_id, session_id, student_id)
  do update set student_type_id = excluded.student_type_id
  where public.student_type_assignments.student_type_id is distinct from excluded.student_type_id;
  get diagnostics v_n = row_count;

  return jsonb_build_object('type', v_type.name, 'changed', v_n > 0);
end;
$function$;

comment on function public.student_type_assign(uuid, uuid) is
  'Say what kind of student a child is in the current year (null for regular). Changes what fees_billable_lines charges them from the next invoice on; invoices already raised are not rewritten (0281).';

revoke all on function public.student_type_assign(uuid, uuid) from public, anon;
grant execute on function public.student_type_assign(uuid, uuid) to authenticated, service_role;

-- promotion_undo asks every table that ties a student to a year whether
-- anything was written there since the run was applied, and
-- `student_type_assignments` is one now. Its foreign key cascades on the
-- enrolment, so without this line an undo would silently delete a type an
-- accountant set after the promotion. `tests/promotion/undo.test.ts` fails
-- until it is listed. Unchanged otherwise; same signature, grants kept.

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
      ('student_type_assignments', 'created_at', '', 'student type', 'student types')
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
