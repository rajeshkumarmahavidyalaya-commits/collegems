"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { payslipEditSchema } from "@/lib/validations/hr";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
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
  paidDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  isOverride: boolean;
  note: string | null;
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
    paidDays: Number(r.paid_days),
    lopDays: Number(r.lop_days),
    grossEarnings: Number(r.gross_earnings),
    totalDeductions: Number(r.total_deductions),
    netPay: Number(r.net_pay),
    isOverride: r.is_override,
    note: r.note,
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
): Promise<ActionResult<{ runId: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("payroll_preview", {
    p_period_month: periodMonth,
    p_note: note || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/payroll");
  return { ok: true, data: { runId: data as string } };
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

/** A person's own payslips, once they are real. A draft is still being argued about. */
export async function getMyPayslips(): Promise<
  { id: string; periodMonth: string; netPay: number; grossEarnings: number }[]
> {
  const supabase = await createClient();

  // Two queries rather than an embed: `payslips` reaches `payroll_runs`
  // through a composite (tenant_id, run_id, run_status) key, and embedding
  // across a composite key is not something this project has been able to
  // verify from its test environment.
  const { data: slips } = await supabase
    .from("payslips")
    .select("id, run_id, gross_earnings, net_pay")
    .eq("run_status", "finalised");

  if (!slips?.length) return [];

  const { data: runs } = await supabase
    .from("payroll_runs")
    .select("id, period_month")
    .in("id", slips.map((s) => s.run_id));

  const month = new Map((runs ?? []).map((r) => [r.id, r.period_month]));

  return slips
    .map((p) => ({
      id: p.id,
      periodMonth: month.get(p.run_id) ?? "",
      grossEarnings: Number(p.gross_earnings),
      netPay: Number(p.net_pay),
    }))
    .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth));
}
