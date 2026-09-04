-- ---------------------------------------------------------------------------
-- Inventory — the ledger pattern, applied to goods
--
-- The tempting design is `items.quantity_on_hand`, incremented and decremented.
-- It is the same mistake `book_issues.fine_paid` was (migration 0026): a stored
-- total that is free to disagree with the events that produced it, and it
-- always eventually does — a failed transaction, a hand-edit, a double-click.
--
-- So stock follows rule 6's instinct exactly:
--
--   **Quantity on hand is a fact about many rows, so it is a sum, never a
--   column.**
--
-- `stock_movements` is append-only. A mistake is corrected with an opposing
-- movement, never by editing one — which is also what makes "why do we have
-- eleven of these" answerable a year later.
-- ---------------------------------------------------------------------------

create table public.item_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table public.item_categories
  add constraint item_categories_tenant_id_key unique (tenant_id, id);
create index item_categories_tenant_idx on public.item_categories (tenant_id);

create trigger set_updated_at before update on public.item_categories
  for each row execute function public.set_updated_at();
create trigger audit_item_categories
  after insert or update or delete on public.item_categories
  for each row execute function public.audit_row_change();

alter table public.item_categories enable row level security;

create policy "tenant members view item_categories" on public.item_categories
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "store keepers manage item_categories" on public.item_categories
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant', 'librarian')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant', 'librarian')
  );

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

-- **Not session-scoped.** A box of chalk outlives an academic year, and so does
-- a projector. The *movements* carry the session, because "what did we spend
-- this year" is always asked about a year.
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null,
  name text not null,
  category_id uuid,
  -- What one of the thing is. Free text on purpose: "box", "ream", "litre" and
  -- "each" are all real and no enum survives contact with a school store.
  unit text not null default 'each',
  -- Below this, the item shows on the reorder list. Zero means "do not track",
  -- which is the honest default for a projector.
  reorder_level numeric(12, 2) not null default 0 check (reorder_level >= 0),
  -- An asset is tracked but not consumed: it is issued and comes back. The
  -- distinction changes nothing about the ledger and everything about the
  -- screen that reads it.
  is_asset boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (tenant_id, sku),

  constraint inventory_items_category_fkey
    foreign key (tenant_id, category_id)
    references public.item_categories (tenant_id, id) on delete set null
);

alter table public.inventory_items
  add constraint inventory_items_tenant_id_key unique (tenant_id, id);

create index inventory_items_tenant_idx on public.inventory_items (tenant_id);
create index inventory_items_category_idx on public.inventory_items (tenant_id, category_id);

create trigger set_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();
create trigger audit_inventory_items
  after insert or update or delete on public.inventory_items
  for each row execute function public.audit_row_change();

alter table public.inventory_items enable row level security;

create policy "tenant members view inventory_items" on public.inventory_items
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "store keepers manage inventory_items" on public.inventory_items
  for all to authenticated
  using (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant', 'librarian')
  )
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant', 'librarian')
  );

-- ---------------------------------------------------------------------------
-- Movements
-- ---------------------------------------------------------------------------

-- One row per thing that happened to the stock. Signed, like `ledger_entries`:
-- positive brings stock in, negative takes it out, and the sign is constrained
-- per kind so an `issue` cannot secretly add to the shelf.
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.academic_sessions(id) on delete cascade,
  item_id uuid not null,

  kind text not null check (kind in ('receipt', 'issue', 'return', 'adjustment', 'write_off')),
  -- Signed. The RPCs take positive numbers and do the signing, exactly as the
  -- fee ledger does -- never ask somebody at a counter for a negative.
  quantity numeric(12, 2) not null check (quantity <> 0),
  -- What one unit cost, on a receipt. Null elsewhere: an issue has no price,
  -- and pretending it does is how a store starts inventing valuations.
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),

  -- Who or what it went to. All optional, because a store issues to a teacher,
  -- to a room, and to "the office" in equal measure.
  issued_to_staff_id uuid,
  issued_to_note text,
  supplier text,
  reference text,
  note text,

  happened_on date not null default current_date,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- The sign is the kind. Getting this wrong is the single way a stock ledger
  -- becomes fiction, so it is a constraint rather than a convention.
  constraint stock_movements_sign_chk check (
    case kind
      when 'receipt' then quantity > 0
      when 'return' then quantity > 0
      when 'issue' then quantity < 0
      when 'write_off' then quantity < 0
      -- An adjustment is the one kind that may go either way: a stock count
      -- finds more or fewer than the ledger says.
      else true
    end
  ),
  constraint stock_movements_cost_chk check (
    unit_cost is null or kind in ('receipt', 'adjustment')
  ),

  constraint stock_movements_item_fkey
    foreign key (tenant_id, item_id)
    references public.inventory_items (tenant_id, id) on delete restrict,
  constraint stock_movements_staff_fkey
    foreign key (tenant_id, issued_to_staff_id)
    references public.staff (tenant_id, id) on delete set null
);

create index stock_movements_tenant_idx on public.stock_movements (tenant_id);
create index stock_movements_item_idx
  on public.stock_movements (tenant_id, item_id, happened_on desc);
create index stock_movements_session_idx on public.stock_movements (tenant_id, session_id);
create index stock_movements_staff_idx on public.stock_movements (tenant_id, issued_to_staff_id);
create index stock_movements_recorder_idx on public.stock_movements (recorded_by);

create trigger audit_stock_movements
  after insert or update or delete on public.stock_movements
  for each row execute function public.audit_row_change();

alter table public.stock_movements enable row level security;

create policy "tenant members view stock_movements" on public.stock_movements
  for select to authenticated
  using (tenant_id = ( select public.current_tenant_id() ));

create policy "store keepers add stock_movements" on public.stock_movements
  for insert to authenticated
  with check (
    tenant_id = ( select public.current_tenant_id() )
    and ( select public.current_role_code() ) in ('admin', 'accountant', 'librarian')
  );

-- Append-only, and **revoked outright rather than merely unmatched by a
-- policy** -- the same distinction rule 6 draws for `ledger_entries`. A store
-- ledger somebody can edit is a store ledger that will be edited on the day the
-- count does not tie.
revoke update, delete on public.stock_movements from authenticated, anon;

comment on table public.stock_movements is
  'Append-only. Quantity on hand is the sum of these, never a stored column: a stored total is free to disagree with the events that produced it, and eventually does. Corrections are opposing movements.';
comment on column public.stock_movements.quantity is
  'Signed: positive brings stock in, negative takes it out, and stock_movements_sign_chk ties the sign to the kind. The RPCs take positive numbers and do the signing.';
