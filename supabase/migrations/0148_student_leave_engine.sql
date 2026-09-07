-- ---------------------------------------------------------------------------
-- Applying, deciding, cancelling
-- ---------------------------------------------------------------------------
--
-- `student_leave_apply` and `student_leave_decide` are `SECURITY INVOKER`: the
-- table already carries policies for every party, so RLS is the gate and a
-- definer function would only be a second one. They are functions at all for
-- the message rather than for the permission -- `23P01: conflicting key value
-- violates exclusion constraint` is not something to show a parent.
--
-- `student_leave_cancel` is the exception and it is the `homework_submit` case
-- from CLAUDE.md rule 4: **two parties need different columns on the same row.**
-- A family sets the dates and the reason; a teacher sets the status and the
-- note. No policy and no column GRANT can express that -- a GRANT is role-wide
-- and every user of this application is `authenticated` -- so the narrower
-- party gets a `SECURITY DEFINER` function that sets exactly one column after
-- checking who is asking, and **no UPDATE policy at all**.

create or replace function public.student_leave_apply(
  p_student_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_kind text default 'other',
  p_reason text default null
)
returns public.student_leave_requests
language plpgsql
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_session_id uuid;
  v_row public.student_leave_requests;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  v_session_id := public.current_session_id(v_tenant_id);
  if v_session_id is null then
    raise exception 'There is no current academic session to apply against';
  end if;

  if p_ends_on < p_starts_on then
    raise exception 'The last day cannot be before the first';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'Say why -- a class teacher deciding this has nothing else to go on';
  end if;

  begin
    insert into public.student_leave_requests
      (tenant_id, session_id, student_id, starts_on, ends_on, kind, reason, applied_by)
    values
      (v_tenant_id, v_session_id, p_student_id, p_starts_on, p_ends_on,
       coalesce(p_kind, 'other'), trim(p_reason), ( select auth.uid() ))
    returning * into v_row;
  exception when exclusion_violation then
    -- The constraint is doing its job; this is only the sentence. Naming the
    -- dates is the difference between a person fixing it and a person filing a
    -- support ticket.
    raise exception
      'There is already a leave request for this student covering % to %. '
      'Cancel or refuse that one first.', p_starts_on, p_ends_on;
  end;

  if v_row.id is null then
    raise exception 'You cannot apply for leave for this student';
  end if;

  return v_row;
end;
$$;

revoke all on function public.student_leave_apply(uuid, date, date, text, text) from public, anon;
grant execute on function public.student_leave_apply(uuid, date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Decide
-- ---------------------------------------------------------------------------

create or replace function public.student_leave_decide(
  p_leave_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.student_leave_requests
language plpgsql
set search_path = public, extensions
as $$
declare
  v_row public.student_leave_requests;
begin
  update public.student_leave_requests
     set status = case when p_approve then 'approved' else 'refused' end,
         decided_by = ( select auth.uid() ),
         decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_leave_id
     and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    -- Either it is not pending, or no policy matched. Under RLS an update that
    -- matches nothing succeeds while touching nothing, and reporting that as a
    -- decision would be a lie -- the family would see nothing change.
    raise exception
      'That request is not waiting for a decision, or it is not yours to decide';
  end if;

  return v_row;
end;
$$;

revoke all on function public.student_leave_decide(uuid, boolean, text) from public, anon;
grant execute on function public.student_leave_decide(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel — the one column a family may change
-- ---------------------------------------------------------------------------

create or replace function public.student_leave_cancel(p_leave_id uuid)
returns public.student_leave_requests
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_uid uuid := ( select auth.uid() );
  v_row public.student_leave_requests;
  v_may boolean;
begin
  if v_tenant_id is null or v_uid is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_row
  from public.student_leave_requests
  where id = p_leave_id and tenant_id = v_tenant_id;

  if v_row.id is null then
    raise exception 'No such leave request';
  end if;
  if v_row.status not in ('pending', 'approved') then
    raise exception 'That request is already %', v_row.status;
  end if;

  -- Definer, so the check is here rather than in a policy. Exactly three
  -- parties: an administrator, a guardian of this child, or the student.
  select
    ( select public.current_role_code() ) = 'admin'
    or exists (
      select 1 from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where gs.tenant_id = v_tenant_id and gs.student_id = v_row.student_id and up.id = v_uid
    )
    or exists (
      select 1 from public.user_profiles up
      where up.id = v_uid and up.student_id = v_row.student_id
    )
  into v_may;

  if not v_may then
    raise exception 'That leave request is not yours to cancel';
  end if;

  -- One column. This is the whole reason the function exists: a family that
  -- could write `status` freely could write 'approved'.
  update public.student_leave_requests
     set status = 'cancelled'
   where id = p_leave_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.student_leave_cancel(uuid) from public, anon;
grant execute on function public.student_leave_cancel(uuid) to authenticated;

comment on function public.student_leave_cancel(uuid) is
  'The only way a family reaches an existing leave request, and it sets exactly '
  'one column. Definer because two parties need different columns on one row, '
  'which no policy and no column GRANT can express -- CLAUDE.md rule 4.';

-- ---------------------------------------------------------------------------
-- Who is away today
-- ---------------------------------------------------------------------------
--
-- The register screen's lookup. `SECURITY INVOKER`, so a class teacher sees
-- their own section and an administrator sees any -- exactly the boundary the
-- register itself draws.

create or replace function public.student_leave_on(
  p_section_id uuid,
  p_date date default null
)
returns table (
  student_id uuid,
  leave_id uuid,
  kind text,
  reason text,
  starts_on date,
  ends_on date
)
language sql
stable
set search_path = public, extensions
as $$
  select
    l.student_id,
    l.id,
    l.kind,
    l.reason,
    l.starts_on,
    l.ends_on
  from public.student_leave_requests l
  join public.enrolments e
    on e.student_id = l.student_id
   and e.session_id = l.session_id
   and e.status = 'active'
  where l.status = 'approved'
    and (p_section_id is null or e.section_id = p_section_id)
    and coalesce(p_date, public.mobile_today()) between l.starts_on and l.ends_on
$$;

revoke all on function public.student_leave_on(uuid, date) from public, anon;
grant execute on function public.student_leave_on(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- ...and the same question, for a caller who is nobody
-- ---------------------------------------------------------------------------
--
-- The absence-notice schedule holds the service role and has no JWT, so it
-- cannot use the invoker function above. This is the narrow twin: one child,
-- one day, one boolean, taking its tenant as an argument and revoked from
-- everybody holding a JWT -- the `fees_settle_gateway_payment` shape, and the
-- `_for` split is safe here because there is no row-ownership question to
-- delegate. It answers about one student the caller already named.

create or replace function public.student_is_on_leave(
  p_tenant_id uuid,
  p_student_id uuid,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.student_leave_requests l
    where l.tenant_id = p_tenant_id
      and l.student_id = p_student_id
      and l.status = 'approved'
      and p_date between l.starts_on and l.ends_on
  )
$$;

revoke all on function public.student_is_on_leave(uuid, uuid, date)
  from public, anon, authenticated;

comment on function public.student_is_on_leave(uuid, uuid, date) is
  'For the absence-notice schedule, which has no JWT. A module that sends must '
  'ask the module that knows, or a school spends its SMS credit telling parents '
  'things the parents told the school.';
