import { z } from "zod";

/**
 * The vocabulary of the ledger, kept in one place so the Zod schemas, the UI
 * and the Postgres check constraints cannot drift apart.
 *
 * `sign` is documentation, not arithmetic: the database stores the signed
 * amount and the RPCs do the signing. Every form here takes a positive number,
 * the way a person types it at a cash desk.
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

export const FEE_CATEGORIES = [
  { value: "tuition", label: "Tuition" },
  { value: "transport", label: "Transport" },
  { value: "hostel", label: "Hostel" },
  { value: "exam", label: "Exam" },
  { value: "library", label: "Library" },
  { value: "activity", label: "Activity" },
  { value: "other", label: "Other" },
] as const;

export const FEE_FREQUENCIES = [
  { value: "one_time", label: "One time" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

/**
 * Money caps at ten million, which is far beyond any single school fee and far
 * below `numeric(12,2)`'s limit -- a typo of four extra zeros should be caught
 * here rather than booked.
 */
const money = z
  .number({ message: "Enter an amount" })
  .positive("Enter an amount greater than zero")
  .max(10_000_000, "That is larger than this system will book in one entry")
  .refine((v) => Number.isFinite(v), "Enter a valid amount")
  .refine((v) => Math.round(v * 100) === v * 100, "At most two decimal places");

export const paymentSchema = z.object({
  studentId: z.string().uuid(),
  amount: money,
  method: z.enum(["cash", "cheque", "card", "upi", "netbanking", "bank_transfer", "online"]),
  occurredAt: isoDate,
  reference: z.string().max(100).optional(),
  invoiceId: z.union([z.string().uuid(), z.literal("")]).optional(),
  note: z.string().max(300).optional(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const refundSchema = z.object({
  studentId: z.string().uuid(),
  amount: money,
  method: z.enum(["cash", "cheque", "card", "upi", "netbanking", "bank_transfer", "online"]),
  occurredAt: isoDate,
  reference: z.string().max(100).optional(),
  note: z.string().max(300).optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

/** Discounts, fines and write-offs. The reason is mandatory in Postgres too. */
export const adjustmentSchema = z.object({
  studentId: z.string().uuid(),
  entryType: z.enum(["discount", "fine", "write_off"]),
  amount: money,
  note: z.string().min(3, "Say why -- this is a permanent record").max(300),
  invoiceId: z.union([z.string().uuid(), z.literal("")]).optional(),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const reversalSchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().min(3, "Say why -- this is a permanent record").max(300),
});

export const feeHeadSchema = z.object({
  code: z
    .string()
    .min(1, "A short code is required")
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only"),
  name: z.string().min(1, "A name is required").max(100),
  description: z.string().max(300).optional(),
  category: z.enum(["tuition", "transport", "hostel", "exam", "library", "activity", "other"]),
  isActive: z.boolean(),
});
export type FeeHeadInput = z.infer<typeof feeHeadSchema>;

export const feeStructureSchema = z.object({
  classLevelId: z.string().uuid("Choose a class"),
  feeHeadId: z.string().uuid("Choose a fee head"),
  // Zero is allowed here, unlike a payment: "this class pays nothing for
  // transport" is a real thing to record.
  amount: z
    .number({ message: "Enter an amount" })
    .min(0, "Cannot be negative")
    .max(10_000_000, "That is larger than this system will bill"),
  frequency: z.enum(["one_time", "monthly", "quarterly", "annual"]),
});
export type FeeStructureInput = z.infer<typeof feeStructureSchema>;

export const generateInvoiceSchema = z.object({
  studentId: z.string().uuid(),
  dueDate: isoDate,
  notes: z.string().max(300).optional(),
});

export const generateSectionInvoicesSchema = z.object({
  sectionId: z.string().uuid("Choose a class"),
  dueDate: isoDate,
});

export const cancelInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().min(3, "Say why -- this is a permanent record").max(300),
});

/**
 * Indian-format currency. The ledger stores `numeric(12,2)`, which supabase-js
 * hands back as a JS number -- safe here because the cap above keeps every
 * amount far inside the range where a double represents cents exactly.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function entryTypeLabel(value: string): string {
  return ENTRY_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function methodLabel(value: string | null): string {
  if (!value) return "—";
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
}
