import type { Translator } from "@/lib/i18n/translate";
import { labelFor, optionsFor } from "./labels";
import { formatCurrency } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { VoucherLineInput } from "./accounts";

/**
 * The half of `accounts.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `accounts.ts` re-exports all of it.
 */

export const ACCOUNT_TYPES = [
  { value: "asset", label: "Asset", normal: "debit", sort: 1 },
  { value: "liability", label: "Liability", normal: "credit", sort: 2 },
  { value: "equity", label: "Equity", normal: "credit", sort: 3 },
  { value: "income", label: "Income", normal: "credit", sort: 4 },
  { value: "expense", label: "Expense", normal: "debit", sort: 5 },
] as const;

export const VOUCHER_STATUSES = [
  { value: "draft", label: "Draft", tone: "muted" },
  { value: "posted", label: "Posted", tone: "success" },
  { value: "void", label: "Void", tone: "muted" },
] as const;

export const SOURCE_KINDS = [
  { value: "manual", label: "Journal" },
  { value: "fee_ledger", label: "Fee receipt" },
  { value: "payroll_payment", label: "Salary payment" },
  { value: "reversal", label: "Reversal" },
] as const;

/** An empty or unparseable box is zero for totalling, never NaN. */
export function toAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function totalDebit(lines: { debit: string }[]): number {
  return lines.reduce((sum, l) => sum + toAmount(l.debit), 0);
}

export function totalCredit(lines: { credit: string }[]): number {
  return lines.reduce((sum, l) => sum + toAmount(l.credit), 0);
}

/**
 * How far out a half-built voucher is. Shown live while somebody types, because
 * "out by 40.00" is the only number that helps when a journal will not post.
 */
export function outOfBalanceBy(lines: { debit: string; credit: string }[]): number {
  return Math.round((totalDebit(lines) - totalCredit(lines)) * 100) / 100;
}

export function isBalanced(lines: { debit: string; credit: string }[]): boolean {
  return Math.abs(outOfBalanceBy(lines)) < 0.005 && totalDebit(lines) > 0;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function accountTypeLabel(value: string, t: Translator) {
  const found = ACCOUNT_TYPES.find((entry) => entry.value === value);
  return found ? labelFor(`accounts.type.${value}`, found.label, t) : value;
}

/** The same five, for a picker. A badge and its `<Select>` read one label. */
export function accountTypeOptions(t: Translator) {
  return optionsFor(ACCOUNT_TYPES, "accounts.type", t);
}

export function voucherStatusLabel(value: string, t: Translator) {
  const found = VOUCHER_STATUSES.find((s) => s.value === value);
  return found ? labelFor(`accounts.voucherStatus.${value}`, found.label, t) : value;
}

export function sourceKindLabel(value: string, t: Translator) {
  const found = SOURCE_KINDS.find((s) => s.value === value);
  return found ? labelFor(`accounts.source.${value}`, found.label, t) : value;
}

/**
 * Zero renders as a dash in a ledger column, not as `₹0.00` clutter.
 *
 * The locale is a parameter because this is a pure helper with no component to
 * hang a hook on — and because a ledger read in Urdu groups its digits the way
 * that reader expects (rule 15).
 */
export function formatColumn(value: number | string | null | undefined, locale: Locale) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return formatCurrency(n, locale);
}

/** A negative balance is shown in brackets, as an accountant expects. */
export function formatBalance(value: number | string | null | undefined, locale: Locale) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n < 0) return `(${formatCurrency(Math.abs(n), locale)})`;
  return formatCurrency(n, locale);
}

// Moved from `accounts.ts` so a screen can use these without loading zod.

export function emptyLine(): VoucherLineInput {
  return { accountId: "", debit: "", credit: "", narration: "" };
}
