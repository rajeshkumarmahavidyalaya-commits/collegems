import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/*
 * Words and links for a payment a family says they made (0353). No Zod here:
 * a module with `import { z }` in it charges every page that shows one of
 * these labels for it (docs/performance.md).
 */

/** The ways a family can pay that leave a reference the office can check. */
export const CLAIM_METHODS = ["upi", "bank_transfer", "netbanking", "cheque"] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];

export const CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for the office",
  approved: "Approved",
  rejected: "Turned down",
};

/** The fallback is the value, not a key (rule 15). */
export function claimStatusLabel(status: string, t: Translator): string {
  return STATUS_LABEL[status] ? labelFor(`paymentClaims.status.${status}`, STATUS_LABEL[status], t) : status;
}

export type PaymentMethods = {
  accountName: string | null;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  upiId: string | null;
  instructions: string | null;
};

/** Read `fees.payment_methods` as it is stored; null when neither a bank account nor a UPI ID is set. */
export function readPaymentMethods(value: unknown): PaymentMethods | null {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" && (v[k] as string).trim() ? (v[k] as string).trim() : null);
  const m: PaymentMethods = {
    accountName: s("account_name"),
    bankName: s("bank_name"),
    accountNumber: s("account_number"),
    ifsc: s("ifsc"),
    branch: s("branch"),
    upiId: s("upi_id"),
    instructions: s("instructions"),
  };
  return m.accountNumber || m.upiId ? m : null;
}

/**
 * The standard UPI deep link (NPCI's `upi://pay`), which every UPI app opens
 * from a QR code. The amount is fixed only when one is given, and the note
 * carries the invoice number so the office can match the statement line.
 * Null for an ID that is not shaped like a VPA, rather than a code that opens
 * an app on an error.
 */
export function upiLink(upiId: string, payeeName: string | null, amount?: number | null, note?: string | null): string | null {
  if (!/^[\w.\-]{2,256}@[a-zA-Z][\w.\-]{1,63}$/.test(upiId)) return null;
  const params = new URLSearchParams({ pa: upiId, cu: "INR" });
  if (payeeName) params.set("pn", payeeName.slice(0, 50));
  if (amount != null && Number.isFinite(amount) && amount > 0) params.set("am", amount.toFixed(2));
  if (note) params.set("tn", note.slice(0, 50));
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}
