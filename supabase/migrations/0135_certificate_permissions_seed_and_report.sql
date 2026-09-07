-- ---------------------------------------------------------------------------
-- Certificates: permissions, three starting templates, and the register
-- ---------------------------------------------------------------------------
--
-- The templates seeded here are **a school's to edit, not ours to own.** They
-- exist so the module is usable on the first day rather than presenting an
-- empty screen and a syntax to guess, and every one of them is an ordinary row
-- an administrator can rewrite. That is the whole point of rule 12: the first
-- customer's wording must not be the product's wording.
--
-- Two deliberate absences in the seeded bodies:
--
--   * **No `{{student.address}}`**, because a school that has not filled in
--     addresses would find every certificate refused -- correctly, but
--     bafflingly, on day one.
--   * **No date of birth in words.** Several boards require it ("Two Thousand
--     and Fifteen") and a half-right implementation on a legal document is
--     worse than none, so it is not a placeholder. A school that needs it
--     declares a field and types it, which is exactly what `fields` is for.

insert into reference.permissions (code, module, ability, description) values
  ('certificates.view', 'certificates', 'view', 'View the certificate register and reprint a certificate'),
  ('certificates.issue', 'certificates', 'issue', 'Issue and cancel certificates'),
  ('certificates.manage', 'certificates', 'manage', 'Write and retire certificate templates')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('certificates.view'), ('certificates.issue'), ('certificates.manage')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

-- A class teacher looks certificates up; they do not issue them. The office does.
insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'certificates.view'
from public.roles r
where r.code in ('teacher', 'accountant')
on conflict (tenant_id, role_id, permission_code) do nothing;

-- ---------------------------------------------------------------------------
-- Three templates to start from
-- ---------------------------------------------------------------------------

insert into public.certificate_templates (tenant_id, kind, name, body, fields, is_default)
select
  t.id, 'transfer', 'Transfer Certificate',
$body$This is to certify that {{student.name}}, son/daughter of {{student.father_name}} and {{student.mother_name}}, bearing Admission Number {{student.admission_number}}, was a bona fide student of {{school.name}}.

Date of birth (as recorded)      : {{student.date_of_birth}}
Date of admission                : {{admission.date}}
Class in which last studied      : {{class.label}}
Academic session                 : {{session.name}}
Attendance in the current session: {{attendance.percent}}%
Result of the last examination   : {{result.outcome}}
Conduct                          : {{conduct}}
Reason for leaving               : {{reason}}

No dues are pending against the student as at the date of issue except as stated separately by the office.

Certificate No. {{serial}}
Issued at {{school.city}} on {{date.issued}}.$body$,
$fields$[
  {"name":"conduct","label":"Conduct","required":true},
  {"name":"reason","label":"Reason for leaving","required":true}
]$fields$::jsonb,
  true
from public.tenants t
on conflict (tenant_id, name) do nothing;

insert into public.certificate_templates (tenant_id, kind, name, body, fields, is_default)
select
  t.id, 'bonafide', 'Bonafide Certificate',
$body$This is to certify that {{student.name}}, son/daughter of {{student.father_name}}, Admission Number {{student.admission_number}}, is a bona fide student of {{school.name}} and is studying in Class {{class.label}} during the academic session {{session.name}}.

This certificate is issued on request for {{purpose}}.

Certificate No. {{serial}}
Issued on {{date.issued}}.$body$,
$fields$[
  {"name":"purpose","label":"Issued for the purpose of","required":true}
]$fields$::jsonb,
  true
from public.tenants t
on conflict (tenant_id, name) do nothing;

insert into public.certificate_templates (tenant_id, kind, name, body, fields, is_default)
select
  t.id, 'character', 'Character Certificate',
$body$This is to certify that {{student.name}}, son/daughter of {{student.father_name}}, was a student of {{school.name}} in Class {{class.label}} during the academic session {{session.name}}.

To the best of our knowledge his/her character and conduct during this period were {{conduct}}.

We wish him/her success in all future endeavours.

Certificate No. {{serial}}
Issued on {{date.issued}}.$body$,
$fields$[
  {"name":"conduct","label":"Character and conduct","required":true}
]$fields$::jsonb,
  true
from public.tenants t
on conflict (tenant_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- The register, as a catalog report
-- ---------------------------------------------------------------------------
--
-- Rule 11 again: "which certificates did we issue last term, and to whom" is a
-- question with parameters, so it is a row rather than a second screen. The
-- issuing screen lists recent certificates; this answers the auditor.
--
-- It reads `certificates.snapshot`, not the live student record, which is the
-- module's whole claim made once more: the register must agree with the paper,
-- and the paper says what it said on the day.

create or replace function public.report_certificate_register(p_params jsonb)
returns table (row_data jsonb)
language sql
stable
set search_path = public, extensions
as $$
  select to_jsonb(t)
  from (
    select
      c.serial_no,
      c.issued_on,
      c.kind,
      c.template_name,
      c.snapshot ->> 'student.name'             as student,
      c.snapshot ->> 'student.admission_number' as admission_number,
      c.snapshot ->> 'class.label'              as class_at_issue,
      c.status,
      c.cancel_reason
    from public.certificates c
    where (
      public.report_param_date(p_params, 'from') is null
      or c.issued_on >= public.report_param_date(p_params, 'from')
    )
    and (
      public.report_param_date(p_params, 'to') is null
      or c.issued_on <= public.report_param_date(p_params, 'to')
    )
    and (
      public.report_param_text(p_params, 'kind') is null
      or c.kind = public.report_param_text(p_params, 'kind')
    )
    and (
      public.report_param_text(p_params, 'status') is null
      or c.status = public.report_param_text(p_params, 'status')
    )
    order by c.issued_on desc, c.serial_no desc
  ) t
$$;

revoke all on function public.report_certificate_register(jsonb) from public, anon;
grant execute on function public.report_certificate_register(jsonb) to authenticated;

insert into reference.reports
  (key, name, description, module, required_permission, function_name, parameters, columns, sort_order)
values
  (
    'certificates.register',
    'Certificate register',
    'Every certificate issued, newest first, including cancelled ones and why. Reads what each certificate actually said rather than the student record as it stands today.',
    'Certificates', 'certificates.view', 'report_certificate_register',
    '[
      {"name":"from","label":"Issued from","type":"date","required":false},
      {"name":"to","label":"Issued to","type":"date","required":false},
      {"name":"kind","label":"Kind","type":"select","required":false,
       "options":[
         {"value":"transfer","label":"Transfer"},
         {"value":"bonafide","label":"Bonafide"},
         {"value":"character","label":"Character"},
         {"value":"study","label":"Study"},
         {"value":"conduct","label":"Conduct"},
         {"value":"custom","label":"Other"}]},
      {"name":"status","label":"Status","type":"select","required":false,
       "options":[{"value":"issued","label":"Issued"},{"value":"cancelled","label":"Cancelled"}]}
    ]'::jsonb,
    '[
      {"key":"serial_no","label":"No.","type":"text"},
      {"key":"issued_on","label":"Issued","type":"date"},
      {"key":"kind","label":"Kind","type":"badge"},
      {"key":"student","label":"Student","type":"text"},
      {"key":"admission_number","label":"Adm. no.","type":"text"},
      {"key":"class_at_issue","label":"Class at issue","type":"text"},
      {"key":"template_name","label":"Template","type":"text"},
      {"key":"status","label":"Status","type":"badge"},
      {"key":"cancel_reason","label":"Cancelled because","type":"text"}
    ]'::jsonb,
    95
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  module = excluded.module,
  required_permission = excluded.required_permission,
  function_name = excluded.function_name,
  parameters = excluded.parameters,
  columns = excluded.columns,
  sort_order = excluded.sort_order;
