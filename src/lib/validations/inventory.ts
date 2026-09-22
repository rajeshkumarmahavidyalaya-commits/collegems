import { z } from "zod";
import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * Inventory.
 *
 * The module's one idea is that **quantity on hand is a sum, never a stored
 * column** — the same instinct as `ledger_entries`. Everything here is the
 * browser's half of that: the shape a form can catch, and the arithmetic a
 * screen does on numbers Postgres already added up.
 */

export const MOVEMENT_KINDS = [
  {
    value: "receipt",
    label: "Received",
    direction: "in",
    hint: "Goods arriving from a supplier.",
  },
  {
    value: "issue",
    label: "Issued",
    direction: "out",
    hint: "Given to somebody. Cannot take stock below zero.",
  },
  {
    value: "return",
    label: "Returned",
    direction: "in",
    hint: "Come back from whoever had it.",
  },
  {
    value: "adjustment",
    label: "Adjustment",
    direction: "either",
    hint: "A stock count found more, or fewer, than the ledger says.",
  },
  {
    value: "write_off",
    label: "Written off",
    direction: "out",
    hint: "Broken, expired or lost.",
  },
] as const;

export type MovementKind = (typeof MOVEMENT_KINDS)[number]["value"];

/** Which way a kind moves stock. Mirrors `stock_movements_sign_chk`. */
export function movementDirection(kind: string): "in" | "out" | "either" {
  return MOVEMENT_KINDS.find((k) => k.value === kind)?.direction ?? "either";
}

export function movementLabel(kind: string, t: Translator) {
  const found = MOVEMENT_KINDS.find((k) => k.value === kind);
  return found ? labelFor(`stock.movement.${kind}`, found.label, t) : kind;
}

/** Every kind, translated. The caller filters by what its user may record. */
export function movementKindOptions(t: Translator) {
  return optionsFor(MOVEMENT_KINDS, "stock.movement", t);
}

/** Only receipts and adjustments carry a price — a store that values its issues invents numbers. */
export function kindTakesCost(kind: string): boolean {
  return kind === "receipt" || kind === "adjustment";
}

export const itemSchema = z.object({
  sku: z.string().min(1, "An item needs a code").max(40),
  name: z.string().min(1, "An item needs a name").max(160),
  categoryId: z.union([z.string().uuid(), z.literal("")]).optional(),
  unit: z.string().min(1, "Say what one of them is").max(20),
  reorderLevel: z
    .number({ message: "Enter a reorder level, or zero not to track one" })
    .min(0, "A reorder level cannot be negative")
    .max(1000000),
  /**
   * **Undefined means not for sale, which is not the same as free.** The
   * column is nullable in Postgres for exactly that reason, and the counter
   * refuses an item with no price rather than charging nothing for it.
   */
  salePrice: z.number().min(0, "A price cannot be negative").max(1000000).optional(),
  isAsset: z.boolean(),
  isActive: z.boolean(),
  notes: z.string().max(400).optional(),
});
export type ItemInput = z.infer<typeof itemSchema>;

export const movementSchema = z
  .object({
    itemId: z.string().uuid("Choose an item"),
    kind: z.enum(["receipt", "issue", "return", "adjustment", "write_off"]),
    /**
     * Always entered positive except for an adjustment, which is the one kind
     * whose whole purpose is to be able to go either way. The server does the
     * signing — never ask somebody at a counter for a negative number.
     */
    quantity: z.number({ message: "Enter how many" }).refine((n) => n !== 0, "Enter how many"),
    unitCost: z.number().min(0, "A cost cannot be negative").optional(),
    issuedToStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
    issuedToNote: z.string().max(160).optional(),
    supplier: z.string().max(160).optional(),
    reference: z.string().max(80).optional(),
    note: z.string().max(400).optional(),
    happenedOn: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"), z.literal("")])
      .optional(),
  })
  .refine((v) => v.kind === "adjustment" || v.quantity > 0, {
    message: "Enter how many, as a positive number",
    path: ["quantity"],
  })
  .refine((v) => v.unitCost === undefined || kindTakesCost(v.kind), {
    message: "Only a receipt or an adjustment carries a cost",
    path: ["unitCost"],
  });
export type MovementInput = z.infer<typeof movementSchema>;

export const reverseSchema = z.object({
  movementId: z.string().uuid(),
  reason: z.string().min(1, "Say why it is being reversed").max(300),
});

/**
 * Selling from the store.
 *
 * `unitPrice` is optional because the item's own `sale_price` is the default —
 * the counter overrides it only when somebody decides to, and the server reads
 * the item either way, so a price sent from the browser is never trusted to be
 * the school's price.
 */
export const saleSchema = z.object({
  itemId: z.string().uuid("Choose an item"),
  studentId: z.string().uuid("Choose a student"),
  quantity: z
    .number({ message: "Enter how many" })
    .positive("Enter how many, as a positive number")
    .max(100000),
  unitPrice: z.number().min(0, "A price cannot be negative").max(1000000).optional(),
  note: z.string().max(400).optional(),
  happenedOn: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"), z.literal("")])
    .optional(),
});
export type SaleInput = z.infer<typeof saleSchema>;

/**
 * Undoing one. Deliberately **not** `reverseSchema` with a different name: a
 * sale is two writes, so undoing it goes through `stock_sale_reverse` and
 * never through `stock_reverse_movement`, which refuses a sale by name.
 */
export const saleReverseSchema = z.object({
  movementId: z.string().uuid(),
  reason: z.string().min(1, "Say why this sale is being undone").max(300),
});

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** `15` → `"15"`, `15.5` → `"15.5"`. Mirrors `format_quantity` in Postgres. */
export function formatQuantity(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

/** `15` + `"box"` → `"15 box"`. The unit is the school's word, not ours. */
export function quantityWithUnit(value: number | string | null | undefined, unit: string): string {
  return `${formatQuantity(value)} ${unit}`;
}

/**
 * What the shelf is worth, at average receipt cost. Null when nothing was ever
 * received with a price against it — a store that guesses a valuation is worse
 * than one that admits it does not have one.
 */
export function stockValue(
  onHand: number,
  averageCost: number | null | undefined,
): number | null {
  if (averageCost === null || averageCost === undefined) return null;
  return Math.round(onHand * averageCost * 100) / 100;
}

/**
 * Whether an item needs ordering. `reorderLevel` of zero means "do not track",
 * which is the honest default for a projector — otherwise every asset sits
 * permanently on the reorder list.
 */
export function needsReorder(onHand: number, reorderLevel: number): boolean {
  return reorderLevel > 0 && onHand <= reorderLevel;
}

/** Text first: a low stock warning must survive a black-and-white printout. */
export function stockTone(onHand: number, reorderLevel: number): "ok" | "low" | "out" {
  if (onHand <= 0) return "out";
  if (needsReorder(onHand, reorderLevel)) return "low";
  return "ok";
}

export function stockSentence(onHand: number, reorderLevel: number, unit: string): string {
  if (onHand <= 0) return "Out of stock";
  if (needsReorder(onHand, reorderLevel)) {
    return `${quantityWithUnit(onHand, unit)} left — reorder at ${formatQuantity(reorderLevel)}`;
  }
  return quantityWithUnit(onHand, unit);
}

/**
 * What the counter will charge. Null when the item has no price — *not for
 * sale* and *free* are different facts, and a total of zero says the second.
 */
export function saleTotal(
  quantity: number,
  unitPrice: number | null | undefined,
): number | null {
  if (unitPrice === null || unitPrice === undefined) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return Math.round(quantity * unitPrice * 100) / 100;
}

/** An item can be sold when it has a price, is still stocked, and there is some. */
export function isSellable(
  salePrice: number | null | undefined,
  isActive: boolean,
  onHand: number,
): boolean {
  return salePrice !== null && salePrice !== undefined && isActive && onHand > 0;
}
