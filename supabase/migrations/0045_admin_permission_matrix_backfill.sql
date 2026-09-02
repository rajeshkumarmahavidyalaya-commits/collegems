-- Fixture repair: the second tenant's admin never got a permission matrix.
--
-- Migration 0010 builds the demo tenant's `role_permissions` in full. The
-- second tenant -- Northgate, which exists so `tests/rls/tenant-isolation.test.ts`
-- has a real other school to be excluded from -- was created without that step,
-- so its admin role held **two** permission codes: the `communication.*` pair
-- that migration 0038 backfilled onto every admin role.
--
-- That went unnoticed because the cross-tenant suite only ever asks Northgate
-- to *fail* to see things, and RLS does that regardless of the permission
-- matrix. The reporting kernel is what surfaced it: `report_run` checks
-- `required_permission`, so Northgate's administrator could not run a single
-- report -- and, in the application, would have seen almost no navigation.
--
-- Fixed the way 0038 did it: for every tenant, not just this one, so a tenant
-- created by a future migration cannot inherit the same hole quietly.
-- `on conflict do nothing` makes it a no-op where the matrix is already right.
--
-- Deliberately admin-only. The other five roles' matrices are a product
-- decision per tenant, and inventing them here would be guessing on a school's
-- behalf; an admin with no permissions is unambiguously a defect.

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, p.code
from public.roles r
cross join reference.permissions p
where r.code = 'admin'
on conflict (tenant_id, role_id, permission_code) do nothing;
