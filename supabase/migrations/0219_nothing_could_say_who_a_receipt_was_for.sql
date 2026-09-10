-- 0219 — Nothing could say who a receipt was for
--
-- `reference.notification_types` declares nine events. Four have a raiser:
-- `attendance.absent`, `fees.due_reminder` and `library.book_overdue` through
-- `schedule_run`, and `notice.published` from the board. **Five do not**, and
-- three of those are the ones a family actually waits for:
--
--   exam.results_published    declared in 0082, raised by nothing
--   fees.invoice_raised       declared in 0035, raised by nothing
--   fees.payment_received     declared in 0035, raised by nothing
--
-- Measured on the demo college: **1 notification ever sent**, 2 deliveries, 0
-- templates, 0 preferences. The dispatcher, five drivers, the WhatsApp template
-- freeze, the delivery log and the channel settings are all built, and one
-- screen calls them.
--
-- ## Why, and it is not neglect
--
-- `notify_resolve_audience` understands four kinds:
--
--   all       everybody in the college
--   role      everybody holding a role
--   users     a list of logins
--   section   a class, its students, its parents, or both
--
-- **There is no way to say "this child's family".** A fee receipt is addressed
-- to one family; an invoice is addressed to one family; and neither could be
-- expressed, so neither was ever raised. The catalogue entry was written, the
-- module that would send it was built, and the sentence in between could not be
-- said.
--
-- > A vocabulary that cannot name the recipient is why the message was never
-- > sent. Look at what the audience *can* express before concluding a module
-- > forgot to call the dispatcher.
--
-- ## One kind, not two
--
-- The obvious fix is a `student` kind taking one id. `students` taking a list
-- is the same code and serves both — a receipt is a list of one, an exam is the
-- cohort that sat it — so there is one kind rather than a singular and a plural
-- that will drift. Additive, so every existing audience document keeps working.
--
-- ## Three raisers, and each is somebody's act
--
-- `notify_send` is `SECURITY DEFINER` with `current_role_code() = 'admin'`, and
-- an accountant taking a payment is not an administrator — so the module cannot
-- simply call it. Rule 6 already says what to do:
--
--   > a background job gets a **narrower** function answering only its own
--   > question
--
-- …and the same is true of a narrower *person*. Each raiser is definer, checks
-- the permission held by whoever performs the act, resolves its own audience,
-- and can raise exactly one event. None of them takes a subject or a body from
-- its caller: **a function that let a caller choose the words would be
-- `notify_send` with a different name**, and the admin check on that one exists
-- for a reason.

begin;

-- ---------------------------------------------------------------------------
-- The missing audience kind
-- ---------------------------------------------------------------------------

create or replace function public.notify_resolve_audience(p_tenant_id uuid, p_audience jsonb)
returns table (user_id uuid)
language sql
stable
set search_path = 'public', 'extensions'
as $$
  select up.id
  from public.user_profiles up
  where up.tenant_id = p_tenant_id
    and up.is_active
    and (
      (p_audience ->> 'kind') = 'all'
      or (
        (p_audience ->> 'kind') = 'role'
        and up.role_id in (
          select r.id from public.roles r
          where r.tenant_id = p_tenant_id and r.code = (p_audience ->> 'role')
        )
      )
      or (
        (p_audience ->> 'kind') = 'users'
        and up.id::text in (
          select jsonb_array_elements_text(coalesce(p_audience -> 'user_ids', '[]'::jsonb))
        )
      )
      or (
        (p_audience ->> 'kind') = 'section'
        and (
          (
            coalesce(p_audience ->> 'who', 'both') in ('students', 'both')
            and up.student_id in (
              select e.student_id from public.enrolments e
              where e.tenant_id = p_tenant_id
                and e.section_id = (p_audience ->> 'section_id')::uuid
                and e.status = 'active'
            )
          )
          or (
            coalesce(p_audience ->> 'who', 'both') in ('parents', 'both')
            and up.guardian_id in (
              select gs.guardian_id
              from public.guardian_student gs
              join public.enrolments e on e.student_id = gs.student_id
              where gs.tenant_id = p_tenant_id
                and e.tenant_id = p_tenant_id
                and e.section_id = (p_audience ->> 'section_id')::uuid
                and e.status = 'active'
            )
          )
        )
      )
      -- The addition. Named children and their families, which is what every
      -- per-child event needs and none of the four above could say.
      --
      -- Deliberately NOT filtered on `enrolments.status`: a receipt for a child
      -- who left last week is still that family's receipt, and the four kinds
      -- above are about people who are *here now*. The caller chose these ids;
      -- narrowing them here would be a second opinion about a list somebody
      -- already decided.
      or (
        (p_audience ->> 'kind') = 'students'
        and (
          (
            coalesce(p_audience ->> 'who', 'both') in ('students', 'both')
            and up.student_id::text in (
              select jsonb_array_elements_text(coalesce(p_audience -> 'student_ids', '[]'::jsonb))
            )
          )
          or (
            coalesce(p_audience ->> 'who', 'both') in ('parents', 'both')
            and up.guardian_id in (
              select gs.guardian_id
              from public.guardian_student gs
              where gs.tenant_id = p_tenant_id
                and gs.student_id::text in (
                  select jsonb_array_elements_text(coalesce(p_audience -> 'student_ids', '[]'::jsonb))
                )
            )
          )
        )
      )
    )
$$;

comment on function public.notify_resolve_audience(uuid, jsonb) is
  'Turns an audience document into logins. Five kinds: all, role, users, '
  'section, students. The last takes `student_ids` and reaches those children '
  'and/or their guardians -- which is what a receipt, an invoice and a result '
  'need, and what the first four could not say.';

-- ---------------------------------------------------------------------------
-- A receipt is addressed to the family that paid
-- ---------------------------------------------------------------------------

create or replace function public.fees_announce_payment(p_ledger_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_entry public.ledger_entries;
  v_name text;
  v_note public.notifications;
begin
  if v_tenant is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  -- The permission held by whoever takes money at the counter. `fees.view` is
  -- held by a family, and a family announcing their own receipt to themselves
  -- is not a thing this should make possible.
  if not public.role_has_permission('fees.collect') then
    raise exception 'Your role does not send fee receipts.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_entry from public.ledger_entries
   where id = p_ledger_entry_id and tenant_id = v_tenant;
  if v_entry.id is null then
    raise exception 'No such receipt.' using errcode = 'no_data_found';
  end if;
  if v_entry.entry_type <> 'payment' then
    raise exception 'That entry is a % rather than a payment.', v_entry.entry_type
      using errcode = 'check_violation';
  end if;

  select p.first_name || ' ' || p.last_name into v_name
  from public.students st join public.people p on p.id = st.person_id
  where st.id = v_entry.student_id;

  -- The wording is the function's, never the caller's. The amount is read back
  -- from the row rather than passed in, so a receipt cannot announce a figure
  -- that is not in the ledger.
  select * into v_note from public.notify_send_for(
    v_tenant,
    'fees.payment_received',
    format('Payment received — receipt %s', v_entry.receipt_number),
    format('We have received %s for %s. Receipt number %s, dated %s.',
           to_char(abs(v_entry.amount), 'FM999,999,990.00'),
           coalesce(v_name, 'your child'),
           v_entry.receipt_number,
           to_char(v_entry.occurred_at, 'FMDD Mon YYYY')),
    jsonb_build_object('kind', 'students',
                       'student_ids', jsonb_build_array(v_entry.student_id),
                       'who', 'both'),
    jsonb_build_object('student', coalesce(v_name, ''),
                       'amount', to_char(abs(v_entry.amount), 'FM999,999,990.00'),
                       'receipt_number', coalesce(v_entry.receipt_number, ''),
                       'paid_on', to_char(v_entry.occurred_at, 'FMDD Mon YYYY')),
    null,
    (select auth.uid()),
    -- A family with no login is a gap, not a failure: the receipt was still
    -- taken. `notice.published` made the same decision and for the same reason.
    false
  );

  return jsonb_build_object('notification_id', v_note.id, 'receipt_number', v_entry.receipt_number);
end;
$$;

comment on function public.fees_announce_payment(uuid) is
  'Tells a family their payment was received. Definer because notify_send is '
  'admin-only and an accountant is not an administrator; gated on fees.collect, '
  'and it reads the amount and receipt number from the ledger row rather than '
  'taking them from the caller.';

revoke all on function public.fees_announce_payment(uuid) from public, anon;
grant execute on function public.fees_announce_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ...and so is a bill
-- ---------------------------------------------------------------------------

create or replace function public.fees_announce_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_invoice public.invoices;
  v_name text;
  v_total numeric;
  v_note public.notifications;
begin
  if v_tenant is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if not public.role_has_permission('fees.collect') then
    raise exception 'Your role does not send fee notices.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_invoice from public.invoices
   where id = p_invoice_id and tenant_id = v_tenant;
  if v_invoice.id is null then
    raise exception 'No such invoice.' using errcode = 'no_data_found';
  end if;
  -- A draft is not a bill. Announcing one would tell a family about a charge
  -- the office has not decided to make.
  if v_invoice.status <> 'issued' then
    raise exception 'That invoice is % rather than issued.', v_invoice.status
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(l.amount), 0) into v_total
  from public.invoice_lines l where l.invoice_id = v_invoice.id;

  select p.first_name || ' ' || p.last_name into v_name
  from public.students st join public.people p on p.id = st.person_id
  where st.id = v_invoice.student_id;

  select * into v_note from public.notify_send_for(
    v_tenant,
    'fees.invoice_raised',
    format('Fee notice %s', v_invoice.invoice_number),
    format('A fee notice for %s has been raised: %s, due %s. The full breakdown is on the fees page.',
           coalesce(v_name, 'your child'),
           to_char(v_total, 'FM999,999,990.00'),
           to_char(v_invoice.due_date, 'FMDD Mon YYYY')),
    jsonb_build_object('kind', 'students',
                       'student_ids', jsonb_build_array(v_invoice.student_id),
                       'who', 'both'),
    jsonb_build_object('student', coalesce(v_name, ''),
                       'amount', to_char(v_total, 'FM999,999,990.00'),
                       'invoice_number', coalesce(v_invoice.invoice_number, ''),
                       'due_on', to_char(v_invoice.due_date, 'FMDD Mon YYYY')),
    null,
    (select auth.uid()),
    false
  );

  return jsonb_build_object('notification_id', v_note.id, 'invoice_number', v_invoice.invoice_number);
end;
$$;

comment on function public.fees_announce_invoice(uuid) is
  'Tells a family a bill has been raised. Refuses a draft: announcing one tells '
  'a family about a charge the office has not decided to make.';

revoke all on function public.fees_announce_invoice(uuid) from public, anon;
grant execute on function public.fees_announce_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ...and results go to the cohort that sat the exam
-- ---------------------------------------------------------------------------

create or replace function public.exams_announce_results(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_exam public.exams;
  v_students jsonb;
  v_count integer;
  v_note public.notifications;
begin
  if v_tenant is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  -- `exams.publish`, not `exams.manage`: publishing is the act this announces,
  -- and 0213 separated the two precisely so a college can hold one back.
  if not public.role_has_permission('exams.publish') then
    raise exception 'Your role does not publish results.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam from public.exams where id = p_exam_id and tenant_id = v_tenant;
  if v_exam.id is null then
    raise exception 'No such exam.' using errcode = 'no_data_found';
  end if;
  if v_exam.status <> 'published' then
    raise exception 'Publish the results before announcing them.'
      using errcode = 'check_violation';
  end if;

  -- The cohort is whoever has a frozen result row, which is exactly who the
  -- exam produced an answer for -- not everybody enrolled, and not everybody
  -- who sat a paper. `exam_results` is the table publishing writes.
  select coalesce(jsonb_agg(distinct r.student_id), '[]'::jsonb), count(distinct r.student_id)
    into v_students, v_count
  from public.exam_results r
  where r.tenant_id = v_tenant and r.exam_id = p_exam_id;

  if v_count = 0 then
    raise exception 'That exam has no results to announce.' using errcode = 'no_data_found';
  end if;

  select * into v_note from public.notify_send_for(
    v_tenant,
    'exam.results_published',
    format('%s results are out', v_exam.name),
    format('Results for %s have been published. The report card is on the exams page.', v_exam.name),
    jsonb_build_object('kind', 'students', 'student_ids', v_students, 'who', 'both'),
    jsonb_build_object('exam', v_exam.name),
    null,
    (select auth.uid()),
    false
  );

  return jsonb_build_object('notification_id', v_note.id, 'students', v_count);
end;
$$;

comment on function public.exams_announce_results(uuid) is
  'Announces a published exam to the cohort that has a frozen result row. One '
  'notification, per rule 10 -- announcing again is a second deliberate act, '
  'never a side effect of re-publishing.';

revoke all on function public.exams_announce_results(uuid) from public, anon;
grant execute on function public.exams_announce_results(uuid) to authenticated;

commit;
