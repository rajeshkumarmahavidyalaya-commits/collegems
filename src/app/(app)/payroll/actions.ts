"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { paymentSchema, payslipEditSchema } from "@/lib/validations/hr";
import type { ActionResult } from "../library/actions";
import { getUserContext } from "@/lib/auth/context";
import type { PayslipDocumentInput } from "@/lib/pdf/payslip";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

export type RunRow = {
  id: string;
  periodMonth: string;
  status: string;
  note: string | null;
  finalisedAt: string | null;
  createdAt: string;
  payslipCount: number;
  totalNet: number;
};

export async function listRuns(): Promise<RunRow[]> {
  const supabase = await createClient();

  const [runsRes, slipsRes] = await Promise.all([
    supabase
      .from("payroll_runs")
      .select("id, period_month, status, note, finalised_at, created_at")
      .order("period_month", { ascending: false }),
    supabase.from("payslips").select("run_id, net_pay"),
  ]);

  if (runsRes.error) throw new Error(runsRes.error.message);

  const tally = new Map<string, { count: number; net: number }>();
  for (const s of slipsRes.data ?? []) {
    const row = tally.get(s.run_id) ?? { count: 0, net: 0 };
    row.count += 1;
    row.net += Number(s.net_pay);
    tally.set(s.run_id, row);
  }

  return (runsRes.data ?? []).map((r) => {
    const counts = tally.get(r.id) ?? { count: 0, net: 0 };
    return {
      id: r.id,
      periodMonth: r.period_month,
      status: r.status,
      note: r.note,
      finalisedAt: r.finalised_at,
      createdAt: r.created_at,
      payslipCount: counts.count,
      totalNet: counts.net,
    };
  });
}

export async function getRun(id: string): Promise<RunRow | null> {
  const runs = await listRuns();
  return runs.find((r) => r.id === id) ?? null;
}

export type RegisterRow = {
  payslipId: string;
  staffId: string;
  employeeCode: string;
  staffName: string;
  designation: string;
  structureName: string | null;
  workingDays: number;
  employedDays: number;
  paidDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  isOverride: boolean;
  note: string | null;
  amountPaid: number;
  hasLeft: boolean;
};

export async function getRegister(runId: string): Promise<RegisterRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_register", { p_run_id: runId });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    payslipId: r.payslip_id,
    staffId: r.staff_id,
    employeeCode: r.employee_code,
    staffName: r.staff_name,
    designation: r.designation,
    structureName: r.structure_name,
    workingDays: Number(r.working_days),
    employedDays: Number(r.employed_days),
    paidDays: Number(r.paid_days),
    lopDays: Number(r.lop_days),
    grossEarnings: Number(r.gross_earnings),
    totalDeductions: Number(r.total_deductions),
    netPay: Number(r.net_pay),
    isOverride: r.is_override,
    note: r.note,
    amountPaid: Number(r.amount_paid),
    hasLeft: r.has_left,
  }));
}

export type PayslipLineRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  amount: number;
  basis: string | null;
};

export async function getPayslipLines(
  payslipIds: string[],
): Promise<Record<string, PayslipLineRow[]>> {
  if (payslipIds.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payslip_lines")
    .select("id, payslip_id, code, name, kind, amount, basis, sort_order")
    .in("payslip_id", payslipIds)
    .order("sort_order");

  if (error) throw new Error(error.message);

  const byPayslip: Record<string, PayslipLineRow[]> = {};
  for (const l of data ?? []) {
    (byPayslip[l.payslip_id] ??= []).push({
      id: l.id,
      code: l.code,
      name: l.name,
      kind: l.kind,
      amount: Number(l.amount),
      basis: l.basis,
    });
  }
  return byPayslip;
}

export async function previewPayroll(
  periodMonth: string,
  note?: string,
  kind: "regular" | "correction" = "regular",
): Promise<ActionResult<{ runId: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_preview", {
    p_period_month: periodMonth,
    p_note: note || undefined,
    p_kind: kind,
  });

  if (error) return fail(error.message);

  revalidatePath("/payroll");
  return { ok: true, data: { runId: data as string } };
}

// ---------------------------------------------------------------------------
// Paying a payslip
// ---------------------------------------------------------------------------

export type PaymentRow = {
  id: string;
  amount: number;
  paidOn: string;
  method: string;
  reference: string | null;
  note: string | null;
  isReversal: boolean;
};

export async function listPayments(payslipId: string): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payroll_payments")
    .select("id, amount, paid_on, method, reference, note, reverses_payment_id")
    .eq("payslip_id", payslipId)
    .order("created_at");

  if (error) throw new Error(error.message);

  return (data ?? []).map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    paidOn: p.paid_on,
    method: p.method,
    reference: p.reference,
    note: p.note,
    isReversal: p.reverses_payment_id !== null,
  }));
}

export async function recordPayment(input: unknown): Promise<ActionResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_record_payment", {
    p_payslip_id: parsed.data.payslipId,
    p_amount: Number(parsed.data.amount),
    p_method: parsed.data.method,
    p_reference: parsed.data.reference || undefined,
    p_paid_on: parsed.data.paidOn || undefined,
    p_note: parsed.data.note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/payroll");
  return { ok: true, data: undefined };
}

export async function reversePayment(paymentId: string, note?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_reverse_payment", {
    p_payment_id: paymentId,
    p_note: note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/payroll");
  return { ok: true, data: undefined };
}

/**
 * Rule 13: applying writes what the rows say. So an edit here changes the
 * payslip and nothing recomputes it afterwards — an administrator who
 * corrected somebody's slip and then watched it revert would never trust the
 * screen again.
 *
 * `is_override` is what separates "the structure decided" from "the head
 * teacher decided", and both belong in the audit log.
 */
export async function editPayslip(input: unknown): Promise<ActionResult> {
  const parsed = payslipEditSchema.safeParse(input);
  if (!parsed.success) return fail("That payslip edit is not one this system understands.");

  const gross = Number(parsed.data.grossEarnings);
  const deductions = Number(parsed.data.totalDeductions);

  if (!Number.isFinite(gross) || gross < 0) return fail("Gross earnings must be zero or more.");
  if (!Number.isFinite(deductions) || deductions < 0) {
    return fail("Deductions must be zero or more.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payslips")
    .update({
      gross_earnings: gross,
      total_deductions: deductions,
      net_pay: gross - deductions,
      is_override: true,
      note: parsed.data.note || null,
    })
    .eq("id", parsed.data.payslipId)
    .select("id");

  if (error) return fail(error.message);
  // No policy matches a finalised payslip, so the update silently touches
  // nothing. Saying so is better than reporting a success that did not happen.
  if (!data?.length) {
    return fail("This payslip has been finalised and can no longer be changed.");
  }

  revalidatePath("/payroll");
  return { ok: true, data: undefined };
}

export async function recomputePayslip(payslipId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_recompute_payslip", { p_payslip_id: payslipId });
  if (error) return fail(error.message);

  revalidatePath("/payroll");
  return { ok: true, data: undefined };
}

export async function finalisePayroll(runId: string): Promise<ActionResult<{ count: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_finalise", { p_run_id: runId });
  if (error) return fail(error.message);

  revalidatePath("/payroll");
  revalidatePath(`/payroll/${runId}`);
  return { ok: true, data: { count: data ?? 0 } };
}

export async function discardPayroll(runId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("payroll_discard", { p_run_id: runId });
  if (error) return fail(error.message);

  revalidatePath("/payroll");
  return { ok: true, data: undefined };
}

/**
 * A person's own payslips, once they are real. A draft is still being argued about.
 *
 * The month is the slip's own column (0300). It used to be read from
 * `payroll_runs`, which only admin and accountant may read, so to the teacher
 * this list is for every month came back blank.
 */
export async function getMyPayslips(): Promise<
  { id: string; periodMonth: string; netPay: number; grossEarnings: number }[]
> {
  const supabase = await createClient();

  const { data: slips } = await supabase
    .from("payslips")
    .select("id, period_month, gross_earnings, net_pay")
    .eq("run_status", "finalised")
    .order("period_month", { ascending: false })
    .order("id");

  return (slips ?? []).map((p) => ({
    id: p.id,
    periodMonth: p.period_month,
    grossEarnings: Number(p.gross_earnings),
    netPay: Number(p.net_pay),
  }));
}

export type PayslipDocument = PayslipDocumentInput & { id: string; staffId: string };

/**
 * One salary slip, as the paper a member of staff is handed (0300).
 *
 * Every read goes through the caller's own policies: an administrator or
 * accountant reads any slip, a member of staff their own **finalised** ones,
 * and anybody else gets null -- which the page turns into a 404 that claims
 * nothing, because under RLS "no such slip" and "not your slip" are the same
 * answer. The month is the slip's own column (0300), not the run's: the run
 * carries every salary structure in the college and is not theirs to read.
 */
export async function getPayslipDocument(payslipId: string): Promise<PayslipDocument | null> {
  if (!/^[0-9a-f-]{36}$/i.test(payslipId)) return null;
  const supabase = await createClient();

  const { data: slip, error } = await supabase
    .from("payslips")
    .select(
      "id, staff_id, run_status, period_month, working_days, employed_days, paid_days, lop_days, gross_earnings, total_deductions, net_pay, note",
    )
    .eq("id", payslipId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!slip) return null;

  const [ctx, linesRes, staffRes, directoryRes, paymentsRes, profileRes] = await Promise.all([
    getUserContext(),
    supabase
      .from("payslip_lines")
      .select("code, name, kind, amount, sort_order")
      .eq("payslip_id", slip.id)
      .order("sort_order"),
    supabase
      .from("staff")
      .select("employee_code, designation, department")
      .eq("id", slip.staff_id)
      .maybeSingle(),
    // The name through the staff directory, which every member may read
    // (0184); people's own policies are not what this document is about.
    supabase.rpc("staff_directory"),
    supabase
      .from("payroll_payments")
      .select("amount, paid_on, method")
      .eq("payslip_id", slip.id)
      .order("paid_on"),
    supabase.from("settings").select("value").eq("key", "school.profile").maybeSingle(),
  ]);
  if (linesRes.error) throw new Error(linesRes.error.message);

  const name =
    (directoryRes.data ?? []).find((d) => d.staff_id === slip.staff_id)?.full_name ?? "";
  const profile = (profileRes.data?.value ?? {}) as Record<string, string | null>;
  const payments = paymentsRes.data ?? [];
  const lastPayment = [...payments].reverse().find((p) => Number(p.amount) > 0) ?? null;

  return {
    id: slip.id,
    staffId: slip.staff_id,
    school: {
      name: ctx?.tenantName ?? "",
      addressLine1: profile.address_line1 ?? null,
      addressLine2: profile.address_line2 ?? null,
      city: profile.city ?? null,
      state: profile.state ?? null,
      postalCode: profile.postal_code ?? null,
      phone: profile.phone ?? null,
      email: profile.email ?? null,
      website: profile.website ?? null,
    },
    periodMonth: slip.period_month,
    draft: slip.run_status !== "finalised",
    staff: {
      name,
      employeeCode: staffRes.data?.employee_code ?? "",
      designation: staffRes.data?.designation ?? "",
      department: staffRes.data?.department ?? null,
    },
    days: {
      working: Number(slip.working_days),
      employed: Number(slip.employed_days),
      paid: Number(slip.paid_days),
      lop: Number(slip.lop_days),
    },
    earnings: (linesRes.data ?? [])
      .filter((l) => l.kind === "earning")
      .map((l) => ({ name: l.name, amount: Number(l.amount) })),
    deductions: (linesRes.data ?? [])
      .filter((l) => l.kind === "deduction")
      .map((l) => ({ name: l.name, amount: Number(l.amount) })),
    gross: Number(slip.gross_earnings),
    totalDeductions: Number(slip.total_deductions),
    net: Number(slip.net_pay),
    paid: payments.reduce((sum, p) => sum + Number(p.amount), 0),
    lastPaidOn: lastPayment?.paid_on ?? null,
    lastMethod: lastPayment?.method ?? null,
    note: slip.note,
  };
}
