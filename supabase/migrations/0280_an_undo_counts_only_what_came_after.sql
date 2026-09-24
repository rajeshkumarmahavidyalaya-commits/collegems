-- 0280: an undo counts only what came after the run.
--
-- Probed on the demo college the moment 0279 applied: start a run, apply it,
-- undo it -- refused with "the children it moved already have 1 hostel bed".
-- That bed was booked for 2026-2027 before the run existed. It was never
-- written against the enrolments the run made, removing them does not orphan
-- it, and after the undo it is exactly where it was before. Counting every
-- row in the receiving year made the undo refuse for the state of the school
-- rather than for what the run caused, and refuse a run on the one college
-- that tried it.
--
-- So a dependent row counts only when it was made at or after `applied_at`.
-- Registers and later runs were already counted by enrolment, which only the
-- run's own enrolments can be. `online_test_attempts` has no `created_at`;
-- its `started_at` is the same fact.
--
-- Same signature, so `create or replace` keeps 0279's grants.

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
      ('visitors', 'created_at', '', 'gate visit', 'gate visits')
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
