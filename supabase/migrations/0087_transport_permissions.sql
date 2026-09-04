-- Phase 5.2 -- the matrix's half of transport.
--
-- RLS already says who may write: routes, stops and vehicles are admin-only,
-- and a family sees its own arrangement and nothing else. These codes do the
-- matrix's other job -- deciding what to render -- and draw the one line RLS
-- deliberately does not: **running the buses is not the same as putting a child
-- on one.** A transport in-charge who plans routes is often not the person at
-- the admissions desk who assigns a seat, and a school should be able to
-- separate them by ticking a box.

insert into reference.permissions (code, module, ability, description) values
  ('transport.view', 'transport', 'view',
   'View routes, stops, vehicles and bus manifests'),
  ('transport.manage', 'transport', 'manage',
   'Create and edit routes, stops, fares and vehicles'),
  ('transport.assign', 'transport', 'assign',
   'Put a student on a route, or take them off one')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'transport.view'
from public.roles r
where r.code in ('admin', 'teacher', 'accountant', 'parent', 'student')
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('transport.manage'), ('transport.assign')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;
