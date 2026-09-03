-- Phase 2.3, part five -- the second authorization layer.
--
-- RLS is already the boundary: the policies on `staff_attendance`,
-- `salary_structures`, `staff_salary_assignments` and `payslips` decide who may
-- read and write, and they hold without a single row here.
--
-- These codes do the other job the matrix does, and in this module it is a
-- bigger job than usual. `staff` is deliberately readable by four roles,
-- because a librarian has to look somebody up -- so "who may see what a person
-- is paid" is a distinction only the permission matrix and the salary tables'
-- own policies express, and the two must agree. A tenant that later wants its
-- office clerk to run payroll should tick a box, not wait for a release.
--
-- The split is between *seeing the register* and *deciding what it costs*:
--
--   hr.view        the staff register and leave calendar
--   hr.manage      mark attendance, approve or refuse leave
--   payroll.view   salary structures, past runs, payslips
--   payroll.process  preview, edit and finalise a run
--
-- A teacher gets neither. Their own attendance, their own leave and their own
-- payslip reach them through the row-ownership policies on those tables, not
-- through a permission -- which is the distinction rule 4 draws, applied to a
-- person looking at their own record.

insert into reference.permissions (code, module, ability, description) values
  ('hr.view', 'hr', 'view',
   'View the staff attendance register and leave requests'),
  ('hr.manage', 'hr', 'manage',
   'Mark staff attendance, and approve or refuse leave'),
  ('payroll.view', 'payroll', 'view',
   'View salary structures, payroll runs and payslips'),
  ('payroll.process', 'payroll', 'process',
   'Preview, correct and finalise a payroll run')
on conflict (code) do nothing;

-- Admins get all four; accountants get payroll and the register they run it
-- from, but not the power to decide who was absent. The person who decides who
-- was absent must not be the person who decides what that costs them, and this
-- is where that separation is written down for the UI as well as for RLS.
insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values
  ('hr.view'), ('hr.manage'), ('payroll.view'), ('payroll.process')
) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('hr.view'), ('payroll.view'), ('payroll.process')) as p(code)
where r.code = 'accountant'
on conflict (tenant_id, role_id, permission_code) do nothing;
