-- ---------------------------------------------------------------------------
-- Front office — the admissions funnel and the gate register
--
-- Everything else in this system starts with a student who already exists.
-- This is the module that comes before that: the parent who telephoned in
-- November, was called back twice, visited in December, and became a student in
-- April. Losing that trail is how a school forgets who it turned away.
--
-- Two tables that look unrelated and are not: both are records of somebody
-- who is **not yet in the identity model**, kept until they either become a
-- person in it or stop mattering.
-- ---------------------------------------------------------------------------

-- `class_levels` predates the convention that every table carries a
-- `(tenant_id, id)` unique key for composite foreign keys to point at, and an
-- enquiry names the class it is asking about. Foreign key checks are not
-- subject to RLS, so a bare `references class_levels(id)` would let one
-- tenant's enquiry point at another tenant's class.
alter table public.class_levels
  add constraint class_levels_tenant_id_key unique (tenant_id, id);

alter table public.document_sequences drop constraint document_sequences_kind_check;
alter table public.document_sequences
  add constraint document_sequences_kind_check
  check (kind in ('receipt', 'invoice', 'voucher', 'enquiry', 'visitor_pass'));

-- ---------------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------------

-- An enquiry is deliberately **not** a `person` row. A name written on a pad at
-- the front desk is not yet a human this school holds records about, and
-- promoting it to one would fill `people` with duplicates of every family that
-- ever asked about fees. It becomes a person at admission, through the same
-- `admit_student` path the office already uses -- see `enquiry_convert`.
create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Session-scoped, per rule 2: an enquiry is for a year's intake, and "how
  -- many enquiries did we get" is always asked about a year.
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  enquiry_number text not null,

  applicant_first_name text not null,
  applicant_last_name text not null,
  date_of_birth date,
  gender text check (gender in ('male', 'female', 'other', 'undisclosed')),
  -- Which class they are asking about. Nullable: plenty of first calls are
  -- "what do you charge", with the class settled later.
  class_level_id uuid,

  contact_name text not null,
  contact_phone text,
  contact_email text,
  relationship text,

  source text not null default 'walk_in'
    check (source in ('walk_in', 'phone', 'website', 'referral', 'advertisement', 'other')),
  -- The funnel. `lost` is a real outcome and the most useful one to record
  -- honestly -- a school that cannot say why it loses families cannot fix it.
  status text not null default 'new'
    check (status in ('new', 'contacted', 'visited', 'applied', 'admitted', 'lost')),

  assigned_staff_id uuid,
  next_follow_up_on date,
  lost_reason text,
  notes text,

  converted_student_id uuid,
  converted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, session_id, enquiry_number),

  -- The same shape as `exams_published_chk`: a status and the evidence for it
  -- kept in step by a constraint, so no code path can claim one without the
  -- other. An admitted enquiry has a student; anything else has not.
  constraint enquiries_admitted_chk check (
    (status = 'admitted') = (converted_student_id is not null)
  ),
  constraint enquiries_converted_at_chk check (
    (converted_student_id is not null) = (converted_at is not null)
  ),
  -- A loss that does not say why is a loss nobody can learn from.
  constraint enquiries_lost_chk check (
    (status = 'lost') = (lost_reason is not null and btrim(lost_reason) <> '')
  ),

  constraint enquiries_class_level_fkey
    foreign key (tenant_id, class_level_id)
    references public.class_levels (tenant_id, id) on delete set null,
  constraint enquiries_assigned_fkey
    foreign key (tenant_id, assigned_staff_id)
    references public.staff (tenant_id, id) on delete set null,
  constraint enquiries_student_fkey
    foreign key (tenant_id, converted_student_id)
    references public.students (tenant_id, id) on delete set null
);

alter table public.enquiries add constraint enquiries_tenant_id_key unique (tenant_id, id);

-- One enquiry per admitted student. Converting twice would show the same child
-- in the funnel twice and double every intake count the school reports.
create unique index enquiries_one_per_student
  on public.enquiries (tenant_id, converted_student_id)
  where converted_student_id is not null;

create index enquiries_tenant_idx on public.enquiries (tenant_id);
create index enquiries_session_idx on public.enquiries (tenant_id, session_id, status);
create index enquiries_assigned_idx on public.enquiries (tenant_id, assigned_staff_id);
create index enquiries_class_idx on public.enquiries (tenant_id, class_level_id);
-- The query the front office actually runs every morning.
create index enquiries_follow_up_idx
  on public.enquiries (tenant_id, next_follow_up_on)
  where status in ('new', 'contacted', 'visited', 'applied');

create trigger set_updated_at before update on public.enquiries
  for each row execute function public.set_updated_at();
create trigger audit_enquiries
  after insert or update or delete on public.enquiries
  for each row execute function public.audit_row_change();

alter table public.enquiries enable row level security;

-- Deliberately narrow: an enquiry holds a child's date of birth and a family's
-- phone number before either has any relationship with the school. Teachers,
-- students and parents have no business in it.
create policy "office views enquiries" on public.enquiries
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "office manages enquiries" on public.enquiries
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

comment on table public.enquiries is
  'The admissions funnel. Not a `people` row: a name on a pad is not yet somebody this school holds records about. It becomes one at admission, through enquiry_convert.';

-- ---------------------------------------------------------------------------
-- Follow-ups
-- ---------------------------------------------------------------------------

-- What was said, and when. Append-only in spirit and in policy: the value of a
-- follow-up log is that it cannot be tidied afterwards, which is exactly the
-- reasoning behind `ledger_entries`.
create table public.enquiry_follow_ups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  enquiry_id uuid not null,
  happened_at timestamptz not null default now(),
  channel text not null default 'phone'
    check (channel in ('phone', 'email', 'sms', 'visit', 'other')),
  note text not null,
  -- What the enquiry became as a result. Recorded on the follow-up as well as
  -- on the enquiry, so the history reads without joining to an audit log.
  outcome text
    check (outcome is null or outcome in ('contacted', 'visited', 'applied', 'admitted', 'lost')),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint enquiry_follow_ups_note_chk check (length(btrim(note)) between 1 and 2000),

  constraint enquiry_follow_ups_enquiry_fkey
    foreign key (tenant_id, enquiry_id)
    references public.enquiries (tenant_id, id) on delete cascade
);

create index enquiry_follow_ups_tenant_idx on public.enquiry_follow_ups (tenant_id);
create index enquiry_follow_ups_enquiry_idx
  on public.enquiry_follow_ups (tenant_id, enquiry_id, happened_at desc);
create index enquiry_follow_ups_author_idx on public.enquiry_follow_ups (recorded_by);

create trigger audit_enquiry_follow_ups
  after insert or update or delete on public.enquiry_follow_ups
  for each row execute function public.audit_row_change();

alter table public.enquiry_follow_ups enable row level security;

create policy "office views enquiry_follow_ups" on public.enquiry_follow_ups
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "office adds enquiry_follow_ups" on public.enquiry_follow_ups
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

-- No UPDATE or DELETE policy for anybody, deliberately. A call log that can be
-- edited afterwards is not evidence of anything -- same reasoning as
-- `ledger_entries`, and the absence is the mechanism.
comment on table public.enquiry_follow_ups is
  'What was said and when. No UPDATE or DELETE policy exists for any role: a call log that can be tidied afterwards is not a record of what happened.';

-- ---------------------------------------------------------------------------
-- The gate register
-- ---------------------------------------------------------------------------

create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  pass_number text not null,

  visitor_name text not null,
  phone text,
  organisation text,
  purpose text not null,

  -- Who they are here to see. Either a member of staff, or a free-text name for
  -- the many visitors who ask for "the principal" without a record to point at.
  host_staff_id uuid,
  host_note text,
  -- Or a child, for the far more common case: a parent collecting somebody.
  student_id uuid,

  id_proof_kind text,
  -- Deliberately the last four digits only. A photocopy of somebody's identity
  -- document at a school gate is a liability, not a security measure.
  id_proof_last4 text check (id_proof_last4 is null or id_proof_last4 ~ '^[0-9A-Za-z]{4}$'),
  vehicle_number text,

  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  checked_in_by uuid references auth.users(id) on delete set null,
  checked_out_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, session_id, pass_number),

  constraint visitors_out_after_in_chk
    check (checked_out_at is null or checked_out_at >= checked_in_at),
  constraint visitors_checked_out_by_chk
    check ((checked_out_at is null) = (checked_out_by is null)),
  constraint visitors_purpose_chk check (length(btrim(purpose)) between 1 and 300),

  constraint visitors_host_fkey
    foreign key (tenant_id, host_staff_id)
    references public.staff (tenant_id, id) on delete set null,
  constraint visitors_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete set null
);

-- **One open visit per phone number.** A gate register whose whole purpose is
-- answering "who is in the building" is worthless if the same person is signed
-- in three times because nobody signed them out. Partial, so the same visitor
-- can return tomorrow.
create unique index visitors_one_open_visit
  on public.visitors (tenant_id, phone)
  where checked_out_at is null and phone is not null;

create index visitors_tenant_idx on public.visitors (tenant_id);
create index visitors_session_idx on public.visitors (tenant_id, session_id, checked_in_at desc);
create index visitors_open_idx
  on public.visitors (tenant_id, checked_in_at desc) where checked_out_at is null;
create index visitors_host_idx on public.visitors (tenant_id, host_staff_id);
create index visitors_student_idx on public.visitors (tenant_id, student_id);

create trigger set_updated_at before update on public.visitors
  for each row execute function public.set_updated_at();
create trigger audit_visitors
  after insert or update or delete on public.visitors
  for each row execute function public.audit_row_change();

alter table public.visitors enable row level security;

create policy "office views visitors" on public.visitors
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

create policy "office manages visitors" on public.visitors
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant')
  );

comment on column public.visitors.id_proof_last4 is
  'The last four characters of an identity document, never the whole number and never a scan. A photocopy of somebody''s ID at a school gate is a liability, not a security measure.';
