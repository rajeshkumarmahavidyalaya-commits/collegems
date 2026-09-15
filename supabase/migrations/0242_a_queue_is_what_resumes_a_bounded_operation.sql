-- 0242 -- A queue is what resumes a bounded operation until it is finished.
--
-- `public.jobs` was created in `0007` and has **0 rows** two hundred and
-- thirty-five migrations later. Rule 7 has named it the home of "anything
-- unbounded" the whole time, and the honest question before building a worker
-- is why nothing ever queued anything.
--
-- It is not neglect. **Every module obeyed rule 7's other half.** Measured
-- across the product:
--
--   | operation | its declared bound | what it tells the office |
--   |---|---|---|
--   | `import_apply_run` | **500 rows** | *"Split it — importing the first 500 silently would be worse."* |
--   | `invitation_preview` | **1,000 people** | *"Narrow it to one class at a time."* |
--   | `accounts_sync` | **200 documents a page** | returns `remaining` |
--   | `report_run` | 1,000 default, 5,000 max | returns `total_count` |
--   | `checks_run` | first 200 | *"showing the first 200"* |
--   | `notify-dispatch` | 200 deliveries or 40 s | returns how many are left |
--
-- Every one of those is correct and this file does not change any of them. But
-- read the right-hand column as a whole and the defect is there in the product's
-- own words:
--
-- > **A bound that fits a request is not a bound that fits the work.** Every
-- > module capped its run, and the cap became the office's job: press again,
-- > narrow it again, split the spreadsheet again. A college onboarding five
-- > thousand historical receipts presses *Sync* **twenty-five times**.
--
-- So the queue is not a way to do bigger work in one go. It is **the thing that
-- presses the button again** — and that is why `accounts_sync` is the first kind
-- rather than the most impressive one: it already returns `(created, remaining)`,
-- which is exactly the contract a resumable job needs, and has had no reader for
-- that second number except a person's patience.
--
-- Measured as the caller, on the demo college: `invitation_apply` is
-- **2,964 ms for 555 people** (5.3 ms each), so a run at its own 1,000 cap is
-- ~5.3 seconds of somebody watching a spinner inside a request that may time
-- out. The backlog `accounts_sync` has today is **0** — an earlier session
-- pressed the button — and that is stated rather than dramatised, because a
-- first draft of this header claimed 323 unposted receipts. That number was
-- measured with `source_kind = 'ledger_entry'`; the function's own predicate is
-- `'fee_ledger'`. *A number measured with a broken instrument is worse than no
-- number*, and this file's argument rests on the structure instead.
--
-- ## Whose authority does a job run under?
--
-- Rule 7 answers this, and the answer is now out of date in a way that matters:
--
-- > *"Edge Functions use the service role (bypassing RLS), so they must filter
-- > by `tenant_id` explicitly."*
--
-- That was written before `0240` found the impersonation mechanism. Taking it
-- literally here would mean rewriting **six** correct `SECURITY INVOKER`
-- functions — `accounts_sync`, `import_apply_run`, `invitation_apply`,
-- `promotion_apply`, `renewal_apply`, `fees_generate_section_invoices` — as
-- definers with hand-written tenant filters. **Reimplementing RLS six times in
-- order to avoid using it**, and losing row ownership on every one.
--
-- So the worker is `schedule_digests_tick`'s mechanism generalised: pg_cron as
-- `postgres`, `SET ROLE authenticated` with the creator's claims, **outside
-- every definer frame**, calling the module's own function unchanged. Every
-- constraint `0240` and `0241` established applies verbatim and is not
-- re-derived here:
--
--   - a `SECURITY DEFINER` frame may not `SET ROLE`, so `job_run_as_creator`
--     and `jobs_tick` are INVOKER and the bookkeeping is a separate definer call;
--   - `service_role` is not a member of `authenticated`, so the Edge Function
--     cannot run a job and is not given one;
--   - both halves of the impersonation are needed: claims alone get `postgres`
--     and `BYPASSRLS`, the role change alone gets a null tenant.
--
-- **The authority is re-checked every attempt, never remembered.** A bursar who
-- left in March is not still posting vouchers in June, and a role that lost
-- `accounts.manage` on Tuesday stops the job with a sentence rather than a
-- failure.

begin;

-- ---------------------------------------------------------------------------
-- The catalogue: what kinds of job exist
-- ---------------------------------------------------------------------------

-- The fifth catalogue-as-data, beside permissions, reports, checks and plans.
-- In `reference` rather than `public` because a job *kind* belongs to no
-- college — and so rule 1's schema guard, which covers `public`, stays true.
create table if not exists reference.job_kinds (
  key text primary key,
  label text not null,
  description text not null,

  -- Gated on the permission somebody who may *act* holds — `0189`'s rule for
  -- critics, which is the same question here: a job does the thing, so the
  -- permission to do the thing is the permission to queue it.
  required_permission text not null references reference.permissions(code),

  -- What the kind's function is handed as its page. The bound stays the
  -- module's own; this only says how big a bite each attempt takes.
  page_size integer not null default 200 check (page_size between 1 and 5000),

  -- A failure is retried this many times before the job is given up on, with
  -- the reason kept. 1 means "do not retry" — right for anything that sends.
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),

  is_active boolean not null default true,
  sort integer not null default 100
);

comment on table reference.job_kinds is
  'What kinds of background job exist, what each may take a page of, and which '
  'permission a person needs to queue one. Data rather than branches, per rule '
  '12 -- but which function implements a kind is product code and lives in the '
  'branch inside job_run_one, exactly as schedule_run does.';

revoke all on reference.job_kinds from anon, authenticated;
grant select on reference.job_kinds to authenticated;

insert into reference.job_kinds (key, label, description, required_permission, page_size, max_attempts, sort)
values
  ('accounts.sync',
   'Post receipts to the ledger',
   'Writes a journal voucher for every fee receipt and salary payment that does not have one yet. '
   'It does 200 at a time and keeps going until there are none left, so a college loading a year of '
   'history does not have to press anything twenty-five times.',
   'accounts.manage', 200, 3, 10),

  ('invitations.apply',
   'Send an invitation list',
   'Turns a checked invitation list into invitations and sends them. It runs once rather than in '
   'pages -- an invitation is a message, and a half-sent list retried from the start would write to '
   'some families twice.',
   'users.manage', 1000, 1, 20)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The queue grows what a worker needs
-- ---------------------------------------------------------------------------

alter table public.jobs
  -- How many times this has been attempted, and the lease the current attempt
  -- holds. **Without a lease a worker that dies holds a job for ever** -- the
  -- row sits in `processing` and nothing on earth moves it, which is the
  -- classic queue bug and the reason `jobs_reap` exists below.
  add column if not exists attempts integer not null default 0,
  add column if not exists lease_until timestamptz,
  add column if not exists worker text,

  -- Backoff. A job that failed does not come straight back round.
  add column if not exists not_before timestamptz not null default now(),

  -- What a person watching sees. `progress_done` accumulates across attempts,
  -- because a resumable job's whole point is that the last attempt did not
  -- start from nothing.
  add column if not exists progress_done integer not null default 0,
  add column if not exists progress_note text;

-- `refused` is deliberately not `failed`. A failure may be worth retrying; a
-- refusal is a decision that changed -- the person who queued it left, or their
-- role lost the permission -- and calls for somebody to do something different.
-- `0207`'s `past_due` is not `expired`, for the same reason.
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('queued', 'processing', 'completed', 'failed', 'refused'));

-- Rule 13's "at most one live run per target", applied to the queue itself.
-- Two live jobs of one kind in one college would race for the same rows, and
-- whichever finished second would find nothing and report success.
create unique index if not exists jobs_one_live_per_kind
  on public.jobs (tenant_id, job_type)
  where status in ('queued', 'processing');

create index if not exists jobs_due_idx
  on public.jobs (not_before, created_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- A plain insert must not route around the permission check
-- ---------------------------------------------------------------------------

-- `0205`'s lesson: `jobs` carries an INSERT policy, so a plain insert through
-- PostgREST reaches the table without passing through `job_enqueue`. The
-- permission therefore lives in a trigger, and `job_enqueue` is the door with
-- the good manners rather than the gate.
create or replace function public.jobs_check_enqueue()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_kind reference.job_kinds;
begin
  select * into v_kind from reference.job_kinds where key = new.job_type;

  if v_kind.key is null then
    raise exception 'There is no kind of job called %. Add it to reference.job_kinds first.', new.job_type;
  end if;
  if not v_kind.is_active then
    raise exception '% is switched off.', v_kind.label;
  end if;
  if not public.role_has_permission(v_kind.required_permission) then
    raise exception 'Your role cannot start %. That needs %.',
      v_kind.label, v_kind.required_permission;
  end if;

  -- The queue records who asked, and it is not the client's to say. Everything
  -- the job later reads is read as this person, so a caller that could choose
  -- it could choose somebody else's permissions.
  new.created_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists jobs_check_enqueue on public.jobs;
create trigger jobs_check_enqueue
  before insert on public.jobs
  for each row execute function public.jobs_check_enqueue();

-- ---------------------------------------------------------------------------
-- Enqueuing, and stopping
-- ---------------------------------------------------------------------------

create or replace function public.job_enqueue(
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns public.jobs
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_job public.jobs;
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  -- The kind and the permission are checked by the trigger above, which is
  -- what makes them true of a plain insert as well. This adds only the
  -- sentence somebody reads when the same job is already running, because
  -- `23505` from a partial unique index is not something to show a person.
  if exists (
    select 1 from public.jobs
    where tenant_id = v_tenant_id and job_type = p_kind
      and status in ('queued', 'processing')
  ) then
    raise exception 'That is already running. It will carry on by itself -- starting a second one would have the two of them racing for the same rows.';
  end if;

  insert into public.jobs (tenant_id, job_type, payload, status)
  values (v_tenant_id, p_kind, coalesce(p_payload, '{}'::jsonb), 'queued')
  returning * into v_job;

  return v_job;
end;
$$;

comment on function public.job_enqueue(text, jsonb) is
  'Queue a background job. SECURITY INVOKER: the kind, the permission and the '
  'creator are enforced by a BEFORE INSERT trigger so a plain insert cannot '
  'route around them, and this adds the readable refusal for a duplicate.';

-- `jobs` deliberately has **no UPDATE policy**: the lease, the attempt count
-- and the progress are the worker's, and a person who could rewrite them could
-- make a job run twice or never. Stopping one is therefore a narrow definer
-- function with its own check -- the `homework_submit` shape.
create or replace function public.job_cancel(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_job public.jobs;
  v_tenant_id uuid := public.current_tenant_id();
begin
  if v_tenant_id is null then
    raise exception 'No tenant in session';
  end if;

  select * into v_job from public.jobs where id = p_job_id and tenant_id = v_tenant_id;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if not (public.current_role_code() = 'admin' or v_job.created_by = auth.uid()) then
    raise exception 'That is somebody else''s job.';
  end if;

  if v_job.status not in ('queued', 'processing') then
    raise exception 'That one has already finished.';
  end if;

  -- `refused`, because a person decided. The work already done stays done:
  -- every kind here is idempotent on its own source rows, so a cancelled
  -- half-run is a smaller backlog rather than a mess.
  update public.jobs
     set status = 'refused',
         completed_at = now(),
         error = 'Stopped by somebody at the school.',
         lease_until = null
   where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

-- ---------------------------------------------------------------------------
-- What is due
-- ---------------------------------------------------------------------------

create or replace function public.jobs_due(p_limit integer default 5)
returns setof public.jobs
language sql
stable
security definer
set search_path = 'public', 'extensions'
as $$
  select j.*
  from public.jobs j
  join reference.job_kinds k on k.key = j.job_type and k.is_active
  where j.status = 'queued'
    and j.not_before <= now()
  order by j.created_at
  limit greatest(coalesce(p_limit, 5), 1)
$$;

revoke all on function public.jobs_due(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- …and what each kind actually does
-- ---------------------------------------------------------------------------

-- A branch, not a catalogue column naming a function, and deliberately:
-- `schedule_run` is already this shape, the signatures differ per kind, and a
-- function name in a table is dynamic SQL built from data. The catalogue holds
-- the *metadata*; the code holds the code.
--
-- Runs as `authenticated`, already impersonating -- so every module function
-- below is called exactly as the screen calls it, unchanged, with RLS deciding
-- what it may touch.
create or replace function public.job_run_one(p_job public.jobs, p_page integer)
returns jsonb
language plpgsql
set search_path = 'public', 'extensions'
as $$
declare
  v_sync record;
  v_inv record;
begin
  if p_job.job_type = 'accounts.sync' then
    select * into v_sync from public.accounts_sync(p_page);
    return jsonb_build_object(
      'ok', true,
      'done', coalesce(v_sync.created, 0),
      'remaining', coalesce(v_sync.remaining, 0),
      'note', case
        when coalesce(v_sync.remaining, 0) > 0
          then format('%s posted, %s still to go.', v_sync.created, v_sync.remaining)
        when coalesce(v_sync.created, 0) = 0
          then 'Everything was already posted.'
        else format('%s posted. The ledger is up to date.', v_sync.created)
      end);

  elsif p_job.job_type = 'invitations.apply' then
    select * into v_inv from public.invitation_apply(
      (p_job.payload ->> 'run_id')::uuid,
      p_job.payload ->> 'signup_url');
    -- Not paged: an invitation is a message, and re-running from the start
    -- would write to some families twice. One attempt, one outcome.
    return jsonb_build_object(
      'ok', true,
      'done', coalesce(v_inv.invited, 0),
      'remaining', 0,
      'note', format('%s invited, %s emailed, %s texted.',
                     v_inv.invited, v_inv.emailed, v_inv.texted));

  else
    raise exception 'Nothing implements the job kind %', p_job.job_type;
  end if;
end;
$$;

-- Executable by `authenticated`, and that is not a widening: this is called
-- **while already impersonating**, so the caller is `authenticated` by the time
-- it runs, and every branch below calls a function a member of the college may
-- call anyway (`accounts_sync`, `invitation_apply`), with RLS deciding the rows
-- exactly as it does from the screen. The privileged part is
-- `job_run_as_creator`, which decides *whose* permissions those are, and that
-- one stays revoked.
revoke all on function public.job_run_one(public.jobs, integer) from public, anon;
grant execute on function public.job_run_one(public.jobs, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- One attempt, as the person who asked
-- ---------------------------------------------------------------------------

create or replace function public.job_run_as_creator(p_job_id uuid)
returns jsonb
language plpgsql
-- **SECURITY INVOKER**, for `0240`'s reason: this does `SET ROLE`, and Postgres
-- forbids that anywhere inside a definer frame. Callable only by a role that
-- may become `authenticated` -- which is `postgres`, and is **not**
-- `service_role`.
set search_path = 'public', 'extensions'
as $$
declare
  v_job public.jobs;
  v_kind reference.job_kinds;
  v_up record;
  v_role record;
  v_claims text;
  v_out jsonb;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'No such job';
  end if;

  select * into v_kind from reference.job_kinds where key = v_job.job_type;
  if v_kind.key is null then
    return jsonb_build_object('ok', false, 'refused', true, 'reason',
      format('There is no kind of job called %s any more.', v_job.job_type));
  end if;

  -- The authority is re-checked, never remembered.
  select up.id, up.role_id into v_up
  from public.user_profiles up
  where up.id = v_job.created_by and up.tenant_id = v_job.tenant_id;

  if v_up.id is null then
    return jsonb_build_object('ok', false, 'refused', true, 'reason',
      'The person who started this no longer has a login at this college, so '
      'there is nobody whose permissions the rest of it could use.');
  end if;

  -- `name` is the word the college chose; `code` is what sixty policies
  -- compare. Only one of the two is for reading -- `0241`'s correction.
  select r.code, r.name into v_role from public.roles r where r.id = v_up.role_id;

  if not exists (
    select 1 from public.role_permissions rp
    where rp.tenant_id = v_job.tenant_id
      and rp.role_id = v_up.role_id
      and rp.permission_code = v_kind.required_permission
      and rp.allowed
  ) then
    return jsonb_build_object('ok', false, 'refused', true, 'reason',
      format('%s may no longer %s, so the rest of this was not done. That role lost %s.',
             coalesce(v_role.name, 'The role that started this'),
             lower(v_kind.label), v_kind.required_permission));
  end if;

  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_up.id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', v_job.tenant_id,
        'role', v_role.code)
    )::text, true);

    set local role authenticated;

    v_out := public.job_run_one(v_job, v_kind.page_size);

    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
  exception when others then
    -- Leaving the session as `authenticated` would make every later statement
    -- in this tick answer for a person who is not there.
    reset role;
    perform set_config('request.jwt.claims', v_claims, true);
    return jsonb_build_object('ok', false, 'refused', false, 'reason', left(sqlerrm, 400));
  end;

  return v_out;
end;
$$;

revoke all on function public.job_run_as_creator(uuid) from public, anon, authenticated;

comment on function public.job_run_as_creator(uuid) is
  'Runs one page of one job as the person who queued it. SECURITY INVOKER on '
  'purpose: Postgres forbids SET ROLE inside a definer frame, so this is '
  'callable only from outside one, by postgres. Re-checks the login and the '
  'permission every attempt rather than trusting the row.';

-- ---------------------------------------------------------------------------
-- Writing down what happened
-- ---------------------------------------------------------------------------

create or replace function public.job_record(p_job_id uuid, p_outcome jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_job public.jobs;
  v_kind reference.job_kinds;
  v_ok boolean := coalesce((p_outcome ->> 'ok')::boolean, false);
  v_refused boolean := coalesce((p_outcome ->> 'refused')::boolean, false);
  v_done integer := coalesce((p_outcome ->> 'done')::integer, 0);
  v_remaining integer := coalesce((p_outcome ->> 'remaining')::integer, 0);
begin
  select * into v_job from public.jobs where id = p_job_id;
  select * into v_kind from reference.job_kinds where key = v_job.job_type;

  if v_refused then
    update public.jobs
       set status = 'refused', completed_at = now(), lease_until = null,
           error = p_outcome ->> 'reason'
     where id = p_job_id returning * into v_job;
    return v_job;
  end if;

  if not v_ok then
    -- A failure costs an attempt and backs off. Past the kind's own ceiling it
    -- is given up on **with the reason kept** -- "why did nothing happen" must
    -- have an answer, which is rule 7's schedule rule arriving at the queue.
    update public.jobs
       set attempts = jobs.attempts + 1,
           lease_until = null,
           worker = null,
           error = p_outcome ->> 'reason',
           status = case when jobs.attempts + 1 >= coalesce(v_kind.max_attempts, 3)
                         then 'failed' else 'queued' end,
           completed_at = case when jobs.attempts + 1 >= coalesce(v_kind.max_attempts, 3)
                               then now() else null end,
           not_before = now() + (interval '30 seconds' * power(2, jobs.attempts))
     where id = p_job_id returning * into v_job;
    return v_job;
  end if;

  update public.jobs
     set progress_done = jobs.progress_done + v_done,
         progress_note = p_outcome ->> 'note',
         lease_until = null,
         worker = null,
         error = null,
         -- **This is the whole point of the module.** A page that leaves work
         -- behind goes back on the queue rather than reporting success, so the
         -- thing that presses the button again is the database.
         status = case when v_remaining > 0 then 'queued' else 'completed' end,
         not_before = now(),
         completed_at = case when v_remaining > 0 then null else now() end,
         result = jsonb_build_object(
           'done', jobs.progress_done + v_done,
           'remaining', v_remaining)
   where id = p_job_id returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.job_record(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- …and the lease that stops a dead worker holding a job for ever
-- ---------------------------------------------------------------------------

create or replace function public.jobs_reap()
returns integer
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.jobs j
       set status = case when j.attempts + 1 >= coalesce(k.max_attempts, 3)
                         then 'failed' else 'queued' end,
           attempts = j.attempts + 1,
           lease_until = null,
           worker = null,
           not_before = now(),
           completed_at = case when j.attempts + 1 >= coalesce(k.max_attempts, 3)
                               then now() else null end,
           error = 'The worker stopped part-way through this attempt and did not come back.'
      from reference.job_kinds k
     where k.key = j.job_type
       and j.status = 'processing'
       and j.lease_until is not null
       and j.lease_until < now()
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.jobs_reap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The tick
-- ---------------------------------------------------------------------------

create or replace function public.jobs_tick(
  p_limit integer default 5,
  p_budget_seconds integer default 40
)
returns jsonb
language plpgsql
-- INVOKER, and callable only by a role that may become a member of a college.
set search_path = 'public', 'extensions'
as $$
declare
  v_due public.jobs;
  v_out jsonb;
  v_job public.jobs;
  v_started timestamptz := clock_timestamp();
  v_ran integer := 0;
  v_completed integer := 0;
  v_continued integer := 0;
  v_failed integer := 0;
  v_refused integer := 0;
  v_limit integer := greatest(least(coalesce(p_limit, 5), 50), 1);
begin
  if not pg_has_role(current_user, 'authenticated', 'USAGE') then
    raise exception
      'This role cannot become a member of a college, so it cannot run a job as '
      'the person who asked for it. Jobs are woken by pg_cron as postgres; the '
      'Edge Functions run as service_role and cannot do this.';
  end if;

  perform public.jobs_reap();

  for v_due in select * from public.jobs_due(v_limit)
  loop
    exit when extract(epoch from (clock_timestamp() - v_started)) > p_budget_seconds;

    -- Claim it, and only if it is still queued: two ticks overlapping must not
    -- both run the same page. `jobs_one_live_per_kind` stops two *jobs*; this
    -- stops two *attempts*.
    update public.jobs
       set status = 'processing',
           started_at = coalesce(started_at, now()),
           worker = format('pg_cron/%s', pg_backend_pid()),
           lease_until = now() + interval '5 minutes'
     where id = v_due.id and status = 'queued'
    returning * into v_job;

    continue when v_job.id is null;

    v_out := public.job_run_as_creator(v_job.id);
    v_job := public.job_record(v_job.id, v_out);

    v_ran := v_ran + 1;
    if v_job.status = 'completed' then v_completed := v_completed + 1;
    elsif v_job.status = 'failed' then v_failed := v_failed + 1;
    elsif v_job.status = 'refused' then v_refused := v_refused + 1;
    else v_continued := v_continued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ran', v_ran,
    'completed', v_completed,
    'continued', v_continued,
    'failed', v_failed,
    'refused', v_refused,
    'remaining', (select count(*) from public.jobs where status = 'queued' and not_before <= now()),
    'limit', v_limit
  );
end;
$$;

revoke all on function public.jobs_tick(integer, integer) from public, anon, authenticated;

comment on function public.jobs_tick(integer, integer) is
  'Runs due jobs, each as the person who queued it. SECURITY INVOKER and '
  'callable only by a role that may SET ROLE authenticated: pg_cron as '
  'postgres. Bounded per rule 7 -- at most p_limit jobs or p_budget_seconds, '
  'and the reply says how many are still waiting.';

commit;
