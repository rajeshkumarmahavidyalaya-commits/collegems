-- Phase 4.1, part 4 -- the second authorization layer for notifications.
--
-- RLS already decides who may send: `notify_send` refuses anyone whose role
-- code is not `admin`, and the policies on `notifications` say the same thing
-- twice over. That is the boundary and it holds without these rows.
--
-- These exist for the other job the permission matrix does -- deciding what to
-- render. Without a code, "Compose" would either be visible to a librarian who
-- will be refused when they press it, or hardcoded against `roleCode ===
-- 'admin'` in the UI, which is exactly the shortcut the matrix exists to stop:
-- a tenant that later grants sending to its office clerk should do it by
-- ticking a box, not by waiting for a release.
--
-- Backfilled onto every existing tenant's admin role, because tenants are
-- provisioned by migration in this system rather than by a function -- there is
-- no single place a new permission would otherwise reach them from.

insert into reference.permissions (code, module, ability, description) values
  ('communication.view', 'communication', 'view',
   'View the notification delivery log and message templates'),
  ('communication.send', 'communication', 'send',
   'Compose and send a notification to a chosen audience')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join (values ('communication.view'), ('communication.send')) as p(code)
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;
