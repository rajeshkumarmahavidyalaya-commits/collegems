-- 0198 -- A dated row's year is arithmetic, not a flag.
--
-- `0195` separated three questions that had been one:
--
--   * `session_id`            -- which year a row is filed under
--   * the row's own date      -- which year it happened in
--   * `current_session_id()`  -- which year the school has decided it is in
--
-- ...gave the second a name (`academics_session_for_date`), and stopped there.
-- The write functions still answered the first with the third, which is how
-- 6,000 of 6,000 register rows came to be filed under a year that ended five
-- months before the earliest of them.
--
-- This closes that for the rows whose own date is the whole answer.
--
-- ---------------------------------------------------------------------------
-- Which functions this is true of, and which it is deliberately not
--
-- **Arithmetic** — the row records something that happened on a day, and the
-- day decides:
--
--   mark_attendance         a register is taken for a date
--   hr_mark_attendance      the same, for staff
--   library_issue_book      a book leaves the shelf today
--   stock_record_movement   `happened_on`, defaulting to today
--   visitor_check_in        somebody is in the building now
--
-- **A decision, and left alone** — `fees_generate_invoice` and the vouchers
-- that follow it. An invoice's `session_id` is *which year's fees it bills*,
-- and `fees_billable_lines` reads the current session to decide that: a bill
-- raised on 3 September for the 2026-27 year is a 2026-27 invoice whatever the
-- calendar says about the day it was printed. Rule 6 then ties every ledger
-- entry to its invoice by foreign key, and `accounts_sync` follows the source
-- document. Converting those to date arithmetic would file April's arrears
-- notice under the wrong year in the opposite direction.
--
-- The distinction is the point. "Stamp from the date" is not a blanket rule; it
-- is the rule for a row that *records a day*, and the modules that bill a year
-- are the ones it does not fit.

/**
 * One message, in one place.
 */
create or replace function public.academics_session_for_date_or_raise(p_on date)
returns uuid
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_id uuid := public.academics_session_for_date(p_on);
begin
  if v_id is null then
    -- Not "no current session": the school may well have one, and it is the
    -- wrong answer for this date. Say which date, and where to fix it.
    raise exception
      'No academic year covers %. Add one under Academics → Years.',
      to_char(p_on, 'FMDD Mon YYYY');
  end if;
  return v_id;
end;
$$;

comment on function public.academics_session_for_date_or_raise(date) is
  'academics_session_for_date, for a write path that cannot proceed without an '
  'answer. Kept beside the nullable version rather than replacing it: a read '
  'model wants null, a write wants a sentence.';

revoke all on function public.academics_session_for_date_or_raise(date) from public, anon;
grant execute on function public.academics_session_for_date_or_raise(date) to authenticated;


-- ---------------------------------------------------------------------------
-- The student register.
--
-- Two changes. The year now comes from the date, and **a zero is explained**:
-- the old body filtered entries to `enr.session_id = current_session_id()` and
-- returned the count, so a register taken on a day in a year the children are
-- not enrolled in wrote nothing and said nothing. The server action guessed at
-- two reasons for that zero; the function can name the real one.

create or replace function public.mark_attendance(
  p_section_id uuid,
  p_date date,
  p_entries jsonb,
  p_period integer default 0
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_written integer;
  v_year text;
  v_their_years text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  if p_date > current_date then
    raise exception 'Cannot mark attendance for a future date';
  end if;

  -- The register's year is the year containing the day it records — not
  -- whichever year happens to hold the flag when somebody presses save.
  v_session_id := public.academics_session_for_date_or_raise(p_date);

  with entries as (
    select
      (e ->> 'enrolment_id')::uuid as enrolment_id,
      e ->> 'status' as status,
      nullif(trim(coalesce(e ->> 'note', '')), '') as note
    from jsonb_array_elements(p_entries) as e
  ),
  valid as (
    select en.enrolment_id, en.status, en.note
    from entries en
    join public.enrolments enr on enr.id = en.enrolment_id
    where enr.tenant_id = v_tenant_id
      and enr.section_id = p_section_id
      and enr.session_id = v_session_id
  ),
  upserted as (
    insert into public.attendance_records
      (tenant_id, session_id, enrolment_id, attendance_date, period, status, note, marked_by)
    select v_tenant_id, v_session_id, v.enrolment_id, p_date, p_period, v.status, v.note, auth.uid()
    from valid v
    on conflict (tenant_id, enrolment_id, attendance_date, period) do update
      set status = excluded.status,
          note = excluded.note,
          marked_by = excluded.marked_by
    returning 1
  )
  select count(*) into v_written from upserted;

  -- A zero with entries in it means the enrolments and the date disagree about
  -- the year. That is a sentence, not a silent no-op: the previous behaviour is
  -- exactly how six thousand rows went to the wrong place without anybody
  -- seeing an error.
  if v_written = 0 and jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) > 0 then
    select string_agg(distinct s.name, ', ' order by s.name)
    into v_their_years
    from jsonb_array_elements(p_entries) as e
    join public.enrolments enr on enr.id = (e ->> 'enrolment_id')::uuid
    join public.academic_sessions s on s.id = enr.session_id
    where enr.tenant_id = v_tenant_id
      and enr.session_id <> v_session_id;

    if v_their_years is not null then
      select name into v_year from public.academic_sessions where id = v_session_id;
      raise exception
        '% falls in %, and these children are enrolled in %. Promote them into % first, or check the date.',
        to_char(p_date, 'FMDD Mon YYYY'), v_year, v_their_years, v_year;
    end if;
    -- Anything else — no permission, an enrolment in another section — is left
    -- to the caller's own message, because the function genuinely cannot tell
    -- those apart through RLS.
  end if;

  return v_written;
end;
$$;


create or replace function public.hr_mark_attendance(p_date date, p_entries jsonb)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_entry jsonb;
  v_written integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- Staff have no enrolment, so this one is pure arithmetic: the day decides.
  v_session_id := public.academics_session_for_date_or_raise(p_date);

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    if (v_entry ->> 'status') is null then
      delete from public.staff_attendance
      where tenant_id = v_tenant_id
        and staff_id = (v_entry ->> 'staff_id')::uuid
        and attendance_date = p_date
        and leave_request_id is null;
      continue;
    end if;

    insert into public.staff_attendance (
      tenant_id, session_id, staff_id, attendance_date, status, check_in, check_out, note, marked_by
    )
    values (
      v_tenant_id, v_session_id,
      (v_entry ->> 'staff_id')::uuid,
      p_date,
      v_entry ->> 'status',
      (v_entry ->> 'check_in')::time,
      (v_entry ->> 'check_out')::time,
      v_entry ->> 'note',
      auth.uid()
    )
    on conflict (tenant_id, staff_id, attendance_date) do update
      set status = excluded.status,
          check_in = excluded.check_in,
          check_out = excluded.check_out,
          note = excluded.note,
          marked_by = excluded.marked_by,
          leave_request_id = case
            when excluded.status = 'on_leave' then staff_attendance.leave_request_id
            else null
          end;

    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;


-- ---------------------------------------------------------------------------
-- The three that record "now".

create or replace function public.library_issue_book(
  p_book_id uuid,
  p_member_id uuid,
  p_due_at date default (current_date + interval '14 days')
)
returns public.book_issues
language plpgsql
set search_path = public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_available integer;
  v_max_books integer;
  v_open_count integer;
  v_issue public.book_issues;
begin
  select available_copies into v_available from public.books
  where id = p_book_id and tenant_id = v_tenant_id
  for update;

  if v_available is null then
    raise exception 'Book not found';
  end if;
  if v_available < 1 then
    raise exception 'No copies available';
  end if;

  select max_books into v_max_books from public.members
  where id = p_member_id and tenant_id = v_tenant_id and status = 'active';

  if v_max_books is null then
    raise exception 'Member not found or not active';
  end if;

  select count(*) into v_open_count from public.book_issues
  where member_id = p_member_id and status = 'issued';

  if v_open_count >= v_max_books then
    raise exception 'Member has reached their borrowing limit';
  end if;

  -- The loan belongs to the year the book left the shelf.
  v_session_id := public.academics_session_for_date_or_raise(current_date);

  update public.books set available_copies = available_copies - 1
  where id = p_book_id;

  insert into public.book_issues (tenant_id, session_id, book_id, member_id, due_at, issued_by)
  values (v_tenant_id, v_session_id, p_book_id, p_member_id, p_due_at, auth.uid())
  returning * into v_issue;

  return v_issue;
end;
$$;


create or replace function public.stock_record_movement(
  p_item_id uuid,
  p_kind text,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_issued_to_staff_id uuid default null,
  p_issued_to_note text default null,
  p_supplier text default null,
  p_reference text default null,
  p_note text default null,
  p_happened_on date default null
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_on date := coalesce(p_happened_on, current_date);
  v_item record;
  v_on_hand numeric;
  v_signed numeric;
  v_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- `happened_on` is already a column on the row; the year follows it rather
  -- than the flag, so a delivery back-dated to March files under March's year.
  v_session_id := public.academics_session_for_date_or_raise(v_on);

  if p_kind not in ('receipt', 'issue', 'return', 'adjustment', 'write_off') then
    raise exception 'Unknown movement kind: %', p_kind;
  end if;

  if p_kind <> 'adjustment' and coalesce(p_quantity, 0) <= 0 then
    raise exception 'Enter how many, as a positive number';
  end if;
  if p_kind = 'adjustment' and coalesce(p_quantity, 0) = 0 then
    raise exception 'An adjustment of zero changes nothing';
  end if;

  select i.id, i.name, i.unit, i.is_active into v_item
  from public.inventory_items i where i.id = p_item_id;

  if v_item.id is null then
    raise exception 'That item does not exist';
  end if;
  if not v_item.is_active and p_kind = 'receipt' then
    raise exception '% is no longer stocked', v_item.name;
  end if;

  v_signed := case p_kind
    when 'issue' then -abs(p_quantity)
    when 'write_off' then -abs(p_quantity)
    when 'adjustment' then p_quantity
    else abs(p_quantity)
  end;

  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text, 0));

  if v_signed < 0 and p_kind <> 'adjustment' then
    select coalesce(sum(m.quantity), 0) into v_on_hand
    from public.stock_movements m where m.item_id = p_item_id;

    if v_on_hand + v_signed < 0 then
      raise exception 'There are % % of % on hand and you are taking out %',
        public.format_quantity(v_on_hand), v_item.unit, v_item.name,
        public.format_quantity(abs(v_signed));
    end if;
  end if;

  insert into public.stock_movements (
    tenant_id, session_id, item_id, kind, quantity, unit_cost,
    issued_to_staff_id, issued_to_note, supplier, reference, note,
    happened_on, recorded_by
  )
  values (
    v_tenant_id, v_session_id, p_item_id, p_kind, v_signed,
    case when p_kind in ('receipt', 'adjustment') then p_unit_cost end,
    p_issued_to_staff_id,
    nullif(btrim(coalesce(p_issued_to_note, '')), ''),
    nullif(btrim(coalesce(p_supplier, '')), ''),
    nullif(btrim(coalesce(p_reference, '')), ''),
    nullif(btrim(coalesce(p_note, '')), ''),
    v_on,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;


create or replace function public.visitor_check_in(
  p_visitor_name text,
  p_purpose text,
  p_phone text default null,
  p_organisation text default null,
  p_host_staff_id uuid default null,
  p_host_note text default null,
  p_student_id uuid default null,
  p_id_proof_kind text default null,
  p_id_proof_last4 text default null,
  p_vehicle_number text default null
)
returns public.visitors
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.visitors;
  v_open record;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- Somebody is in the building now, so the year is today's.
  v_session_id := public.academics_session_for_date_or_raise(current_date);

  if btrim(coalesce(p_visitor_name, '')) = '' then
    raise exception 'A pass needs a name';
  end if;
  if btrim(coalesce(p_purpose, '')) = '' then
    raise exception 'Say why they are here -- "who is in the building and why" is the whole register';
  end if;

  begin
    insert into public.visitors (
      tenant_id, session_id, pass_number, visitor_name, phone, organisation,
      purpose, host_staff_id, host_note, student_id,
      id_proof_kind, id_proof_last4, vehicle_number, checked_in_by
    )
    values (
      v_tenant_id, v_session_id, public.fees_next_document_number('visitor_pass'),
      btrim(p_visitor_name),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_organisation, '')), ''),
      btrim(p_purpose),
      p_host_staff_id,
      nullif(btrim(coalesce(p_host_note, '')), ''),
      p_student_id,
      nullif(btrim(coalesce(p_id_proof_kind, '')), ''),
      nullif(btrim(coalesce(p_id_proof_last4, '')), ''),
      nullif(btrim(coalesce(p_vehicle_number, '')), ''),
      auth.uid()
    )
    returning * into v_row;
  exception when unique_violation then
    select pass_number, checked_in_at into v_open
    from public.visitors
    where tenant_id = v_tenant_id and phone = btrim(p_phone) and checked_out_at is null
    limit 1;

    raise exception
      'That number is already signed in on pass % since %. Sign them out first.',
      coalesce(v_open.pass_number, '?'),
      to_char(coalesce(v_open.checked_in_at, now()), 'HH24:MI');
  end;

  return v_row;
end;
$$;
