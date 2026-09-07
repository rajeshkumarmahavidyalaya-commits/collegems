-- ---------------------------------------------------------------------------
-- Schedules — the school's clock, not the server's
-- ---------------------------------------------------------------------------
--
-- Everything this system sends, somebody presses a button for. That is the gap
-- this closes: *"tell a parent the same evening their child was absent"* is the
-- single most-asked-for thing in a school ERP, and it cannot be a button
-- because the whole value is that nobody has to remember.
--
-- FOUR DECISIONS, AND THE FIRST IS THE ONE EVERY SCHEDULER GETS WRONG
--
-- **1. "Half past seven" is a wall clock, not an instant.** A cron expression
-- fires in one timezone. Two schools on one deployment do not share one, and a
-- school that keeps `Asia/Kolkata` does not want its evening SMS at 2pm because
-- the server keeps UTC. So a schedule stores `run_at time` -- a local wall
-- clock -- and the runner asks each tenant *"is it half past seven where you
-- are?"*. Storing a UTC instant would also silently move the send by an hour
-- twice a year for any school that observes daylight saving.
--
-- **2. Which days it runs is data, not a branch.** Rule 12. "Every weekday",
-- "the 1st of the month", "Mondays" are all real, and so is the school that
-- wants Saturdays because it teaches on them.
--
-- **3. An occurrence runs once.** `schedule_runs` is unique on
-- `(schedule_id, occurrence_at)`, so a runner invoked twice at 19:30 and 19:31
-- inserts the second row into a unique violation instead of sending four
-- hundred parents a second SMS. This is `accounts_sync`'s idempotency rule
-- applied to time: **make the natural key the thing that cannot repeat.**
--
-- **4. A schedule that was missed does not catch up.** Enabling a daily
-- reminder at three in the afternoon must not fire this morning's, and a runner
-- that was down for a week must not send a week of absence notices on Monday.
-- So `grace_minutes` is per schedule, because the right answer differs by
-- kind: a fee reminder three hours late is fine, and an absence notice three
-- hours late is worse than useless because school is over and the parent has
-- already collected the child. Past its grace, the occurrence is **recorded as
-- missed** rather than skipped silently -- otherwise "why did nothing go out on
-- the 3rd" has no answer.

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- What to do. Not free text: each kind is a branch in `schedule_run`, and a
  -- kind nobody implemented would be a row that fails every night for ever.
  kind text not null check (kind in (
    'attendance.absentees',
    'fees.due_reminder',
    'library.overdue'
  )),
  name text not null,

  -- The kind's own settings, per rule 12. A school that wants reminders only
  -- above 500 rupees, or only for books a week overdue, says so here rather
  -- than in a release.
  params jsonb not null default '{}'::jsonb,

  -- The wall clock, in the tenant's timezone. See the header.
  run_at time not null,

  -- ISO weekdays: 1 = Monday ... 7 = Sunday. Empty means every day.
  weekdays smallint[] not null default '{}',

  -- For a monthly schedule. Null means "not monthly"; the two are mutually
  -- exclusive and the check below says so, because a schedule that is both
  -- "Mondays" and "the 1st" is a question nobody can answer.
  day_of_month smallint,

  -- How late is still worth sending. See the header -- this is the column that
  -- makes "no backfill" a policy rather than a constant.
  grace_minutes integer not null default 180 check (grace_minutes between 5 and 1440),

  -- Which channels, or null for the event type's defaults. Rule 10 still holds:
  -- this names channels, it does not know how any of them travel.
  channels text[],

  is_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  unique (tenant_id, name),

  constraint schedules_weekly_or_monthly check (
    day_of_month is null or cardinality(weekdays) = 0
  ),
  constraint schedules_day_of_month_range check (
    day_of_month is null or day_of_month between 1 and 28
  ),
  constraint schedules_weekdays_valid check (
    weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  )
);

alter table public.schedules
  add constraint schedules_tenant_id_key unique (tenant_id, id);

create index schedules_tenant_idx on public.schedules (tenant_id);
create index schedules_enabled_idx on public.schedules (tenant_id, is_enabled) where is_enabled;

create trigger set_updated_at before update on public.schedules
  for each row execute function public.set_updated_at();
create trigger audit_schedules
  after insert or update or delete on public.schedules
  for each row execute function public.audit_row_change();

alter table public.schedules enable row level security;

create policy "tenant members view schedules" on public.schedules
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage schedules" on public.schedules
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

comment on column public.schedules.day_of_month is
  'Capped at 28 on purpose. "The 31st" silently skips February and the short '
  'months, which is a schedule that works for seven months of the year and '
  'looks broken for five. A school that means "month end" needs a different '
  'concept, not a number that is wrong four times a year.';

-- ---------------------------------------------------------------------------
-- What happened, once per occurrence
-- ---------------------------------------------------------------------------

create table public.schedule_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  schedule_id uuid not null,

  -- The instant the schedule was *for*, not the instant it ran. That is the
  -- distinction the unique index below rests on: a run that starts at 19:31
  -- because the tick was late is still the 19:30 occurrence, and must not
  -- become a second one.
  occurrence_at timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,

  status text not null default 'running'
    check (status in ('running', 'done', 'missed', 'failed')),

  -- What it actually did, so the register answers "did anybody hear about it".
  matched integer not null default 0,
  notified integer not null default 0,
  note text,

  created_at timestamptz not null default now(),

  constraint schedule_runs_schedule_fkey
    foreign key (tenant_id, schedule_id)
    references public.schedules (tenant_id, id) on delete cascade
);

-- The idempotency key. Not an advisory lock and not a check-then-insert: two
-- ticks racing must have one of them lose at the index, in the database.
create unique index schedule_runs_one_per_occurrence
  on public.schedule_runs (schedule_id, occurrence_at);

create index schedule_runs_tenant_idx on public.schedule_runs (tenant_id, occurrence_at desc);

alter table public.schedule_runs enable row level security;

-- Read-only to people, and append-only in the strong sense: the runner holds
-- the service role and bypasses RLS, so there is no write policy at all here.
-- That is the "absent policy" flavour of append-only from rule 6, and it is the
-- right one: exactly one party writes, through a definer function, and the rest
-- simply have no way in.
create policy "tenant members view schedule_runs" on public.schedule_runs
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

comment on table public.schedule_runs is
  'One row per schedule per occurrence, unique on (schedule_id, occurrence_at). '
  'A `missed` row is a deliberate record that an occurrence went past its '
  'grace window unsent -- silence would leave "why did nothing go out on the '
  '3rd" unanswerable.';
