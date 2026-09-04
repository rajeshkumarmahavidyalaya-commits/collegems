-- Inventory: the matrix's half, and a store with something in it.
--
-- The line the matrix draws here: **keeping the store is not the same as
-- writing off what is missing.** A store keeper issues chalk all day; deciding
-- that six projectors are gone is a different decision with a different
-- signature on it.

insert into reference.permissions (code, module, ability, description) values
  ('inventory.view', 'inventory', 'view', 'View items, stock on hand and the store ledger'),
  ('inventory.manage', 'inventory', 'manage', 'Add items and categories, receive and issue stock'),
  ('inventory.adjust', 'inventory', 'adjust', 'Adjust or write off stock after a count')
on conflict (code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'inventory.view'
from public.roles r
where r.code in ('admin', 'accountant', 'librarian', 'teacher')
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'inventory.manage'
from public.roles r
where r.code in ('admin', 'accountant', 'librarian')
on conflict (tenant_id, role_id, permission_code) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission_code)
select r.tenant_id, r.id, 'inventory.adjust'
from public.roles r
where r.code in ('admin', 'accountant')
on conflict (tenant_id, role_id, permission_code) do nothing;

do $$
declare
  v_tenant uuid;
  v_session uuid;
  v_staff uuid;
  v_stationery uuid;
  v_equipment uuid;
  v_cleaning uuid;
  v_item record;
begin
  select id into v_tenant from public.tenants where slug = 'rajesh-kumar-mahavidyalaya';
  if v_tenant is null then return; end if;

  select id into v_session from public.academic_sessions
  where tenant_id = v_tenant and is_current limit 1;
  if v_session is null then return; end if;

  if exists (select 1 from public.inventory_items where tenant_id = v_tenant) then
    return;
  end if;

  select id into v_staff from public.staff where tenant_id = v_tenant order by created_at limit 1;

  insert into public.item_categories (tenant_id, name)
  values (v_tenant, 'Stationery'), (v_tenant, 'Equipment'), (v_tenant, 'Cleaning')
  on conflict (tenant_id, name) do nothing;

  select id into v_stationery from public.item_categories where tenant_id = v_tenant and name = 'Stationery';
  select id into v_equipment from public.item_categories where tenant_id = v_tenant and name = 'Equipment';
  select id into v_cleaning from public.item_categories where tenant_id = v_tenant and name = 'Cleaning';

  insert into public.inventory_items (tenant_id, sku, name, category_id, unit, reorder_level, is_asset)
  values
    (v_tenant, 'STN-001', 'Chalk (white)', v_stationery, 'box', 20, false),
    (v_tenant, 'STN-002', 'A4 paper', v_stationery, 'ream', 15, false),
    (v_tenant, 'STN-003', 'Whiteboard marker', v_stationery, 'each', 40, false),
    (v_tenant, 'EQP-001', 'Projector', v_equipment, 'each', 0, true),
    (v_tenant, 'EQP-002', 'Laptop', v_equipment, 'each', 0, true),
    (v_tenant, 'CLN-001', 'Floor cleaner', v_cleaning, 'litre', 25, false)
  on conflict (tenant_id, sku) do nothing;

  -- Receipts first, then issues, so the running balance in the ledger reads the
  -- way a store keeper's book does.
  for v_item in
    select id, sku, is_asset from public.inventory_items where tenant_id = v_tenant order by sku
  loop
    insert into public.stock_movements (
      tenant_id, session_id, item_id, kind, quantity, unit_cost, supplier,
      reference, happened_on
    )
    values (
      v_tenant, v_session, v_item.id, 'receipt',
      case when v_item.is_asset then 8 else 100 end,
      case v_item.sku
        when 'STN-001' then 45.00
        when 'STN-002' then 320.00
        when 'STN-003' then 28.00
        when 'EQP-001' then 32000.00
        when 'EQP-002' then 48000.00
        else 180.00
      end,
      'Iyer Stationers', 'GRN-' || v_item.sku,
      current_date - 60
    );

    insert into public.stock_movements (
      tenant_id, session_id, item_id, kind, quantity,
      issued_to_staff_id, reference, happened_on
    )
    values (
      v_tenant, v_session, v_item.id, 'issue',
      case when v_item.is_asset then -3 else -85 end,
      v_staff, 'Term issue', current_date - 20
    );
  end loop;
end $$;
