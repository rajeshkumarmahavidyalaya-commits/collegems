-- 0249 — A seat is a room and a number
--
-- The roadmap's Phase 3b named an exam seat plan "self-contained and genuinely
-- missing", and the measurement agrees: zero occurrences of `seat_plan`,
-- `seating`, `invigilat`, `hall_ticket` or `admit_card` anywhere in `src/`,
-- `supabase/` or `docs/`.
--
-- What the college has instead is the arrangement nobody chose. Measured on the
-- demo college: 12 sections of 25-27 children, 302 candidates sitting on each
-- of 8 dates, and 12 active rooms of 40 seats each. Seat a section in its own
-- classroom — which is what happens when nothing decides otherwise — and the
-- room is 63% full and **every neighbour is writing the identical paper**.
--
-- That is the whole point of the module. A seat plan is not a room-booking
-- system; it is the arrangement that puts different question papers next to
-- each other.
--
-- ---------------------------------------------------------------------------
-- Capacity is a rule about how many other rows exist — except when seats are
-- numbered
--
-- Rule 4 is explicit that a rule about *how many other rows exist* — a bus with
-- 40 seats, a room with 4 beds, debits equalling credits — cannot be a
-- constraint, because no constraint sees a second row, and so it lives in the
-- write function under an advisory lock.
--
-- **A numbered seat escapes that, and it is worth naming why.** Two
-- constraints:
--
--     check (seat_no between 1 and planned_capacity)       -- one row
--     unique (tenant_id, plan_id, room_id, seat_no)        -- one row per seat
--
-- Together they say *at most `planned_capacity` candidates are in this room*,
-- declaratively, with no lock and no count — because the numbering is the
-- count. The advisory-lock answer is for a capacity whose occupants are
-- anonymous. Give the occupants numbers and the pigeonhole principle does the
-- work.
--
-- ---------------------------------------------------------------------------
-- Two of rule 4's devices, in one table, doing the two different things they
-- are for
--
-- `run_status` is carried **with** `on update cascade`. That is the status use:
-- publishing a plan is one UPDATE on the parent, the cascade rewrites every
-- allocation, and from that instant the draft-only write policies match no row.
-- No revoke, no trigger — `payslips.run_status` and `exam_remarks.exam_status`
-- for the third time.
--
-- `planned_capacity` is carried **without** one, and is not in a key at all.
-- That is rule 4's second boundary — the one about time rather than distance:
--
-- > The composite-key device ties a child to its parent's **current** state. A
-- > row that records what was true on a day is not that child.
--
-- A seat plan is `substitutions`, not `payslips`. Both halves of the device
-- fail here exactly as they fail there: with the cascade, refurbishing a room
-- from 40 seats to 30 next year rewrites last July's plan and the room is
-- recorded as having had a capacity it did not have; without the cascade the
-- refurbishment is *refused*, and the college cannot edit a room until every
-- historical plan is deleted. So the capacity is a frozen plain integer, the
-- live room is free to disagree with it, and — as with a reassigned timetable
-- lesson — **the disagreement is what the critic can find.**
--
-- ---------------------------------------------------------------------------
-- A sitting is a date and a slot
--
-- Measured: this college sets `exam_subjects.time_slot_id` on 0 of 96 dated
-- papers, and no date carries two sittings. A plan keyed on the date alone
-- would therefore have passed every test available here and been wrong for the
-- first college that examines morning and afternoon — a candidate sitting two
-- papers on one day needs two seats, and `exam_seat_allocations_one_per_student`
-- would have refused the second with a constraint error.
--
-- One nullable column and `nulls not distinct` make that college
-- representable instead of refused, and cost the college with no slots nothing:
-- every plan simply carries a null slot and the engine matches papers the same
-- way.

-- ---------------------------------------------------------------------------
-- The plan
-- ---------------------------------------------------------------------------

create table public.exam_seat_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Rule 2: carried directly even though it is reachable through `exams`, so
  -- every query can filter on the year without a join.
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  exam_id uuid not null,

  -- The sitting this plan seats. A date plus, optionally, the period within it.
  sits_on date not null,
  time_slot_id uuid references public.time_slots(id) on delete set null,

  status text not null default 'draft'
    check (status in ('draft', 'published', 'discarded')),

  -- Rule 13: freeze the rules onto the run. Editing `exams.seating` later must
  -- not change what a plan already decided — `exam_results.rules_snapshot` and
  -- `promotion_runs`' snapshot for the same reason.
  rules jsonb not null default '{}'::jsonb,

  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exam_seat_plans_exam_fkey
    foreign key (tenant_id, exam_id)
    references public.exams (tenant_id, id) on delete cascade,

  constraint exam_seat_plans_published_chk
    check ((status = 'published') = (published_at is not null))
);

alter table public.exam_seat_plans
  add constraint exam_seat_plans_tenant_id_key unique (tenant_id, id);

-- The key an allocation's `run_status` is held against.
alter table public.exam_seat_plans
  add constraint exam_seat_plans_status_key unique (tenant_id, id, status);

-- At most one live plan per sitting. `promotion_runs_one_live` and
-- `renewal_runs_one_live` for the same reason: two half-built previews of one
-- arrangement disagree, and whichever is published second silently wins.
--
-- `nulls not distinct` is load-bearing. Without it two draft plans for the same
-- date with no slot would both be allowed, because in the default reading two
-- nulls never collide — and a college that sets no slots (this one sets none on
-- 96 of 96 dated papers) is *precisely* the college where every plan has a null
-- here, so the index would protect nobody.
create unique index exam_seat_plans_one_live
  on public.exam_seat_plans (tenant_id, exam_id, sits_on, time_slot_id)
  nulls not distinct
  where status <> 'discarded';

create index exam_seat_plans_exam_idx
  on public.exam_seat_plans (tenant_id, exam_id, sits_on);
create index exam_seat_plans_session_idx
  on public.exam_seat_plans (tenant_id, session_id, sits_on desc);

create trigger set_updated_at before update on public.exam_seat_plans
  for each row execute function public.set_updated_at();
create trigger audit_exam_seat_plans
  after insert or update or delete on public.exam_seat_plans
  for each row execute function public.audit_row_change();

alter table public.exam_seat_plans enable row level security;

-- Who may see a plan, and the one sentence that decides it:
--
--   **A seat plan is a document about where somebody must be at nine o'clock
--   tomorrow morning, and the person who most needs it is the candidate.**
--
-- So the read side is deliberately wider than the write side. Staff holding
-- `exams.view` read every plan; a candidate reads their own allocation and
-- nothing else; a guardian reads their own children's. None of the three may
-- write, and the *draft* plans are staff-only — a room allocation that is still
-- being argued about is not an announcement.
create policy "staff view exam_seat_plans" on public.exam_seat_plans
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('exams.view') )
  );

create policy "exam officers manage exam_seat_plans" on public.exam_seat_plans
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('exams.manage') )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('exams.manage') )
  );

comment on table public.exam_seat_plans is
  'A seating arrangement for one sitting of one exam: a date, optionally a '
  'period, and the rules that were in force when it was generated. Rule 13''s '
  'shape — the preview is editable rows, and publishing freezes them.';
comment on column public.exam_seat_plans.rules is
  'Frozen copy of the tenant''s `exams.seating` setting. Editing the setting '
  'later must not change what a plan already decided.';
comment on column public.exam_seat_plans.time_slot_id is
  'The period within the date, where a college examines more than once a day. '
  'Null means "the sitting on this date", which is what a college that does '
  'not use periods has. Part of exam_seat_plans_one_live, which is NULLS NOT '
  'DISTINCT precisely because null is the common case.';

-- ---------------------------------------------------------------------------
-- The seats
-- ---------------------------------------------------------------------------

create table public.exam_seat_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null,

  -- Carried from the plan and held equal to it by exam_seat_allocations_plan_fkey.
  -- It is here because a POLICY cannot reach another table cheaply, and the
  -- write policies below require 'draft'.
  run_status text not null default 'draft'
    check (run_status in ('draft', 'published', 'discarded')),

  student_id uuid not null,

  -- Which paper this candidate is writing at this sitting. A live foreign key,
  -- not frozen: a paper that has been deleted is a plan that cannot be sat, and
  -- finding that out from a null is better than from a stale name.
  exam_subject_id uuid not null references public.exam_subjects(id) on delete cascade,

  room_id uuid not null references public.class_rooms(id) on delete restrict,

  -- Frozen. See the header: the live room is free to disagree with this, and
  -- the critic reports when it does. `on delete restrict` above is the pair to
  -- it — a room may shrink or close, but deleting one out from under a plan
  -- would leave a seat with no address.
  planned_capacity integer not null check (planned_capacity > 0),
  room_name text not null,

  seat_no integer not null check (seat_no >= 1),

  -- The other half of the declarative capacity rule described in the header.
  constraint exam_seat_allocations_within_room_chk
    check (seat_no <= planned_capacity),

  -- Rule 13: the difference between "the rules decided" and "the examination
  -- officer decided", and both belong in the audit log.
  is_override boolean not null default false,
  -- Why this candidate is where they are, when a person moved them. Required
  -- for an override, because 0220's rule is that a reason asked for is a reason
  -- kept — and here there is nowhere else the fact could live.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One seat per candidate at this sitting.
  constraint exam_seat_allocations_one_per_student unique (tenant_id, plan_id, student_id),
  -- One candidate per seat.
  constraint exam_seat_allocations_one_per_seat unique (tenant_id, plan_id, room_id, seat_no),

  constraint exam_seat_allocations_plan_fkey
    foreign key (tenant_id, plan_id, run_status)
    references public.exam_seat_plans (tenant_id, id, status)
    on update cascade on delete cascade,
  constraint exam_seat_allocations_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,

  constraint exam_seat_allocations_override_chk
    check (not is_override or length(trim(coalesce(note, ''))) >= 3)
);

create index exam_seat_allocations_tenant_idx on public.exam_seat_allocations (tenant_id);
create index exam_seat_allocations_plan_idx
  on public.exam_seat_allocations (tenant_id, plan_id, room_id, seat_no);
create index exam_seat_allocations_student_idx
  on public.exam_seat_allocations (tenant_id, student_id);
create index exam_seat_allocations_paper_idx
  on public.exam_seat_allocations (tenant_id, exam_subject_id);

create trigger set_updated_at before update on public.exam_seat_allocations
  for each row execute function public.set_updated_at();
create trigger audit_exam_seat_allocations
  after insert or update or delete on public.exam_seat_allocations
  for each row execute function public.audit_row_change();

alter table public.exam_seat_allocations enable row level security;

-- Staff with `exams.view` read every allocation, draft or published: the
-- examination officer has to be able to argue with a draft.
create policy "staff view exam_seat_allocations" on public.exam_seat_allocations
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.role_has_permission('exams.view') )
  );

-- A candidate reads their own seat, and only once it has been published.
--
-- `run_status = 'published'` is doing real work here and it is the whole
-- argument for carrying the column: without it this policy would have to reach
-- into `exam_seat_plans` on every row, and a candidate would be told where to
-- sit while the officer was still moving people around.
create policy "students view own exam seat" on public.exam_seat_allocations
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and run_status = 'published'
    and ( select public.current_role_code() ) = 'student'
    and student_id = (select up.student_id from public.user_profiles up where up.id = auth.uid())
  );

create policy "parents view own children exam seats" on public.exam_seat_allocations
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and run_status = 'published'
    and ( select public.current_role_code() ) = 'parent'
    and exists (
      select 1 from public.guardian_student gs
      where gs.student_id = exam_seat_allocations.student_id
        and gs.guardian_id = (select up.guardian_id from public.user_profiles up where up.id = auth.uid())
    )
  );

-- The write policies, and the payoff for carrying `run_status`: they require a
-- draft. Publishing is one UPDATE on the parent; the cascade rewrites every
-- allocation to 'published', and from that instant these match no row. Writes
-- touch nothing, silently, which is what RLS does.
--
-- Not a revoke and not a trigger. A published plan is not append-only — it is
-- *finished*, and it becomes editable again if it is unpublished, which is what
-- makes "the hall changed on Thursday" an audited unpublish/republish pair
-- rather than a quiet edit.
create policy "exam officers write draft seat allocations" on public.exam_seat_allocations
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and run_status = 'draft'
    and ( select public.role_has_permission('exams.manage') )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and run_status = 'draft'
    and ( select public.role_has_permission('exams.manage') )
  );

comment on table public.exam_seat_allocations is
  'One candidate, one room, one numbered seat, for one sitting. The room''s '
  'capacity and name are frozen copies: this row records an arrangement made '
  'on a day, so the live room is free to disagree with it and '
  'exam_seating_problems() reports when it does.';
comment on column public.exam_seat_allocations.run_status is
  'Held equal to the plan''s status by exam_seat_allocations_plan_fkey ON '
  'UPDATE CASCADE. Publishing is one UPDATE on the plan; this column is what '
  'the write policies and the candidate''s read policy compare against.';
comment on column public.exam_seat_allocations.planned_capacity is
  'The room''s capacity when the plan was made, frozen. Deliberately NOT in a '
  'composite key: with a cascade, refurbishing a room would rewrite a plan '
  'from a previous year; without one, the refurbishment would be refused. Rule '
  '4''s second boundary — a statement about a day is not a child kept in step.';
comment on column public.exam_seat_allocations.seat_no is
  'Together with the unique index on (plan, room, seat_no) and the CHECK '
  'against planned_capacity, this is what enforces room capacity — '
  'declaratively, with no advisory lock, because numbered occupants cannot '
  'outnumber their numbers.';

-- ---------------------------------------------------------------------------
-- Rule 1's fourth privilege set, and rule 12's policy-as-data
-- ---------------------------------------------------------------------------

-- 0159's revoke covers today's tables through the amended default privileges,
-- but stating it here means the guard has nothing to find on the day this
-- applies rather than on the day somebody next runs it.
revoke truncate, trigger, references, maintain
  on public.exam_seat_plans, public.exam_seat_allocations
  from anon, authenticated;

-- The seating policy. Everything in it is something a real college disagrees
-- with, which is rule 12's test:
--
--   `fill`  — `spread` divides the candidates evenly over the rooms opened;
--             `pack` fills each room before opening the next. Packing saves
--             invigilators; spreading gives elbow room. Both are real.
--   `separate_same_paper` — whether two candidates writing the same paper may
--             occupy consecutive seats. **Defaults to true**, which is the
--             conservative reading (rule 12): a college that wants leniency
--             will say so, whereas a college that gets it by accident finds out
--             from an invigilator.
--   `order` — how candidates are sequenced before they are interleaved. A
--             college whose invigilators call the register by roll number wants
--             `roll`; one that files by admission number wants `admission`.
--   `reserve_per_room` — seats held back in every room, for a candidate who
--             arrives with a scribe or simply for room to walk. 0 by default.
--
-- An empty `{}` is a coherent configuration, not an error.
insert into reference.settings_catalog
  (key, label, description, module, value_type, fields, default_value,
   is_required, permission_code, sort_order)
values (
  'exams.seating',
  'Seating arrangement',
  'How candidates are spread over rooms when an exam seat plan is generated. '
  'A plan freezes these rules when it is created, so changing them here never '
  'alters a plan that already exists.',
  'Exams',
  'object',
  '[{"name":"fill","type":"text","label":"Fill rooms by"},
    {"name":"separate_same_paper","type":"boolean","label":"Keep the same paper off adjacent seats"},
    {"name":"order","type":"text","label":"Sequence candidates by"},
    {"name":"reserve_per_room","type":"number","label":"Seats held back per room"}]'::jsonb,
  '{"fill":"spread","separate_same_paper":true,"order":"roll","reserve_per_room":0}'::jsonb,
  false,
  'exams.manage',
  80
);
