import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * `inventory.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `inventory.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
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

/** `15` → `"15"`, `15.5` → `"15.5"`. Mirrors `format_quantity` in Postgres. */
export function formatQuantity(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

/** `15` + `"box"` → `"15 box"`. The unit is the school's word, not ours. */
export function quantityWithUnit(
  value: number | string | null | undefined,
  unit: string,
): string {
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
export function stockTone(
  onHand: number,
  reorderLevel: number,
): "ok" | "low" | "out" {
  if (onHand <= 0) return "out";
  if (needsReorder(onHand, reorderLevel)) return "low";
  return "ok";
}

export function stockSentence(
  onHand: number,
  reorderLevel: number,
  unit: string,
): string {
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
  return (
    salePrice !== null && salePrice !== undefined && isActive && onHand > 0
  );
}
