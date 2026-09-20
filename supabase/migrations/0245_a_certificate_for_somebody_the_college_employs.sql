-- 0245 -- A certificate for somebody the college employs.
--
-- `certificates.student_id` is `not null`, so the whole frozen-document engine
-- — the gapless serial, *preview computes; issue freezes*, the column grant
-- that stops anybody rewriting what a certificate says, and the PDF renderer
-- `0244` gave it — is **structurally student-only**.
--
-- Measured: **0** mentions of an experience, relieving, service or salary
-- certificate anywhere in `src/` or the migrations. `staff_exit` ends a
-- person's employment, writes the date and the reason, and hands them nothing.
-- A lecturer leaving a college in India needs an experience certificate to be
-- hired anywhere else.
--
-- ## One table, not two
--
-- The tempting shape is `staff_certificates`, and it would be a second gapless
-- counter, a second immutability grant, a second cancel path and a second PDF
-- route — four copies of a document engine to serve a second kind of person.
-- So this is the `invitations` shape instead (`0224`): **one row, a nullable
-- column per kind of subject, and a discriminator** saying which one is filled.
--
-- ## The discriminator is rule 4's carried column, and it stops a real mistake
--
-- > A transfer certificate cannot be issued to a member of staff, and an
-- > experience certificate cannot be issued to a seven-year-old.
--
-- `certificate_templates.subject` says who a template is written for;
-- `certificates.subject` carries it, held equal by a composite foreign key onto
-- `(tenant_id, id, subject)`; and a CHECK makes the key unsatisfiable unless the
-- matching id is the one that is filled in. The trigger populates, the key and
-- the CHECK enforce — `0225`'s split, because a caller looking the subject up
-- is the second copy the device exists to avoid.
--
-- **Deliberately no `on update cascade`**, which is the opposite of every other
-- use of this device here, and rule 4's second boundary says why: a certificate
-- is *a record of a day*, not a child kept in step with its parent. Cascading a
-- template's subject from `student` to `staff` would rewrite documents already
-- handed over. Without it the template edit is **refused** while certificates
-- exist against it — which is the correct answer, and recoverable by retiring
-- the template and writing a new one.
--
-- ## …and the policy is the part that would have leaked
--
-- `staff view certificates` reads:
--
--     current_role_code() = any (array['admin','teacher','accountant','librarian'])
--
-- Tenant-wide, no row ownership. That is a defensible choice for a child's
-- bonafide certificate and it is **the wrong one the instant a staff
-- certificate exists**: it would hand every teacher, every accountant and
-- every librarian their colleagues' experience certificates — which name why
-- somebody left.
--
-- This codebase has already learned this exact lesson once, on this exact
-- table's neighbour: `0009`'s *"staff directory is not sensitive HR data"* was
-- a claim about three columns made by a policy that grants whole rows. So the
-- policy is narrowed to `subject = 'student'` here, before there is anything to
-- leak, and staff certificates get row ownership:
--
--   * an administrator sees all of them;
--   * a member of staff sees **their own**;
--   * everybody else sees none — including the other three staff roles.
--
-- The guardian and student policies need no change: both filter on
-- `student_id`, which is null on a staff certificate, and `null in (...)` is
-- null rather than true.

begin;

-- ---------------------------------------------------------------------------
-- Who a template is written for
-- ---------------------------------------------------------------------------

alter table public.certificate_templates
  add column if not exists subject text not null default 'student';

alter table public.certificate_templates
  drop constraint if exists certificate_templates_subject_check;
alter table public.certificate_templates
  add constraint certificate_templates_subject_check
  check (subject in ('student', 'staff'));

comment on column public.certificate_templates.subject is
  'Who this template is written for. It decides which snapshot fills it and '
  'which id a certificate issued against it must carry -- never what anybody '
  'may do, which is role_permissions.';

-- The parent side of rule 4's composite key.
alter table public.certificate_templates
  drop constraint if exists certificate_templates_subject_key;
alter table public.certificate_templates
  add constraint certificate_templates_subject_key unique (tenant_id, id, subject);

-- A template for staff can say things a student template cannot.
alter table public.certificate_templates
  drop constraint if exists certificate_templates_kind_check;
alter table public.certificate_templates
  add constraint certificate_templates_kind_check
  check (kind in ('transfer', 'bonafide', 'character', 'study', 'conduct',
                  'experience', 'service', 'custom'));

-- ---------------------------------------------------------------------------
-- A certificate's subject
-- ---------------------------------------------------------------------------

alter table public.certificates
  alter column student_id drop not null;

alter table public.certificates
  add column if not exists staff_id uuid,
  add column if not exists subject text not null default 'student';

alter table public.certificates
  drop constraint if exists certificates_staff_fkey;
alter table public.certificates
  add constraint certificates_staff_fkey
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id)
  on delete cascade;

alter table public.certificates
  drop constraint if exists certificates_kind_check;
alter table public.certificates
  add constraint certificates_kind_check
  check (kind in ('transfer', 'bonafide', 'character', 'study', 'conduct',
                  'experience', 'service', 'custom'));

-- **Exactly one subject, and it is the one the discriminator names.** Without
-- the second half a staff certificate could carry a student id and print a
-- child's name under a template about employment.
alter table public.certificates
  drop constraint if exists certificates_one_subject;
alter table public.certificates
  add constraint certificates_one_subject check (
    (subject = 'student' and student_id is not null and staff_id is null)
    or
    (subject = 'staff' and staff_id is not null and student_id is null)
  );

-- The child side of the composite key. MATCH SIMPLE, so it is skipped entirely
-- when `template_id` is null -- which happens by design, because the template
-- foreign key is `on delete set null` and a certificate outlives the template
-- it was written from.
--
-- No cascade: see the header. A record of a day is not kept in step.
alter table public.certificates
  drop constraint if exists certificates_template_subject_fkey;
alter table public.certificates
  add constraint certificates_template_subject_fkey
  foreign key (tenant_id, template_id, subject)
  references public.certificate_templates (tenant_id, id, subject);

comment on column public.certificates.subject is
  'Which kind of person this certificate is about, carried from its template '
  'and held equal to it by certificates_template_subject_fkey. The CHECK '
  'beside it makes the key unsatisfiable unless the matching id is filled.';

-- ---------------------------------------------------------------------------
-- The trigger populates; the key and the CHECK enforce
-- ---------------------------------------------------------------------------

-- `0225`'s lesson, verbatim: a carried column is a copy, and a copy needs
-- somebody to write it. Every caller looking the template's subject up is the
-- second copy the device exists to avoid -- and a plain insert through
-- PostgREST routes around any function, so it cannot live in `certificate_issue`.
--
-- Drop this trigger and writes **fail** rather than admitting a wrong value,
-- which is what keeps it inside rule 4 rather than an exception to it.
create or replace function public.certificates_stamp_subject()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.template_id is not null then
    select t.subject into new.subject
    from public.certificate_templates t
    where t.id = new.template_id and t.tenant_id = new.tenant_id;
  end if;

  -- A certificate with no template (the template was retired and the foreign
  -- key set it null) still has to say what it is about, and the ids are the
  -- only evidence left.
  if new.subject is null then
    new.subject := case when new.staff_id is not null then 'staff' else 'student' end;
  end if;

  return new;
end;
$$;

drop trigger if exists certificates_stamp_subject on public.certificates;
create trigger certificates_stamp_subject
  before insert on public.certificates
  for each row execute function public.certificates_stamp_subject();

-- ---------------------------------------------------------------------------
-- The policies
-- ---------------------------------------------------------------------------

-- Narrowed to students. See the header: tenant-wide was defensible for a
-- child's bonafide certificate and is not for a colleague's experience one.
drop policy if exists "staff view certificates" on public.certificates;
create policy "staff view student certificates" on public.certificates
  for select using (
    tenant_id = (select public.current_tenant_id())
    and subject = 'student'
    and (select public.current_role_code()) in ('admin', 'teacher', 'accountant', 'librarian')
  );

drop policy if exists "admins view staff certificates" on public.certificates;
create policy "admins view staff certificates" on public.certificates
  for select using (
    tenant_id = (select public.current_tenant_id())
    and subject = 'staff'
    and (select public.current_role_code()) = 'admin'
  );

-- Row ownership, the same shape `homework_submissions` and `devices` use: the
-- person the document is about may read it, and nobody else on the payroll can.
drop policy if exists "staff view their own certificates" on public.certificates;
create policy "staff view their own certificates" on public.certificates
  for select using (
    tenant_id = (select public.current_tenant_id())
    and subject = 'staff'
    and staff_id in (
      select up.staff_id from public.user_profiles up
      where up.id = (select auth.uid()) and up.staff_id is not null
    )
  );

comment on table public.certificates is
  'Issued documents, frozen at issue and immutable in what they say. One row '
  'per document whether it is about a student or a member of staff; `subject` '
  'says which, and the read policies differ -- a student certificate is '
  'readable by any staff role, a staff certificate by an administrator and by '
  'the person it is about.';

commit;
