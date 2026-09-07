-- ---------------------------------------------------------------------------
-- The notice board
-- ---------------------------------------------------------------------------
--
-- `reference.notification_types` has carried a `notice.published` event since
-- migration 0033 with nothing behind it. This is the thing it was for.
--
-- THE DISTINCTION THE WHOLE MODULE RESTS ON
--
-- > **A notice is a document with an audience. A notification is the fact that
-- > something was announced, once.**
--
-- Collapsing them is the classic mistake and it fails in both directions. Treat
-- a notice as a notification and there is no board — nothing to come back to in
-- March to check what the fee circular actually said. Treat a notification as a
-- notice and every typo correction re-sends four hundred SMS.
--
-- So the two are separate tables with one deliberate join: `notices` is the
-- document, and publishing it calls `notify_send` exactly once. That is the
-- same instinct rule 10 already states for `notifications` versus
-- `notification_deliveries` — *"did the notice go out" and "did Ravi's mother's
-- SMS arrive" are different questions* — carried one level up.
--
-- Three consequences, each enforced rather than hoped for:
--
--   * **Editing never announces.** There is no trigger on update. A school
--     fixing a date in a circular does not wake anybody's phone.
--   * **Publishing announces once**, and `announced_count` says so.
--   * **Announcing again is a separate, deliberate act** with its own function
--     and its own audit row — not a boolean on publish that means different
--     things depending on what happened before.
--
-- WHO CAN SEE ONE IS A POLICY, NOT A QUERY
--
-- The audience is the same `jsonb` shape the notification module resolves, and
-- the RLS policy asks it directly: a parent addressed by a Grade 4 circular can
-- read that row, and a parent who is not cannot — in Postgres, not in a filter
-- somebody might forget. Rule 4: the UI is never the gate.

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,

  title text not null,
  body text not null,

  -- The same shape `notify_resolve_audience` reads: {"kind":"all"},
  -- {"kind":"role","role":"teacher"}, {"kind":"section","section_id":...,"who":"parents"}.
  -- One vocabulary for "who is this for", used by the board and by the message.
  audience jsonb not null default '{"kind": "all"}'::jsonb,

  category text not null default 'general'
    check (category in ('general', 'circular', 'event', 'examination', 'holiday', 'urgent')),

  is_pinned boolean not null default false,

  -- The window it is *on the board* for. Distinct from `published_at`, which is
  -- when it was announced: a school publishes the sports-day circular in
  -- January for a window in March, and the announcement goes out in January.
  starts_on date,
  expires_on date,

  status text not null default 'draft'
    check (status in ('draft', 'published', 'withdrawn')),
  published_at timestamptz,
  published_by uuid,

  -- How many times this was announced, and when last. Zero is the state that
  -- makes `notice_publish` idempotent; anything above one only happens because
  -- somebody called `notice_announce_again` on purpose.
  announced_count integer not null default 0 check (announced_count >= 0),
  last_announced_at timestamptz,

  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notices_published_has_a_time check (
    (status = 'published') = (published_at is not null)
    or (status = 'withdrawn' and published_at is not null)
  ),
  constraint notices_withdrawal_complete check (
    (status = 'withdrawn') = (withdrawn_at is not null)
  ),
  constraint notices_window_ordered check (
    starts_on is null or expires_on is null or expires_on >= starts_on
  )
);

alter table public.notices
  add constraint notices_tenant_id_key unique (tenant_id, id);

create index notices_tenant_idx on public.notices (tenant_id, is_pinned desc, published_at desc);
create index notices_session_idx on public.notices (tenant_id, session_id);
create index notices_live_idx on public.notices (tenant_id, status) where status = 'published';

create trigger set_updated_at before update on public.notices
  for each row execute function public.set_updated_at();
create trigger audit_notices
  after insert or update or delete on public.notices
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Is this one for me?
-- ---------------------------------------------------------------------------
--
-- The inverse of `notify_resolve_audience`, and it has to be. That function
-- answers *"who does this audience mean"* and is right for fanning a message
-- out to four hundred people once. A board asks the opposite question about
-- twenty rows — *"is this one for me"* — and resolving the audience of every
-- notice to compare lists would be twenty fan-outs to render one page.
--
-- `stable` and `SECURITY INVOKER`: it reads the caller's own profile, which
-- they can read anyway.

create or replace function public.notice_matches_me(p_audience jsonb)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = ( select auth.uid() )
      and up.tenant_id = ( select public.current_tenant_id() )
      and up.is_active
      and (
        (p_audience ->> 'kind') = 'all'

        or (
          (p_audience ->> 'kind') = 'role'
          and up.role_id in (
            select r.id from public.roles r
            where r.tenant_id = up.tenant_id and r.code = (p_audience ->> 'role')
          )
        )

        or (
          (p_audience ->> 'kind') = 'users'
          and up.id::text in (
            select jsonb_array_elements_text(coalesce(p_audience -> 'user_ids', '[]'::jsonb))
          )
        )

        or (
          (p_audience ->> 'kind') = 'section'
          and (
            (
              coalesce(p_audience ->> 'who', 'both') in ('students', 'both')
              and up.student_id in (
                select e.student_id from public.enrolments e
                where e.tenant_id = up.tenant_id
                  and e.section_id = (p_audience ->> 'section_id')::uuid
                  and e.status = 'active'
              )
            )
            or (
              coalesce(p_audience ->> 'who', 'both') in ('parents', 'both')
              and up.guardian_id in (
                select gs.guardian_id
                from public.guardian_student gs
                join public.enrolments e on e.student_id = gs.student_id
                where gs.tenant_id = up.tenant_id
                  and e.tenant_id = up.tenant_id
                  and e.section_id = (p_audience ->> 'section_id')::uuid
                  and e.status = 'active'
              )
            )
          )
        )
      )
  )
$$;

revoke all on function public.notice_matches_me(jsonb) from public, anon;
grant execute on function public.notice_matches_me(jsonb) to authenticated;

alter table public.notices enable row level security;

-- Staff see the board including drafts, because they are the people who write
-- them and a draft nobody can find is a draft nobody finishes.
create policy "staff view notices" on public.notices
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'accountant', 'librarian')
  );

-- Everybody else sees a published notice addressed to them, inside its window.
-- The audience test is *in the policy*, so a parent cannot read another class's
-- circular by asking for it directly. Rule 4: the UI is never the gate.
create policy "the audience views published notices" on public.notices
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and status = 'published'
    and (starts_on is null or starts_on <= current_date)
    and (expires_on is null or expires_on >= current_date)
    and public.notice_matches_me(audience)
  );

create policy "admins manage notices" on public.notices
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
--
-- `homework_files`'s shape, narrowed to one parent. The object *path* is stored
-- and never a URL (rule 8), the row is unique on the path so deletion is never
-- ambiguous, and the signed URL is issued by the server action only after this
-- row has been read back through RLS -- which is the sentence rule 8 makes
-- about the signature being the authorization.

create table public.notice_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notice_id uuid not null,

  storage_path text not null,
  bucket_id text not null default 'documents' check (bucket_id = 'documents'),
  file_name text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid,
  created_at timestamptz not null default now(),

  unique (bucket_id, storage_path),

  constraint notice_files_notice_fkey
    foreign key (tenant_id, notice_id)
    references public.notices (tenant_id, id) on delete cascade
);

create index notice_files_notice_idx on public.notice_files (tenant_id, notice_id);

alter table public.notice_files enable row level security;

-- A file is exactly as visible as its notice. Writing that as a subquery on
-- `notices` rather than repeating the audience test means the two can never
-- disagree -- a circular withdrawn this morning takes its attachment with it.
create policy "notice files follow their notice" on public.notice_files
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and exists (select 1 from public.notices n where n.id = notice_id)
  );

create policy "admins manage notice files" on public.notice_files
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Read receipts
-- ---------------------------------------------------------------------------
--
-- *"Has every parent seen the fee circular"* is the question a school asks
-- about a notice board, and it is the reason a board beats a broadcast.
--
-- Append-only in the strong sense: `UPDATE` and `DELETE` are **revoked**, not
-- merely unmatched by a policy, so an attempt raises `42501` rather than
-- silently touching nothing. A read receipt is a fact about a moment; there is
-- no legitimate edit to it, and a school that could clear them could claim
-- anything about who was told.

create table public.notice_reads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notice_id uuid not null,
  user_id uuid not null,
  read_at timestamptz not null default now(),

  unique (notice_id, user_id),

  constraint notice_reads_notice_fkey
    foreign key (tenant_id, notice_id)
    references public.notices (tenant_id, id) on delete cascade
);

create index notice_reads_notice_idx on public.notice_reads (tenant_id, notice_id);
create index notice_reads_user_idx on public.notice_reads (tenant_id, user_id);

alter table public.notice_reads enable row level security;

create policy "staff view notice reads" on public.notice_reads
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher')
  );

create policy "people view their own read receipts" on public.notice_reads
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and user_id = ( select auth.uid() )
  );

-- The only write anybody may make, and only about themselves. A parent who
-- could insert somebody else's receipt could make a circular look read.
create policy "people record their own reading" on public.notice_reads
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and user_id = ( select auth.uid() )
    and exists (select 1 from public.notices n where n.id = notice_id)
  );

revoke update, delete on public.notice_reads from authenticated, anon;

comment on table public.notice_reads is
  'One row per person per notice, written once. UPDATE and DELETE are revoked '
  'outright, so an attempt raises rather than silently matching nothing -- a '
  'school that could clear these could claim anything about who was told.';
