-- ---------------------------------------------------------------------------
-- One severity, spelled two ways
-- ---------------------------------------------------------------------------
--
-- Twenty-two critics feed `checks_run`, and every one of them writes its own
-- severity as a bare string. Nothing constrains the word: not a CHECK, not a
-- domain, not the catalogue -- `checks_run` returns `severity text` and each
-- critic fills it in. Swept over the latest definition of each:
--
--   warning  13 critics
--   info      9
--   error     8
--   warn      3   <- family_login_problems (0235), scheduler_problems (0241),
--                    job_problems (0243)
--
-- The three are the three most recently written, which is what makes it drift
-- rather than a decision: it was typed once and copied twice.
--
-- **And the renderer compares the word.** `severityTone` is
-- `severity === "warning" ? "warning" : "secondary"`, so a `warn` falls through
-- to the neutral tone -- the same grey an `info` gets. Measured on the live
-- college today, that is one row, and it is the loudest finding the product
-- has:
--
--   > 302 of 302 active students have nobody who can sign in: no fee account,
--   > timetable, result or absence notice reaches their families.
--
-- Drawn as an aside, next to *"13 hostel beds have not been renewed"* in the
-- same colour.
--
-- > **A vocabulary with no home is a vocabulary that drifts**, and it drifts
-- > quietly because both spellings read as correct. Migration `0101` already
-- > wrote the rule for values: *a list of valid values belongs in one place,
-- > and the constraint is usually that place.* A set-returning function cannot
-- > carry a CHECK, so the place is the runner -- and the half that makes it
-- > safe is that an unrecognised word now renders **loudly** rather than
-- > quietly. Rule 12's conservative reading, applied to a colour.
--
-- Three functions, six literals, one word each. The bodies below are the
-- **latest definition of each, lifted verbatim** and changed in exactly that
-- one respect -- transcribing them by hand is how a body silently diverges.

begin;

-- ---- family_login_problems, from `0235` ----

create or replace function public.family_login_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_total integer;
  v_without integer;
  v_stale integer;
begin
  if not public.role_has_permission('users.manage') then
    return;
  end if;

  -- One call, both numbers. The critic's count and the report's row count are
  -- now the same query, so a school cannot be told 301 and shown 287.
  select count(*), count(*) filter (where f.state <> 'ok')
    into v_total, v_without
  from public.family_login_status(null) f;

  if v_without > 0 then
    return query select
      'family.no_login',
      case when v_total > 0 and v_without = v_total then 'warning' else 'info' end,
      format(
        '%s of %s active %s %s nobody who can sign in: no fee account, timetable, result or absence notice reaches %s. The report "Families who cannot sign in" names them.',
        v_without,
        v_total,
        case when v_total   = 1 then 'student' else 'students' end,
        case when v_without = 1 then 'has'     else 'have'     end,
        case when v_without = 1 then 'that child''s family' else 'their families' end);
  end if;

  -- Deliberately still counted here rather than in `family_login_status`: a
  -- staff invitation that expired has nothing to do with a child, and folding
  -- it into a per-student read model would be a second answer to a different
  -- question. It reads `invitations` through this function's own definer
  -- helper for the same reason the count above does.
  select public.family_login_stale_invitations() into v_stale;

  if v_stale > 0 then
    return query select
      'family.stale_invitations',
      'info',
      format('%s %s expired without being accepted. %s to be sent again.',
        v_stale,
        case when v_stale = 1 then 'invitation has' else 'invitations have' end,
        case when v_stale = 1 then 'It needs'       else 'They need'        end);
  end if;
end;
$$;

-- ---- scheduler_problems, from `0241` ----

create or replace function public.scheduler_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v jsonb;
  v_minutes integer;
  v_digests integer;
begin
  if not public.role_has_permission('schedules.view') then
    return;
  end if;

  v := public.scheduler_liveness();
  v_minutes := (v ->> 'minutes_since')::integer;

  select count(*) into v_digests
  from public.schedules s
  where s.tenant_id = public.current_tenant_id()
    and s.is_enabled
    and s.kind = any (public.schedule_kinds_needing_authority());

  -- Silent unless this college actually has one, which is the bar CLAUDE.md
  -- sets for a critic: is somebody going to have to do something about it.
  if v_digests > 0 and not coalesce((v ->> 'digest_waker')::boolean, false) then
    return query select
      'scheduler.no_digest_waker',
      'warning',
      format(
        '%s scheduled report(s) are switched on and nothing in the database is '
        'running them. Unlike the message schedules, nothing outside it can: a '
        'report runs as the person who scheduled it, and only a database job '
        'has the authority to become them.', v_digests);
  end if;

  if not (v ->> 'in_database_waker')::boolean then
    -- Information, not a fault: an Edge Function or an external scheduler
    -- calling `schedules_tick` is a supported and invisible-from-here answer.
    return query select
      'scheduler.no_waker',
      'info',
      'Nothing inside the database is waking the scheduler. That is fine if '
      'something outside it calls schedules_tick -- the schedule-tick Edge '
      'Function does. If nothing does, every schedule stays silent for ever '
      'and no register of that is kept.';
    return;
  end if;

  if v_minutes is null then
    return query select
      'scheduler.never_ran',
      'warning',
      'The scheduler is set to run every five minutes and has never run once. '
      'Until it does, no absence notice, fee reminder or overdue-book reminder '
      'will go out.';
  elsif v_minutes > 30 then
    return query select
      'scheduler.stalled',
      'warning',
      format(
        'The scheduler last ran %s minutes ago and is set to run every five. '
        'Anything due since then is going out late, or past its grace, not at all.',
        v_minutes);
  end if;

  return;
end;
$$;

-- ---- job_problems, from `0243` ----

create or replace function public.job_problems()
returns table (key text, severity text, message text)
language plpgsql
stable
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_row record;
begin
  if v_tenant_id is null then
    return;
  end if;

  -- A job that gave up. `error` is kept by `job_record` precisely so this can
  -- quote it: *"why did nothing happen"* must have an answer, which is rule 7's
  -- rule for a missed schedule arriving at the queue.
  for v_row in
    select j.job_type, k.label, j.error, j.attempts, j.progress_done
    from public.jobs j
    join reference.job_kinds k on k.key = j.job_type
    where j.tenant_id = v_tenant_id and j.status = 'failed'
    order by j.completed_at desc nulls last
    limit 20
  loop
    return query select
      'jobs.failed',
      'error'::text,
      format('%s stopped after %s %s. %s%s',
             v_row.label,
             v_row.attempts,
             -- Both forms carried rather than a stem and a rule: English
             -- plurals are not derivable, and a count-dependent word left
             -- disagreeing reads exactly as careless (`0196`).
             case when v_row.attempts = 1 then 'attempt' else 'attempts' end,
             coalesce(v_row.error, 'No reason was recorded.'),
             case when v_row.progress_done > 0
                  then format(' %s were done before it stopped, and those stay done.',
                              v_row.progress_done)
                  else '' end);
  end loop;

  -- A refusal is not a failure, and the difference is what somebody must do
  -- about it: a failure may be worth starting again, a refusal means a
  -- permission or a person changed.
  for v_row in
    select j.job_type, k.label, j.error, j.progress_done
    from public.jobs j
    join reference.job_kinds k on k.key = j.job_type
    where j.tenant_id = v_tenant_id and j.status = 'refused'
      and j.completed_at > now() - interval '30 days'
      -- Somebody pressing Stop is not a finding. They know.
      and coalesce(j.error, '') <> 'Stopped by somebody at the school.'
    order by j.completed_at desc
    limit 20
  loop
    return query select
      'jobs.refused',
      'warning'::text,
      format('%s stopped part-way. %s', v_row.label,
             coalesce(v_row.error, 'No reason was recorded.'));
  end loop;

  -- Queued and not moving. Anything still waiting ten minutes after it was due
  -- means the waker is not running -- `scheduler_problems()` answers that
  -- question for the *schedulers*, and until now nothing asked it of the queue.
  for v_row in
    select k.label, count(*) as n, min(j.created_at) as oldest
    from public.jobs j
    join reference.job_kinds k on k.key = j.job_type
    where j.tenant_id = v_tenant_id
      and j.status = 'queued'
      and j.not_before < now() - interval '10 minutes'
    group by k.label
  loop
    return query select
      'jobs.stuck',
      'warning'::text,
      format('%s has been waiting since %s and nothing has picked it up. '
             'That usually means the thing that runs background work is not running.',
             v_row.label, to_char(v_row.oldest, 'FMDD Mon, HH24:MI'));
  end loop;

  return;
end;
$$;

commit;
