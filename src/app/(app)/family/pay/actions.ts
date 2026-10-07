"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, removeFile, uploadFile } from "@/lib/storage/files";
import { CLAIM_METHODS, readPaymentMethods, type PaymentMethods } from "@/lib/validations/payment-claims-display";
import type { ActionResult } from "../../library/actions";

/*
 * A family paying by bank or UPI (0353). The family says what they paid; the
 * office checks the bank and approves it into a receipt. Nothing here decides
 * whose child this is: payment_claim_submit does, and the policies decide what
 * each read returns.
 */

export type OpenInvoice = { id: string; number: string; dueDate: string; outstanding: number };
export type ClaimRow = {
  id: string;
  createdAt: string;
  invoiceNumber: string | null;
  amount: number;
  method: string;
  reference: string;
  paidOn: string;
  status: string;
  decisionNote: string | null;
  receiptId: string | null;
};

export async function getPayPage(studentId: string): Promise<{
  methods: PaymentMethods | null;
  invoices: OpenInvoice[];
  claims: ClaimRow[];
}> {
  const supabase = await createClient();
  const [settingRes, invoiceRes, claimRes] = await Promise.all([
    supabase.rpc("setting_value", { p_key: "fees.payment_methods" }),
    supabase
      .from("invoices")
      .select("id, invoice_number, due_date")
      .eq("student_id", studentId)
      .eq("status", "issued")
      .order("due_date")
      .order("invoice_number"),
    supabase
      .from("payment_claims")
      .select("id, created_at, invoice_id, amount, method, reference, paid_on, status, decision_note, ledger_entry_id")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(50),
  ]);
  if (invoiceRes.error) throw new Error(invoiceRes.error.message);
  if (claimRes.error) throw new Error(claimRes.error.message);

  const invoices = invoiceRes.data ?? [];
  const ids = invoices.map((i) => i.id);
  // Owed on an invoice is its lines less what was paid or credited against
  // it: the same arithmetic the invoice sheet prints.
  const [lineRes, entryRes] = ids.length
    ? await Promise.all([
        supabase.from("invoice_lines").select("invoice_id, amount").in("invoice_id", ids),
        supabase
          .from("ledger_entries")
          .select("invoice_id, amount")
          .in("invoice_id", ids)
          .in("entry_type", ["payment", "discount", "write_off"]),
      ])
    : [{ data: [] as { invoice_id: string; amount: number }[] }, { data: [] as { invoice_id: string | null; amount: number }[] }];
  const owed = new Map<string, number>();
  for (const l of lineRes.data ?? []) owed.set(l.invoice_id, (owed.get(l.invoice_id) ?? 0) + Number(l.amount));
  for (const e of entryRes.data ?? []) if (e.invoice_id) owed.set(e.invoice_id, (owed.get(e.invoice_id) ?? 0) + Number(e.amount));

  const numberOf = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const claims = claimRes.data ?? [];
  // A claim may name an invoice that has since been settled or cancelled and
  // so is not in the open list above.
  const missing = [...new Set(claims.map((c) => c.invoice_id).filter((x): x is string => !!x && !numberOf.has(x)))];
  if (missing.length) {
    const { data } = await supabase.from("invoices").select("id, invoice_number").in("id", missing);
    for (const i of data ?? []) numberOf.set(i.id, i.invoice_number);
  }

  return {
    methods: readPaymentMethods(settingRes.data),
    invoices: invoices
      .map((i) => ({ id: i.id, number: i.invoice_number, dueDate: i.due_date, outstanding: Math.round((owed.get(i.id) ?? 0) * 100) / 100 }))
      .filter((i) => i.outstanding > 0),
    claims: claims.map((c) => ({
      id: c.id,
      createdAt: c.created_at,
      invoiceNumber: c.invoice_id ? (numberOf.get(c.invoice_id) ?? null) : null,
      amount: Number(c.amount),
      method: c.method,
      reference: c.reference,
      paidOn: c.paid_on,
      status: c.status,
      decisionNote: c.decision_note,
      receiptId: c.ledger_entry_id,
    })),
  };
}

const claimSchema = z.object({
  studentId: z.string().uuid(),
  invoiceId: z.union([z.string().uuid(), z.literal("")]),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter the amount paid, in rupees.")
    .refine((v) => Number(v) > 0, "Enter the amount paid, in rupees."),
  method: z.enum(CLAIM_METHODS, { message: "Choose how you paid." }),
  reference: z.string().trim().min(4, "Give the transaction reference (UTR) from your bank or UPI app.").max(60),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date you paid."),
  note: z.string().trim().max(500).optional().default(""),
});

/**
 * Send a payment to the office. The screenshot is uploaded first and the claim
 * written second; if the claim is refused the screenshot is removed, because
 * an object nobody points at costs bytes nobody sees (rule 8).
 */
export async function sendPaymentClaim(form: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = claimSchema.safeParse({
    studentId: form.get("studentId"),
    invoiceId: form.get("invoiceId") ?? "",
    amount: form.get("amount"),
    method: form.get("method"),
    reference: form.get("reference"),
    paidOn: form.get("paidOn"),
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Sign in again." };

  let proofPath: string | null = null;
  const file = form.get("proof");
  if (file instanceof File && file.size > 0) {
    const up = await uploadFile(BUCKETS.documents, ctx.tenantId, `payment-proofs/${parsed.data.studentId}`, file);
    if (!up.ok) return { ok: false, error: up.error, fieldErrors: { proof: [up.error] } };
    proofPath = up.path;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payment_claim_submit", {
    p_student_id: parsed.data.studentId,
    p_invoice_id: parsed.data.invoiceId || null,
    p_amount: Number(parsed.data.amount),
    p_method: parsed.data.method,
    p_reference: parsed.data.reference,
    p_paid_on: parsed.data.paidOn,
    p_proof_path: proofPath,
    p_note: parsed.data.note || null,
  });
  if (error) {
    if (proofPath) await removeFile(BUCKETS.documents, proofPath);
    return { ok: false, error: error.message };
  }
  revalidatePath("/family/pay");
  return { ok: true, data: { id: data as string } };
}
