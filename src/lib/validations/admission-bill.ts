/**
 * What `fees_bill_on_admission` answered (0286), read defensively.
 *
 * No imports, deliberately: the student form reaches this through its server
 * action, and a label module that grows `import { z }` becomes the thing it was
 * extracted from (`fees-display.ts`).
 */
export type AdmissionBill =
  | { billed: true; invoiceNumber: string; amount: number }
  | { billed: false; reason: string | null };

export function parseAdmissionBill(raw: unknown): AdmissionBill {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (o.billed === true && typeof o.invoiceNumber === "string") {
    return { billed: true, invoiceNumber: o.invoiceNumber, amount: Number(o.amount ?? 0) };
  }
  return { billed: false, reason: typeof o.reason === "string" && o.reason.trim() ? o.reason : null };
}

/**
 * The second line of the "admitted" toast, or null when there is nothing to
 * say -- no fee head is set to bill on admission, which is the default.
 * `money` is the amount already formatted for the reader's locale.
 */
export function admissionBillSentence(bill: AdmissionBill, money: string): string | null {
  if (bill.billed) return `Admission fees billed: invoice ${bill.invoiceNumber} for ${money}.`;
  return bill.reason;
}
