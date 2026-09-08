-- 0180 — Graduating is leaving, and `promotion_apply` only set a flag.
--
-- `student_exit` (0174) exists because a status column is a summary, not a
-- switch: leaving is one act that ends the enrolment, the bus seat, the hostel
-- bed and any live concessions. Migration 0174 taught `certificate_issue` to
-- perform that act.
--
-- It did not teach the *other* place that turns a child into an alumnus, and
-- that place does it fifty at a time:
--
--     elsif v_decision.decision = 'graduate' then
--       update public.enrolments set status = 'promoted' ...;
--       update public.students set status = 'alumni' ...;
--
-- Two statements, five relationships. In the demo cohort that is **6 bus
-- riders and 2 hostel residents** who leave in March and keep a seat, a bed and
-- every fee concession they held -- and, because `transport_fee_lines` and
-- `hostel_fee_lines` consult neither `students.status` nor `enrolments`, keep
-- being billed for both.
--
-- The fix is not a third copy of the five updates inside `promotion_apply`.
-- That is the mistake rule 12 names: nine readers would each have to remember,
-- and the tenth is the one somebody writes next year. So the *act* is
-- extracted:
--
--     student_end_relationships(student, on, status, reason)
--
-- -- `SECURITY INVOKER`, no validation, no reporting, just the five updates in
-- the order that matters (status last, so a failure part-way leaves the child
-- visibly still here rather than half-gone). `student_exit` becomes that call
-- plus its validation and its "what could not be ended" note;
-- `promotion_apply` becomes that call per graduate.
--
-- ---------------------------------------------------------------------------
-- Why `promotion_apply` does not simply call `student_exit`
--
-- Two reasons, and the second was measured rather than assumed.
--
-- 1. **The outgoing enrolment must read `promoted`, not `withdrawn`.** A
--    graduate finished the year; they did not drop out of it, and the word is
--    what somebody reads on a class list in five years. So the enrolment is
--    closed first, with the right word, and the ending then finds no active
--    enrolment and closes none.
--
-- 2. **`student_exit`'s outstanding note costs 97 ms per child.** It reads
--    `fees_student_balances()`, a set-returning function, and a
--    `where student_id =` outside one is an optimisation fence (rule 7): the
--    function runs to completion for every student in the school and the filter
--    is applied to the result. Measured: 97 ms, 5,113 buffers, to return one
--    row. Fifty graduates is 4.9 seconds of work whose answer this module
--    already has -- `promotion_decisions.carry_forward` is that same balance,
--    computed once at preview.
--
-- So the balance half of "what could not be ended" is already on the screen,
-- and the half that was missing -- unreturned library books -- is one grouped
-- query after the loop rather than one per child.
--
-- ---------------------------------------------------------------------------
-- And it is written down, not toasted
--
-- `promotion_runs.left_behind` holds those sentences. A toast that says "6
-- graduates still have library books" is gone before the librarian is told, and
-- applying cannot be undone -- so the record of what applying could not close
-- belongs on the run, next to what it did. Same instinct as
-- `notices.announce_error` (rule 10): a reason with nowhere to go is a reason
-- nobody acts on.

-- ---------------------------------------------------------------------------
-- 1. The act, on its own
-- ---------------------------------------------------------------------------

create or replace function public.student_end_relationships(
  p_student_id uuid,
  p_on date,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_enrolments integer := 0;
  v_transport integer := 0;
  v_hostel integer := 0;
  v_concessions integer := 0;
begin
  -- No validation here on purpose: this is the act, and the two callers have
  -- different things to check before performing it. `student_exit` refuses an
  -- empty reason; `promotion_apply` has already refused a run that is not a
  -- draft. A third caller must do its own checking, and that is the point of
  -- the function being this narrow.

  -- 1. The enrolment. `withdrawn` rather than `transferred_out` unless the
  --    school said transfer, because the two mean different things to whoever
  --    reads a class list next year. A caller that has already closed the
  --    outgoing year with a better word -- `promoted`, for a graduate -- finds
  --    nothing active here and closes nothing.
  update public.enrolments
  set status = case when p_status = 'transferred' then 'transferred_out' else 'withdrawn' end
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_enrolments = row_count;

  -- 2. The bus seat. Ended, not cancelled: the child genuinely rode the bus
  --    until the day they left, and rewriting that to `cancelled` erases a fact
  --    the school was right to record.
  update public.transport_assignments
  set ends_on = p_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= p_on
    and effective_ends_on > p_on;
  get diagnostics v_transport = row_count;

  -- An arrangement that has not started yet was never ridden, and an `ends_on`
  -- before `starts_on` is refused by the range CHECK anyway.
  update public.transport_assignments
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > p_on;

  -- 3. The hostel bed, which also frees it for somebody else.
  update public.hostel_allocations
  set ends_on = p_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= p_on
    and effective_ends_on > p_on;
  get diagnostics v_hostel = row_count;

  update public.hostel_allocations
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > p_on;

  -- 4. Concessions. A discount on a bill nobody will raise is harmless, but it
  --    keeps the child on the concessions register and in its cost total, which
  --    is a number a bursar reports to a board.
  update public.student_concessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = ( select auth.uid() ),
      revoke_reason = p_reason
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_concessions = row_count;

  -- 5. The status itself, last, so a failure above leaves the child visibly
  --    still here rather than half-gone.
  update public.students
  set status = p_status
  where id = p_student_id and tenant_id = v_tenant_id;

  return jsonb_build_object(
    'enrolments', v_enrolments,
    'transport', v_transport,
    'hostel', v_hostel,
    'concessions', v_concessions
  );
end;
$$;

revoke all on function public.student_end_relationships(uuid, date, text, text) from public, anon;
grant execute on function public.student_end_relationships(uuid, date, text, text) to authenticated;

comment on function public.student_end_relationships(uuid, date, text, text) is
  'The five updates that end a child''s relationships with the school, in the '
  'order that matters. SECURITY INVOKER, so RLS decides every row. Callers do '
  'their own validation -- see student_exit and promotion_apply.';

-- ---------------------------------------------------------------------------
-- 2. `student_exit` becomes validation + the act + the note
-- ---------------------------------------------------------------------------

create or replace function public.student_exit(
  p_student_id uuid,
  p_reason text,
  p_left_on date default null,
  p_status text default 'transferred'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_on date := coalesce(p_left_on, current_date);
  v_name text;
  v_closed jsonb;
  v_books integer := 0;
  v_balance numeric := 0;
  v_outstanding jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_status not in ('transferred', 'alumni', 'expelled', 'inactive') then
    raise exception 'A child leaves as transferred, alumni, expelled or inactive -- not "%"', p_status;
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this child is leaving -- it is the only thing a record five years from now will have';
  end if;

  select (p.first_name || ' ' || p.last_name) into v_name
  from public.students st join public.people p on p.id = st.person_id
  where st.id = p_student_id;

  if v_name is null then
    raise exception 'No such student, or you cannot see them';
  end if;

  v_closed := public.student_end_relationships(
    p_student_id, v_on, p_status,
    format('Left the school on %s', to_char(v_on, 'FMDD Mon YYYY'))
  );

  -- ---- what could not be ended --------------------------------------------

  select count(*) into v_books
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  where m.student_id = p_student_id and bi.status = 'issued';

  if v_books > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'library',
      'message', format(
        '%s still has %s library %s out. Leaving does not return them.',
        v_name, v_books, case when v_books = 1 then 'book' else 'books' end)
    );
  end if;

  -- 97 ms and 5,113 buffers, because the filter sits outside a set-returning
  -- function (rule 7). Acceptable for one child at a desk; see migration 0180's
  -- header for why `promotion_apply` must not pay it fifty times.
  select coalesce(b.balance, 0) into v_balance
  from public.fees_student_balances() b
  where b.student_id = p_student_id;

  if coalesce(v_balance, 0) > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'balance',
      'message', format(
        '%s owes %s. Whether that is chased, written off or withholds a '
        'certificate is the school''s to decide -- this has not touched it.',
        v_name, to_char(v_balance, 'FM999999990.00'))
    );
  end if;

  return jsonb_build_object(
    'student_id', p_student_id,
    'student', v_name,
    'left_on', v_on,
    'status', p_status,
    'closed', v_closed,
    'outstanding', v_outstanding
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Where the run writes down what it could not close
-- ---------------------------------------------------------------------------

alter table public.promotion_runs
  add column left_behind jsonb not null default '[]'::jsonb;

comment on column public.promotion_runs.left_behind is
  'Sentences about what applying this run could not end -- an unreturned '
  'library book, a debt that has no enrolment to carry it onto. Written down '
  'rather than toasted, because applying cannot be undone and a message that '
  'scrolls away is a message nobody acted on.';

-- ---------------------------------------------------------------------------
-- 4. `promotion_apply`, with graduation as an act
--
-- The return type gains three counts and the run id, so it is dropped and
-- recreated rather than left with two bodies.
-- ---------------------------------------------------------------------------

drop function if exists public.promotion_apply(uuid);

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
  v_books integer := 0;
  v_children integer := 0;
  v_balance_total numeric := 0;
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

  -- ---- what applying could not close --------------------------------------
  --
  -- One grouped query for the whole cohort, not one per child: see the header.

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

  -- The debt half this module already knows: `carry_forward` is the same
  -- number, computed once at preview, and a graduate has no receiving
  -- enrolment to carry it onto.
  select
    coalesce(sum(d.carry_forward), 0),
    count(*) filter (where d.carry_forward > 0)
  into v_balance_total, v_children
  from public.promotion_decisions d
  where d.run_id = p_run_id and d.decision = 'graduate';

  if v_balance_total > 0 then
    v_left := v_left || jsonb_build_object(
      'kind', 'balance',
      'message', format(
        '%s is still owed by %s %s who left. There is no enrolment in %s to '
        'carry it onto, so chasing it or writing it off is the school''s to decide.',
        to_char(v_balance_total, 'FM999999990.00'), v_children,
        case when v_children = 1 then 'graduate' else 'graduates' end,
        (select s.name from public.academic_sessions s where s.id = v_run.to_session_id))
    );
  end if;

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

comment on function public.promotion_apply(uuid) is
  'Writes what the decision rows say. A graduate leaves through '
  'student_end_relationships rather than a status flag (migration 0180), and '
  'what the run could not close is written to promotion_runs.left_behind.';
