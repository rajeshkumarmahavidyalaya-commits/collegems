-- 0184 — Renewing an arrangement: rule 13's shape, for a bus seat and a bed.
--
-- Migration 0178 made an arrangement end with its year, which was right and
-- left a hole: on 1 April a school that ran 46 bus seats and 13 hostel beds
-- runs none, and somebody has to re-enter all 59 by hand in the busiest week of
-- the year. `academics_session_problems()` says the number; this is what a
-- person does about it.
--
-- Rule 13, because this is a bulk operation and its preview has to be
-- *editable*:
--
-- > every year the rules get three or four named children wrong -- one is
-- > moving house, one has stopped taking the bus, one has been given a
-- > different room -- and the person who knows that is standing at the screen.
--
-- ---------------------------------------------------------------------------
-- One table typed by kind, not two nearly identical ones
--
-- `ledger_entries` is the precedent: one table with a `kind`, and the
-- constraint written per kind. Two tables here would be two sets of policies,
-- two audit triggers, two apply functions and two screens, differing in the
-- three columns that actually matter.
--
-- And `kind` is carried onto the decision rather than read from the run,
-- because **a CHECK cannot reach another table** (rule 4). It is held equal to
-- the run's by the composite foreign key, so "this decision belongs to this
-- run" and "this decision is the same kind as its run" are one constraint.
--
-- ---------------------------------------------------------------------------
-- What is frozen, and what is not
--
-- `from_label` and `from_fare` are frozen copies of the arrangement being
-- renewed -- deliberately plain columns, not a foreign key. This is rule 4's
-- second boundary: a decision row is **a statement about a day**, and last
-- year's arrangement is free to be ended, corrected or deleted without
-- rewriting what the preview said.
--
-- The *target* is not frozen: `to_stop_id` and `to_room_id` are live foreign
-- keys, because a decision that points at a stop somebody has since deleted is
-- a decision that cannot be applied, and finding that out at apply time is
-- worse than having the row go null.

create table public.renewal_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_session_id uuid not null references public.academic_sessions(id) on delete cascade,
  to_session_id uuid not null references public.academic_sessions(id) on delete cascade,
  kind text not null check (kind in ('transport', 'hostel')),
  status text not null default 'draft'
    check (status in ('draft', 'applied', 'discarded')),
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint renewal_runs_sessions_differ_chk check (from_session_id <> to_session_id),
  constraint renewal_runs_applied_chk check ((status = 'applied') = (applied_at is not null))
);

alter table public.renewal_runs
  add constraint renewal_runs_tenant_id_key unique (tenant_id, id);

-- The key the decision's `kind` is held against.
alter table public.renewal_runs
  add constraint renewal_runs_kind_key unique (tenant_id, id, kind);

-- At most one live run per rollover per kind. Two half-built previews of the
-- same renewal disagree, and whichever is applied second silently wins --
-- `promotion_runs_one_live` for the same reason.
create unique index renewal_runs_one_live
  on public.renewal_runs (tenant_id, from_session_id, to_session_id, kind)
  where status <> 'discarded';

create index renewal_runs_tenant_idx on public.renewal_runs (tenant_id, created_at desc);

create trigger set_updated_at before update on public.renewal_runs
  for each row execute function public.set_updated_at();
create trigger audit_renewal_runs
  after insert or update or delete on public.renewal_runs
  for each row execute function public.audit_row_change();

alter table public.renewal_runs enable row level security;

create policy "admins manage renewal_runs" on public.renewal_runs
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

comment on table public.renewal_runs is
  'A dry run of carrying arrangements of one kind into the receiving academic '
  'year. Admin-only to read as well as write, like a promotion run: "this '
  'child will lose their bus seat" is not a sentence to leave in a staff room '
  'before anybody has decided it.';

create table public.renewal_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null,
  -- Carried from the run so the target check below can see it.
  kind text not null check (kind in ('transport', 'hostel')),
  student_id uuid not null,

  -- Frozen: what the child had. A statement about last year, not a pointer at
  -- a row that may be ended or corrected in the meantime.
  from_label text not null,
  from_fare numeric(12, 2) not null default 0 check (from_fare >= 0),

  decision text not null check (decision in ('renew', 'skip')),

  to_stop_id uuid references public.route_stops(id) on delete set null,
  to_room_id uuid references public.hostel_rooms(id) on delete set null,
  direction text check (direction in ('pickup', 'drop', 'both')),

  -- Why this row says what it says, in a sentence, so the screen does not have
  -- to guess. `grading_scheme_problems()`'s instinct applied to a decision.
  reason text not null,

  -- The difference between "the rules decided" and "a person decided", and
  -- both belong in the audit log.
  is_override boolean not null default false,

  -- What was written, and what stopped it. A run applies row by row and carries
  -- on past a failure (rule 13, the import lesson): stopping at the first one
  -- leaves the office with half a bus and no list of who is missing.
  applied_id uuid,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, run_id, student_id),

  constraint renewal_decisions_run_fkey
    foreign key (tenant_id, run_id, kind)
    references public.renewal_runs (tenant_id, id, kind) on delete cascade,
  constraint renewal_decisions_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,

  -- A renewal has to land somewhere, and where depends on the kind. A skip
  -- must point at nothing at all, or applying it would be a silent write.
  constraint renewal_decisions_target_chk check (
    case
      when decision = 'skip'
        then to_stop_id is null and to_room_id is null and direction is null
      when kind = 'transport'
        then to_stop_id is not null and to_room_id is null and direction is not null
      else to_room_id is not null and to_stop_id is null and direction is null
    end
  ),

  constraint renewal_decisions_reason_chk check (length(trim(reason)) >= 3)
);

create index renewal_decisions_tenant_idx on public.renewal_decisions (tenant_id);
create index renewal_decisions_run_idx on public.renewal_decisions (tenant_id, run_id);
create index renewal_decisions_student_idx on public.renewal_decisions (tenant_id, student_id);

create trigger set_updated_at before update on public.renewal_decisions
  for each row execute function public.set_updated_at();
create trigger audit_renewal_decisions
  after insert or update or delete on public.renewal_decisions
  for each row execute function public.audit_row_change();

alter table public.renewal_decisions enable row level security;

create policy "admins manage renewal_decisions" on public.renewal_decisions
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

comment on column public.renewal_decisions.kind is
  'Held equal to the run''s kind by renewal_decisions_run_fkey. It is here '
  'because a CHECK cannot reach another table, and the target check needs it.';
comment on column public.renewal_decisions.from_label is
  'What the child had last year, frozen as text. Not a foreign key: last '
  'year''s arrangement is free to be ended or corrected without rewriting what '
  'this preview said.';
