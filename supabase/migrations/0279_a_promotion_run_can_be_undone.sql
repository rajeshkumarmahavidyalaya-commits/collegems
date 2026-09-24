-- 0279: an applied promotion run can be undone, while nothing depends on it.
--
-- Applying a run wrote enrolments into the receiving year, closed the outgoing
-- one, and ended every graduate's relationships -- and the review screen said
-- "cannot be undone from this screen". So a run applied with the wrong year,
-- the wrong class for Grade 5 B, or fifty children graduated who were meant to
-- be kept back could only be repaired by hand, one enrolment at a time.
--
-- `promotion_undo` reverses exactly what `promotion_apply` wrote, and refuses
-- rather than guessing wherever it cannot:
--
-- 1. It deletes only the enrolments the run *created*. `promotion_apply` uses
--    `on conflict do nothing` and then adopts an enrolment that already
--    existed, so `applied_enrolment_id` alone cannot say whose it is. The
--    decision now records it (`created_enrolment`). For runs applied before
--    this migration it is recovered exactly: an enrolment created by the apply
--    has `created_at = applied_at`, both being the same transaction's `now()`.
--
-- 2. It refuses while anything in the receiving year hangs off the children it
--    moved: a register (which would be *deleted* by the enrolment's cascade),
--    marks, results, invoices, a receipt, a renewed bus seat or hostel bed, a
--    later run. It names the counts. Undo is for a mistake noticed soon after
--    applying, not for unwinding a term.
--
-- 3. It refuses when a row the run wrote has changed since -- a child withdrawn
--    in the new year, a graduate re-admitted or given a certificate -- because
--    putting the old value back would overwrite a decision somebody made later.
--
-- 4. Graduation ended relationships through `student_end_relationships`. What
--    it ended *in the apply's own transaction* is identifiable exactly: every
--    touched row carries `updated_at = applied_at` (set_updated_at stamps
--    `now()`), and a row edited since does not. Those are put back -- the
--    student's status, revoked concessions, expired library cards, cancelled
--    future seats and beds. Anything that cannot be put back exactly (a seat
--    whose end date was moved, a concession edited since) is left as it is and
--    named in the result, rather than restored to a guess.
--
-- The run goes back to `draft` so a decision can be corrected and the run
-- applied again. `undone_at` / `undone_by` keep that it was once applied; the
-- audit log keeps the rest.
--
-- INVOKER: the policies on enrolments, students, concessions, seats, beds and
-- library cards are the boundary, and each is administrator-only (librarians
-- and accountants may write some, and none of them may reach promotion). The
-- administrator check is mirrored for the message, as in `promotion_apply`.

alter table public.promotion_decisions
  add column created_enrolment boolean not null default false;

comment on column public.promotion_decisions.created_enrolment is
  'True when promotion_apply inserted applied_enrolment_id itself, false when it adopted an enrolment that already existed. Only the former is removed by promotion_undo (0279).';

update public.promotion_decisions d
set created_enrolment = true
from public.promotion_runs r, public.enrolments e
where r.id = d.run_id
  and r.status = 'applied'
  and e.id = d.applied_enrolment_id
  and e.created_at = r.applied_at;

alter table public.promotion_runs
  add column undone_at timestamptz,
  add column undone_by uuid references auth.users (id) on delete set null;

comment on column public.promotion_runs.undone_at is
  'When an applied run was last undone and put back to draft (0279). Null for a run never undone.';

-- promotion_apply, unchanged except that it records whether it created the
-- enrolment. Same signature, so `create or replace` keeps its grants.
create or replace function public.promotion_apply(p_run_id uuid)
returns table(promoted integer, repeated integer, graduated integer, held integer, carried integer, ended_transport integer, ended_hostel integer, ended_concessions integer, left_behind jsonb)
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.promotion_runs;
  v_from_name text;
  v_from_ends date;
  v_decision record;
  v_enrolment_id uuid;
  v_created boolean;
  v_closed jsonb;
  v_promoted integer := 0;
  v_repeated integer := 0;
  v_graduated integer := 0;
  v_held integer := 0;
  v_carried integer := 0;
  v_transport integer := 0;
  v_hostel integer := 0;
  v_concessions integer := 0;
  v_left jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can apply a promotion run';
  end if;

  select * into v_run from public.promotion_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;

  if v_run.id is null then
    raise exception 'That promotion run does not exist';
  end if;

  if v_run.status <> 'draft' then
    raise exception 'This run is %, so it cannot be applied again', v_run.status;
  end if;

  select s.name, s.end_date into v_from_name, v_from_ends
  from public.academic_sessions s where s.id = v_run.from_session_id;

  for v_decision in
    select * from public.promotion_decisions d
    where d.run_id = p_run_id and d.tenant_id = v_tenant_id
    order by d.created_at
  loop
    v_enrolment_id := null;
    v_created := false;

    if v_decision.decision in ('promote', 'repeat') then
      insert into public.enrolments (
        tenant_id, session_id, student_id, section_id, roll_number, status
      ) values (
        v_tenant_id, v_run.to_session_id, v_decision.student_id,
        v_decision.to_section_id, null, 'active'
      )
      on conflict (tenant_id, session_id, student_id) do nothing
      returning id into v_enrolment_id;

      v_created := v_enrolment_id is not null;

      if v_enrolment_id is null then
        select en.id into v_enrolment_id from public.enrolments en
        where en.tenant_id = v_tenant_id
          and en.session_id = v_run.to_session_id
          and en.student_id = v_decision.student_id;
      end if;

      update public.enrolments
      set status = case when v_decision.decision = 'promote' then 'promoted' else 'repeated' end
      where id = v_decision.from_enrolment_id;

      if v_decision.decision = 'promote' then
        v_promoted := v_promoted + 1;
      else
        v_repeated := v_repeated + 1;
      end if;

      -- The debt stays on the outgoing year's account, where a receipt
      -- settles it (0186), and the new year shows it as arrears (0187).
      -- Raising an "opening balance" invoice here as well billed it twice
      -- (0276). This counts the children who move on owing.
      if v_decision.outstanding > 0 then
        v_carried := v_carried + 1;
      end if;

    elsif v_decision.decision = 'graduate' then
      -- The outgoing year first, and with the right word: a graduate finished
      -- it. `student_end_relationships` then finds no active enrolment.
      update public.enrolments set status = 'promoted'
      where id = v_decision.from_enrolment_id;

      -- Leaving is an act, not a flag (rule 12). Dated to the end of the
      -- outgoing year rather than to today, because that is when they left.
      v_closed := public.student_end_relationships(
        v_decision.student_id, v_from_ends, 'alumni',
        format('Graduated from %s', v_from_name)
      );

      v_transport := v_transport + (v_closed ->> 'transport')::integer;
      v_hostel := v_hostel + (v_closed ->> 'hostel')::integer;
      v_concessions := v_concessions + (v_closed ->> 'concessions')::integer;
      v_graduated := v_graduated + 1;

    else
      v_held := v_held + 1;
    end if;

    if v_enrolment_id is not null then
      -- Whether this run made the enrolment or adopted one somebody else
      -- made: only the first is this run's to remove on undo (0279).
      update public.promotion_decisions
      set applied_enrolment_id = v_enrolment_id,
          created_enrolment = v_created
      where id = v_decision.id;
    end if;
  end loop;

  -- What this run could not close, computed once for the cohort by
  -- `promotion_left_behind` rather than inline here, so the preview screen can
  -- ask the same question of a draft.
  v_left := public.promotion_left_behind(p_run_id);

  update public.promotion_runs
  set status = 'applied', applied_at = now(), applied_by = auth.uid(),
      left_behind = v_left
  where id = p_run_id;

  return query select
    v_promoted, v_repeated, v_graduated, v_held, v_carried,
    v_transport, v_hostel, v_concessions, v_left;
end;
$function$;

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
      ('marks', '', 'mark', 'marks'),
      ('exam_results', '', 'exam result', 'exam results'),
      ('exam_remarks', '', 'report-card remark', 'report-card remarks'),
      ('homework_submissions', '', 'homework submission', 'homework submissions'),
      ('online_test_attempts', '', 'online test attempt', 'online test attempts'),
      ('invoices', '', 'invoice', 'invoices'),
      ('ledger_entries', '', 'fee account entry', 'fee account entries'),
      ('payment_intents', '', 'online payment', 'online payments'),
      ('student_concessions', ' and x.status = ''active''', 'fee concession', 'fee concessions'),
      ('transport_assignments', ' and x.status = ''active''', 'bus seat', 'bus seats'),
      ('hostel_allocations', ' and x.status = ''active''', 'hostel bed', 'hostel beds'),
      ('certificates', '', 'certificate', 'certificates'),
      ('student_leave_requests', '', 'leave application', 'leave applications'),
      ('visitors', '', 'gate visit', 'gate visits')
    ) as t(tbl, extra, one, many)
  loop
    -- The table names and the extra predicate are the literals above, never
    -- input; the values are bound.
    execute format(
      'select count(*)::integer from public.%I x where x.tenant_id = $1 and x.session_id = $2 and x.student_id = any($3)%s',
      v_dep.tbl, v_dep.extra
    ) into v_n using v_tenant_id, v_run.to_session_id, v_movers;
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

comment on function public.promotion_undo(uuid) is
  'Reverse an applied promotion run while nothing in the receiving year depends on it: remove the enrolments it created, reopen the outgoing year, bring graduates back with what their graduation ended, and put the run back to draft. Refuses, naming counts, when registers, marks, invoices, seats or a later run hang off the children it moved, or when what it wrote has changed since (0279).';

revoke all on function public.promotion_undo(uuid) from public, anon;
grant execute on function public.promotion_undo(uuid) to authenticated, service_role;
