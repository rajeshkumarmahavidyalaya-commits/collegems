"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Boxes, HandCoins, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorSummary } from "@/components/forms/error-summary";
import { SelectField, TextField, TextareaField } from "@/components/forms/form-fields";
import {
  formatMoney,
  formatQuantity,
  itemSchema,
  kindTakesCost,
  MOVEMENT_KINDS,
  movementDirection,
  movementSchema,
  quantityWithUnit,
  stockSentence,
  stockTone,
  type ItemInput,
  type MovementInput,
} from "@/lib/validations/inventory";
import {
  addCategory,
  recordMovement,
  saveItem,
  type AssetOutRow,
  type StockRow,
} from "./actions";

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

  return (
    <div className="flex flex-col gap-4">
      {lowCount > 0 && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {lowCount} item{lowCount === 1 ? "" : "s"} at or below the reorder level
          </AlertTitle>
          <AlertDescription>
            They are listed first below. An item with a reorder level of zero is never flagged —
            that is the honest setting for something the school does not restock.
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
          />
        </TabsContent>

        <TabsContent value="out" className="mt-4">
          <AssetsOutTab assetsOut={assetsOut} />
        </TabsContent>
      </Tabs>

      <ItemDialog
        open={itemOpen}
        onOpenChange={setItemOpen}
        item={editingItem}
        categories={categories}
      />
      <MovementDialog
        item={movementFor}
        onClose={() => setMovementFor(null)}
        staff={staff}
        canAdjust={canAdjust}
      />
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
}: {
  stock: StockRow[];
  canManage: boolean;
  canAdjust: boolean;
  onAdd: () => void;
  onEdit: (item: StockRow) => void;
  onMove: (item: StockRow) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>What is on the shelf</CardTitle>
          <CardDescription className="max-w-2xl">
            Every quantity here is a sum over the movements, computed on read. There is no stored
            total to go stale.
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
              <Boxes className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">The store is empty</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Add the things the school keeps — chalk, paper, projectors — and record what arrives
                and what goes out.
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
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead>Last moved</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
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
                          {stockSentence(item.onHand, item.reorderLevel, item.unit)}
                        </Badge>
                        {item.isAsset && item.issuedOut > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {quantityWithUnit(item.issuedOut, item.unit)} out
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {item.averageCost === null ? "—" : formatMoney(item.averageCost)}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {item.lastMovement ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {(canManage || canAdjust) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="cursor-pointer"
                            onClick={() => onMove(item)}
                          >
                            <HandCoins className="size-4" aria-hidden="true" />
                            <span className="sr-only">Record a movement for {item.name}</span>
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
          Assets the school lends and expects back. A holder who returned everything nets to zero
          and drops off this list on its own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {assetsOut.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="rounded-full bg-muted p-3">
              <Boxes className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium">Nothing is out</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Mark an item as an asset and issue it to somebody to see it here.
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
                  <TableHead className="text-right">How many</TableHead>
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
                    <TableCell className="text-right font-mono tabular-nums">
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

function MovementDialog({
  item,
  onClose,
  staff,
  canAdjust,
}: {
  item: StockRow | null;
  onClose: () => void;
  staff: { id: string; label: string }[];
  canAdjust: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<MovementInput>({
    resolver: zodResolver(movementSchema),
    values: {
      itemId: item?.itemId ?? "",
      kind: "receipt",
      quantity: 1,
      unitCost: undefined,
      issuedToStaffId: "",
      issuedToNote: "",
      supplier: "",
      reference: "",
      note: "",
      happenedOn: "",
    },
  });

  const kind = form.watch("kind");
  const direction = movementDirection(kind);

  // Only what the kind can carry: an adjustment or a receipt takes a cost, an
  // issue takes a holder. Showing every field for every kind is how a store
  // ends up with suppliers recorded against write-offs.
  const kinds = MOVEMENT_KINDS.filter((k) => canAdjust || k.value === "receipt" || k.value === "issue" || k.value === "return");

  function onSubmit(values: MovementInput) {
    startTransition(async () => {
      const result = await recordMovement(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Recorded.");
      onClose();
      form.reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>
            {item && stockSentence(item.onHand, item.reorderLevel, item.unit)}. Enter how many as a
            positive number — the ledger does the signing.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <SelectField
              control={form.control}
              name="kind"
              label="What happened"
              options={kinds.map((k) => ({ value: k.value, label: k.label }))}
              description={MOVEMENT_KINDS.find((k) => k.value === kind)?.hint}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberBox
                id="movement-quantity"
                label={direction === "either" ? "Change (may be negative)" : "How many"}
                required
                value={form.watch("quantity")}
                error={form.formState.errors.quantity?.message}
                onChange={(n) => form.setValue("quantity", n, { shouldValidate: true })}
                allowNegative={direction === "either"}
              />
              {kindTakesCost(kind) && (
                <NumberBox
                  id="movement-cost"
                  label="Unit cost"
                  step="0.01"
                  value={form.watch("unitCost") ?? NaN}
                  error={form.formState.errors.unitCost?.message}
                  onChange={(n) =>
                    form.setValue("unitCost", Number.isNaN(n) ? undefined : n, {
                      shouldValidate: true,
                    })
                  }
                />
              )}
            </div>

            {(kind === "issue" || kind === "return") && (
              <>
                <SelectField
                  control={form.control}
                  name="issuedToStaffId"
                  label="Who"
                  options={[
                    { value: "", label: "Not a named member of staff" },
                    ...staff.map((s) => ({ value: s.id, label: s.label })),
                  ]}
                />
                <TextField
                  control={form.control}
                  name="issuedToNote"
                  label="Or where"
                  description='A room or a department — "the office" is a real answer.'
                />
              </>
            )}

            {kind === "receipt" && (
              <TextField control={form.control} name="supplier" label="Supplier" />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="reference" label="Reference" />
              <TextField control={form.control} name="happenedOn" label="Date" />
            </div>

            <TextareaField control={form.control} name="note" label="Note" rows={2} />

            <DialogFooter>
              <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                Record
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ItemDialog({
  open,
  onOpenChange,
  item,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: StockRow | null;
  categories: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newCategory, setNewCategory] = useState("");

  const form = useForm<ItemInput>({
    resolver: zodResolver(itemSchema),
    values: {
      sku: item?.sku ?? "",
      name: item?.name ?? "",
      categoryId: "",
      unit: item?.unit ?? "each",
      reorderLevel: item?.reorderLevel ?? 0,
      isAsset: item?.isAsset ?? false,
      isActive: item?.isActive ?? true,
      notes: "",
    },
  });

  function onSubmit(values: ItemInput) {
    startTransition(async () => {
      const result = await saveItem(values, item?.itemId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(item ? "Item updated." : "Item added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  function submitCategory() {
    startTransition(async () => {
      const result = await addCategory(newCategory);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Category added.");
      setNewCategory("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit item" : "New item"}</DialogTitle>
          <DialogDescription>
            A reorder level of zero means the item is never flagged — which is the right setting for
            a projector, and the wrong one for chalk.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <ErrorSummary errors={form.formState.errors} submitCount={form.formState.submitCount} />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField control={form.control} name="sku" label="Code" required />
              <TextField
                control={form.control}
                name="unit"
                label="Unit"
                required
                description='"box", "ream", "each" — the school&apos;s own word.'
              />
            </div>
            <TextField control={form.control} name="name" label="Name" required />
            <SelectField
              control={form.control}
              name="categoryId"
              label="Category"
              options={[
                { value: "", label: "None" },
                ...categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
            />

            <div className="flex items-end gap-2 rounded-md border p-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="new-category">Add a category</Label>
                <input
                  id="new-category"
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                disabled={pending || newCategory.trim() === ""}
                onClick={submitCategory}
              >
                Add
              </Button>
            </div>

            <NumberBox
              id="item-reorder"
              label="Reorder level"
              required
              value={form.watch("reorderLevel")}
              error={form.formState.errors.reorderLevel?.message}
              onChange={(n) => form.setValue("reorderLevel", n, { shouldValidate: true })}
            />

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="item-asset">An asset</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Lent out and expected back, rather than consumed.
                </p>
              </div>
              <Switch
                id="item-asset"
                checked={form.watch("isAsset")}
                onCheckedChange={(checked) => form.setValue("isAsset", checked)}
                className="cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="item-active">Still stocked</Label>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Turning this off keeps the history and stops new receipts.
                </p>
              </div>
              <Switch
                id="item-active"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) => form.setValue("isActive", checked)}
                className="cursor-pointer"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="cursor-pointer">
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {item ? "Save item" : "Add item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function NumberBox({
  id,
  label,
  value,
  onChange,
  error,
  required,
  step,
  allowNegative,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  required?: boolean;
  step?: string;
  allowNegative?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-destructive">
            {" "}
            *
          </span>
        )}
      </Label>
      <input
        id={id}
        type="number"
        step={step}
        min={allowNegative ? undefined : 0}
        inputMode="decimal"
        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={Number.isNaN(value) ? "" : value}
        onChange={(event) => onChange(event.target.value === "" ? NaN : Number(event.target.value))}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
