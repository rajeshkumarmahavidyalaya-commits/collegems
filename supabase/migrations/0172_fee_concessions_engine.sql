-- ---------------------------------------------------------------------------
-- What a child is owed off, and the order it is worked out in
-- ---------------------------------------------------------------------------
--
-- **Evaluation order is part of the contract** (rule 12), and this is the
-- order. It is written here, pinned to exact numbers in
-- `tests/fees/concession-engine.test.ts`, and a comment would not have been
-- enough -- migration `0059` carried payroll's order in its header and the loop
-- underneath did something else for four months.
--
--   1. Award the concessions in `priority` order, ties broken by `code`, so
--      the answer is deterministic rather than whatever the planner returns.
--   2. A **percentage is taken against the original charge**, never against
--      what a previous concession left. 10% + 50% is 60%, not 55%. Compounding
--      is defensible and is what nobody means when they say "half fees for
--      staff children, plus the sibling ten per cent".
--   3. A **percentage may be capped** by `max_amount` -- "20%, up to 2,000".
--   4. A **fixed amount** subtracts what is left after the percentages, so a
--      1,000 scholarship on a 600 balance credits 600 rather than 1,000.
--   5. **The total credit never exceeds the charge.** A school does not owe a
--      family money because three waivers stacked, and a negative invoice is
--      not a refund -- it is a bug that would print as one.
--
-- Rule 5 in particular is why this is a function rather than five triggers:
-- the cap is a fact about *all* the awards together, and no constraint sees a
-- second row.

create or replace function public.fees_concession_lines(
  p_student_id uuid,
  p_charges jsonb,
  p_as_of date default null
)
returns table (
  award_id uuid,
  concession_id uuid,
  code text,
  name text,
  amount numeric
)
language sql
stable
set search_path = public, extensions
as $$
  with as_of as (select coalesce(p_as_of, current_date) as d),
  -- What the concession is being taken off. Passed in rather than recomputed,
  -- so a preview and an invoice cannot disagree about the charge -- the same
  -- reason `fees_billable_lines` is consulted by both.
  charged as (
    select
      (c.key)::uuid as fee_head_id,
      (c.value)::numeric as amount
    from jsonb_each_text(coalesce(p_charges, '{}'::jsonb)) c
  ),
  total as (select coalesce(sum(amount), 0) as gross from charged),
  live as (
    select
      sc.id as award_id,
      fc.id as concession_id,
      fc.code,
      fc.name,
      fc.kind,
      fc.value,
      fc.max_amount,
      fc.priority,
      -- Only the heads this concession applies to. Null means all of them.
      coalesce(
        (select sum(ch.amount) from charged ch
          where fc.fee_head_ids is null or ch.fee_head_id = any (fc.fee_head_ids)),
        0
      ) as base
    from public.student_concessions sc
    join public.fee_concessions fc
      on fc.id = sc.concession_id and fc.tenant_id = sc.tenant_id
    cross join as_of a
    where sc.student_id = p_student_id
      and sc.session_id = public.current_session_id(public.current_tenant_id())
      and sc.status = 'active'
      and fc.is_active
      and sc.granted_on <= a.d
      and (sc.ends_on is null or sc.ends_on >= a.d)
  ),
  -- Step 2 and 3: percentages, each against the original base, each capped.
  pct as (
    select
      l.*,
      least(
        round(l.base * l.value / 100.0, 2),
        coalesce(l.max_amount, 1e18)
      ) as raw
    from live l
    where l.kind = 'percentage'
  ),
  pct_total as (select coalesce(sum(raw), 0) as taken from pct),
  -- Step 4: fixed amounts, against what the percentages left.
  amt as (
    select
      l.*,
      least(l.value, greatest((select gross from total) - (select taken from pct_total), 0)) as raw
    from live l
    where l.kind = 'amount'
  ),
  combined as (
    select award_id, concession_id, code, name, priority, raw from pct
    union all
    select award_id, concession_id, code, name, priority, raw from amt
  ),
  -- Step 5: the running total, so the cap falls on whichever concession
  -- crosses the line rather than on all of them proportionally. Ordered, which
  -- is what makes "priority" mean something.
  ordered as (
    select
      c.*,
      coalesce(sum(c.raw) over (
        order by c.priority, c.code
        rows between unbounded preceding and 1 preceding
      ), 0) as taken_before
    from combined c
  )
  select
    o.award_id,
    o.concession_id,
    o.code::text,
    o.name::text,
    round(
      least(o.raw, greatest((select gross from total) - o.taken_before, 0)),
      2
    ) as amount
  from ordered o
  where round(least(o.raw, greatest((select gross from total) - o.taken_before, 0)), 2) > 0
  order by o.priority, o.code
$$;

revoke all on function public.fees_concession_lines(uuid, jsonb, date) from public, anon;
grant execute on function public.fees_concession_lines(uuid, jsonb, date) to authenticated;

comment on function public.fees_concession_lines(uuid, jsonb, date) is
  'What to credit a child, given what they were charged. Percentages against '
  'the original charge, fixed amounts after, total capped at the charge. Order '
  'declared in migration 0172 and pinned in tests.';

-- ---------------------------------------------------------------------------
-- Granting and revoking
-- ---------------------------------------------------------------------------
--
-- `SECURITY INVOKER`: `student_concessions` already carries a finance-only
-- write policy, so RLS is the gate and a definer function would be a second
-- one. What these add over a bare insert is the sentences.

create or replace function public.concession_award(
  p_student_id uuid,
  p_concession_id uuid,
  p_reason text,
  p_ends_on date default null
)
returns public.student_concessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.student_concessions;
  v_name text;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'No current academic session';
  end if;

  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this concession was granted -- a discount with no reason is the one an auditor asks about';
  end if;

  select name into v_name from public.fee_concessions
  where id = p_concession_id and is_active;
  if v_name is null then
    raise exception 'No such concession, or it is no longer offered';
  end if;

  begin
    insert into public.student_concessions (
      tenant_id, session_id, student_id, concession_id,
      reason, ends_on, granted_by
    )
    values (
      v_tenant_id, v_session_id, p_student_id, p_concession_id,
      trim(p_reason), p_ends_on, ( select auth.uid() )
    )
    returning * into v_row;
  exception when unique_violation then
    raise exception '% is already awarded to this student for this year. Revoke it first if the terms have changed.', v_name;
  end;

  if v_row.id is null then
    raise exception 'You may not award concessions';
  end if;

  return v_row;
end;
$$;

revoke all on function public.concession_award(uuid, uuid, text, date) from public, anon;
grant execute on function public.concession_award(uuid, uuid, text, date) to authenticated;

-- Revoked, never deleted. Money that was already credited stays credited -- the
-- ledger is append-only and a concession that applied in April did apply in
-- April. Revoking stops the next invoice, and says so.
create or replace function public.concession_revoke(
  p_award_id uuid,
  p_reason text
)
returns public.student_concessions
language plpgsql
set search_path = public, extensions
as $$
declare
  v_row public.student_concessions;
begin
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why this concession is being withdrawn';
  end if;

  update public.student_concessions
  set status = 'revoked',
      revoked_at = now(),
      revoked_by = ( select auth.uid() ),
      revoke_reason = trim(p_reason)
  where id = p_award_id and status = 'active'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No such active award, or you may not withdraw it';
  end if;

  return v_row;
end;
$$;

revoke all on function public.concession_revoke(uuid, text) from public, anon;
grant execute on function public.concession_revoke(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The critic
-- ---------------------------------------------------------------------------
--
-- `grading_scheme_problems()` in a sixth place. Money makes the sentences
-- matter more: every one of these is a child whose bill is wrong in a way
-- nobody would notice until a parent rang.

create or replace function public.concession_problems()
returns table (student_id uuid, severity text, message text)
language sql
stable
set search_path = public, extensions
as $$
  -- An award pointing at a concession the school has switched off. The award
  -- still looks live on the child's record and credits nothing.
  select
    sc.student_id,
    'warning'::text,
    format(
      '%s %s holds "%s", but that concession is switched off, so nothing is '
      'being taken off their bill.',
      p.first_name, p.last_name, fc.name
    )
  from public.student_concessions sc
  join public.fee_concessions fc on fc.id = sc.concession_id
  join public.students st on st.id = sc.student_id
  join public.people p on p.id = st.person_id
  where sc.status = 'active'
    and sc.session_id = public.current_session_id(public.current_tenant_id())
    and not fc.is_active

  union all

  -- An award that has quietly expired. Not a fault -- a one-term scholarship is
  -- meant to end -- but it belongs on a list somebody reads, because the family
  -- is about to get a bigger bill without being told.
  select
    sc.student_id,
    'info'::text,
    format(
      '%s %s''s "%s" ended on %s. Their next invoice will be the full amount.',
      p.first_name, p.last_name, fc.name, to_char(sc.ends_on, 'FMDD Mon YYYY')
    )
  from public.student_concessions sc
  join public.fee_concessions fc on fc.id = sc.concession_id
  join public.students st on st.id = sc.student_id
  join public.people p on p.id = st.person_id
  where sc.status = 'active'
    and sc.session_id = public.current_session_id(public.current_tenant_id())
    and sc.ends_on is not null
    and sc.ends_on < current_date

  union all

  -- An award on a child who is no longer enrolled. Harmless until somebody
  -- re-admits them and wonders why the fees are wrong.
  select
    sc.student_id,
    'info'::text,
    format(
      '%s %s holds "%s" but is not actively enrolled this year.',
      p.first_name, p.last_name, fc.name
    )
  from public.student_concessions sc
  join public.fee_concessions fc on fc.id = sc.concession_id
  join public.students st on st.id = sc.student_id
  join public.people p on p.id = st.person_id
  where sc.status = 'active'
    and sc.session_id = public.current_session_id(public.current_tenant_id())
    and not exists (
      select 1 from public.enrolments e
      where e.student_id = sc.student_id
        and e.session_id = sc.session_id
        and e.status = 'active'
    )

  order by 2, 3
$$;

revoke all on function public.concession_problems() from public, anon;
grant execute on function public.concession_problems() to authenticated;

comment on function public.concession_problems() is
  'Sentences, not a constraint -- every one is a child whose bill is wrong in a '
  'way nobody notices until a parent rings. See migration 0172.';
