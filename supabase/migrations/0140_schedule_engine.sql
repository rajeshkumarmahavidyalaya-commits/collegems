-- ---------------------------------------------------------------------------
-- The scheduler: which occurrences are due, and what running one does
-- ---------------------------------------------------------------------------
--
-- Every function here takes its tenant as an argument and is revoked from
-- `public`, `anon` **and** `authenticated`. That is the `fees_settle_gateway_-
-- payment` shape and it is not optional: a function that trusts a tenant id
-- from its caller is a function that would let any signed-in person send in any
-- school's name. The only caller is the Edge Function holding the service role.
--
-- A NOTE ON THE ONE THING THAT IS COMPUTED TWICE
--
-- `schedule_fee_defaulters` sums invoices and the ledger, which is what
-- `fees_student_balances` already does. That is normally the mistake rule 11
-- names -- a second reader is free to disagree with the screen the money is
-- taken on -- so here is why it is not avoidable, written down rather than
-- hoped over:
--
--   `fees_student_balances` is `SECURITY INVOKER` **and its safety is
--   row-level**: a parent calling it sees their own children through RLS, not
--   through an argument. A definer twin of it would hand a parent the whole
--   school, and an invoker wrapper cannot delegate row ownership to a definer
--   helper -- there is nothing to pass that means "the rows this caller may
--   see". So the general read path cannot be reused by a caller who is nobody.
--
-- > **The `_for` split is only safe where the invoker version's protection is a
-- > tenant or role check, not a row-ownership one.** `notify_send` guards with
-- > an explicit admin test, so parameterising the tenant and revoking the door
-- > is exactly equivalent. `fees_student_balances` does not, so a background job
-- > gets a *narrower* function answering only its own question.
--
-- The two are then pinned together by a test that asserts they agree to the
-- paisa on the demo tenant -- the same treatment the dashboard's fee figure
-- gets, and the only thing that keeps two readers honest.

-- ---------------------------------------------------------------------------
-- Which occurrences are due
-- ---------------------------------------------------------------------------
--
-- The wall-clock arithmetic lives here, once. For each enabled schedule it
-- considers **today's and yesterday's** local occurrence and nothing older:
-- that bound is what stops a runner that was down for a week sending a week of
-- absence notices on Monday morning.

create or replace function public.schedules_due(p_limit integer default 100)
returns table (
  schedule_id uuid,
  tenant_id uuid,
  kind text,
  name text,
  occurrence_at timestamptz,
  minutes_late integer,
  within_grace boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with candidates as (
    select
      s.id,
      s.tenant_id,
      s.kind,
      s.name,
      s.grace_minutes,
      -- The occurrence as a wall clock in the school's own zone, then converted
      -- back to an instant. Doing it in this order is what makes "half past
      -- seven" survive daylight saving: the local time is the fixed thing.
      (((now() at time zone t.timezone)::date - d.offset_days) + s.run_at)
        at time zone t.timezone as occurrence_at,
      ((now() at time zone t.timezone)::date - d.offset_days) as local_date,
      s.weekdays,
      s.day_of_month
    from public.schedules s
    join public.tenants t on t.id = s.tenant_id
    cross join (values (0), (1)) as d(offset_days)
    where s.is_enabled
  ),
  matching as (
    select *
    from candidates c
    where
      -- The day has to be one the schedule runs on. An empty weekday list and a
      -- null day-of-month together mean "every day", which is the reading a
      -- school gets by saying nothing.
      (
        (cardinality(c.weekdays) = 0 and c.day_of_month is null)
        or (c.day_of_month is not null and extract(day from c.local_date)::smallint = c.day_of_month)
        or (cardinality(c.weekdays) > 0
            and extract(isodow from c.local_date)::smallint = any (c.weekdays))
      )
      -- ...and it has to have arrived.
      and c.occurrence_at <= now()
      -- ...and nothing must have run it. This is the read side of the unique
      -- index; the index is what actually decides a race.
      and not exists (
        select 1 from public.schedule_runs r
        where r.schedule_id = c.id and r.occurrence_at = c.occurrence_at
      )
  )
  select
    m.id,
    m.tenant_id,
    m.kind,
    m.name,
    m.occurrence_at,
    (extract(epoch from (now() - m.occurrence_at)) / 60)::integer,
    (now() - m.occurrence_at) <= (m.grace_minutes * interval '1 minute')
  from matching m
  order by m.occurrence_at
  limit greatest(coalesce(p_limit, 100), 1)
$$;

revoke all on function public.schedules_due(integer) from public, anon, authenticated;

comment on function public.schedules_due(integer) is
  'Occurrences waiting to be run, across all tenants, in each tenant''s own '
  'wall clock. Looks back at most one day: a runner that was down for a week '
  'must not send a week of absence notices on Monday.';

-- ---------------------------------------------------------------------------
-- Who owes money, for a caller who is nobody
-- ---------------------------------------------------------------------------

create or replace function public.schedule_fee_defaulters(
  p_tenant_id uuid,
  p_min_amount numeric default 1
)
returns table (student_id uuid, full_name text, balance numeric)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with ctx as (
    select p_tenant_id as tenant_id,
           public.current_session_id(p_tenant_id) as session_id
  ),
  roster as (
    select s.id as student_id, (p.first_name || ' ' || p.last_name)::text as full_name
    from public.enrolments e
    join public.students s on s.id = e.student_id
    join public.people p on p.id = s.person_id
    cross join ctx
    where e.tenant_id = ctx.tenant_id
      and e.session_id = ctx.session_id
      and e.status = 'active'
  ),
  charges as (
    select i.student_id, sum(l.amount) as charged
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    cross join ctx
    where i.tenant_id = ctx.tenant_id
      and i.session_id = ctx.session_id
      and i.status = 'issued'
    group by i.student_id
  ),
  movements as (
    select le.student_id, sum(le.amount) as net
    from public.ledger_entries le
    cross join ctx
    where le.tenant_id = ctx.tenant_id
      and le.session_id = ctx.session_id
    group by le.student_id
  )
  select
    r.student_id,
    r.full_name,
    (coalesce(c.charged, 0) + coalesce(m.net, 0))::numeric as balance
  from roster r
  left join charges c on c.student_id = r.student_id
  left join movements m on m.student_id = r.student_id
  where (coalesce(c.charged, 0) + coalesce(m.net, 0)) >= greatest(coalesce(p_min_amount, 1), 0.01)
  order by (coalesce(c.charged, 0) + coalesce(m.net, 0)) desc
$$;

revoke all on function public.schedule_fee_defaulters(uuid, numeric) from public, anon, authenticated;

comment on function public.schedule_fee_defaulters(uuid, numeric) is
  'Outstanding balances for a caller with no JWT. Deliberately a second reader '
  'of the same two sums as fees_student_balances -- see 0140''s header -- and '
  'pinned to it by a test rather than by hope.';

-- ---------------------------------------------------------------------------
-- The logins that should hear about a student
-- ---------------------------------------------------------------------------

create or replace function public.schedule_student_audience(
  p_tenant_id uuid,
  p_student_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- Guardians first, and the student's own login too when they have one. A
  -- child of six has no login and that is expected -- rule 3 -- so this
  -- returning only guardians is the ordinary case, not a gap.
  select jsonb_build_object('kind', 'users', 'user_ids', coalesce(jsonb_agg(distinct u), '[]'::jsonb))
  from (
    select up.id::text as u
    from public.guardian_student gs
    join public.user_profiles up on up.guardian_id = gs.guardian_id
    where gs.tenant_id = p_tenant_id and gs.student_id = p_student_id and up.is_active

    union

    select up.id::text
    from public.user_profiles up
    where up.tenant_id = p_tenant_id and up.student_id = p_student_id and up.is_active
  ) x
$$;

revoke all on function public.schedule_student_audience(uuid, uuid) from public, anon, authenticated;
