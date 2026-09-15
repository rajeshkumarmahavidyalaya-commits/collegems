-- 0240 -- A definer may not become somebody else.
--
-- `0238` decided that a scheduled report runs under **the authority of the
-- person who scheduled it**, and built the function that assumes it. `0239`
-- called that function from `schedule_run`. Probed the moment it was applied:
--
--     ERROR: 42501: cannot set parameter "role" within security-definer function
--     CONTEXT: SQL statement "reset role"
--              PL/pgSQL function schedule_report_digest(uuid) line 82
--
-- **Postgres forbids `SET ROLE` anywhere inside a `SECURITY DEFINER` frame**,
-- and the scheduler is definer all the way down — `schedules_tick` and
-- `schedule_run` both are, necessarily, because they write rows for a tenant
-- whose JWT nobody is holding.
--
-- So the decision in `0238` was right and its mechanism was impossible, which
-- is a distinction worth keeping apart: the feature was never blocked on taste.
-- It was blocked on a rule of the engine that nobody had looked up.
--
-- > **Both halves are needed and neither is optional.** The JWT claims alone do
-- > nothing: `postgres` carries `BYPASSRLS`, so a report run under its identity
-- > returns *every college's rows* and returns them looking entirely ordinary —
-- > `0205`'s probe reporting 303 students for a school with none, arriving in
-- > production on a timer. The role change alone does nothing either: RLS would
-- > apply and `current_tenant_id()` would be null, so the answer is zero.
--
-- ## Where the impersonation has to live
--
-- Measured rather than reasoned: the same body in a **plain** function, called
-- by `postgres`, returns **96** for `fees.defaulters` — exactly what the
-- administrator gets by asking the question themselves — and leaves
-- `current_user` back at `postgres` afterwards.
--
-- So the digest tick is a second entry point, deliberately:
--
--     cron / Edge Function
--       ├── schedules_tick()          definer   the three message kinds
--       └── schedule_digests_tick()   INVOKER   report.digest only
--
-- and the thing that makes a second waker safe is the guard that already
-- exists. `tests/schedules/waker.test.ts` asserts that the cron wakes
-- everything the Edge Function wakes, written when the first waker shipped,
-- for exactly this hazard: *two wakers are two places to add the next periodic
-- job.*
--
-- ## …and the claim is the thing that must not race
--
-- `schedule_runs` is unique on `(schedule_id, occurrence_at)` and the run opens
-- with `on conflict do nothing`, so **whichever tick reaches an occurrence
-- first owns it.** If `schedules_tick` kept picking up digest schedules it
-- would claim the occurrence and then refuse it, and the digest tick would find
-- nothing to do — a race whose loser is always the one that could have done the
-- work. So `schedules_tick` skips the kind by name, and `schedule_run` refuses
-- a digest occurrence that arrives without a precomputed answer rather than
-- trying to compute one it cannot.

begin;

-- ---------------------------------------------------------------------------
-- The impersonating half, now plain
-- ---------------------------------------------------------------------------

-- Not `create or replace`: changing `SECURITY DEFINER` to invoker in place is
-- exactly the sort of edit that is invisible in a diff of the body.
drop function if exists public.schedule_report_digest(uuid);

create function public.schedule_report_digest(p_schedule_id uuid)
returns jsonb
language plpgsql
-- **SECURITY INVOKER**, and that is the whole point of this migration. It must
-- be called by somebody who may `SET ROLE authenticated` -- `postgres` from the
-- cron, `service_role` from the Edge Function -- and from **outside** every
-- definer frame. It is revoked from everybody holding a JWT below.
set search_path = 'public', 'extensions'
as $$
declare
  v_s public.schedules;
  v_key text;
  v_report record;
  v_up record;
  v_role_code text;
  v_rows bigint := 0;
  v_claims text;
begin
  select * into v_s from public.schedules where id = p_schedule_id;
  if v_s.id is null then
    raise exception 'No such schedule';
  end if;
  if v_s.kind <> 'report.digest' then
    raise exception 'That schedule is not a report digest';
  end if;

  v_key := nullif(btrim(coalesce(v_s.params ->> 'report_key', '')), '');
  if v_key is null then
    return jsonb_build_object('ok', false, 'reason',
      'This schedule does not say which report to run.');
  end if;

  select r.key, r.name, r.required_permission into v_report
  from reference.reports r where r.key = v_key;
  if v_report.key is null then
    return jsonb_build_object('ok', false, 'reason',
      format('There is no report called %s any more.', v_key));
  end if;

  -- The authority is re-checked, never remembered: an administrator who left in
  -- March must not still be running the fee digest in June.
  select up.id, up.role_id, up.tenant_id into v_up
  from public.user_profiles up
  where up.id = v_s.created_by and up.tenant_id = v_s.tenant_id;

  if v_up.id is null then
    return jsonb_build_object('ok', false, 'reason',
      'The person who scheduled this no longer has a login at this college, so '
      'there is nobody whose permissions the run could use.');
  end if;

  select r.code into v_role_code from public.roles r where r.id = v_up.role_id;

  if not exists (
    select 1 from public.role_permissions rp
    where rp.tenant_id = v_s.tenant_id
      and rp.role_id = v_up.role_id
      and rp.permission_code = v_report.required_permission
      and rp.allowed
  ) then
    return jsonb_build_object('ok', false, 'reason',
      format('%s may no longer run %s, so nothing was sent. Their role lost %s.',
             coalesce(v_role_code, 'That role'), v_report.name,
             v_report.required_permission));
  end if;

  -- Become them, for exactly one statement.
  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_up.id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', v_s.tenant_id,
        'role', v_role_code)
    )::text, true);

    set local role authenticated;

    select max(rr.total_count) into v_rows
    from public.report_run(
      v_report.key,
      coalesce(v_s.params -> 'report_params', '{}'::jsonb),
      1, 0) rr;

    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
  exception when others then
    -- Leaving the session as `authenticated` would make every later statement
    -- in this tick answer for a person who is not there.
    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
    raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, 0),
    'report_name', v_report.name,
    'recipient', v_up.id);
end;
$$;

revoke all on function public.schedule_report_digest(uuid) from public, anon, authenticated;

comment on function public.schedule_report_digest(uuid) is
  'Runs one scheduled report as the person who scheduled it. SECURITY INVOKER '
  'on purpose: Postgres forbids SET ROLE inside a definer frame, so this is '
  'callable only from outside one, by postgres or service_role. Takes no user '
  'parameter -- the identity is schedules.created_by, stamped by a trigger and '
  'immutable -- and re-checks the login and the permission every occurrence.';

-- ---------------------------------------------------------------------------
-- The recording half takes the answer rather than computing it
-- ---------------------------------------------------------------------------

drop function if exists public.schedule_run(uuid, timestamptz, integer);

create function public.schedule_run(
  p_schedule_id uuid,
  p_occurrence_at timestamp with time zone,
  p_max_recipients integer default 500,
  p_digest jsonb default null
)
returns public.schedule_runs
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_s public.schedules;
  v_tz text;
  v_local_date date;
  v_run public.schedule_runs;
  v_late_minutes integer;
  v_matched integer := 0;
  v_notified integer := 0;
  v_on_leave integer := 0;
  v_truncated boolean := false;
  v_row record;
  v_audience jsonb;
  v_refused text;
  v_cap integer := greatest(least(coalesce(p_max_recipients, 500), 2000), 1);
begin
  select * into v_s from public.schedules where id = p_schedule_id;
  if v_s.id is null then
    raise exception 'No such schedule';
  end if;

  select t.timezone into v_tz from public.tenants t where t.id = v_s.tenant_id;
  v_local_date := (p_occurrence_at at time zone v_tz)::date;

  insert into public.schedule_runs (tenant_id, schedule_id, occurrence_at, status)
  values (v_s.tenant_id, v_s.id, p_occurrence_at, 'running')
  on conflict (schedule_id, occurrence_at) do nothing
  returning * into v_run;

  if v_run.id is null then
    select * into v_run from public.schedule_runs
    where schedule_id = p_schedule_id and occurrence_at = p_occurrence_at;
    return v_run;
  end if;

  v_late_minutes := (extract(epoch from (now() - p_occurrence_at)) / 60)::integer;
  if v_late_minutes > v_s.grace_minutes then
    update public.schedule_runs
       set status = 'missed',
           finished_at = now(),
           note = format(
             'Not run: %s minutes late, and this schedule is only worth sending within %s. '
             'Nothing was sent, and nothing will be sent for this occurrence.',
             v_late_minutes, v_s.grace_minutes)
     where id = v_run.id
    returning * into v_run;
    return v_run;
  end if;

  begin
    if v_s.kind = 'attendance.absentees' then
      for v_row in
        select distinct
          e.student_id,
          (p.first_name || ' ' || p.last_name)::text as full_name
        from public.attendance_records ar
        join public.enrolments e on e.id = ar.enrolment_id
        join public.students st on st.id = e.student_id
        join public.people p on p.id = st.person_id
        where ar.tenant_id = v_s.tenant_id
          and ar.attendance_date = v_local_date
          and ar.status = 'absent'
        order by full_name
        limit v_cap + 1
      loop
        v_matched := v_matched + 1;
        if v_matched > v_cap then
          v_truncated := true;
          v_matched := v_cap;
          exit;
        end if;

        if public.student_is_on_leave(v_s.tenant_id, v_row.student_id, v_local_date) then
          v_on_leave := v_on_leave + 1;
          continue;
        end if;

        v_audience := public.schedule_student_audience(v_s.tenant_id, v_row.student_id);
        continue when jsonb_array_length(v_audience -> 'user_ids') = 0;

        perform public.notify_send_for(
          v_s.tenant_id,
          'attendance.absent',
          format('%s was marked absent', v_row.full_name),
          format('%s was marked absent at school on %s.',
                 v_row.full_name, to_char(v_local_date, 'FMDD Mon YYYY')),
          v_audience,
          jsonb_build_object(
            'student_name', v_row.full_name,
            'date', to_char(v_local_date, 'FMDD Mon YYYY')
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := v_notified + 1;
      end loop;

    elsif v_s.kind = 'fees.due_reminder' then
      for v_row in
        select d.student_id, d.full_name, d.balance
        from public.schedule_fee_defaulters(
          v_s.tenant_id,
          coalesce((v_s.params ->> 'min_amount')::numeric, 1)
        ) d
        limit v_cap + 1
      loop
        v_matched := v_matched + 1;
        if v_matched > v_cap then
          v_truncated := true;
          v_matched := v_cap;
          exit;
        end if;

        v_audience := public.schedule_student_audience(v_s.tenant_id, v_row.student_id);
        continue when jsonb_array_length(v_audience -> 'user_ids') = 0;

        perform public.notify_send_for(
          v_s.tenant_id,
          'fees.due_reminder',
          'Fees outstanding',
          format('%s has %s outstanding on their fee account.',
                 v_row.full_name, to_char(v_row.balance, 'FM9999999990.00')),
          v_audience,
          jsonb_build_object(
            'student_name', v_row.full_name,
            'amount', to_char(v_row.balance, 'FM9999999990.00')
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := v_notified + 1;
      end loop;

    elsif v_s.kind = 'library.overdue' then
      for v_row in
        select
          bi.id as issue_id,
          m.student_id,
          b.title,
          bi.due_at,
          (v_local_date - bi.due_at) as days_over
        from public.book_issues bi
        join public.members m on m.id = bi.member_id
        join public.books b on b.id = bi.book_id
        where bi.tenant_id = v_s.tenant_id
          and bi.status = 'issued'
          and bi.due_at < v_local_date
          and (v_local_date - bi.due_at) >= coalesce((v_s.params ->> 'min_days_over')::integer, 1)
          and m.student_id is not null
        order by bi.due_at
        limit v_cap + 1
      loop
        v_matched := v_matched + 1;
        if v_matched > v_cap then
          v_truncated := true;
          v_matched := v_cap;
          exit;
        end if;

        v_audience := public.schedule_student_audience(v_s.tenant_id, v_row.student_id);
        continue when jsonb_array_length(v_audience -> 'user_ids') = 0;

        perform public.notify_send_for(
          v_s.tenant_id,
          'library.book_overdue',
          'Library book overdue',
          format('"%s" was due back on %s and is %s day(s) overdue.',
                 v_row.title, to_char(v_row.due_at, 'FMDD Mon YYYY'), v_row.days_over),
          v_audience,
          jsonb_build_object(
            'title', v_row.title,
            'due_at', to_char(v_row.due_at, 'FMDD Mon YYYY'),
            'days_over', v_row.days_over::text
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := v_notified + 1;
      end loop;

    elsif v_s.kind = 'report.digest' then
      -- The answer arrives precomputed, from `schedule_digests_tick`, because
      -- this function is SECURITY DEFINER and Postgres will not let a definer
      -- frame `SET ROLE`. Computing it here is not a thing that can be made to
      -- work -- so this refuses rather than quietly running the report as
      -- `postgres`, which would answer with every college's rows.
      if p_digest is null then
        v_refused :=
          'This occurrence was claimed by the message tick, which cannot run a '
          'report as anybody. Digests are run by schedule_digests_tick.';
      elsif not coalesce((p_digest ->> 'ok')::boolean, false) then
        -- Not `failed`: nothing is broken. Somebody's permissions changed, or
        -- they left, and the register has to be able to say which.
        v_refused := p_digest ->> 'reason';
      else
        v_matched := coalesce((p_digest ->> 'rows')::integer, 0);

        perform public.notify_send_for(
          v_s.tenant_id,
          'report.digest',
          format('%s — %s', p_digest ->> 'report_name',
            case when v_matched = 1 then '1 row today' else v_matched || ' rows today' end),
          case
            when v_matched = 0 then
              format('%s found nothing today. That is the whole answer, not a '
                     'message that failed to arrive.', p_digest ->> 'report_name')
            when v_matched = 1 then
              format('%s has 1 row today. Open Reports to see it.', p_digest ->> 'report_name')
            else
              format('%s has %s rows today. Open Reports to see them.',
                     p_digest ->> 'report_name', v_matched)
          end,
          -- The creator, and nobody else: here the authority question and the
          -- audience question are the same question.
          jsonb_build_object('kind', 'users',
                             'user_ids', jsonb_build_array(p_digest ->> 'recipient')),
          jsonb_build_object(
            'report_key', v_s.params ->> 'report_key',
            'report_name', p_digest ->> 'report_name',
            'rows', v_matched::text
          ),
          v_s.channels,
          null,
          false
        );
        v_notified := 1;
      end if;

    else
      raise exception 'Nothing implements the schedule kind %', v_s.kind;
    end if;

  exception when others then
    update public.schedule_runs
       set status = 'failed', finished_at = now(), note = left(sqlerrm, 500),
           matched = v_matched, notified = v_notified
     where id = v_run.id
    returning * into v_run;
    return v_run;
  end;

  update public.schedule_runs
     set status = 'done',
         finished_at = now(),
         matched = v_matched,
         notified = v_notified,
         note = nullif(trim(concat_ws(' ',
           v_refused,
           case when v_truncated then format(
             'Stopped at %s, which is this run''s limit. Raise the limit or narrow '
             'the schedule -- the rest were not told.', v_cap) end,
           case when v_s.kind <> 'report.digest' and v_matched = 0
                then 'Nothing matched, so nothing was sent.' end,
           case when v_on_leave > 0 then format(
             '%s of %s were on approved leave, so their families were not told again.',
             v_on_leave, v_matched) end,
           case when v_s.kind <> 'report.digest'
                     and v_matched - v_on_leave - v_notified > 0 then format(
             '%s had no family login to send to.', v_matched - v_on_leave - v_notified) end
         )), '')
   where id = v_run.id
  returning * into v_run;

  return v_run;
end;
$$;

commit;
