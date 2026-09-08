-- ---------------------------------------------------------------------------
-- Leaving is the end of several relationships, not one flag
-- ---------------------------------------------------------------------------
--
-- `certificate_issue` sets `students.status = 'transferred'` and stops, with a
-- comment saying that issuing a leaving certificate *is* the act of the child
-- leaving. The comment is right about the intent and the code does a fifth of
-- it. Checked against the live function bodies rather than assumed:
--
--   fees_billable_lines          does not consult students.status
--   transport_fee_lines          does not
--   hostel_fee_lines             does not
--   schedule_student_audience    does not
--   fees_student_balances        does  <- the only one
--
-- ...and `fees_generate_section_invoices` loops `enrolments.status = 'active'`,
-- which the certificate never touched. So a child whose leaving certificate was
-- issued in April keeps being invoiced every month, keeps a seat on a bus and a
-- bed in a hostel that are both still being charged for, and their family gets
-- an absence text every evening for a child who is at a different school.
--
-- THE FIX IS NOT TO TEACH EVERY READER ABOUT THE FLAG
--
-- Nine read paths would each have to remember it, and the tenth is the one
-- somebody writes next year. The same reasoning as rule 12's:
--
--   > A status column is a **summary**. The relationships are owned by the
--   > modules that made them, so **leaving is one act that ends them**, not a
--   > flag every reader has to check.
--
-- WHAT IT ENDS, AND HOW
--
-- `ends_on`, never `cancelled`. The child genuinely did ride the bus until the
-- day they left, and rewriting that to "cancelled" erases a fact the school was
-- right to have recorded -- the same instinct that keeps a revoked concession's
-- credits and a withdrawn leave request's history. `transport_fee_lines` and
-- `hostel_fee_lines` both honour `ends_on`, so this stops the charge from the
-- following day and leaves the record intact.
--
-- WHAT IT CANNOT END IS A SENTENCE, NOT A REFUSAL
--
-- An unreturned library book and an unpaid balance both survive a child
-- leaving, and neither is this function's to decide about. Certificates already
-- settled the principle -- *"whether unpaid fees withhold a leaving certificate
-- is a real school's real policy and unlawful in some states"* -- so this
-- reports them and proceeds. A function that refused would be a function
-- schools route around.

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
  v_session_id uuid;
  v_on date := coalesce(p_left_on, current_date);
  v_name text;
  v_enrolments integer := 0;
  v_transport integer := 0;
  v_hostel integer := 0;
  v_concessions integer := 0;
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

  v_session_id := public.current_session_id(v_tenant_id);

  select (p.first_name || ' ' || p.last_name) into v_name
  from public.students st join public.people p on p.id = st.person_id
  where st.id = p_student_id;

  if v_name is null then
    raise exception 'No such student, or you cannot see them';
  end if;

  -- 1. The enrolment. `withdrawn` rather than `transferred_out` unless the
  --    school said transfer, because the two mean different things to whoever
  --    reads a class list next year.
  update public.enrolments
  set status = case when p_status = 'transferred' then 'transferred_out' else 'withdrawn' end
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_enrolments = row_count;

  -- 2. The bus seat. Ended, not cancelled -- see the header.
  update public.transport_assignments
  set ends_on = v_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and (ends_on is null or ends_on > v_on);
  get diagnostics v_transport = row_count;

  -- 3. The hostel bed, which also frees it for somebody else.
  update public.hostel_allocations
  set ends_on = v_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and (ends_on is null or ends_on > v_on);
  get diagnostics v_hostel = row_count;

  -- 4. Concessions. A discount on a bill nobody will raise is harmless, but it
  --    keeps the child on the concessions register and in its cost total, which
  --    is a number a bursar reports to a board.
  update public.student_concessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = ( select auth.uid() ),
      revoke_reason = format('Left the school on %s', to_char(v_on, 'FMDD Mon YYYY'))
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_concessions = row_count;

  -- 5. The status itself, last, so a failure above leaves the child visibly
  --    still here rather than half-gone.
  update public.students
  set status = p_status
  where id = p_student_id and tenant_id = v_tenant_id;

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
    'closed', jsonb_build_object(
      'enrolments', v_enrolments,
      'transport', v_transport,
      'hostel', v_hostel,
      'concessions', v_concessions
    ),
    'outstanding', v_outstanding
  );
end;
$$;

revoke all on function public.student_exit(uuid, text, date, text) from public, anon;
grant execute on function public.student_exit(uuid, text, date, text) to authenticated;

comment on function public.student_exit(uuid, text, date, text) is
  'Ends the enrolment, the bus seat, the hostel bed and any concessions, then '
  'sets the status. Reports what it could not end -- library books, an unpaid '
  'balance -- rather than refusing. Idempotent. See migration 0174.';

-- ---------------------------------------------------------------------------
-- Issuing the certificate performs the act
-- ---------------------------------------------------------------------------
--
-- `0134` said this in a comment and set one column. Now it means it. The
-- reason names the serial, so the exit and the document that caused it are
-- findable from each other without a join table.

create or replace function public.certificate_issue(
  p_student_id uuid,
  p_template_id uuid,
  p_issued_on date default null,
  p_extra jsonb default '{}'::jsonb
)
returns public.certificates
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id  uuid := public.current_tenant_id();
  v_session_id uuid;
  v_issued_on  date;
  v_t public.certificate_templates;
  v_preview jsonb;
  v_snapshot jsonb;
  v_serial text;
  v_body text;
  v_unresolved text[];
  v_row public.certificates;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'There is no current academic session to issue against';
  end if;

  v_issued_on := coalesce(p_issued_on, public.mobile_today());

  select * into v_t from public.certificate_templates where id = p_template_id;
  if v_t.id is null then
    raise exception 'No such certificate template';
  end if;
  if not v_t.is_active then
    raise exception 'The template "%" has been retired', v_t.name;
  end if;

  -- The same preview the person just looked at. Recomputing it here rather than
  -- trusting what the client sends is the ordinary server-boundary rule: the
  -- screen is a convenience, this is the gate.
  v_preview := public.certificate_preview(p_student_id, p_template_id, v_issued_on, p_extra);

  if not (v_preview ->> 'can_issue')::boolean then
    raise exception 'This certificate cannot be issued yet: %',
      ( select string_agg(p ->> 'message', ' ')
        from jsonb_array_elements(v_preview -> 'problems') p
        where p ->> 'severity' = 'error' );
  end if;

  -- The serial is allocated *before* rendering, so a template that prints
  -- {{serial}} gets the real number rather than a hole. Gapless, per rule 6,
  -- from the same counter receipts and invoices use.
  v_serial := public.fees_next_document_number_for(v_tenant_id, v_session_id, 'certificate');

  v_snapshot := public.certificate_snapshot(p_student_id, v_issued_on, p_extra)
                || jsonb_build_object('serial', v_serial);
  v_body := public.certificate_render(v_t.body, v_snapshot);

  v_unresolved := public.certificate_placeholders(v_body);
  if array_length(v_unresolved, 1) is not null then
    -- Belt and braces: the preview said this was clear, so reaching here means
    -- the two disagreed, and issuing a document with `{{...}}` printed on it is
    -- not a thing to do quietly.
    raise exception 'Nothing filled: %', array_to_string(v_unresolved, ', ');
  end if;

  insert into public.certificates (
    tenant_id, session_id, student_id,
    template_id, template_name, kind,
    serial_no, issued_on, issued_by,
    snapshot, body
  )
  values (
    v_tenant_id, v_session_id, p_student_id,
    v_t.id, v_t.name, v_t.kind,
    v_serial, v_issued_on, ( select auth.uid() ),
    v_snapshot, v_body
  )
  returning * into v_row;

  -- Issuing a leaving certificate *is* the act of the child leaving. Doing it in
  -- two steps leaves a school with certificates issued to children still on the
  -- roll, which is how a class list ends up with somebody who left in April.
  -- Issuing a leaving certificate *is* the act of the child leaving -- and
  -- `0134` said exactly that while setting one column. `student_exit` is the
  -- rest of it: the enrolment, the bus seat, the hostel bed and any
  -- concessions. The reason names the serial, so the exit and the document
  -- that caused it are findable from each other without a join table.
  if v_t.kind = 'transfer' then
    perform public.student_exit(
      p_student_id,
      format('Transfer certificate %s issued', v_serial),
      v_issued_on,
      'transferred'
    );
  end if;

  return v_row;
end;
$$;

revoke all on function public.certificate_issue(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.certificate_issue(uuid, uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------
--
-- Two directions, because both states exist in a school that has been running
-- for a year and neither announces itself.

create or replace function public.student_exit_problems()
returns table (student_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  -- Gone, but still attached to something that costs money or sends messages.
  -- These are the children who left before `student_exit` existed.
  select
    st.id,
    'warning'::text,
    format(
      '%s %s is marked %s but %s. They will keep being billed.',
      p.first_name, p.last_name, st.status,
      array_to_string(array_remove(array[
        case when exists (select 1 from public.enrolments e
                          where e.student_id = st.id and e.status = 'active')
             then 'is still enrolled' end,
        case when exists (select 1 from public.transport_assignments ta
                          where ta.student_id = st.id and ta.status = 'active'
                            and (ta.ends_on is null or ta.ends_on >= current_date))
             then 'still has a bus seat' end,
        case when exists (select 1 from public.hostel_allocations ha
                          where ha.student_id = st.id and ha.status = 'active'
                            and (ha.ends_on is null or ha.ends_on >= current_date))
             then 'still has a hostel bed' end
      ], null), ' and ')
    )
  from public.students st
  join public.people p on p.id = st.person_id
  where st.status in ('transferred', 'alumni', 'expelled')
    and (
      exists (select 1 from public.enrolments e
              where e.student_id = st.id and e.status = 'active')
      or exists (select 1 from public.transport_assignments ta
                 where ta.student_id = st.id and ta.status = 'active'
                   and (ta.ends_on is null or ta.ends_on >= current_date))
      or exists (select 1 from public.hostel_allocations ha
                 where ha.student_id = st.id and ha.status = 'active'
                   and (ha.ends_on is null or ha.ends_on >= current_date))
    )

  union all

  -- The other direction, and the one a cancelled transfer certificate leaves
  -- behind: back on the roll on paper, with no enrolment to put them in a
  -- class. They vanish from every register without being marked as gone.
  select
    st.id,
    'warning'::text,
    format(
      '%s %s is active but has no enrolment this year, so they appear on no '
      'register. Re-enrol them, or record that they have left.',
      p.first_name, p.last_name
    )
  from public.students st
  join public.people p on p.id = st.person_id
  where st.status = 'active'
    and not exists (
      select 1 from public.enrolments e
      where e.student_id = st.id
        and e.session_id = public.current_session_id(public.current_tenant_id())
        and e.status = 'active'
    )

  order by 2, 3
$$;

revoke all on function public.student_exit_problems() from public, anon;
grant execute on function public.student_exit_problems() to authenticated;

comment on function public.student_exit_problems() is
  'Children marked gone who are still attached to something, and children on '
  'the roll with nowhere to be. Sentences rather than a constraint, because '
  'both states are recoverable and neither is anybody''s fault. See 0174.';
