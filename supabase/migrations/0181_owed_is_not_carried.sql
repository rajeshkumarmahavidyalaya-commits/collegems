-- 0181 — What a family owes is not what the run decided to carry.
--
-- `promotion_decisions.carry_forward` stored one number for two facts, and the
-- probe that found it is worth writing down: a run created with an empty rules
-- document came back with `carried = 0` on a school where **96 families owe
-- ₹10,60,904**. Nothing was wrong -- `carry_forward_fees` defaults to false
-- (rule 12: a missing key means the conservative reading) -- but the run had no
-- record of the debt at all, because the only column that could hold it was the
-- one the policy had zeroed.
--
-- Two facts, two columns:
--
--   `outstanding`    what this child owed at the end of the outgoing year,
--                    as the preview computed it. A measurement.
--   `carry_forward`  what the run decided to bill in the receiving year,
--                    which is `outstanding` or zero depending on policy.
--                    A decision.
--
-- The same distinction `attendance_coverage` draws between a rate and the
-- measurement behind it, and the same one `settings` draws between a value and
-- whether anybody chose it: **one value cannot carry both.**
--
-- It matters here because of who cannot be billed. A graduate has no enrolment
-- in the receiving year, so their debt is not carried whatever the policy says
-- -- and `promotion_apply` writes that fact into `promotion_runs.left_behind`
-- (migration 0180). Reading it off `carry_forward` would have made the sentence
-- appear only when carry-forward was switched on, which is exactly backwards:
-- the school least likely to have that policy is the school most likely to
-- forget the money.
--
-- Backfilled from `carry_forward`, which is the best available answer for runs
-- created before this column existed: where the policy was on the two agree,
-- and where it was off the debt was never recorded and cannot be recovered
-- now. Said out loud rather than backfilled with a recomputation, because
-- recomputing today's balance onto a run applied last March would put a number
-- next to a date it does not belong to.

alter table public.promotion_decisions
  add column outstanding numeric(12, 2) not null default 0
  check (outstanding >= 0);

update public.promotion_decisions set outstanding = carry_forward
where carry_forward > 0;

comment on column public.promotion_decisions.outstanding is
  'What this child owed at the end of the outgoing year, as the preview '
  'measured it. `carry_forward` is what the run decided to do about it -- the '
  'same number when the policy carries fees, zero when it does not.';

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

  insert into public.promotion_runs (
    tenant_id, from_session_id, to_session_id, rules, created_by
  ) values (
    v_tenant_id, p_from_session_id, p_to_session_id, coalesce(p_rules, '{}'::jsonb), auth.uid()
  )
  returning id into v_run_id;

  insert into public.promotion_decisions (
    tenant_id, run_id, student_id, from_enrolment_id,
    decision, to_section_id, reason, outstanding, carry_forward
  )
  select
    v_tenant_id, v_run_id, pv.student_id, pv.from_enrolment_id,
    pv.decision, pv.to_section_id, pv.reason,
    -- The measurement, always.
    pv.outstanding,
    -- The decision, which the policy may zero.
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

-- ---------------------------------------------------------------------------
-- The sentences, in one place
--
-- Migration 0180 built these inline in `promotion_apply`. Pulling them out is
-- not tidying: a run's "what this could not close" is a question worth asking
-- of a *draft* too -- before applying, which is when somebody can still do
-- something about it -- and a second implementation for the preview screen
-- would be a second answer (rule 11).
-- ---------------------------------------------------------------------------

create or replace function public.promotion_left_behind(p_run_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_run public.promotion_runs;
  v_left jsonb := '[]'::jsonb;
  v_books integer := 0;
  v_children integer := 0;
  v_owed numeric := 0;
begin
  select * into v_run from public.promotion_runs r where r.id = p_run_id;
  if v_run.id is null then
    return v_left;
  end if;

  -- One grouped query for the whole cohort. `student_exit` asks the same
  -- question per child, which is right at a desk and wrong fifty times over --
  -- see migration 0180.
  select count(*), count(distinct m.student_id) into v_books, v_children
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  join public.promotion_decisions d
    on d.student_id = m.student_id and d.run_id = p_run_id
  where bi.status = 'issued' and d.decision = 'graduate';

  if v_books > 0 then
    v_left := v_left || jsonb_build_object(
      'kind', 'library',
      'message', format(
        '%s library %s still out with %s %s who %s left. Graduating does not return them.',
        v_books, case when v_books = 1 then 'book is' else 'books are' end,
        v_children, case when v_children = 1 then 'child' else 'children' end,
        case when v_children = 1 then 'has' else 'have' end)
    );
  end if;

  -- `outstanding`, not `carry_forward`: a graduate's debt is not carried
  -- whatever the policy says, so the sentence must not depend on the policy
  -- being switched on. That is the whole point of this migration.
  select coalesce(sum(d.outstanding), 0), count(*) filter (where d.outstanding > 0)
  into v_owed, v_children
  from public.promotion_decisions d
  where d.run_id = p_run_id and d.decision = 'graduate';

  if v_owed > 0 then
    v_left := v_left || jsonb_build_object(
      'kind', 'balance',
      'message', format(
        '%s is still owed by %s %s who %s leaving. There is no enrolment in %s '
        'to carry it onto, so chasing it or writing it off is the school''s to decide.',
        to_char(v_owed, 'FM999999990.00'), v_children,
        case when v_children = 1 then 'graduate' else 'graduates' end,
        case when v_children = 1 then 'is' else 'are' end,
        (select s.name from public.academic_sessions s where s.id = v_run.to_session_id))
    );
  end if;

  return v_left;
end;
$$;

revoke all on function public.promotion_left_behind(uuid) from public, anon;
grant execute on function public.promotion_left_behind(uuid) to authenticated;

comment on function public.promotion_left_behind(uuid) is
  'What this run cannot close, in sentences. Answerable of a draft as well as '
  'an applied run, which is the point -- before applying is when somebody can '
  'still act on it.';

-- ---------------------------------------------------------------------------
-- `promotion_apply`, with the sentences delegated
-- ---------------------------------------------------------------------------

create or replace function public.promotion_apply(p_run_id uuid)
returns table (
  promoted integer,
  repeated integer,
  graduated integer,
  held integer,
  carried integer,
  ended_transport integer,
  ended_hostel integer,
  ended_concessions integer,
  left_behind jsonb
)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_run public.promotion_runs;
  v_from_name text;
  v_from_ends date;
  v_decision record;
  v_enrolment_id uuid;
  v_invoice_id uuid;
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
      -- The outgoing year first, and with the right word: a graduate finished
      -- it. `student_end_relationships` then finds no active enrolment and
      -- closes none, which is why the order is not a style choice.
      update public.enrolments set status = 'promoted'
      where id = v_decision.from_enrolment_id;

      -- Leaving is an act, not a flag (rule 12). This ends the bus seat, the
      -- hostel bed and every live concession, and sets `students.status` last.
      -- `alumni`, not `graduated`: that is the word the column uses, and
      -- keeping alumni representable is one of the four things the layered
      -- identity model exists for (rule 5).
      --
      -- Dated to the end of the outgoing year rather than to today, because
      -- that is when they left. A run applied in February must not bill a
      -- family for a bus they will ride until March.
      v_closed := public.student_end_relationships(
        v_decision.student_id, v_from_ends, 'alumni',
        format('Graduated from %s', v_from_name)
      );

      v_transport := v_transport + (v_closed ->> 'transport')::integer;
      v_hostel := v_hostel + (v_closed ->> 'hostel')::integer;
      v_concessions := v_concessions + (v_closed ->> 'concessions')::integer;
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

  -- What this run could not close, computed once for the cohort by
  -- `promotion_left_behind` (migration 0181) rather than inline here, so the
  -- preview screen can ask the same question of a draft.
  v_left := public.promotion_left_behind(p_run_id);

  update public.promotion_runs
  set status = 'applied', applied_at = now(), applied_by = auth.uid(),
      left_behind = v_left
  where id = p_run_id;

  return query select
    v_promoted, v_repeated, v_graduated, v_held, v_carried,
    v_transport, v_hostel, v_concessions, v_left;
end;
$$;

revoke all on function public.promotion_apply(uuid) from public, anon;
grant execute on function public.promotion_apply(uuid) to authenticated;
