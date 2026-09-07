-- ---------------------------------------------------------------------------
-- Certificates — the documents a school hands over and cannot take back
-- ---------------------------------------------------------------------------
--
-- A transfer certificate, a bonafide, a character certificate. Every school in
-- the country issues them constantly, a leaving certificate is a legal record
-- rather than a printout, and the whole module turns on one sentence that this
-- codebase has already written twice:
--
--   **Anything printed on a document a person keeps is frozen when the document
--   is made.**
--
-- `exam_results.rules_snapshot` said it for a report card, and the attendance
-- line on that card said it again after a reprint in December disagreed with
-- the card handed out in March. A transfer certificate is the sharpest case
-- there is: the child has left, their enrolment is over, next year the class
-- they were in has different children in it — and somebody will ask for a
-- duplicate in 2034. So `certificates.snapshot` holds every value that was
-- printed, and `certificates.body` holds the rendered text. **A reprint reads
-- the row; it never recomputes.**
--
-- WHY THE TEMPLATE IS DATA (rule 12)
--
-- CBSE, ICSE and a dozen state boards each prescribe a different leaving
-- certificate, and several prescribe the exact wording. Hardcoding the first
-- school's is the single most common way a product like this fails its second
-- customer, so the wording is a row with `{{placeholders}}` in it and the
-- engine fills them from a snapshot it assembles.
--
-- WHAT IS DELIBERATELY *NOT* HERE
--
-- No PDF. Certificates print through the same `data-print` CSS the report
-- cards use, because a school wants it on their own letterhead in their own
-- printer tray. PDF rendering is still rule 7's `jobs` work and is still not
-- built.

-- ---------------------------------------------------------------------------
-- A certificate number is a gapless serial, and adding a kind is one ALTER
-- ---------------------------------------------------------------------------
--
-- Per the convention migration 0101 established: `document_sequences_kind_check`
-- *is* the list of document kinds, and `fees_next_document_number_for` consults
-- the constraint rather than carrying its own copy. So this is the entire
-- change needed to give certificates gapless per-tenant-per-session numbers.

alter table public.document_sequences
  drop constraint document_sequences_kind_check;

alter table public.document_sequences
  add constraint document_sequences_kind_check
  check (kind = any (array[
    'receipt', 'invoice', 'voucher', 'enquiry', 'visitor_pass', 'certificate'
  ]));

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create table public.certificate_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- `kind` is not decoration: it is what makes a transfer certificate behave
  -- differently from a bonafide (see `certificates` below). `custom` is the
  -- escape hatch for the sports certificate nobody anticipated, and it
  -- deliberately carries none of the transfer rules.
  kind text not null check (kind in (
    'transfer', 'bonafide', 'character', 'study', 'conduct', 'custom'
  )),
  name text not null,

  -- The wording, with `{{placeholders}}`. Free text on purpose — a school's
  -- board tells it what the sentence must say, and no schema of ours should
  -- have an opinion about that.
  body text not null,

  -- Extra values the *issuer* must supply because the database cannot know
  -- them: the reason for leaving, a conduct grade, the name of the school the
  -- child is going to. Shape: [{"name":"reason","label":"Reason for leaving",
  -- "required":true}]. Rules-as-data, so a board that wants three more boxes
  -- is a row rather than a release.
  fields jsonb not null default '[]'::jsonb,

  is_active boolean not null default true,
  is_default boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  unique (tenant_id, name)
);

alter table public.certificate_templates
  add constraint certificate_templates_tenant_id_key unique (tenant_id, id);

create index certificate_templates_tenant_idx on public.certificate_templates (tenant_id, kind);

-- One default per kind, so "issue a bonafide" has an unambiguous answer. Partial
-- so that the other templates of that kind are unconstrained, and dropping the
-- default simply leaves the kind without one rather than blocking the update.
create unique index certificate_templates_one_default
  on public.certificate_templates (tenant_id, kind)
  where is_default;

create trigger set_updated_at before update on public.certificate_templates
  for each row execute function public.set_updated_at();
create trigger audit_certificate_templates
  after insert or update or delete on public.certificate_templates
  for each row execute function public.audit_row_change();

alter table public.certificate_templates enable row level security;

create policy "tenant members view certificate_templates" on public.certificate_templates
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "admins manage certificate_templates" on public.certificate_templates
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
-- Issued certificates
-- ---------------------------------------------------------------------------

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Session-scoped per rule 2 — "how many leaving certificates did we issue
  -- last year" is always asked about a year — even though the certificate
  -- itself outlives every session.
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  student_id uuid not null,

  -- The template is remembered but the certificate does not depend on it:
  -- `on delete set null`, because deleting a template must never be able to
  -- alter, orphan or blank a document somebody is holding. `kind` and `body`
  -- are copied down for the same reason.
  template_id uuid,
  template_name text not null,
  kind text not null check (kind in (
    'transfer', 'bonafide', 'character', 'study', 'conduct', 'custom'
  )),

  serial_no text not null,
  issued_on date not null,
  issued_by uuid,

  -- Everything that was printed, frozen. See the header.
  snapshot jsonb not null,
  body text not null,

  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, serial_no),

  constraint certificates_student_fkey
    foreign key (tenant_id, student_id)
    references public.students (tenant_id, id) on delete cascade,
  constraint certificates_template_fkey
    foreign key (tenant_id, template_id)
    references public.certificate_templates (tenant_id, id) on delete set null,

  -- A cancellation is a fact with three parts and they arrive together. Half a
  -- cancellation — a status with no reason, a reason with no timestamp — is a
  -- row nobody can audit.
  constraint certificates_cancellation_complete check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (cancelled_at is null) = (cancel_reason is null)
  )
);

alter table public.certificates
  add constraint certificates_tenant_id_key unique (tenant_id, id);

create index certificates_tenant_idx on public.certificates (tenant_id, issued_on desc);
create index certificates_student_idx on public.certificates (tenant_id, student_id);
create index certificates_session_idx on public.certificates (tenant_id, session_id);

-- **One live transfer certificate per student.** A child leaves once. Two live
-- TCs with different serials is a school that cannot say which one is real, and
-- the second is usually issued because the first was mislaid — so the rule is
-- not "never twice" but "cancel the first". Partial on `issued`, so cancelling
-- reopens it, and partial on `transfer`, because a child may hold any number of
-- bonafides.
create unique index certificates_one_live_transfer
  on public.certificates (tenant_id, student_id)
  where kind = 'transfer' and status = 'issued';

create trigger set_updated_at before update on public.certificates
  for each row execute function public.set_updated_at();
create trigger audit_certificates
  after insert or update or delete on public.certificates
  for each row execute function public.audit_row_change();

alter table public.certificates enable row level security;

-- Staff read every certificate the tenant has issued; a family reads their own.
-- The narrow policies are separate rather than one `or`-ed condition so that
-- each is legible on its own, which is what `\d+` prints.
create policy "staff view certificates" on public.certificates
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'teacher', 'accountant', 'librarian')
  );

create policy "students view their own certificates" on public.certificates
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and student_id in (
      select up.student_id from public.user_profiles up
      where up.id = ( select auth.uid() ) and up.student_id is not null
    )
  );

create policy "guardians view their children's certificates" on public.certificates
  for select to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and student_id in (
      select gs.student_id
      from public.guardian_student gs
      join public.user_profiles up on up.guardian_id = gs.guardian_id
      where up.id = ( select auth.uid() )
    )
  );

create policy "admins issue certificates" on public.certificates
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

-- **Cancelling is the only update there is**, and this is the
-- `notification_deliveries` shape from CLAUDE.md rule 4, not the
-- `homework_submissions` one: exactly one party (an administrator) has an
-- UPDATE policy at all, so a role-wide column GRANT narrowing what *everybody*
-- may write narrows precisely the right thing. Nobody — administrator included
-- — can rewrite `body`, `snapshot`, `serial_no` or `issued_on` after the fact,
-- which is what makes a certificate a record rather than a draft.
--
-- DELETE is revoked outright. A cancelled certificate keeps its serial: a
-- gapless sequence with a hole in it is a sequence nobody can audit, and "why
-- is there no 0043" is a question a school should never have to answer.
create policy "admins cancel certificates" on public.certificates
  for update to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) = 'admin'
  );

revoke update, delete on public.certificates from authenticated, anon;
grant update (status, cancelled_at, cancelled_by, cancel_reason)
  on public.certificates to authenticated;

comment on table public.certificates is
  'Issued certificates. `snapshot` and `body` are frozen at issue and never '
  'recomputed -- a duplicate printed in ten years is the same document. '
  'UPDATE is granted on the four cancellation columns only and DELETE is '
  'revoked, so a serial is never reused and never disappears.';
