-- Phase 1.4, part 2 -- the promotion engine.
--
-- THE RULES DOCUMENT
--
-- {
--   "no_detention_up_to_sequence": 8,
--   "criteria": {
--     "require_exam_pass": true,
--     "exam_kind": "annual",
--     "max_failed_subjects": 0,
--     "min_attendance_percent": 75
--   },
--   "on_missing_result": "hold",
--   "carry_forward_fees": true
-- }
--
-- Every key is optional, and an empty `{}` promotes everybody who has somewhere
-- to go -- which is a real policy (plenty of primary schools have exactly that
-- one), not a degenerate case.
--
-- EVALUATION ORDER, WHICH IS THE PART THAT MATTERS
--
--   1. No-detention band. A class at or below `no_detention_up_to_sequence` is
--      promoted regardless of marks or attendance. It comes first because that
--      is what the policy means -- it is a statutory override, not a tie-break.
--   2. Attendance. Below `min_attendance_percent` repeats, even having passed.
--   3. The examination. `require_exam_pass` false promotes everyone past 1-2.
--   4. A missing result falls to `on_missing_result` -- `hold` by default,
--      because "we have not marked this child yet" is not the same answer as
--      "this child failed", and defaulting to either of the other two quietly
--      decides something nobody decided.
--
-- Then the shape of the school decides the rest: a promotion with no next class
-- level is a graduation; a promotion or repeat with no section to land in is a
-- `hold`, with the reason saying which section is missing.

-- ---------------------------------------------------------------------------
-- Criticising a rules document
-- ---------------------------------------------------------------------------

create or replace function public.promotion_rule_problems(p_rules jsonb)
returns table (problem text)
language sql
immutable
set search_path = public, extensions
as $$
  select 'Promotion is conditional on an examination, but no exam kind was named, so nothing will match.'
  where coalesce((p_rules -> 'criteria' ->> 'require_exam_pass')::boolean, false)
    and coalesce(p_rules -> 'criteria' ->> 'exam_kind', '') = ''

  union all
  select 'Promotion is not conditional on anything, so every student with somewhere to go will be promoted.'
  where not coalesce((p_rules -> 'criteria' ->> 'require_exam_pass')::boolean, false)
    and (p_rules -> 'criteria' ->> 'min_attendance_percent') is null
    and (p_rules ->> 'no_detention_up_to_sequence') is null

  union all
  select 'An attendance minimum above 100% can never be met.'
  where coalesce((p_rules -> 'criteria' ->> 'min_attendance_percent')::numeric, 0) > 100

  union all
  select 'A negative number of failed subjects cannot be allowed.'
  where coalesce((p_rules -> 'criteria' ->> 'max_failed_subjects')::integer, 0) < 0

  union all
  select 'When a result is missing the run must hold, promote or repeat -- "'
         || (p_rules ->> 'on_missing_result') || '" is none of those.'
  where coalesce(p_rules ->> 'on_missing_result', 'hold') not in ('hold', 'promote', 'repeat')

  union all
  select 'Results are ignored below the no-detention band, and the band covers every class in this school, so the examination criterion will never be consulted.'
  where (p_rules ->> 'no_detention_up_to_sequence') is not null
    and coalesce((p_rules -> 'criteria' ->> 'require_exam_pass')::boolean, false)
    and (p_rules ->> 'no_detention_up_to_sequence')::integer
        >= (select coalesce(max(cl.sequence), 0) from public.class_levels cl)
$$;

revoke all on function public.promotion_rule_problems(jsonb) from public, anon;
grant execute on function public.promotion_rule_problems(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Building next year's classes
-- ---------------------------------------------------------------------------

-- `sections` are session-scoped, so next year's 6B is a different row from this
-- year's. Promotion cannot invent them -- a section carries a capacity and a
-- class teacher, which are decisions -- but making an administrator retype
-- twelve of them before they can even see a preview is the kind of friction
-- that gets a product abandoned in June.
--
-- So: copy the shape, keep nothing that is a per-year decision except the
-- class teacher, and skip anything that already exists.
create or replace function public.academics_roll_forward_sections(
  p_from_session_id uuid,
  p_to_session_id uuid
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_from_session_id = p_to_session_id then
    raise exception 'Pick two different sessions';
  end if;

  insert into public.sections (tenant_id, class_level_id, session_id, name, capacity, class_teacher_staff_id)
  select s.tenant_id, s.class_level_id, p_to_session_id, s.name, s.capacity, s.class_teacher_staff_id
  from public.sections s
  where s.tenant_id = v_tenant_id
    and s.session_id = p_from_session_id
    and not exists (
      select 1 from public.sections existing
      where existing.tenant_id = s.tenant_id
        and existing.session_id = p_to_session_id
        and existing.class_level_id = s.class_level_id
        and existing.name = s.name
    );

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

revoke all on function public.academics_roll_forward_sections(uuid, uuid) from public, anon;
grant execute on function public.academics_roll_forward_sections(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The preview
-- ---------------------------------------------------------------------------

-- Pure computation. Runs before a run exists, so an administrator can try three
-- sets of rules and look at what each does before committing to one.
create or replace function public.promotion_preview(
  p_from_session_id uuid,
  p_to_session_id uuid,
  p_rules jsonb default '{}'::jsonb
)
returns table (
  student_id uuid,
  admission_number text,
  student_name text,
  roll_number text,
  from_enrolment_id uuid,
  from_section_id uuid,
  from_section_label text,
  from_sequence integer,
  decision text,
  reason text,
  to_section_id uuid,
  to_section_label text,
  exam_result text,
  subjects_failed integer,
  attendance_percent numeric,
  outstanding numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with cfg as (
    select
      (p_rules ->> 'no_detention_up_to_sequence')::integer                       as no_detention,
      coalesce((p_rules -> 'criteria' ->> 'require_exam_pass')::boolean, false)  as require_pass,
      coalesce(p_rules -> 'criteria' ->> 'exam_kind', 'annual')                  as exam_kind,
      coalesce((p_rules -> 'criteria' ->> 'max_failed_subjects')::integer, 0)    as max_failed,
      (p_rules -> 'criteria' ->> 'min_attendance_percent')::numeric              as min_attendance,
      coalesce(p_rules ->> 'on_missing_result', 'hold')                          as on_missing
  ),
  -- The examination that decides. Only a published one counts: a draft result
  -- is a number still being argued about, and promoting on it would be acting
  -- on something the school has not agreed to yet.
  deciding_exam as (
    select e.id
    from public.exams e
    cross join cfg c
    where e.session_id = p_from_session_id
      and e.kind = c.exam_kind
      and e.status = 'published'
    order by e.starts_on desc nulls last, e.created_at desc
    limit 1
  ),
  levels as (
    select cl.id, cl.sequence, cl.name,
      lead(cl.id) over (order by cl.sequence) as next_level_id
    from public.class_levels cl
  ),
  roll as (
    select
      en.id as from_enrolment_id,
      en.student_id,
      en.roll_number,
      en.section_id as from_section_id,
      sec.name as from_section_name,
      lv.sequence as from_sequence,
      lv.id as from_level_id,
      lv.next_level_id,
      (lv.name || ' ' || sec.name)::text as from_section_label,
      st.admission_number,
      (p.first_name || ' ' || p.last_name)::text as student_name
    from public.enrolments en
    join public.sections sec on sec.id = en.section_id
    join levels lv on lv.id = sec.class_level_id
    join public.students st on st.id = en.student_id
    join public.people p on p.id = st.person_id
    where en.session_id = p_from_session_id
      and en.status = 'active'
  ),
  -- The attendance module's own rule, restated: late counts as attended, and an
  -- excused day is left out of the denominator rather than counted against the
  -- student. Two places computing "attendance %" differently is how a child
  -- repeats a year over a rounding disagreement.
  attendance as (
    select
      ar.enrolment_id,
      round(
        100.0 * count(*) filter (where ar.status in ('present', 'late'))
        / nullif(count(*) filter (where ar.status in ('present', 'late', 'absent')), 0),
        1
      ) as percent
    from public.attendance_records ar
    where ar.session_id = p_from_session_id and ar.period = 0
    group by ar.enrolment_id
  ),
  -- Outstanding at the end of the outgoing year. Computed here rather than
  -- through `fees_student_balances`, which is bound to whichever session is
  -- current -- and the whole point of a rollover is that the session you are
  -- leaving may not be. Same arithmetic: billed, plus the signed ledger, where
  -- positive means "owes more".
  balances as (
    select
      b.student_id,
      greatest(coalesce(sum(b.amount), 0), 0) as outstanding
    from (
      select il.student_id, il.amount
      from (
        select i.student_id, l.amount
        from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
        where l.session_id = p_from_session_id and i.status = 'issued'
      ) il
      union all
      select le.student_id, le.amount
      from public.ledger_entries le
      where le.session_id = p_from_session_id
    ) b
    group by b.student_id
  ),
  scored as (
    select
      r.*,
      er.result as exam_result,
      er.subjects_failed,
      att.percent as attendance_percent,
      coalesce(bal.outstanding, 0) as outstanding,
      c.*
    from roll r
    cross join cfg c
    left join attendance att on att.enrolment_id = r.from_enrolment_id
    left join balances bal on bal.student_id = r.student_id
    left join public.exam_results er
      on er.exam_id = (select id from deciding_exam)
     and er.student_id = r.student_id
  ),
  judged as (
    select
      s.*,
      case
        -- 1. The no-detention band overrides everything, because that is what
        --    the policy is: a statutory floor, not a tie-break.
        when s.no_detention is not null and s.from_sequence <= s.no_detention
          then 'promote'
        -- 2. Attendance.
        when s.min_attendance is not null
             and coalesce(s.attendance_percent, 0) < s.min_attendance
          then 'repeat'
        -- 3. No examination criterion at all.
        when not s.require_pass then 'promote'
        -- 4. A missing result is its own answer, never silently a failure.
        when s.exam_result is null then s.on_missing
        when s.exam_result = 'pass' then 'promote'
        when s.exam_result = 'incomplete' then s.on_missing
        when coalesce(s.subjects_failed, 0) <= s.max_failed then 'promote'
        else 'repeat'
      end as intent,
      case
        when s.no_detention is not null and s.from_sequence <= s.no_detention
          then 'No-detention policy up to class sequence ' || s.no_detention::text
        when s.min_attendance is not null
             and coalesce(s.attendance_percent, 0) < s.min_attendance
          then 'Attendance ' || coalesce(s.attendance_percent, 0)::text
               || '% is below the required ' || s.min_attendance::text || '%'
        when not s.require_pass then 'Promotion is not conditional on an examination'
        when s.exam_result is null then 'No published result for the deciding examination'
        when s.exam_result = 'pass' then 'Passed the examination'
        when s.exam_result = 'incomplete' then 'The examination result is incomplete'
        when coalesce(s.subjects_failed, 0) <= s.max_failed
          then 'Failed ' || coalesce(s.subjects_failed, 0)::text
               || ' subject(s), within the allowance of ' || s.max_failed::text
        else 'Failed ' || coalesce(s.subjects_failed, 0)::text || ' subject(s)'
      end as intent_reason
    from scored s
  ),
  placed as (
    select
      j.*,
      -- Promote lands in the next class level; repeat lands in the same one.
      case when j.intent = 'promote' then j.next_level_id else j.from_level_id end
        as target_level_id
    from judged j
  ),
  targeted as (
    select
      p.*,
      tgt.id as target_section_id,
      tgt.label as target_section_label
    from placed p
    left join lateral (
      select sec.id, (lv.name || ' ' || sec.name)::text as label
      from public.sections sec
      join public.class_levels lv on lv.id = sec.class_level_id
      where sec.session_id = p_to_session_id
        and sec.class_level_id = p.target_level_id
      -- Same letter where it exists: a child in 6B expects to be in 7B, and a
      -- rollover that reshuffles every class alphabetically is a rollover
      -- somebody has to undo by hand.
      order by (sec.name = p.from_section_name) desc, sec.name
      limit 1
    ) tgt on true
    where p.target_level_id is not null or p.intent = 'promote'
  )
  select
    t.student_id,
    t.admission_number,
    t.student_name,
    t.roll_number,
    t.from_enrolment_id,
    t.from_section_id,
    t.from_section_label,
    t.from_sequence,
    case
      when t.intent = 'promote' and t.next_level_id is null then 'graduate'
      when t.intent in ('promote', 'repeat') and t.target_section_id is null then 'hold'
      else t.intent
    end as decision,
    case
      when t.intent = 'promote' and t.next_level_id is null
        then t.intent_reason || ', and this is the final class — so this is a graduation'
      when t.intent in ('promote', 'repeat') and t.target_section_id is null
        then t.intent_reason || ', but the receiving session has no matching class to move into'
      else t.intent_reason
    end as reason,
    case
      when t.intent = 'promote' and t.next_level_id is null then null
      else t.target_section_id
    end as to_section_id,
    case
      when t.intent = 'promote' and t.next_level_id is null then null
      else t.target_section_label
    end as to_section_label,
    t.exam_result,
    t.subjects_failed,
    t.attendance_percent,
    t.outstanding
  from targeted t
  order by t.from_sequence, t.from_section_label, t.roll_number nulls last, t.student_name
$$;

revoke all on function public.promotion_preview(uuid, uuid, jsonb) from public, anon;
grant execute on function public.promotion_preview(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Materialising a run
-- ---------------------------------------------------------------------------

create or replace function public.promotion_start_run(
  p_from_session_id uuid,
  p_to_session_id uuid,
  p_rules jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can start a promotion run';
  end if;

  if p_from_session_id = p_to_session_id then
    raise exception 'A promotion run moves students between two different sessions';
  end if;

  if exists (
    select 1 from public.promotion_runs r
    where r.tenant_id = v_tenant_id
      and r.from_session_id = p_from_session_id
      and r.to_session_id = p_to_session_id
      and r.status <> 'discarded'
  ) then
    raise exception 'There is already a run for those two sessions. Open it, or discard it first.';
  end if;

  insert into public.promotion_runs (
    tenant_id, from_session_id, to_session_id, rules, created_by
  ) values (
    v_tenant_id, p_from_session_id, p_to_session_id, coalesce(p_rules, '{}'::jsonb), auth.uid()
  )
  returning id into v_run_id;

  insert into public.promotion_decisions (
    tenant_id, run_id, student_id, from_enrolment_id,
    decision, to_section_id, reason, carry_forward
  )
  select
    v_tenant_id, v_run_id, pv.student_id, pv.from_enrolment_id,
    pv.decision, pv.to_section_id, pv.reason,
    case
      when coalesce((p_rules ->> 'carry_forward_fees')::boolean, false)
      then pv.outstanding else 0
    end
  from public.promotion_preview(p_from_session_id, p_to_session_id, p_rules) pv;

  if not exists (select 1 from public.promotion_decisions d where d.run_id = v_run_id) then
    raise exception 'That session has no active enrolments, so there is nobody to promote';
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.promotion_start_run(uuid, uuid, jsonb) from public, anon;
grant execute on function public.promotion_start_run(uuid, uuid, jsonb) to authenticated;

create or replace function public.promotion_discard_run(p_run_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_status text;
begin
  select status into v_status from public.promotion_runs r
  where r.id = p_run_id and r.tenant_id = v_tenant_id;

  if v_status is null then
    raise exception 'That promotion run does not exist';
  end if;

  -- An applied run is history. Discarding it would leave enrolments nothing
  -- explains, which is the opposite of what the run is for.
  if v_status = 'applied' then
    raise exception 'This run has been applied, so it cannot be discarded';
  end if;

  update public.promotion_runs set status = 'discarded' where id = p_run_id;
end;
$$;

revoke all on function public.promotion_discard_run(uuid) from public, anon;
grant execute on function public.promotion_discard_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Applying it
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, unlike `exams_publish`. The difference is that everything
-- this writes -- enrolments, invoices, invoice lines -- already has an admin
-- policy, so RLS can decide every row and the function only needs to supply
-- atomicity. A definer function here would take authority it does not need.
--
-- What it writes is what the DECISIONS say, not what the rules said. That is
-- the whole point of the preview: by the time this runs, a person may have
-- changed three of them.
create or replace function public.promotion_apply(p_run_id uuid)
returns table (promoted integer, repeated integer, graduated integer, held integer, carried integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.promotion_runs;
  v_decision record;
  v_enrolment_id uuid;
  v_invoice_id uuid;
  v_promoted integer := 0;
  v_repeated integer := 0;
  v_graduated integer := 0;
  v_held integer := 0;
  v_carried integer := 0;
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

  for v_decision in
    select * from public.promotion_decisions d
    where d.run_id = p_run_id and d.tenant_id = v_tenant_id
    order by d.created_at
  loop
    v_enrolment_id := null;

    if v_decision.decision in ('promote', 'repeat') then
      -- Idempotent on the enrolment's own unique key: a student already placed
      -- in the receiving session keeps that placement rather than gaining a
      -- second one. A rollover that is retried after a timeout must converge.
      insert into public.enrolments (
        tenant_id, session_id, student_id, section_id, roll_number, status
      ) values (
        v_tenant_id, v_run.to_session_id, v_decision.student_id,
        v_decision.to_section_id, null, 'active'
      )
      on conflict (tenant_id, session_id, student_id) do nothing
      returning id into v_enrolment_id;

      if v_enrolment_id is null then
        select en.id into v_enrolment_id from public.enrolments en
        where en.tenant_id = v_tenant_id
          and en.session_id = v_run.to_session_id
          and en.student_id = v_decision.student_id;
      end if;

      -- The outgoing year is closed with the word that describes what happened
      -- to it, which is what makes `enrolments` a history rather than a
      -- snapshot.
      update public.enrolments
      set status = case when v_decision.decision = 'promote' then 'promoted' else 'repeated' end
      where id = v_decision.from_enrolment_id;

      if v_decision.decision = 'promote' then
        v_promoted := v_promoted + 1;
      else
        v_repeated := v_repeated + 1;
      end if;

      -- Carry-forward is a charge in the receiving year, not a copied balance.
      -- Rule 6: money moves by documents, so what crosses the year boundary is
      -- an invoice the family can be shown, with its own gapless number.
      if v_decision.carry_forward > 0 then
        insert into public.invoices (
          tenant_id, session_id, student_id, invoice_number, issue_date, due_date, notes, issued_by
        ) values (
          v_tenant_id, v_run.to_session_id, v_decision.student_id,
          public.fees_next_document_number_for(v_tenant_id, v_run.to_session_id, 'invoice'),
          current_date, current_date, 'Opening balance carried forward', auth.uid()
        )
        returning id into v_invoice_id;

        insert into public.invoice_lines (tenant_id, session_id, invoice_id, description, amount)
        values (
          v_tenant_id, v_run.to_session_id, v_invoice_id,
          'Balance brought forward from the previous session', v_decision.carry_forward
        );

        v_carried := v_carried + 1;
      end if;

    elsif v_decision.decision = 'graduate' then
      -- No new enrolment: a graduate has left. `students.status` is what makes
      -- them an alumnus, and the closed enrolment is what says which year.
      update public.enrolments set status = 'promoted'
      where id = v_decision.from_enrolment_id;

      -- `alumni`, not `graduated`: that is the word `students.status` uses,
      -- and keeping alumni representable is one of the four things the layered
      -- identity model exists for (CLAUDE.md rule 5).
      update public.students set status = 'alumni'
      where id = v_decision.student_id and tenant_id = v_tenant_id;

      v_graduated := v_graduated + 1;

    else
      -- A hold changes nothing at all, deliberately. The outgoing enrolment
      -- stays active so the student is still visibly somebody's problem.
      v_held := v_held + 1;
    end if;

    if v_enrolment_id is not null then
      update public.promotion_decisions
      set applied_enrolment_id = v_enrolment_id
      where id = v_decision.id;
    end if;
  end loop;

  update public.promotion_runs
  set status = 'applied', applied_at = now(), applied_by = auth.uid()
  where id = p_run_id;

  return query select v_promoted, v_repeated, v_graduated, v_held, v_carried;
end;
$$;

revoke all on function public.promotion_apply(uuid) from public, anon;
grant execute on function public.promotion_apply(uuid) to authenticated;
