-- The day book, computed in Postgres so its day boundaries are the school's.
--
-- The first version of this filtered `occurred_at` against timestamps built in
-- the Node process. Vercel runs in UTC, so "today" for a school in
-- Asia/Kolkata would have started at 05:30 local and ended at 05:30 the next
-- morning. A counter does not usually take money between midnight and half
-- past five, so the error would have stayed invisible until the one evening it
-- didn't -- and a day book that reports the wrong day is not a day book.
--
-- `tenants.timezone` has been carried since the first migration and never used.
-- This is what it is for.
--
-- The range is half-open -- `>= start of p_from` and `< start of the day after
-- p_to` -- which is the only way to include a whole final day without the
-- 23:59:59.999 fencepost, and it stays correct at a DST boundary for tenants
-- in zones that have one.
--
-- Joining the student in here as well removes the second round trip the server
-- action was making to name each row.

create or replace function public.fees_day_book(
  p_from date,
  p_to date
)
returns table (
  id uuid,
  occurred_at timestamptz,
  entry_type text,
  receipt_number text,
  method text,
  reference text,
  note text,
  amount numeric,
  student_id uuid,
  student_name text,
  admission_number text,
  is_reversal boolean,
  is_reversed boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with ctx as (
    select t.id as tenant_id,
           t.timezone,
           public.current_session_id(t.id) as session_id
    from public.tenants t
    where t.id = public.current_tenant_id()
  ),
  bounds as (
    select
      (p_from::timestamp at time zone ctx.timezone) as from_ts,
      ((p_to + 1)::timestamp at time zone ctx.timezone) as to_ts
    from ctx
  )
  select
    le.id,
    le.occurred_at,
    le.entry_type,
    le.receipt_number,
    le.method,
    le.reference,
    le.note,
    le.amount,
    le.student_id,
    (p.first_name || ' ' || p.last_name)::text,
    s.admission_number,
    (le.reverses_entry_id is not null),
    exists (
      select 1 from public.ledger_entries r where r.reverses_entry_id = le.id
    )
  from public.ledger_entries le
  join public.students s on s.id = le.student_id
  join public.people p on p.id = s.person_id
  cross join ctx
  cross join bounds
  where le.tenant_id = ctx.tenant_id
    and le.session_id = ctx.session_id
    -- Only money that actually crossed the counter. A discount changes what a
    -- family owes but nothing left the drawer, so including it would make
    -- these totals disagree with the cash.
    and le.entry_type in ('payment', 'refund')
    and le.occurred_at >= bounds.from_ts
    and le.occurred_at < bounds.to_ts
  order by le.occurred_at desc
$$;

revoke all on function public.fees_day_book(date, date) from public, anon;
grant execute on function public.fees_day_book(date, date) to authenticated;
