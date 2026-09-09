/**
 * The fee module's vocabulary and its display helpers — **and no Zod.**
 *
 * `fees.ts` imports Zod, which is a 91 kB client chunk. Eleven components
 * imported nothing from it but `formatMoney`, `methodLabel` or
 * `entryTypeLabel`, and paid the 91 kB for it — including the dashboard, whose
 * only use of the module is one currency formatter, and `/fees`, `/fees/daybook`
 * and `/library/issues`, which have no form on them at all.
 *
 * A validation schema belongs in the browser when a form validates against it;
 * a label does not. The split is that line, and `fees.ts` re-exports everything
 * here so nothing that wants both has to import twice.
 *
 * **Keep this file free of imports.** One `import { z }` and it silently
 * becomes the thing it was extracted from.
 */

export const ENTRY_TYPES = [
  { value: "payment", label: "Payment", sign: "credit", description: "Money received" },
  { value: "discount", label: "Discount", sign: "credit", description: "A concession granted" },
  { value: "write_off", label: "Write-off", sign: "credit", description: "Debt the school will not pursue" },
  { value: "fine", label: "Fine", sign: "charge", description: "An extra amount owed" },
  { value: "refund", label: "Refund", sign: "charge", description: "Money paid back out" },
] as const;

export type EntryType = (typeof ENTRY_TYPES)[number]["value"];

export const ADJUSTMENT_TYPES = ENTRY_TYPES.filter(
  (t) => t.value === "discount" || t.value === "fine" || t.value === "write_off",
);

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
  { value: "netbanking", label: "Net banking" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "online", label: "Online gateway" },
] as const;

export function entryTypeLabel(value: string): string {
  return ENTRY_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function methodLabel(value: string | null): string {
  if (!value) return "—";
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
}
