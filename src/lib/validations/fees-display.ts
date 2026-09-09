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
 * **Keep this file free of *value* imports.** One `import { z }` and it
 * silently becomes the thing it was extracted from.
 *
 * The two below are the qualification, added when the labels learned to speak
 * the reader's language. `labelFor` is a five-line lookup in a file with no
 * imports of its own, and `Translator` is a **type**, erased at build — so the
 * catalogue reaches a call site through the `t` a component already holds, not
 * through this module.
 *
 * Measured, because the point of this file is a number: `/fees/daybook` went
 * 4.30 → 4.43 kB and 190 → 192 kB First Load. **Neither kilobyte is this
 * import.** The 0.13 is the call sites gaining an argument; the 2 is the
 * message catalogue itself growing by ~50 keys in three languages, which every
 * client route paid equally — `/academics` and `/accounts` moved the same 2 kB
 * without being touched, and the Server-Component-only routes (`/checks`,
 * `/certificates`, `/accounts/[accountId]`, all at 107 kB) did not move at all.
 * The catalogues travel in the bundle deliberately; the alternative is a screen
 * that renders in English and flickers into Hindi.
 *
 * If a future edit here needs a *value* import, it belongs somewhere else.
 */
import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

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

export function entryTypeLabel(value: string, t: Translator): string {
  const found = ENTRY_TYPES.find((e) => e.value === value);
  return found ? labelFor(`fees.entryType.${value}`, found.label, t) : value;
}

export function entryTypeOptions(t: Translator) {
  return optionsFor(ENTRY_TYPES, "fees.entryType", t);
}

export function methodLabel(value: string | null, t: Translator): string {
  if (!value) return "—";
  const found = PAYMENT_METHODS.find((m) => m.value === value);
  return found ? labelFor(`fees.method.${value}`, found.label, t) : value;
}

export function paymentMethodOptions(t: Translator) {
  return optionsFor(PAYMENT_METHODS, "fees.method", t);
}

/** The subset a counter clerk may raise by hand. Same keys, fewer values. */
export function adjustmentTypeOptions(t: Translator) {
  return optionsFor(ADJUSTMENT_TYPES, "fees.entryType", t);
}
