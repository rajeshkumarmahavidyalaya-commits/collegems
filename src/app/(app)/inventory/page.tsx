import { PackageSearch } from "lucide-react";
import { hasPermission } from "@/lib/auth/permissions";
import { listStaffOptions } from "../hr/actions";
import { listAssetsOut, listCategories, listStock } from "./actions";
import { InventoryView } from "./inventory-view";
import { formatMoney, stockValue } from "@/lib/validations/inventory";

export const metadata = { title: "Store" };

export default async function InventoryPage() {
  const [canView, canManage, canAdjust] = await Promise.all([
    hasPermission("inventory.view"),
    hasPermission("inventory.manage"),
    hasPermission("inventory.adjust"),
  ]);

  if (!canView) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Store</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ask an administrator to grant you <code className="font-mono">inventory.view</code>.
        </p>
      </div>
    );
  }

  const [stock, assetsOut, categories, staff] = await Promise.all([
    listStock(),
    listAssetsOut(),
    listCategories(),
    listStaffOptions(),
  ]);

  const lowCount = stock.filter((s) => s.belowReorder).length;
  const valued = stock
    .map((s) => stockValue(s.onHand, s.averageCost))
    .filter((v): v is number => v !== null);
  const total = valued.reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Store</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What the school holds, and what happened to it. Quantity on hand is a sum over every
            movement, never a stored number — so it cannot drift away from the events that produced
            it.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <PackageSearch className="size-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-mono text-lg font-semibold tabular-nums">
              {valued.length === stock.length ? formatMoney(total) : `${formatMoney(total)}+`}
            </p>
            <p className="text-xs text-muted-foreground">
              at average cost
              {valued.length !== stock.length &&
                ` · ${stock.length - valued.length} unpriced`}
            </p>
          </div>
        </div>
      </div>

      <InventoryView
        stock={stock}
        assetsOut={assetsOut}
        categories={categories}
        staff={staff}
        lowCount={lowCount}
        canManage={canManage}
        canAdjust={canAdjust}
      />
    </div>
  );
}
