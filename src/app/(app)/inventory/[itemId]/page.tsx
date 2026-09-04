import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/permissions";
import {
  formatMoney,
  quantityWithUnit,
  stockSentence,
  stockValue,
} from "@/lib/validations/inventory";
import { getItemLedger, listStock } from "../actions";
import { ItemLedger } from "./item-ledger";

export const metadata = { title: "Item" };

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const [stock, ledger, canAdjust] = await Promise.all([
    listStock(),
    getItemLedger(itemId),
    hasPermission("inventory.adjust"),
  ]);

  const item = stock.find((s) => s.itemId === itemId);
  if (!item) notFound();

  const value = stockValue(item.onHand, item.averageCost);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{item.name}</h1>
            <Badge variant="outline" className="font-mono">
              {item.sku}
            </Badge>
            {item.isAsset && <Badge variant="secondary">Asset</Badge>}
            {item.belowReorder && <Badge variant="destructive">Reorder</Badge>}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{stockSentence(item.onHand, item.reorderLevel, item.unit)}</span>
            {item.isAsset && item.issuedOut > 0 && (
              <span>{quantityWithUnit(item.issuedOut, item.unit)} out with people</span>
            )}
            <span>
              {item.averageCost === null
                ? "No cost recorded"
                : `${formatMoney(item.averageCost)} each · ${formatMoney(value)} on the shelf`}
            </span>
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/inventory">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All items
          </Link>
        </Button>
      </div>

      <ItemLedger rows={ledger} unit={item.unit} canAdjust={canAdjust} />
    </div>
  );
}
