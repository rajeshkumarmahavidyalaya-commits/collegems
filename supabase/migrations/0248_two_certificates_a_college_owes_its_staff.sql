-- 0248 -- Two certificates a college owes its staff.
--
-- The wording, and the critic that stops the two snapshots drifting.
--
-- ## Only what the database is guaranteed to have
--
-- Rule 12: *a seeded default may only use values the database is guaranteed to
-- have.* Four `staff` columns are `not null` — `employee_code`, `designation`,
-- `date_of_joining`, `status` — and `department`, `date_of_leaving` and
-- `exit_reason` are not. So the shipped wording prints the first four and the
-- school's own name, and nothing else.
--
-- **The split between the two falls out of that nullability rather than being
-- invented:**
--
-- | | prints | for |
-- |---|---|---|
-- | Service Certificate | `{{service.from}}`, `{{service.length}}` | somebody still in post — issues today |
-- | Experience Certificate | those **and `{{service.to}}`** | somebody who has left |
--
-- An experience certificate asked for while the person is still employed leaves
-- `{{service.to}}` standing, so the preview names it and issuing refuses — and
-- a second, plainer sentence says why and points at the other template. That is
-- the engine's own mechanism doing the work; no new rule was needed.
--
-- Probed live as the college's administrator, 20 Sep 2026:
--
--     service    can_issue = true
--                "Rajesh Kumar, Employee Number EMP-001, has been serving at
--                 Rajesh Kumar Mahavidyalaya as Principal / System Administrator
--                 since 1 Jun 2015, a period of 11 years, 3 months…"
--     experience can_issue = false
--                error:   Nothing filled {{service.to}}.
--                warning: This person is still employed here… A service
--                         certificate is the one for somebody still in post.
--
-- ## …and a critic for the copy this work deliberately left in place
--
-- `0246` made `certificate_school_values()` the definition and had the staff
-- snapshot call it. `certificate_snapshot` still builds its own school block:
-- rewriting a function that renders documents families keep is a probe of it,
-- not a tidy-up, and this session could not run the database suites.
--
-- A copy that agrees costs nothing until the day one of them changes —
-- `library.fine_per_day`'s lesson — so the two are compared instead of merged.
-- The next migration that has to touch `certificate_snapshot` for its own
-- reasons should collapse them and delete this check.

begin;

insert into public.certificate_templates
  (tenant_id, kind, subject, name, body, fields, is_active, is_default)
select
  t.id, 'service', 'staff', 'Service Certificate',
  'This is to certify that {{staff.name}}, Employee Number {{staff.employee_code}}, '
  || 'has been serving at {{school.name}} as {{staff.designation}} since '
  || '{{service.from}}, a period of {{service.length}}, and remains in service on '
  || 'the date of this certificate.' || E'\n\n'
  || 'This certificate is issued on request.' || E'\n\n'
  || 'Certificate No. {{serial}}, issued on {{date.issued}}.',
  '[]'::jsonb, true, true
from public.tenants t
where not exists (
  select 1 from public.certificate_templates x
  where x.tenant_id = t.id and x.kind = 'service' and x.subject = 'staff'
);

insert into public.certificate_templates
  (tenant_id, kind, subject, name, body, fields, is_active, is_default)
select
  t.id, 'experience', 'staff', 'Experience Certificate',
  'This is to certify that {{staff.name}}, Employee Number {{staff.employee_code}}, '
  || 'served at {{school.name}} as {{staff.designation}} from {{service.from}} to '
  || '{{service.to}}, a period of {{service.length}}.' || E'\n\n'
  || 'During this period their conduct and discharge of duties were found '
  || 'satisfactory. We wish them well in their future endeavours.' || E'\n\n'
  || 'Certificate No. {{serial}}, issued on {{date.issued}}.',
  '[]'::jsonb, true, true
from public.tenants t
where not exists (
  select 1 from public.certificate_templates x
  where x.tenant_id = t.id and x.kind = 'experience' and x.subject = 'staff'
);

create or replace function public.certificate_school_values_problems()
returns table (severity text, message text)
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_student uuid;
  v_staff uuid;
  v_a jsonb;
  v_b jsonb;
  v_key text;
begin
  if v_tenant is null then
    return;
  end if;

  select id into v_student from public.students limit 1;
  select id into v_staff from public.staff limit 1;
  if v_student is null or v_staff is null then
    return;
  end if;

  v_a := public.certificate_snapshot(v_student);
  v_b := public.certificate_staff_snapshot(v_staff);

  foreach v_key in array array['school.name','school.address','school.city',
                               'school.state','school.phone','school.email',
                               'school.website']
  loop
    if (v_a ->> v_key) is distinct from (v_b ->> v_key) then
      return query select 'error'::text, format(
        'A student certificate and a staff certificate would print different '
        'values for %s -- "%s" against "%s". The two snapshots have drifted; '
        'certificate_school_values() is meant to be the only definition.',
        v_key, coalesce(v_a ->> v_key, '(none)'), coalesce(v_b ->> v_key, '(none)'));
    end if;
  end loop;

  return;
end;
$$;

comment on function public.certificate_school_values_problems() is
  'certificate_snapshot still builds its own school.* block rather than calling '
  'certificate_school_values(). Rewriting a function that renders documents '
  'families keep is a probe, not a tidy-up, so the copy stays and this compares '
  'the two instead. The next migration that has to touch certificate_snapshot '
  'for its own reasons should collapse them and delete this.';

revoke all on function public.certificate_school_values_problems() from public, anon;
grant execute on function public.certificate_school_values_problems() to authenticated;

insert into reference.checks
  (key, label, description, function_name, shape, module, href, required_permission, sort)
values (
  'certificates.school_values',
  'Certificates agree about the college',
  'Compares the school.* values a student certificate would print against the '
  'ones a staff certificate would. They come from two pieces of code today, and '
  'a college that printed two different addresses on two documents issued the '
  'same morning would find out from whoever received them.',
  'certificate_school_values_problems',
  'severity_message',
  'Certificates',
  '/certificates',
  'certificates.issue',
  260
)
on conflict (key) do nothing;

commit;
