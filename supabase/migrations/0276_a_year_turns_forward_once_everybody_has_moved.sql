-- 0276: a year turns forward, once, after everybody has moved.
--
-- Probed on the demo college on 23 Sep 2026: the flag still says 2025-2026
-- (which ended on 31 March), 2026-2027 exists with its 12 classes, and no
-- promotion has ever been run. Every step of turning the year over was tried
-- in a rolled-back transaction, and six things were wrong. Five are fixed here;
-- the sixth (copying fee structures) is the new function at the end.
--
-- 1. A run could go backwards. Nothing compared the two years, and the
--    planner's default "promote into" was the first year that was not current
--    in date order -- 2024-2025. A run into the previous year was accepted.
--    `promotion_start_run`, `renewal_start_run` and
--    `academics_roll_forward_sections` now refuse a receiving year that does
--    not start after the sending one, in a sentence.
--
-- 2. Carrying a balance forward billed it twice. `promotion_apply` raised an
--    "opening balance" invoice in the new year and closed nothing in the old
--    one, while 0186/0187 already keep an unpaid year on its own account and
--    collect it at the counter as arrears. Measured: the child owing the most
--    owed 26,908.00; after the run and the switch the fee account showed
--    26,908.00 this year *and* 26,908.00 for 2025-2026. Across the college,
--    13,24,336.00 owed by 103 families would have been owed twice. No run had
--    been applied, so no family was ever billed twice.
--
--    Rule 6 already settles which is right: a ledger row's `session_id` is
--    which year's account it moves, and a receipt settles the year of the
--    invoice it names. So a debt stays on the year it was incurred in, and the
--    new year shows it as arrears; it is never re-billed. `carry_forward` is
--    written as 0 from here on, and `promotion_apply`'s `carried` now counts
--    the children who move on *with* arrears, which is what a person needs to
--    know.
--
-- 3. An applied run locked the year pair for ever. `promotion_runs_one_live`
--    was partial on `status <> 'discarded'`, so after one run was applied no
--    second run from 2025-2026 into 2026-2027 could be started -- and "hold"
--    is documented as "the outgoing enrolment stays open" for somebody to
--    decide later. Probed: one child held, run applied, second run refused with
--    23505. The index now covers drafts only (rule 13's "at most one *live*
--    run"): an applied run is history, and a second run's preview contains
--    exactly the children still active in the old year. The renewal index had
--    the same shape and the same fix, for children promoted late.
--
-- 4. The planner's own defaults could not start a run. "Hold them" when there
--    is no result sent a hold row out of `promotion_preview` still carrying the
--    target class, and `promotion_decisions_target_chk` (a hold has no class)
--    refused the insert with a raw 23514. With the annual examination still in
--    draft that is every child. A hold row now carries no class.
--
-- 5. Switching the year hid every child. `academics_session_activate` moved
--    the flag unconditionally, and the year screen's banner offered "Make
--    2026-2027 current" as its main action. Switching before promoting leaves
--    302 children enrolled only in a year that is no longer current: gone from
--    every class list, register and fee screen of the new year. It now refuses
--    while children in the current year have not been moved into the new one,
--    naming the count, unless the caller says `p_force` -- the flag stays a
--    decision (0195), and now it is an informed one.
--
-- Migrations 0051, 0181 and 0195 are where these functions were last defined;
-- every body below is theirs with only the change described.

-- ---------------------------------------------------------------------------
-- 3. One live run means one draft.
-- ---------------------------------------------------------------------------
drop index if exists public.promotion_runs_one_live;
create unique index promotion_runs_one_live
  on public.promotion_runs (tenant_id, from_session_id, to_session_id)
  where status = 'draft';

drop index if exists public.renewal_runs_one_live;
create unique index renewal_runs_one_live
  on public.renewal_runs (tenant_id, from_session_id, to_session_id, kind)
  where status = 'draft';

-- ---------------------------------------------------------------------------
-- 1. Which way a year turns: one definition, three callers.
-- ---------------------------------------------------------------------------
create or replace function public.academics_require_later_year(
  p_from_session_id uuid,
  p_to_session_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_from public.academic_sessions;
  v_to public.academic_sessions;
begin
  select * into v_from from public.academic_sessions s
  where s.id = p_from_session_id and s.tenant_id = public.current_tenant_id();
  select * into v_to from public.academic_sessions s
  where s.id = p_to_session_id and s.tenant_id = public.current_tenant_id();

  if v_from.id is null or v_to.id is null then
    raise exception 'Choose two academic years of this college.' using errcode = '22023';
  end if;
  if v_from.id = v_to.id then
    raise exception 'Choose two different academic years.' using errcode = '22023';
  end if;
  if v_to.start_date <= v_from.start_date then
    raise exception '% comes before %. Children move into a later year, never an earlier one.',
      v_to.name, v_from.name using errcode = '22023';
  end if;
end;
$$;

comment on function public.academics_require_later_year(uuid, uuid) is
  'Raises unless the receiving year starts after the sending one. The single definition of "forward" for promotion, renewal and copying classes (0276).';

create or replace function public.academics_roll_forward_sections(p_from_session_id uuid, p_to_session_id uuid)
returns integer
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_created integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  perform public.academics_require_later_year(p_from_session_id, p_to_session_id);

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
$function$;

create or replace function public.renewal_start_run(p_from_session_id uuid, p_to_session_id uuid, p_kind text)
returns uuid
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can start a renewal run';
  end if;

  if p_kind not in ('transport', 'hostel') then
    raise exception 'A renewal run carries transport or hostel, not "%"', p_kind;
  end if;

  perform public.academics_require_later_year(p_from_session_id, p_to_session_id);

  begin
    insert into public.renewal_runs (
      tenant_id, from_session_id, to_session_id, kind, created_by
    ) values (
      v_tenant_id, p_from_session_id, p_to_session_id, p_kind, auth.uid()
    )
    returning id into v_run_id;
  exception when unique_violation then
    raise exception
      'There is already a draft run carrying % into that year. Open it, or discard it, first.', p_kind;
  end;

  insert into public.renewal_decisions (
    tenant_id, run_id, kind, student_id,
    from_label, from_fare, decision, to_stop_id, to_room_id, direction, reason
  )
  select
    v_tenant_id, v_run_id, p_kind, pv.student_id,
    pv.from_label, pv.from_fare, pv.decision,
    pv.to_stop_id, pv.to_room_id, pv.direction, pv.reason
  from public.renewal_preview(p_from_session_id, p_to_session_id, p_kind) pv;

  if not exists (select 1 from public.renewal_decisions d where d.run_id = v_run_id) then
    raise exception
      'Nothing to carry: no active % arrangement in the outgoing year.', p_kind;
  end if;

  return v_run_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. A hold row carries no class.
-- ---------------------------------------------------------------------------
create or replace function public.promotion_preview(p_from_session_id uuid, p_to_session_id uuid, p_rules jsonb default '{}'::jsonb)
returns table(student_id uuid, admission_number text, student_name text, roll_number text, from_enrolment_id uuid, from_section_id uuid, from_section_label text, from_sequence integer, decision text, reason text, to_section_id uuid, to_section_label text, exam_result text, subjects_failed integer, attendance_percent numeric, outstanding numeric)
language sql
stable
set search_path to 'public', 'extensions'
as $function$
  with cfg as (
    select
      (p_rules ->> 'no_detention_up_to_sequence')::integer                       as no_detention,
      coalesce((p_rules -> 'criteria' ->> 'require_exam_pass')::boolean, false)  as require_pass,
      coalesce(p_rules -> 'criteria' ->> 'exam_kind', 'annual')                  as exam_kind,
      coalesce((p_rules -> 'criteria' ->> 'max_failed_subjects')::integer, 0)    as max_failed,
      (p_rules -> 'criteria' ->> 'min_attendance_percent')::numeric              as min_attendance,
      coalesce(p_rules ->> 'on_missing_result', 'hold')                          as on_missing
  ),
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
        when s.no_detention is not null and s.from_sequence <= s.no_detention
          then 'promote'
        when s.min_attendance is not null
             and coalesce(s.attendance_percent, 0) < s.min_attendance
          then 'repeat'
        when not s.require_pass then 'promote'
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
        then t.intent_reason || ', and this is the final class, so this is a graduation'
      when t.intent in ('promote', 'repeat') and t.target_section_id is null
        then t.intent_reason || ', but the receiving session has no matching class to move into'
      else t.intent_reason
    end as reason,
    -- Only a child who moves has somewhere to move to. A hold (on purpose, or
    -- because no result exists) and a graduation carry no class; before 0276
    -- a hold kept the class it would have had, and the target CHECK refused
    -- the whole run.
    case
      when t.intent = 'promote' and t.next_level_id is null then null
      when t.intent in ('promote', 'repeat') then t.target_section_id
      else null
    end as to_section_id,
    case
      when t.intent = 'promote' and t.next_level_id is null then null
      when t.intent in ('promote', 'repeat') then t.target_section_label
      else null
    end as to_section_label,
    t.exam_result,
    t.subjects_failed,
    t.attendance_percent,
    t.outstanding
  from targeted t
  order by t.from_sequence, t.from_section_label, t.roll_number nulls last, t.student_name
$function$;

-- ---------------------------------------------------------------------------
-- 1, 2 and 3 at the start of a run.
-- ---------------------------------------------------------------------------
create or replace function public.promotion_start_run(p_from_session_id uuid, p_to_session_id uuid, p_rules jsonb default '{}'::jsonb)
returns uuid
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run_id uuid;
  v_from_name text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if ( select public.current_role_code() ) <> 'admin' then
    raise exception 'Only an administrator can start a promotion run';
  end if;

  perform public.academics_require_later_year(p_from_session_id, p_to_session_id);

  begin
    insert into public.promotion_runs (
      tenant_id, from_session_id, to_session_id, rules, created_by
    ) values (
      v_tenant_id, p_from_session_id, p_to_session_id, coalesce(p_rules, '{}'::jsonb), auth.uid()
    )
    returning id into v_run_id;
  exception when unique_violation then
    raise exception
      'There is already a draft run between these two years. Open it from the list, or discard it, before starting another.';
  end;

  insert into public.promotion_decisions (
    tenant_id, run_id, student_id, from_enrolment_id,
    decision, to_section_id, reason, outstanding, carry_forward
  )
  select
    v_tenant_id, v_run_id, pv.student_id, pv.from_enrolment_id,
    pv.decision, pv.to_section_id, pv.reason,
    -- What the child owes in the outgoing year. It stays on that year's
    -- account and follows them as arrears (0276); it is never re-billed, so
    -- `carry_forward` is 0.
    pv.outstanding,
    0
  from public.promotion_preview(p_from_session_id, p_to_session_id, p_rules) pv;

  if not exists (select 1 from public.promotion_decisions d where d.run_id = v_run_id) then
    select s.name into v_from_name from public.academic_sessions s where s.id = p_from_session_id;
    if exists (
      select 1 from public.promotion_runs r
      where r.tenant_id = v_tenant_id and r.from_session_id = p_from_session_id and r.status = 'applied'
    ) then
      raise exception 'Every child in % has already been moved by an earlier run. There is nobody left to promote.', v_from_name;
    end if;
    raise exception 'That session has no active enrolments, so there is nobody to promote';
  end if;

  return v_run_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Applying moves the children and never re-bills a debt.
-- ---------------------------------------------------------------------------
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

    if v_decision.decision in ('promote', 'repeat') then
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
      update public.promotion_decisions
      set applied_enrolment_id = v_enrolment_id
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

comment on column public.promotion_decisions.carry_forward is
  'Always 0 since 0276. A debt stays on the year it was incurred in and follows the child as arrears; re-billing it in the new year counted it twice. `outstanding` is what the child owed.';

-- ---------------------------------------------------------------------------
-- 5. Switching the year, informed.
-- ---------------------------------------------------------------------------
-- A new parameter is a new signature, so the old one is dropped rather than
-- left beside it (two bodies is where a check stops being updated in one).
-- `drop` forgets grants (0267), so they are restated below exactly as they
-- stood: authenticated and service_role, nobody else.
drop function if exists public.academics_session_activate(uuid);

create function public.academics_session_activate(p_session_id uuid, p_force boolean default false)
returns public.academic_sessions
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row public.academic_sessions;
  v_target public.academic_sessions;
  v_current public.academic_sessions;
  v_waiting integer;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if not public.role_has_permission('academics.manage') then
    raise exception 'Your role cannot change the current academic year';
  end if;

  select * into v_target from public.academic_sessions s
  where s.id = p_session_id and s.tenant_id = v_tenant_id;
  if v_target.id is null then
    raise exception 'No such academic year, or you may not change it';
  end if;

  select * into v_current from public.academic_sessions s
  where s.tenant_id = v_tenant_id and s.is_current;

  -- Moving forward while children are still enrolled only in the year being
  -- left: they would vanish from every screen of the new one. Refused with the
  -- count, unless somebody has read it and says so (0276).
  if not p_force and v_current.id is not null and v_current.id <> v_target.id
     and v_target.start_date > v_current.start_date then
    select count(*)::integer into v_waiting
    from public.enrolments e
    where e.tenant_id = v_tenant_id
      and e.session_id = v_current.id
      and e.status = 'active'
      and not exists (
        select 1 from public.enrolments n
        where n.tenant_id = v_tenant_id
          and n.session_id = v_target.id
          and n.student_id = e.student_id
      );

    if v_waiting > 0 then
      raise exception '% % in % % not been promoted into % yet. Switch now and % will disappear from every class list, register and fee screen of the new year. Promote first, or confirm that you want to switch anyway.',
        v_waiting,
        case when v_waiting = 1 then 'child' else 'children' end,
        v_current.name,
        case when v_waiting = 1 then 'has' else 'have' end,
        v_target.name,
        case when v_waiting = 1 then 'that child' else 'they' end
        using errcode = '55000';
    end if;
  end if;

  update public.academic_sessions
  set is_current = false
  where tenant_id = v_tenant_id and is_current and id <> p_session_id;

  update public.academic_sessions
  set is_current = true
  where tenant_id = v_tenant_id and id = p_session_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No such academic year, or you may not change it';
  end if;

  return v_row;
end;
$function$;

revoke all on function public.academics_session_activate(uuid, boolean) from public, anon;
grant execute on function public.academics_session_activate(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Next year's fees, copied rather than re-typed.
-- ---------------------------------------------------------------------------
-- `fee_structures` is keyed on (session, class, fee head), so a new year starts
-- with none and bills nothing: probed, 24 in 2025-2026 and 0 in 2026-2027,
-- with nothing anywhere saying so. Copies what is missing and leaves anything
-- already set for the receiving year alone, so it is safe to run twice.
create or replace function public.fees_roll_forward_structures(
  p_from_session_id uuid,
  p_to_session_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
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

  insert into public.fee_structures (tenant_id, session_id, class_level_id, fee_head_id, amount, frequency)
  select f.tenant_id, p_to_session_id, f.class_level_id, f.fee_head_id, f.amount, f.frequency
  from public.fee_structures f
  where f.tenant_id = v_tenant
    and f.session_id = p_from_session_id
  on conflict (tenant_id, session_id, class_level_id, fee_head_id) do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

comment on function public.fees_roll_forward_structures(uuid, uuid) is
  'Copies one year''s fee structures into a later year, skipping any already set there. Invoker: the finance-roles policy is the boundary (0276).';

revoke all on function public.fees_roll_forward_structures(uuid, uuid) from public, anon;
grant execute on function public.fees_roll_forward_structures(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The checklist: where turning the year over stands, in one read.
-- ---------------------------------------------------------------------------
-- The steps were on three screens (classes and promotion on /promotion, fees on
-- /fees/setup, the switch on /academics/sessions) and nothing said which were
-- done, so the year screen's banner offered the last step first. INVOKER and
-- counts only: every figure is one a member of staff can already read.
create or replace function public.academics_year_end(p_to_session_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with cur as (
    select s.* from public.academic_sessions s
    where s.tenant_id = public.current_tenant_id() and s.is_current
  ),
  nxt as (
    select s.* from public.academic_sessions s
    where s.id = p_to_session_id and s.tenant_id = public.current_tenant_id()
  )
  select jsonb_build_object(
    'from', (select jsonb_build_object('id', cur.id, 'name', cur.name, 'endDate', cur.end_date) from cur),
    'to', (select jsonb_build_object('id', nxt.id, 'name', nxt.name, 'startDate', nxt.start_date,
                                     'isCurrent', nxt.is_current) from nxt),
    'classes', jsonb_build_object(
      'from', (select count(*) from public.sections sec, cur where sec.session_id = cur.id),
      'to', (select count(*) from public.sections sec, nxt where sec.session_id = nxt.id)),
    'fees', jsonb_build_object(
      'from', (select count(*) from public.fee_structures f, cur where f.session_id = cur.id),
      'to', (select count(*) from public.fee_structures f, nxt where f.session_id = nxt.id)),
    'children', jsonb_build_object(
      'waiting', (
        select count(*) from public.enrolments e, cur, nxt
        where e.session_id = cur.id and e.status = 'active'
          and not exists (select 1 from public.enrolments n
                          where n.session_id = nxt.id and n.student_id = e.student_id)),
      'moved', (select count(*) from public.enrolments e, nxt where e.session_id = nxt.id),
      'draftRun', (
        select r.id from public.promotion_runs r, cur, nxt
        where r.from_session_id = cur.id and r.to_session_id = nxt.id and r.status = 'draft'
        limit 1)),
    'renewals', jsonb_build_object(
      'transport', (
        select count(*) from public.transport_assignments ta, cur, nxt
        where ta.session_id = cur.id and ta.status = 'active'
          and exists (select 1 from public.enrolments n
                      where n.session_id = nxt.id and n.student_id = ta.student_id)
          and not exists (select 1 from public.transport_assignments t2
                          where t2.session_id = nxt.id and t2.student_id = ta.student_id
                            and t2.status = 'active')),
      'hostel', (
        select count(*) from public.hostel_allocations ha, cur, nxt
        where ha.session_id = cur.id and ha.status = 'active'
          and exists (select 1 from public.enrolments n
                      where n.session_id = nxt.id and n.student_id = ha.student_id)
          and not exists (select 1 from public.hostel_allocations h2
                          where h2.session_id = nxt.id and h2.student_id = ha.student_id
                            and h2.status = 'active')))
  )
$$;

comment on function public.academics_year_end(uuid) is
  'Where turning the current year over into p_to_session_id stands: classes, fees, children still to move, seats and beds to renew. Counts only; invoker (0276).';

revoke all on function public.academics_year_end(uuid) from public, anon;
grant execute on function public.academics_year_end(uuid) to authenticated;
