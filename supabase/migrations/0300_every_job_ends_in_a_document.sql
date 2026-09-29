-- 0300: every job ends in a document.
--
-- The eSkooly comparison's first finding: admitting a child, hiring somebody
-- and paying them each end, there, in a piece of paper -- an admission letter,
-- a job letter, a salary slip -- and here they ended in a toast. Three
-- documents, built on the engines that already exist, and two defects the
-- building found.
--
-- ## 1. Two letters, as certificate templates
--
-- The certificate engine already does everything a letter needs: wording as
-- data, a gapless serial, a frozen body, a PDF. So an admission letter is a
-- template with `subject = 'student'` and an appointment letter one with
-- `subject = 'staff'`, and neither needed a line of engine code. Both print
-- only values the database is guaranteed to have for the person they are
-- about (rule 12's seeded-default rule): a child with no class leaves
-- {{class.label}} standing and the preview names it, which is the right answer
-- -- an admission letter that says no class is not an admission letter.
--
-- `certificates.kind` and `certificate_templates.kind` gain 'admission' and
-- 'appointment'. The CHECK is the list (migration 0101), so that is the whole
-- change to the list.
--
-- ## 2. A college founded today had no certificates at all
--
-- Every template ever shipped was written as `insert ... select from tenants
-- where not exists`, which reaches every college that exists when the
-- migration runs and no college founded afterwards. `platform_start_school`
-- never mentions certificate_templates, and there is no template editor
-- (`NOT_YET_A_CONTROL` says so), so a college that signed up after 0248 could
-- issue no certificate of any kind -- not a transfer certificate, not a
-- bonafide -- and could do nothing about it.
--
-- 0269 met the same shape for the permission matrix and wrote the rule down:
-- *a default written as a literal list inside a function is a default nobody
-- updates.* Here the default was not even inside the function. So the shipped
-- wording is data, `reference.certificate_template_defaults`, and an AFTER
-- INSERT trigger on `tenants` copies it into every new college. The seven rows
-- are the five templates both existing colleges hold today -- read back from
-- the live rows, which no person has ever edited (0 audited updates) -- plus
-- the two letters. Existing colleges receive only the two letters.
--
-- ## 3. A payslip did not know its own month
--
-- Probed as the demo college's teacher, who has two finalised payslips: the
-- policies let them read both slips and all 12 lines, and **0 payroll runs**,
-- because `payroll_runs` is readable by admin and accountant alone. The month
-- lives on the run, so "My pay" listed two salaries against a blank month, and
-- a salary slip -- a document whose first line is the month -- could not be
-- printed for the person it is about.
--
-- Opening the run to its staff is the wrong fix, and the row says why:
-- `rules_snapshot` is every salary structure in the college, and a policy
-- grants whole rows on the way out (rule 4). So the month is carried on the
-- payslip instead, by the composite-key device beside the status it already
-- carries: (tenant_id, run_id, run_status, period_month) onto payroll_runs.
-- A BEFORE INSERT trigger populates it, because the three payroll functions
-- that insert payslips do not know it and a plain insert routes around any
-- function (0225's split: the trigger populates, the key enforces).

begin;

-- ---------------------------------------------------------------------------
-- 1. The two new kinds
-- ---------------------------------------------------------------------------

alter table public.certificate_templates drop constraint certificate_templates_kind_check;
alter table public.certificate_templates add constraint certificate_templates_kind_check
  check (kind = any (array['transfer', 'bonafide', 'character', 'study', 'conduct',
                           'experience', 'service', 'admission', 'appointment', 'custom']));

alter table public.certificates drop constraint certificates_kind_check;
alter table public.certificates add constraint certificates_kind_check
  check (kind = any (array['transfer', 'bonafide', 'character', 'study', 'conduct',
                           'experience', 'service', 'admission', 'appointment', 'custom']));

-- ---------------------------------------------------------------------------
-- 2. The shipped wording, as data
-- ---------------------------------------------------------------------------

create table reference.certificate_template_defaults (
  kind     text not null,
  subject  text not null check (subject in ('student', 'staff')),
  name     text not null unique,
  body     text not null,
  fields   jsonb not null default '[]'::jsonb,
  sort     integer not null,
  primary key (subject, kind)
);

comment on table reference.certificate_template_defaults is
  'The certificate wording the product ships. An AFTER INSERT trigger on '
  'tenants copies it into every new college (0300); a college edits its own '
  'copy, never this. Outside public because it belongs to no tenant.';

revoke all on reference.certificate_template_defaults from public, anon, authenticated;
grant select on reference.certificate_template_defaults to authenticated;

insert into reference.certificate_template_defaults (kind, subject, name, body, fields, sort) values
(
  'transfer', 'student', 'Transfer Certificate',
  'This is to certify that {{student.name}}, son/daughter of {{student.father_name}} and {{student.mother_name}}, bearing Admission Number {{student.admission_number}}, was a bona fide student of {{school.name}}.' || E'\n\n'
  || 'Date of birth (as recorded)      : {{student.date_of_birth}}' || E'\n'
  || 'Date of admission                : {{admission.date}}' || E'\n'
  || 'Class in which last studied      : {{class.label}}' || E'\n'
  || 'Academic session                 : {{session.name}}' || E'\n'
  || 'Attendance in the current session: {{attendance.percent}}%' || E'\n'
  || 'Result of the last examination   : {{result.outcome}}' || E'\n'
  || 'Conduct                          : {{conduct}}' || E'\n'
  || 'Reason for leaving               : {{reason}}' || E'\n\n'
  || 'No dues are pending against the student as at the date of issue except as stated separately by the office.' || E'\n\n'
  || 'Certificate No. {{serial}}' || E'\n'
  || 'Issued on {{date.issued}}.',
  '[{"name": "conduct", "label": "Conduct", "required": true}, {"name": "reason", "label": "Reason for leaving", "required": true}]',
  10
),
(
  'bonafide', 'student', 'Bonafide Certificate',
  'This is to certify that {{student.name}}, son/daughter of {{student.father_name}}, Admission Number {{student.admission_number}}, is a bona fide student of {{school.name}} and is studying in Class {{class.label}} during the academic session {{session.name}}.' || E'\n\n'
  || 'This certificate is issued on request for {{purpose}}.' || E'\n\n'
  || 'Certificate No. {{serial}}' || E'\n'
  || 'Issued on {{date.issued}}.',
  '[{"name": "purpose", "label": "Issued for the purpose of", "required": true}]',
  20
),
(
  'character', 'student', 'Character Certificate',
  'This is to certify that {{student.name}}, son/daughter of {{student.father_name}}, was a student of {{school.name}} in Class {{class.label}} during the academic session {{session.name}}.' || E'\n\n'
  || 'To the best of our knowledge his/her character and conduct during this period were {{conduct}}.' || E'\n\n'
  || 'We wish him/her success in all future endeavours.' || E'\n\n'
  || 'Certificate No. {{serial}}' || E'\n'
  || 'Issued on {{date.issued}}.',
  '[{"name": "conduct", "label": "Character and conduct", "required": true}]',
  30
),
(
  'admission', 'student', 'Admission Letter',
  'This is to confirm that {{student.name}} has been admitted to {{school.name}} in {{class.label}} for the academic session {{session.name}}, with effect from {{admission.date}}.' || E'\n\n'
  || 'Admission Number: {{student.admission_number}}' || E'\n\n'
  || 'Please keep this letter. The admission number above appears on every fee receipt, report card and certificate the school issues, and the office will ask for it.' || E'\n\n'
  || 'Letter No. {{serial}}, issued on {{date.issued}}.',
  '[]',
  5
),
(
  'appointment', 'staff', 'Appointment Letter',
  'Dear {{staff.name}},' || E'\n\n'
  || 'We are pleased to confirm your appointment as {{staff.designation}} at {{school.name}}, with effect from {{service.from}}.' || E'\n\n'
  || 'Your employee number is {{staff.employee_code}}. Please quote it in all correspondence with the office; it also appears on your salary slips and your identity card.' || E'\n\n'
  || 'Your terms of service, including your salary, are as agreed with the management and recorded in the staff register.' || E'\n\n'
  || 'Letter No. {{serial}}, issued on {{date.issued}}.',
  '[]',
  40
),
(
  'service', 'staff', 'Service Certificate',
  'This is to certify that {{staff.name}}, Employee Number {{staff.employee_code}}, has been serving at {{school.name}} as {{staff.designation}} since {{service.from}}, a period of {{service.length}}, and remains in service on the date of this certificate.' || E'\n\n'
  || 'This certificate is issued on request.' || E'\n\n'
  || 'Certificate No. {{serial}}, issued on {{date.issued}}.',
  '[]',
  50
),
(
  'experience', 'staff', 'Experience Certificate',
  'This is to certify that {{staff.name}}, Employee Number {{staff.employee_code}}, served at {{school.name}} as {{staff.designation}} from {{service.from}} to {{service.to}}, a period of {{service.length}}.' || E'\n\n'
  || 'During this period their conduct and discharge of duties were found satisfactory. We wish them well in their future endeavours.' || E'\n\n'
  || 'Certificate No. {{serial}}, issued on {{date.issued}}.',
  '[]',
  60
);

-- Copies every default the college does not already hold. "Already holds" is
-- by (kind, subject), or by name, since a college may have renamed or written
-- its own: a school's own wording is never overwritten or duplicated.
create or replace function public.certificate_seed_defaults(p_tenant_id uuid)
returns integer
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  insert into public.certificate_templates
    (tenant_id, kind, subject, name, body, fields, is_active, is_default)
  select p_tenant_id, d.kind, d.subject, d.name, d.body, d.fields, true, true
  from reference.certificate_template_defaults d
  where not exists (
    select 1 from public.certificate_templates x
    where x.tenant_id = p_tenant_id
      and ((x.kind = d.kind and x.subject = d.subject) or x.name = d.name)
  )
  order by d.sort;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.certificate_seed_defaults(uuid) is
  'Copies reference.certificate_template_defaults into one college, skipping '
  'any kind it already has. Called by the tenants insert trigger; not by people.';

revoke all on function public.certificate_seed_defaults(uuid) from public, anon, authenticated;

create or replace function public.tenants_seed_certificates()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform public.certificate_seed_defaults(new.id);
  return new;
end;
$$;

revoke all on function public.tenants_seed_certificates() from public, anon, authenticated;

create trigger tenants_seed_certificates
  after insert on public.tenants
  for each row execute function public.tenants_seed_certificates();

-- Existing colleges: only what they lack, which today is the two letters.
select public.certificate_seed_defaults(t.id) from public.tenants t;

-- ---------------------------------------------------------------------------
-- 3. A payslip carries its month
-- ---------------------------------------------------------------------------

alter table public.payslips add column period_month date;

update public.payslips p
set period_month = r.period_month
from public.payroll_runs r
where r.id = p.run_id and r.tenant_id = p.tenant_id;

alter table public.payslips alter column period_month set not null;

alter table public.payroll_runs
  add constraint payroll_runs_period_key unique (tenant_id, id, status, period_month);

alter table public.payslips drop constraint payslips_run_fkey;
alter table public.payslips add constraint payslips_run_fkey
  foreign key (tenant_id, run_id, run_status, period_month)
  references public.payroll_runs (tenant_id, id, status, period_month)
  on update cascade on delete cascade;

comment on column public.payslips.period_month is
  'The run''s month, carried by the composite key (0300) so the person the '
  'slip is about can read it: payroll_runs is not theirs to read, because its '
  'rules_snapshot is every salary structure in the college.';

-- The trigger populates; the key enforces. Whatever a caller sends is
-- replaced, so a slip cannot claim a month its run is not for.
create or replace function public.payslips_carry_period()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  select r.period_month into new.period_month
  from public.payroll_runs r
  where r.id = new.run_id and r.tenant_id = new.tenant_id;
  return new;
end;
$$;

revoke all on function public.payslips_carry_period() from public, anon, authenticated;

create trigger payslips_carry_period
  before insert on public.payslips
  for each row execute function public.payslips_carry_period();

commit;
