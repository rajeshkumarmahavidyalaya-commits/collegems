-- Phase 4.1 -- one notification abstraction.
--
-- The rule this exists to enforce: NOTHING in this codebase may call an email
-- or SMS API directly. Every module that wants to tell somebody something
-- writes a row here and stops caring how it travels.
--
-- The failure mode being avoided is specific and expensive. When sending is
-- hardcoded at each call site, adding a channel means touching every module
-- that sends -- which is why eSkooly can charge separately for WhatsApp. One
-- table and one dispatcher means a new channel is a driver, not a migration.
--
-- SHAPE
--
--   notifications            what happened, once
--     └── notification_deliveries   one row per recipient per channel
--
-- The split matters: "the absence notice" is one thing an administrator can
-- look at, while "did Ravi's mother's SMS arrive" is a different question, and
-- collapsing them makes the second unanswerable.
--
-- WHAT ACTUALLY SENDS TODAY: in-app, and only in-app. An in-app delivery is
-- `sent` the moment it exists, because the row IS the delivery. Email, SMS,
-- WhatsApp and push are real channels with real preference handling and real
-- delivery rows -- they queue, and nothing drains them, because no provider is
-- connected. That is deliberate and the UI says so rather than implying a
-- message went out.

-- ---------------------------------------------------------------------------
-- The global catalog of things worth telling somebody
-- ---------------------------------------------------------------------------

-- Outside `public`, like `reference.permissions`, because it is not tenant
-- data -- which keeps the schema-guard invariant meaningful.
create table reference.notification_types (
  key text primary key,
  name text not null,
  description text not null,
  -- What a tenant gets before anyone edits their preferences.
  default_channels text[] not null default array['in_app']
);

revoke insert, update, delete on reference.notification_types from authenticated, anon;
grant select on reference.notification_types to authenticated, anon;

insert into reference.notification_types (key, name, description, default_channels) values
  ('attendance.absent',       'Student marked absent',
   'Sent to a guardian when their child is marked absent for the day.',
   array['in_app', 'sms']),
  ('fees.invoice_raised',     'Fee invoice raised',
   'Sent when a new bill is issued to a family.',
   array['in_app', 'email']),
  ('fees.payment_received',   'Fee payment received',
   'Confirmation that a payment was recorded, with its receipt number.',
   array['in_app', 'email']),
  ('fees.due_reminder',       'Fee due reminder',
   'Reminder that an invoice is approaching or past its due date.',
   array['in_app', 'sms']),
  ('library.book_overdue',    'Library book overdue',
   'Sent when a borrowed book passes its due date.',
   array['in_app']),
  ('exam.results_published',  'Exam results published',
   'Sent when results become visible to students and parents.',
   array['in_app', 'sms']),
  ('notice.published',        'Notice published',
   'A notice board entry aimed at this person.',
   array['in_app']),
  ('message.received',        'New message',
   'Somebody sent a direct message.',
   array['in_app']),
  ('general.announcement',    'Announcement',
   'A one-off message composed by an administrator.',
   array['in_app']);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

-- Per tenant, per event, per channel, with `{{variable}}` interpolation. An
-- SMS and an email for the same event are not the same text -- one is 160
-- characters and one can be a paragraph -- so the channel is part of the key.
create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_key text not null references reference.notification_types(key) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'whatsapp', 'push')),
  subject text,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, event_key, channel)
);

create index notification_templates_tenant_idx on public.notification_templates (tenant_id);

create trigger set_updated_at before update on public.notification_templates
  for each row execute function public.set_updated_at();
create trigger audit_notification_templates
  after insert or update or delete on public.notification_templates
  for each row execute function public.audit_row_change();

alter table public.notification_templates enable row level security;

create policy "tenant members view notification_templates" on public.notification_templates
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage notification_templates" on public.notification_templates
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
-- What happened
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  event_key text not null references reference.notification_types(key) on delete restrict,
  subject text,
  body text not null,
  -- The variables the message was built from, kept so a delivery can be
  -- re-rendered for a channel added later without re-deriving them.
  payload jsonb not null default '{}'::jsonb,
  -- How the recipients were chosen, kept as a record of intent: "all parents
  -- of 6B" stays meaningful after a student leaves 6B, which a frozen list of
  -- ids would not.
  audience jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The composite key `notification_deliveries` points at, declared before the
-- table that needs it.
alter table public.notifications add constraint notifications_tenant_id_key unique (tenant_id, id);

create index notifications_tenant_idx on public.notifications (tenant_id);
create index notifications_recent_idx on public.notifications (tenant_id, session_id, created_at desc);
create index notifications_session_idx on public.notifications (session_id);
create index notifications_created_by_idx on public.notifications (created_by);

create trigger audit_notifications
  after insert or update or delete on public.notifications
  for each row execute function public.audit_row_change();

alter table public.notifications enable row level security;

create policy "admins view notifications" on public.notifications
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "admins create notifications" on public.notifications
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Who it reached, and whether it arrived
-- ---------------------------------------------------------------------------

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notification_id uuid not null,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'whatsapp', 'push')),
  -- Email address or phone number as it was at send time. Frozen on purpose: a
  -- delivery log that re-reads the current address cannot answer "where did we
  -- actually send it".
  address text,
  subject text,
  body text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notification_deliveries_notification_id_fkey
    foreign key (tenant_id, notification_id)
    references public.notifications (tenant_id, id) on delete cascade
);

create index notification_deliveries_tenant_idx on public.notification_deliveries (tenant_id);
create index notification_deliveries_notification_idx
  on public.notification_deliveries (tenant_id, notification_id);
-- The inbox query: my unread, newest first.
create index notification_deliveries_inbox_idx
  on public.notification_deliveries (recipient_user_id, created_at desc)
  where channel = 'in_app';
-- The dispatcher's claim query.
create index notification_deliveries_due_idx
  on public.notification_deliveries (status, next_attempt_at)
  where status = 'queued';

create trigger audit_notification_deliveries
  after insert or update or delete on public.notification_deliveries
  for each row execute function public.audit_row_change();

alter table public.notification_deliveries enable row level security;

create policy "admins view notification_deliveries" on public.notification_deliveries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

create policy "recipients view own deliveries" on public.notification_deliveries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and recipient_user_id = ( select auth.uid() )
  );

-- Marking your own in-app message read is the only update a person may make,
-- and `read_at` is the only column they could want to change. Everything else
-- about a delivery is the system's record of what it did.
-- Declared here rather than with the other `notifications` policies: it reads
-- `notification_deliveries`, which did not exist yet at that point. Anyone can
-- see the notification behind a delivery addressed to them -- otherwise their
-- own inbox could not render its text.
create policy "recipients view their notifications" on public.notifications
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and exists (
      select 1 from public.notification_deliveries d
      where d.notification_id = notifications.id
        and d.recipient_user_id = ( select auth.uid() )
    )
  );

create policy "recipients mark own deliveries read" on public.notification_deliveries
  for update to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and recipient_user_id = ( select auth.uid() )
    and channel = 'in_app'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and recipient_user_id = ( select auth.uid() )
    and channel = 'in_app'
  );

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

-- Absence of a row means "use the catalog default", so turning a channel on for
-- everybody is a change to `reference.notification_types` rather than a
-- backfill of a row per user per event.
create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null references reference.notification_types(key) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms', 'whatsapp', 'push')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, event_key, channel)
);

create index notification_preferences_tenant_idx on public.notification_preferences (tenant_id);
create index notification_preferences_user_idx
  on public.notification_preferences (tenant_id, user_id);

create trigger set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

-- Your preferences are yours. No admin override: a school that wants everyone
-- on SMS changes the catalog default, it does not reach into somebody's
-- settings.
create policy "users manage own notification_preferences" on public.notification_preferences
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and user_id = ( select auth.uid() )
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and user_id = ( select auth.uid() )
  );
