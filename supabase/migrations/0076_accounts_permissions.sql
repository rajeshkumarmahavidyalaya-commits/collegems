-- Phase 2.2 -- the second authorization layer for the books.
--
-- RLS already restricts every accounts table to `admin` and `accountant`. These
-- codes do the matrix's other job -- deciding what to render -- and draw one
-- line RLS deliberately does not: **reading the books is not the same as
-- posting to them.** A head teacher may want the trial balance without the
-- ability to write a journal entry, and a school that later hires a bookkeeper
-- should grant posting by ticking a box.

insert into reference.permissions (code, module, ability, description) values
  ('accounts.view', 'accounts', 'view',
   'View the chart of accounts, vouchers and the trial balance'),
  ('accounts.post', 'accounts', 'post',
   'Write and post journal vouchers, and sync the subledgers'),
  ('accounts.manage', 'accounts', 'manage',
   'Edit the chart of accounts and the posting rules')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('accounts.view'), ('accounts.post'), ('accounts.manage')) as p(code)
where r.code in ('admin', 'accountant')
on conflict (tenant_id, role_id, permission_code) do nothing;
