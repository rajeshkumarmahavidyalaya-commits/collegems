"use client";

import { useState } from "react";
import Link from "next/link";

import {
  AlertTriangle,
  Boxes,
  HandCoins,
  Pencil,
  Plus,
  ShoppingCart,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  formatQuantity,
  isSellable,
  quantityWithUnit,
  stockSentence,
  stockTone,
} from "@/lib/validations/inventory-display";
import { useI18n } from "@/components/providers/i18n-provider";

import { type AssetOutRow, type StockRow } from "./actions";
import dynamic from "next/dynamic";

// Loaded on the click that opens them and rendered only while open: they
// hold this page's Zod and form code, and a conditional render is not a
// conditional load (see `fees-table.tsx` and docs/performance.md).
const ItemDialog = dynamic(() =>
  import("./inventory-dialogs").then((m) => m.ItemDialog),
);
const MovementDialog = dynamic(() =>
  import("./inventory-dialogs").then((m) => m.MovementDialog),
);
const SellDialog = dynamic(() =>
  import("./inventory-dialogs").then((m) => m.SellDialog),
);

export function InventoryView({
  stock,
  assetsOut,
  categories,
  staff,
  lowCount,
  canManage,
  canAdjust,
}: {
  stock: StockRow[];
  assetsOut: AssetOutRow[];
  categories: { id: string; label: string }[];
  staff: { id: string; label: string }[];
  lowCount: number;
  canManage: boolean;
  canAdjust: boolean;
}) {
  const [itemOpen, setItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StockRow | null>(null);
  const [movementFor, setMovementFor] = useState<StockRow | null>(null);
  const [sellingItem, setSellingItem] = useState<StockRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {lowCount > 0 && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {lowCount} item{lowCount === 1 ? "" : "s"} at or below the reorder
            level
          </AlertTitle>
          <AlertDescription>
            They are listed first below. An item with a reorder level of zero is
            never flagged — that is the honest setting for something the school
            does not restock.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="out">Out with people</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4">
          <StockTab
            stock={stock}
            canManage={canManage}
            canAdjust={canAdjust}
            onAdd={() => {
              setEditingItem(null);
              setItemOpen(true);
            }}
            onEdit={(item) => {
              setEditingItem(item);
              setItemOpen(true);
            }}
            onMove={setMovementFor}
            onSell={setSellingItem}
          />
        </TabsContent>

        <TabsContent value="out" className="mt-4">
          <AssetsOutTab assetsOut={assetsOut} />
        </TabsContent>
      </Tabs>

      {itemOpen ? (
        <ItemDialog
          open={itemOpen}
          onOpenChange={setItemOpen}
          item={editingItem}
          categories={categories}
        />
      ) : null}
      {movementFor ? (
        <MovementDialog
          item={movementFor}
          onClose={() => setMovementFor(null)}
          staff={staff}
          canAdjust={canAdjust}
        />
      ) : null}
      {sellingItem ? (
        <SellDialog item={sellingItem} onClose={() => setSellingItem(null)} />
      ) : null}
    </div>
  );
}

function StockTab({
  stock,
  canManage,
  canAdjust,
  onAdd,
  onEdit,
  onMove,
  onSell,
}: {
  stock: StockRow[];
  canManage: boolean;
  canAdjust: boolean;
  onAdd: () => void;
  onEdit: (item: StockRow) => void;
  onMove: (item: StockRow) => void;
  onSell: (item: StockRow) => void;
}) {
  const { formatCurrency } = useI18n();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>What is on the shelf</CardTitle>
          <CardDescription className="max-w-2xl">
            Every quantity here is a sum over the movements, computed on read.
            There is no stored total to go stale.
          </CardDescription>
        </div>
        {canManage && (
          <Button size="sm" onClick={onAdd} className="cursor-pointer">
            <Plus className="size-4" aria-hidden="true" />
            New item
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {stock.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Boxes
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="font-medium">The store is empty</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add the things the school keeps — chalk, paper, projectors — and
                record what arrives and what goes out.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>On hand</TableHead>
                  <TableHead className="text-end">Unit cost</TableHead>
                  <TableHead className="text-end">Sells for</TableHead>
                  <TableHead>Last moved</TableHead>
                  <TableHead className="w-24 text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.map((item) => {
                  const tone = stockTone(item.onHand, item.reorderLevel);
                  return (
                    <TableRow key={item.itemId}>
                      <TableCell>
                        <Link
                          href={`/inventory/${item.itemId}`}
                          className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {item.name}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {item.sku}
                          {item.isAsset && " · asset"}
                          {!item.isActive && " · not stocked"}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.categoryName ?? "—"}
                      </TableCell>
                      <TableCell>
                        {/* Text carries it; the variant only echoes. */}
                        <Badge
                          variant={
                            tone === "out"
                              ? "destructive"
                              : tone === "low"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {stockSentence(
                            item.onHand,
                            item.reorderLevel,
                            item.unit,
                          )}
                        </Badge>
                        {item.isAsset && item.issuedOut > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {quantityWithUnit(item.issuedOut, item.unit)} out
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums text-muted-foreground">
                        {item.averageCost === null
                          ? "—"
                          : formatCurrency(item.averageCost)}
                      </TableCell>
                      <TableCell className="text-end font-mono tabular-nums">
                        {/* Null is "not for sale", and a dash says that. A zero
                            here would say the school gives it away. */}
                        {item.salePrice === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatCurrency(item.salePrice)
                        )}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {item.lastMovement ?? "—"}
                      </TableCell>
                      <TableCell className="text-end">
                        {/* Drawn only when the counter could actually serve
                            somebody. A button that will refuse you costs the
                            person the work of trying — and "not for sale",
                            "out of stock" and "no longer stocked" are three
                            different reasons, each already on the row. */}
                        {canManage &&
                          isSellable(
                            item.salePrice,
                            item.isActive,
                            item.onHand,
                          ) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="cursor-pointer"
                              onClick={() => onSell(item)}
                            >
                              <ShoppingCart
                                className="size-4"
                                aria-hidden="true"
                              />
                              <span className="sr-only">
                                Sell {item.name} to a student
                              </span>
                            </Button>
                          )}
                        {(canManage || canAdjust) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onMove(item)}
                          >
                            <HandCoins className="size-4" aria-hidden="true" />
                            <span className="sr-only">
                              Record a movement for {item.name}
                            </span>
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onEdit(item)}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            <span className="sr-only">Edit {item.name}</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AssetsOutTab({ assetsOut }: { assetsOut: AssetOutRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Out with people</CardTitle>
        <CardDescription className="max-w-2xl">
          Assets the school lends and expects back. A holder who returned
          everything nets to zero and drops off this list on its own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assetsOut.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Boxes
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div>
              <p className="font-medium">Nothing is out</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Mark an item as an asset and issue it to somebody to see it
                here.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>With</TableHead>
                  <TableHead className="text-end">How many</TableHead>
                  <TableHead>Since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assetsOut.map((row, index) => (
                  <TableRow key={`${row.itemId}-${row.holder}-${index}`}>
                    <TableCell>
                      <Link
                        href={`/inventory/${row.itemId}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.name}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {row.sku}
                      </span>
                    </TableCell>
                    <TableCell>{row.holder}</TableCell>
                    <TableCell className="text-end font-mono tabular-nums">
                      {formatQuantity(row.quantity)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {row.since}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
