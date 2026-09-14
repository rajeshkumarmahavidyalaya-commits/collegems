-- 0220 -- A refusal message is a promise.
--
-- `student_exit` will not run without a reason, in these words:
--
--   > Say why this child is leaving -- it is the only thing a record five years
--   > from now will have.
--
-- It then checks the length and **throws the words away**. `p_reason` occurs
-- twice in the whole body: once in the signature, once in the `if length(...)
-- < 3`. What it hands on to `student_end_relationships` is not what anybody
-- typed -- it is `format('Left the school on %s', v_on)`, generated from the
-- date. So the sentence the office wrote reached exactly nothing, and the
-- record five years from now has neither the reason nor the leaving date:
-- `students` carries no column for either.
--
-- It never reached `audit_log` either, and that is the part worth keeping:
-- **the log copies rows, and this was never on one.** A parameter that is
-- validated and dropped is invisible to every mechanism this codebase relies on
-- to notice things, which is how it survived six migrations of work on this
-- exact function.
--
-- Measured over the 295 functions in `public`: 28 take somebody's own words, 25
-- write them, three do not -- in two shapes that deserve different urgency:
--
--   asked and discarded   student_exit, staff_exit    a required "Why" box on a
--                                                     real screen; the save then
--                                                     succeeds and says nothing
--   never asked           library_waive_staff_fine    p_note declared and never
--                                                     mentioned; the app does
--                                                     not pass it at all
--
-- This closes all three.
--
-- ## Two things checked before writing a line of it
--
-- **The column name.** `docs/modules/student-exit.md` proposed `students.left_on`.
-- `staff.date_of_leaving` already exists and means precisely that, and two names
-- for one concept across two tables is the drift this file criticises
-- everywhere else -- so it is `students.date_of_leaving`. The *return document*
-- of `student_exit` keeps its `left_on` key, because that is a published shape
-- the students screen reads and renaming it would be a breaking change for a
-- nicer word (rule 3's `admin`-is-not-renamed reasoning).
--
-- **Whether a new column is writable at all.** These functions are
-- `SECURITY INVOKER`, so they write as the caller. `information_schema.
-- column_privileges` lists every column of `students`, `staff` and
-- `book_issues` as granted to `authenticated` -- which reads exactly like the
-- column-level `GRANT` that `certificates` really has, and would have meant a
-- new column was *not* writable and the function would fail with
-- `permission denied for column`. It is not: `information_schema.
-- table_privileges` shows a **table-level** UPDATE grant on all three, which
-- `column_privileges` expands per column. `certificates` is absent from that
-- table-level list, which is how the two are told apart. So no grant is needed
-- here, and adding one would have widened nothing while looking prudent.

begin;

-- ---------------------------------------------------------------------------
-- Somewhere for the words to go
-- ---------------------------------------------------------------------------

alter table public.students
  add column if not exists date_of_leaving date,
  add column if not exists exit_reason text;

comment on column public.students.date_of_leaving is
  'The day the child left. Written by `student_exit` and by a promotion run '
  'that graduates them; null while they are still here. Named to match '
  '`staff.date_of_leaving` rather than inventing a second word for one fact.';

comment on column public.students.exit_reason is
  'Why they left, in the words of whoever performed the exit -- "moving to '
  'Pune, father transferred", or "Graduated from 2025-2026" when a promotion '
  'run did it. `student_exit` has always demanded this and never stored it.';

alter table public.staff
  add column if not exists exit_reason text;

comment on column public.staff.exit_reason is
  'Why they left. `staff.date_of_leaving` has existed since 0003 and is '
  'written; the reason `staff_exit` insists on had no column until 0220.';

alter table public.book_issues
  add column if not exists staff_fine_waive_note text;

comment on column public.book_issues.staff_fine_waive_note is
  'Why a staff library fine was written off. Beside `staff_fine_waived_at` and '
  '`staff_fine_waived_by`, which were always written -- this is the third of '
  'the three, and writing off money with no note is a decision somebody will '
  'be asked about.';

-- ---------------------------------------------------------------------------
-- ...and the act that writes them
-- ---------------------------------------------------------------------------

-- `student_end_relationships` is where the summary is set, deliberately last
-- (0174: "so a failure above leaves the child visibly still here rather than
-- half-gone"). The date and the reason belong in that same statement for the
-- same reason -- a child whose status says `alumni` with no reason beside it is
-- half-gone in a quieter way.
--
-- **`p_reason` stops being decoration and becomes the exit reason.** It already
-- fed `student_concessions.revoke_reason`, and it still does; what changes is
-- that `student_exit` now passes the sentence a person wrote rather than a
-- restatement of the date. That makes the concession's note better too: *why*
-- an award was revoked is "the child left: moving to Pune", and `revoked_at`
-- already carries the when.
--
-- `promotion_apply` needs no change. It passes `format('Graduated from %s',
-- v_from_name)`, which was already a genuine reason for leaving and is exactly
-- what this column should hold for a graduate.
create or replace function public.student_end_relationships(
  p_student_id uuid,
  p_on date,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_enrolments integer := 0;
  v_transport integer := 0;
  v_hostel integer := 0;
  v_concessions integer := 0;
  v_library integer := 0;
begin
  update public.enrolments
  set status = case when p_status = 'transferred' then 'transferred_out' else 'withdrawn' end
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_enrolments = row_count;

  update public.transport_assignments
  set ends_on = p_on
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on <= p_on
    and effective_ends_on > p_on;
  get diagnostics v_transport = row_count;

  update public.transport_assignments
  set status = 'cancelled'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active'
    and starts_on > p_on;

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

  update public.student_concessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = ( select auth.uid() ),
      revoke_reason = p_reason
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_concessions = row_count;

  -- 5. The library membership. `expired`, not `suspended`: a suspension is
  --    something a librarian does about behaviour, and this is a membership
  --    that ran out because the person is no longer at the school.
  update public.members
  set status = 'expired'
  where student_id = p_student_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_library = row_count;

  -- 6. The summary itself, last, so a failure above leaves the child visibly
  --    still here rather than half-gone -- and now the date and the reason in
  --    the same statement, because a status with no reason beside it is
  --    half-gone in a quieter way.
  --
  --    `coalesce` on the date: a child re-exited after a correction keeps the
  --    day they actually left, the same way `staff_exit` has always treated
  --    `date_of_leaving`.
  update public.students
  set status = p_status,
      date_of_leaving = coalesce(date_of_leaving, p_on),
      exit_reason = p_reason
  where id = p_student_id and tenant_id = v_tenant_id;

  return jsonb_build_object(
    'enrolments', v_enrolments,
    'transport', v_transport,
    'hostel', v_hostel,
    'concessions', v_concessions,
    'library', v_library
  );
end;
$$;

comment on function public.student_end_relationships(uuid, date, text, text) is
  'Ends every relationship a child has and sets the summary last. Since 0220 it '
  'also writes `date_of_leaving` and `exit_reason` in that same statement -- '
  '`p_reason` is the exit reason, and both callers already pass one worth '
  'keeping.';

-- ---------------------------------------------------------------------------
-- ...and the one-line change that is the whole bug
-- ---------------------------------------------------------------------------

-- The only edit to `student_exit` is what it hands on: `p_reason` instead of
-- `format('Left the school on %s', v_on)`. The date is not lost -- it is
-- `v_on`, which the same call already passes as `p_on` and which is now stored
-- on the row. The generated sentence was restating an argument it was sent
-- beside, and doing so on top of the one thing a person had actually written.
create or replace function public.student_exit(
  p_student_id uuid,
  p_reason text,
  p_left_on date default null,
  p_status text default 'transferred'
)
returns jsonb
language plpgsql
set search_path = 'public', 'extensions'
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

  -- The sentence somebody wrote, passed on rather than replaced.
  v_closed := public.student_end_relationships(p_student_id, v_on, p_status, trim(p_reason));

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

  -- `left_on` keeps its name in the *return document* even though the column is
  -- `date_of_leaving`: the students screen reads this key, and renaming a
  -- published shape to match a column is a breaking change for a nicer word.
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

comment on function public.student_exit(uuid, text, date, text) is
  'Performs a child''s exit: ends every relationship, records the day and the '
  'reason, and names what it could not end. Since 0220 the reason a person '
  'types is stored rather than validated and dropped.';

-- ---------------------------------------------------------------------------
-- The same one line, for staff
-- ---------------------------------------------------------------------------

-- Copied from `0192` (its own latest definition) rather than retyped, and
-- verified against the live `pg_get_functiondef` first: same arguments, same
-- two references to `p_reason`, same `update public.staff`. **Transcribing five
-- thousand characters by hand to change one of them is how a migration
-- introduces a bug it was not written to introduce.**

create or replace function public.staff_exit(
  p_staff_id uuid,
  p_reason text,
  p_left_on date default null,
  p_status text default 'terminated'
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_on date := coalesce(p_left_on, current_date);
  v_name text;
  v_lessons integer := 0;
  v_sections integer := 0;
  v_subjects integer := 0;
  v_books integer := 0;
  v_library integer := 0;
  v_future_covers integer := 0;
  v_outstanding jsonb := '[]'::jsonb;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_status not in ('terminated', 'resigned', 'retired', 'inactive') then
    raise exception 'A member of staff leaves as terminated, resigned, retired or inactive -- not "%"', p_status;
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why they are leaving -- it is the only thing a record five years from now will have';
  end if;

  select (p.first_name || ' ' || p.last_name) into v_name
  from public.staff s join public.people p on p.id = s.person_id
  where s.id = p_staff_id;

  if v_name is null then
    raise exception 'No such member of staff, or you cannot see them';
  end if;

  -- 1. The timetable. Unassigned, not deleted: the class still happens.
  update public.timetable_entries
  set teacher_staff_id = null
  where teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_lessons = row_count;

  -- 2. Class-teacher duty. A section whose class teacher has left needs one,
  --    and `academics` already treats null as "not yet chosen".
  update public.sections
  set class_teacher_staff_id = null
  where class_teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_sections = row_count;

  -- 3. Subject assignments.
  update public.section_subjects
  set teacher_staff_id = null
  where teacher_staff_id = p_staff_id and tenant_id = v_tenant_id;
  get diagnostics v_subjects = row_count;

  -- 4. The library membership, for the same reason it closes for a child:
  --    nothing else stops a book being issued to somebody who has left, and
  --    `library_issue_book` checks `members.status` rather than whether the
  --    person is still here.
  update public.members
  set status = 'expired'
  where staff_id = p_staff_id
    and tenant_id = v_tenant_id
    and status = 'active';
  get diagnostics v_library = row_count;

  -- 5. The employment record, last -- so a failure above leaves them visibly
  --    still employed rather than half-gone.
  update public.staff
  set status = p_status,
      date_of_leaving = coalesce(date_of_leaving, v_on),
      -- The one line 0192 was missing. `date_of_leaving` was always written;
      -- the reason the function refuses to run without had no column.
      exit_reason = trim(p_reason)
  where id = p_staff_id and tenant_id = v_tenant_id;

  -- ---- what this cannot end ------------------------------------------------

  select count(*) into v_books
  from public.book_issues bi
  join public.members m on m.id = bi.member_id
  where m.staff_id = p_staff_id and bi.status = 'issued';

  if v_books > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'library',
      'message', format(
        '%s still has %s library %s out, and any fine on them is a payroll '
        'deduction rather than a fee -- see the library module.',
        v_name, v_books, case when v_books = 1 then 'book' else 'books' end)
    );
  end if;

  -- Cover they were down to provide after today. Deliberately not cleared:
  -- `substitutions` records what was arranged, and rewriting it would erase a
  -- decision somebody made. Naming it lets the office re-arrange.
  select count(*) into v_future_covers
  from public.substitutions s
  where s.substitute_staff_id = p_staff_id
    and s.on_date > v_on;

  if v_future_covers > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'cover',
      'message', format(
        '%s is down to cover %s %s after %s. Those need re-arranging -- this '
        'has not touched them, because the roster is a record of what was '
        'decided.',
        v_name, v_future_covers,
        case when v_future_covers = 1 then 'class' else 'classes' end,
        to_char(v_on, 'FMDD Mon YYYY'))
    );
  end if;

  if v_lessons > 0 then
    v_outstanding := v_outstanding || jsonb_build_object(
      'kind', 'timetable',
      'message', format(
        '%s %s now %s nobody teaching %s. They show on the cover list as '
        'unassigned until the timetable is redrawn.',
        v_lessons, case when v_lessons = 1 then 'lesson' else 'lessons' end,
        case when v_lessons = 1 then 'has' else 'have' end,
        case when v_lessons = 1 then 'it' else 'them' end)
    );
  end if;

  return jsonb_build_object(
    'staff_id', p_staff_id,
    'staff', v_name,
    'left_on', v_on,
    'status', p_status,
    'unassigned', jsonb_build_object(
      'lessons', v_lessons,
      'sections', v_sections,
      'subjects', v_subjects
    ),
    'closed', jsonb_build_object('library', v_library),
    'outstanding', v_outstanding
  );
end;
$$;

comment on function public.staff_exit(uuid, text, date, text) is
  'Performs a member of staff''s exit: unassigns their lessons and duties, ends '
  'their library membership, records the day and -- since 0220 -- the reason.';

-- ---------------------------------------------------------------------------
-- ...and the third, which nobody was even asked for
-- ---------------------------------------------------------------------------

-- A different defect from the other two, and a milder one. `p_note` has been in
-- this signature since `0066`, is mentioned nowhere in the body, and the
-- application calls the function **without it** -- so nothing has been lost,
-- and what existed was a parameter the product could not reach. Rule 15's *"a
-- correct string nobody renders is not a feature"*, wearing a signature.
--
-- Writing it rather than dropping it, because the librarian's screen should ask:
-- writing off money with no note is a decision somebody will be asked about,
-- and `staff_fine_waived_at` and `staff_fine_waived_by` were always recorded
-- beside it. The parameter keeps its default, so the existing caller is
-- unaffected on the day this runs.
create or replace function public.library_waive_staff_fine(p_issue_id uuid, p_note text default null)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_issue public.book_issues;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_issue from public.book_issues bi
  where bi.id = p_issue_id and bi.tenant_id = v_tenant_id;

  if v_issue.id is null then
    raise exception 'That issue does not exist';
  end if;
  if v_issue.fine_amount <= 0 then
    raise exception 'There is no fine on this issue to waive.';
  end if;
  if v_issue.staff_fine_payslip_id is not null then
    raise exception 'This fine has already been collected on a payslip. Reverse that instead.';
  end if;
  if not exists (
    select 1 from public.members m
    where m.id = v_issue.member_id and m.staff_id is not null
  ) then
    raise exception 'This is a student fine. It is settled through the fee ledger, not here.';
  end if;

  update public.book_issues
  set staff_fine_waived_at = now(),
      staff_fine_waived_by = auth.uid(),
      -- `nullif(trim(...), '')` rather than the raw argument: an empty string
      -- submitted by an untouched form field is *no note*, not a note that says
      -- nothing. The same distinction `formatCurrency` draws between "" and 0.
      staff_fine_waive_note = nullif(trim(p_note), '')
  where id = p_issue_id;
end;
$$;

comment on function public.library_waive_staff_fine(uuid, text) is
  'Writes off a staff library fine. Since 0220 the note is stored: it had been '
  'a parameter the application never passed and the body never read.';

commit;
