"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { BUCKETS, signedUrlFor } from "@/lib/storage/files";
import type { ActionResult } from "../../library/actions";

/*
 * Verify Payments (0353): what families say they paid, for the office to check
 * against the bank. The policies decide who reads these (the roles that read
 * the ledger); approving writes the receipt through fees_record_payment as the
 * caller.
 */

export type ClaimStatus = "pending" | "approved" | "rejected";

export type VerifyRow = {
  id: string;
  createdAt: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: number;
  method: string;
  reference: string;
  paidOn: string;
  note: string | null;
  hasProof: boolean;
  decisionNote: string | null;
  decidedAt: string | null;
  receiptId: string | null;
};

const PAGE = 200;

export async function listClaims(status: ClaimStatus): Promise<{ rows: VerifyRow[]; total: number; counts: Record<ClaimStatus, number> }> {
  const supabase = await createClient();
  const [res, ...countRes] = await Promise.all([
    supabase
      .from("payment_claims")
      .select(
        "id, created_at, student_id, invoice_id, amount, method, reference, paid_on, note, proof_path, decision_note, decided_at, ledger_entry_id",
        { count: "exact" },
      )
      .eq("status", status)
      // Oldest first while waiting, so nobody's payment sits at the bottom;
      // newest first once decided.
      .order(status === "pending" ? "created_at" : "decided_at", { ascending: status === "pending" })
      .order("id")
      .limit(PAGE),
    ...(["pending", "approved", "rejected"] as const).map((s) =>
      supabase.from("payment_claims").select("id", { count: "exact", head: true }).eq("status", s),
    ),
  ]);
  if (res.error) throw new Error(res.error.message);
  const claims = res.data ?? [];

  const studentIds = [...new Set(claims.map((c) => c.student_id))];
  const invoiceIds = [...new Set(claims.map((c) => c.invoice_id).filter((x): x is string => !!x))];
  const [studentRes, invoiceRes] = await Promise.all([
    studentIds.length
      ? supabase.from("students").select("id, admission_number, people:person_id ( first_name, last_name )").in("id", studentIds)
      : Promise.resolve({ data: [] }),
    invoiceIds.length
      ? supabase.from("invoices").select("id, invoice_number").in("id", invoiceIds)
      : Promise.resolve({ data: [] as { id: string; invoice_number: string }[] }),
  ]);
  const students = new Map(
    (studentRes.data ?? []).map((s) => [
      s.id,
      { name: s.people ? `${s.people.first_name} ${s.people.last_name}` : "Unknown", admission: s.admission_number },
    ]),
  );
  const invoices = new Map((invoiceRes.data ?? []).map((i) => [i.id, i.invoice_number]));

  return {
    rows: claims.map((c) => ({
      id: c.id,
      createdAt: c.created_at,
      studentId: c.student_id,
      studentName: students.get(c.student_id)?.name ?? "Unknown",
      admissionNumber: students.get(c.student_id)?.admission ?? "—",
      invoiceId: c.invoice_id,
      invoiceNumber: c.invoice_id ? (invoices.get(c.invoice_id) ?? null) : null,
      amount: Number(c.amount),
      method: c.method,
      reference: c.reference,
      paidOn: c.paid_on,
      note: c.note,
      hasProof: !!c.proof_path,
      decisionNote: c.decision_note,
      decidedAt: c.decided_at,
      receiptId: c.ledger_entry_id,
    })),
    total: res.count ?? claims.length,
    counts: {
      pending: countRes[0].count ?? 0,
      approved: countRes[1].count ?? 0,
      rejected: countRes[2].count ?? 0,
    },
  };
}

/** A short-lived link to the screenshot, signed only after the claim is read back through RLS (rule 8). */
export async function proofLink(claimId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const { data } = await supabase.from("payment_claims").select("proof_path").eq("id", claimId).maybeSingle();
  if (!data?.proof_path) return { ok: false, error: "There is no screenshot with this payment." };
  const url = await signedUrlFor(BUCKETS.documents, data.proof_path, 300);
  if (!url) return { ok: false, error: "The screenshot could not be opened. Try again." };
  return { ok: true, data: { url } };
}

export async function approveClaim(claimId: string): Promise<ActionResult<{ receiptNumber: string | null; entryId: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payment_claim_approve", { p_claim_id: claimId });
  if (error) return { ok: false, error: error.message };
  // A failed announcement is not a failed payment (rule 10).
  const { error: notifyError } = await supabase.rpc("fees_announce_payment", { p_ledger_entry_id: data.id });
  if (notifyError) console.error("[fees] fees_announce_payment did not go out:", notifyError.message);
  revalidatePath("/fees/verify");
  revalidatePath("/fees");
  return { ok: true, data: { receiptNumber: data.receipt_number, entryId: data.id } };
}

export async function rejectClaim(claimId: string, reason: string): Promise<ActionResult> {
  const text = reason.trim();
  if (text.length < 3) return { ok: false, error: "Say why, so the family knows what to do next.", fieldErrors: { reason: ["Say why."] } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("payment_claim_reject", { p_claim_id: claimId, p_reason: text });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/fees/verify");
  return { ok: true, data: undefined };
}
