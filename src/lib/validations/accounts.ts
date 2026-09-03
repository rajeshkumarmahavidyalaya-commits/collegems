import { z } from "zod";

/**
 * Phase 2.2 — the chart of accounts and double-entry vouchers.
 *
 * The balance rule (debits equal credits) is checked here too, but the browser
 * is the convenience and `accounts_post_voucher` is the gate: it is a fact
 * about several rows, so Postgres owns it.
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

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const accountSchema = z.object({
  code: z
    .string()
    .min(1, "A code is required")
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, dots, dashes and underscores only"),
  name: z.string().min(1, "A name is required").max(120),
  accountType: z.enum(["asset", "liability", "equity", "income", "expense"]),
  parentId: z.union([z.string().uuid(), z.literal("")]).optional(),
  // A group account totals its children; a postable one is where a line lands.
  // Posting to a group would double-count its own total, so the database
  // refuses it through a foreign key.
  isPostable: z.boolean(),
  isActive: z.boolean(),
  description: z.string().max(300).optional(),
});
export type AccountInput = z.infer<typeof accountSchema>;

/**
 * One line of a voucher. Debit and credit are strings because an empty box is
 * "this side is not used", which is different from zero — and `z.coerce` would
 * collapse the two as well as breaking the resolver.
 */
export const voucherLineSchema = z
  .object({
    accountId: z.string().uuid("Choose an account"),
    debit: z.string(),
    credit: z.string(),
    narration: z.string().max(200).optional(),
  })
  .refine((v) => !(toAmount(v.debit) > 0 && toAmount(v.credit) > 0), {
    message: "A line is a debit or a credit, never both",
    path: ["credit"],
  })
  .refine((v) => toAmount(v.debit) > 0 || toAmount(v.credit) > 0, {
    message: "Enter an amount on one side",
    path: ["debit"],
  });
export type VoucherLineInput = z.infer<typeof voucherLineSchema>;

export const voucherSchema = z
  .object({
    voucherDate: isoDate,
    narration: z.string().max(300).optional(),
    lines: z.array(voucherLineSchema).min(2, "A voucher needs at least two lines to balance"),
  })
  .refine((v) => Math.abs(totalDebit(v.lines) - totalCredit(v.lines)) < 0.005, {
    message: "Debits and credits must be equal",
    path: ["lines"],
  })
  .refine((v) => totalDebit(v.lines) > 0, {
    message: "A voucher of zero moves nothing",
    path: ["lines"],
  });
export type VoucherInput = z.infer<typeof voucherSchema>;

export const postingRuleSchema = z
  .object({
    eventKey: z.string().min(1).max(40),
    debitAccountId: z.string().uuid("Choose an account to debit"),
    creditAccountId: z.string().uuid("Choose an account to credit"),
    isActive: z.boolean(),
  })
  .refine((v) => v.debitAccountId !== v.creditAccountId, {
    message: "A rule cannot debit and credit the same account",
    path: ["creditAccountId"],
  });
export type PostingRuleInput = z.infer<typeof postingRuleSchema>;

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

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

export function accountTypeLabel(value: string) {
  return ACCOUNT_TYPES.find((t) => t.value === value)?.label ?? value;
}

/** Which column an account's balance naturally sits in. */
export function normalSide(accountType: string): "debit" | "credit" {
  return ACCOUNT_TYPES.find((t) => t.value === accountType)?.normal === "credit"
    ? "credit"
    : "debit";
}

export function voucherStatusLabel(value: string) {
  return VOUCHER_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export function sourceKindLabel(value: string) {
  return SOURCE_KINDS.find((s) => s.value === value)?.label ?? value;
}

/** `₹45,200.00`. Two decimals always: a ledger that rounds is a ledger nobody trusts. */
export function formatAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/** Zero renders as a dash in a ledger column, not as `₹0.00` clutter. */
export function formatColumn(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return formatAmount(n);
}

/** A negative balance is shown in brackets, as an accountant expects. */
export function formatBalance(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (n < 0) return `(${formatAmount(Math.abs(n))})`;
  return formatAmount(n);
}

export function emptyLine(): VoucherLineInput {
  return { accountId: "", debit: "", credit: "", narration: "" };
}
