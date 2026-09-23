"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

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

import { ErrorSummary } from "@/components/forms/error-summary";

import {
  SelectField,
  TextField,
  TextareaField,
} from "@/components/forms/form-fields";

import {
  formatQuantity,
  itemSchema,
  kindTakesCost,
  MOVEMENT_KINDS,
  movementDirection,
  movementKindOptions,
  movementSchema,
  saleSchema,
  saleTotal,
  stockSentence,
  type ItemInput,
  type MovementInput,
  type SaleInput,
} from "@/lib/validations/inventory";
import {
  StudentPicker,
  type PickedStudent,
} from "@/components/people/student-picker";

import { useI18n } from "@/components/providers/i18n-provider";

import {
  addCategory,
  recordMovement,
  saveItem,
  searchStudentsForStore,
  sellToStudent,
  type StockRow,
} from "./actions";

/*
 * Dialogs split out of the page so they load on the click that opens them:
 * this is where the page's Zod and form code lives, and a conditional render
 * is not a conditional load (see `fees-table.tsx`).
 */

export function MovementDialog({
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
  const { t } = useI18n();
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
  const kinds = movementKindOptions(t).filter(
    (k) =>
      canAdjust ||
      k.value === "receipt" ||
      k.value === "issue" ||
      k.value === "return",
  );

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
            {item && stockSentence(item.onHand, item.reorderLevel, item.unit)}.
            Enter how many as a positive number — the ledger does the signing.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <SelectField
              control={form.control}
              name="kind"
              label="What happened"
              options={kinds}
              description={MOVEMENT_KINDS.find((k) => k.value === kind)?.hint}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberBox
                id="movement-quantity"
                label={
                  direction === "either"
                    ? "Change (may be negative)"
                    : "How many"
                }
                required
                value={form.watch("quantity")}
                error={form.formState.errors.quantity?.message}
                onChange={(n) =>
                  form.setValue("quantity", n, { shouldValidate: true })
                }
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
              <TextField
                control={form.control}
                name="supplier"
                label="Supplier"
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="reference"
                label="Reference"
              />
              <TextField
                control={form.control}
                name="happenedOn"
                label="Date"
              />
            </div>

            <TextareaField
              control={form.control}
              name="note"
              label="Note"
              rows={2}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Record
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The counter.
 *
 * One act, two writes: stock leaves the shelf and the amount lands on the
 * child's fee account, where it is collected with the tuition on one receipt.
 * Both happen inside `stock_sell_to_student`, because supabase-js cannot open
 * a transaction and a sale that wrote one of the two would leave a shelf short
 * with nobody billed.
 *
 * The price shown is the item's own. Overriding it is possible and deliberate
 * — a damaged copy sold cheap is a real thing a counter does — and the server
 * re-reads the item either way, so nothing here decides what a school charges.
 */

/**
 * The counter.
 *
 * One act, two writes: stock leaves the shelf and the amount lands on the
 * child's fee account, where it is collected with the tuition on one receipt.
 * Both happen inside `stock_sell_to_student`, because supabase-js cannot open
 * a transaction and a sale that wrote one of the two would leave a shelf short
 * with nobody billed.
 *
 * The price shown is the item's own. Overriding it is possible and deliberate
 * — a damaged copy sold cheap is a real thing a counter does — and the server
 * re-reads the item either way, so nothing here decides what a school charges.
 */
export function SellDialog({
  item,
  onClose,
}: {
  item: StockRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { formatCurrency } = useI18n();
  const [pending, startTransition] = useTransition();
  const [student, setStudent] = useState<PickedStudent | null>(null);
  const [studentError, setStudentError] = useState<string | null>(null);

  const form = useForm<SaleInput>({
    resolver: zodResolver(saleSchema),
    values: {
      itemId: item?.itemId ?? "",
      studentId: student?.id ?? "",
      quantity: 1,
      unitPrice: item?.salePrice ?? undefined,
      note: "",
      happenedOn: "",
    },
  });

  const quantity = form.watch("quantity");
  const unitPrice = form.watch("unitPrice");
  const total = saleTotal(quantity, unitPrice ?? item?.salePrice);

  function close() {
    setStudent(null);
    setStudentError(null);
    form.reset();
    onClose();
  }

  function onSubmit(values: SaleInput) {
    startTransition(async () => {
      const result = await sellToStudent(values);
      if (!result.ok) {
        // Every refusal here is a sentence written in Postgres — no price, not
        // enough on the shelf, the child has left, your role does not sell.
        toast.error(result.error);
        return;
      }
      // Both halves, on one line. Saying only "Sold" is how a store comes to
      // believe nobody was charged.
      toast.success(
        `Sold ${formatQuantity(result.data.quantity)} ${item?.unit ?? ""} to ${result.data.student} · ${formatCurrency(result.data.total)} added to their fee account.`,
      );
      close();
      router.refresh();
    });
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sell {item?.name}</DialogTitle>
          <DialogDescription>
            {item && stockSentence(item.onHand, item.reorderLevel, item.unit)}.
            The amount is charged to the child&apos;s fee account and collected
            at the counter with everything else — it is not money taken now.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sale-student">
                Student
                <span aria-hidden="true" className="text-destructive">
                  {" "}
                  *
                </span>
              </Label>
              <StudentPicker
                id="sale-student"
                selected={student}
                onSelect={(picked) => {
                  setStudent(picked);
                  setStudentError(null);
                  form.setValue("studentId", picked.id, {
                    shouldValidate: true,
                  });
                }}
                search={searchStudentsForStore}
              />
              <p aria-live="polite" className="min-h-5 text-sm">
                {studentError ? (
                  <span role="alert" className="font-medium text-destructive">
                    {studentError}
                  </span>
                ) : student && student.status !== "active" ? (
                  // The picker lists them and the server refuses them; saying
                  // so here saves the clerk a round trip.
                  <span className="text-muted-foreground">
                    {student.name} has left the college, so nothing can be sold
                    to them.
                  </span>
                ) : null}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberBox
                id="sale-quantity"
                label="How many"
                required
                value={quantity}
                error={form.formState.errors.quantity?.message}
                onChange={(n) =>
                  form.setValue("quantity", n, { shouldValidate: true })
                }
              />
              <NumberBox
                id="sale-price"
                label="Price each"
                step="0.01"
                value={unitPrice ?? NaN}
                error={form.formState.errors.unitPrice?.message}
                onChange={(n) =>
                  form.setValue("unitPrice", Number.isNaN(n) ? undefined : n, {
                    shouldValidate: true,
                  })
                }
              />
            </div>

            <div
              className="flex items-baseline justify-between rounded-md border p-3"
              aria-live="polite"
            >
              <span className="text-sm text-muted-foreground">
                To be added to the fee account
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {total === null ? "—" : formatCurrency(total)}
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="happenedOn"
                label="Date"
              />
            </div>

            <TextareaField
              control={form.control}
              name="note"
              label="Note"
              rows={2}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
                onClick={() => {
                  if (!student) setStudentError("Choose a student.");
                }}
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                Sell
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ItemDialog({
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
      salePrice: item?.salePrice ?? undefined,
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
            A reorder level of zero means the item is never flagged — which is
            the right setting for a projector, and the wrong one for chalk.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4"
            noValidate
          >
            <ErrorSummary
              errors={form.formState.errors}
              submitCount={form.formState.submitCount}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                control={form.control}
                name="sku"
                label="Code"
                required
              />
              <TextField
                control={form.control}
                name="unit"
                label="Unit"
                required
                description='"box", "ream", "each" — the school&apos;s own word.'
              />
            </div>
            <TextField
              control={form.control}
              name="name"
              label="Name"
              required
            />
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

            <div className="grid gap-4 sm:grid-cols-2">
              <NumberBox
                id="item-reorder"
                label="Reorder level"
                required
                value={form.watch("reorderLevel")}
                error={form.formState.errors.reorderLevel?.message}
                onChange={(n) =>
                  form.setValue("reorderLevel", n, { shouldValidate: true })
                }
              />
              <NumberBox
                id="item-sale-price"
                label="Sells for"
                step="0.01"
                value={form.watch("salePrice") ?? NaN}
                error={form.formState.errors.salePrice?.message}
                onChange={(n) =>
                  form.setValue("salePrice", Number.isNaN(n) ? undefined : n, {
                    shouldValidate: true,
                  })
                }
              />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Leave <em>Sells for</em> empty and the item is not for sale —
              which is not the same as free. Chalk and a projector are the
              school&apos;s; an exercise book is sold to a child and charged to
              their fee account.
            </p>

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
                onCheckedChange={(checked) =>
                  form.setValue("isActive", checked)
                }
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
              <Button
                type="submit"
                disabled={pending}
                className="cursor-pointer"
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                {item ? "Save item" : "Add item"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function NumberBox({
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
        onChange={(event) =>
          onChange(event.target.value === "" ? NaN : Number(event.target.value))
        }
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
