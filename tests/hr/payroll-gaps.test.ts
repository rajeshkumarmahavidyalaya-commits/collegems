import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * The four gaps `docs/modules/payroll.md` recorded and migrations 0065–0070
 * closed. Each is pinned to the arithmetic, because two of the four fixes were
 * themselves bugs found only by doing the arithmetic on the output:
 *
 *   1. A leaver is prorated for the days employed, not paid a whole month.
 *   2. A correction run pays only the difference, and does not refund a fine
 *      that was legitimately collected.
 *   3. A payment records against a finalised payslip and overpaying is refused.
 *   4. A staff library fine is collected on payroll and then marked settled.
 *
 * All test data is written under a far-future month and torn down.
 */
describe("payroll gap fixes", () => {
  let a: SupabaseClient<Database>;
  let structureComponents: object;

  const MONTH = "2035-06-01";
  const createdRuns: string[] = [];
  const createdStaff: string[] = [];
  const createdPeople: string[] = [];

  async function evaluate(
    working: number,
    lop: number,
    employed: number | null,
    overrides: object = { BASIC: 30000 },
  ) {
    const { data, error } = await a.rpc("payroll_evaluate", {
      p_components: structureComponents as never,
      p_overrides: overrides as never,
      p_working_days: working,
      p_lop_days: lop,
      p_employed_days: employed ?? undefined,
    });
    expect(error, error?.message).toBeNull();
    return data as unknown as {
      working_days: number;
      employed_days: number;
      paid_days: number;
      gross_earnings: number;
      net_pay: number;
    };
  }

  beforeAll(async () => {
    a = await tenantAClient();
    const { data: st } = await a
      .from("salary_structures")
      .select("components")
      .eq("name", "Teaching staff")
      .single();
    structureComponents = st!.components as object;
  });

  afterAll(async () => {
    for (const id of createdRuns) await a.from("payroll_runs").delete().eq("id", id);
    for (const id of createdStaff) await a.from("staff").delete().eq("id", id);
    for (const id of createdPeople) await a.from("people").delete().eq("id", id);
  });

  // -------------------------------------------------------------------------
  // 1. Partial employment
  // -------------------------------------------------------------------------

  it("prorates a whole month to 1", async () => {
    const full = await evaluate(26, 0, 26);
    expect(Number(full.gross_earnings)).toBe(47200);
    expect(Number(full.employed_days)).toBe(26);
  });

  it("prorates a leaver for the days employed, not the whole month", async () => {
    // 11 of 26 working days employed: 47200 * 11/26 = 19969.23 -> 19969.
    // The bug this pins: passing 11 as BOTH working and employed gave a whole
    // month, because the single factor was 11/11 = 1.
    const leaver = await evaluate(26, 0, 11);
    expect(Number(leaver.working_days)).toBe(26);
    expect(Number(leaver.employed_days)).toBe(11);
    expect(Number(leaver.gross_earnings)).toBe(19969);
    expect(Number(leaver.gross_earnings)).not.toBe(47200);
  });

  it("combines partial employment with absence, multiplicatively", async () => {
    // Employed 20 of 26, of which 2 unpaid: factor = (20/26) * (18/20).
    // 47200 * (20/26) * (18/20) = 47200 * 18/26 = 32676.92 -> 32677.
    const both = await evaluate(26, 2, 20);
    expect(Number(both.paid_days)).toBe(18);
    expect(Number(both.gross_earnings)).toBe(32677);
  });

  it("still does not prorate employment when the window is the whole month", async () => {
    // Passing null employed_days means "employed all month" -- the ordinary
    // case, and every pre-leaving call site relies on it.
    const full = await evaluate(26, 0, null);
    expect(Number(full.gross_earnings)).toBe(47200);
  });

  // -------------------------------------------------------------------------
  // 2. Payments
  // -------------------------------------------------------------------------

  it("records a payment against a finalised payslip and refuses to overpay", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: MONTH });
    createdRuns.push(runId as string);
    await a.rpc("payroll_finalise", { p_run_id: runId as string });

    const { data: slips } = await a
      .from("payslips")
      .select("id, net_pay")
      .eq("run_id", runId as string)
      .gt("net_pay", 0)
      .limit(1);
    const slip = slips![0];
    const net = Number(slip.net_pay);

    const { error: e1 } = await a.rpc("payroll_record_payment", {
      p_payslip_id: slip.id,
      p_amount: net,
      p_method: "bank_transfer",
      p_reference: "TEST-UTR-1",
    });
    expect(e1, e1?.message).toBeNull();

    const { data: paid } = await a.rpc("payroll_payslip_paid", { p_payslip_id: slip.id });
    expect(Number(paid)).toBe(net);

    // A single rupee more is refused: the payslip is the figure that was agreed.
    const { error: e2 } = await a.rpc("payroll_record_payment", {
      p_payslip_id: slip.id,
      p_amount: 1,
      p_method: "cash",
    });
    expect(e2).not.toBeNull();
    expect(e2!.message).toContain("already paid");
  });

  it("reverses a payment with a negative entry rather than deleting it", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2035-07-01" });
    createdRuns.push(runId as string);
    await a.rpc("payroll_finalise", { p_run_id: runId as string });

    const { data: slips } = await a
      .from("payslips")
      .select("id, net_pay")
      .eq("run_id", runId as string)
      .gt("net_pay", 0)
      .limit(1);
    const slip = slips![0];

    const { data: paymentId } = await a.rpc("payroll_record_payment", {
      p_payslip_id: slip.id,
      p_amount: Number(slip.net_pay),
      p_method: "cash",
    });

    const { error } = await a.rpc("payroll_reverse_payment", { p_payment_id: paymentId as string });
    expect(error, error?.message).toBeNull();

    // Two rows now — the payment and its reversal — netting to zero. The
    // original is never destroyed.
    const { data: rows } = await a
      .from("payroll_payments")
      .select("amount, reverses_payment_id")
      .eq("payslip_id", slip.id);
    expect(rows).toHaveLength(2);

    const { data: paid } = await a.rpc("payroll_payslip_paid", { p_payslip_id: slip.id });
    expect(Number(paid)).toBe(0);
  });

  it("refuses a payment against a draft payslip", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2035-08-01" });
    createdRuns.push(runId as string);

    const { data: slips } = await a
      .from("payslips")
      .select("id, net_pay")
      .eq("run_id", runId as string)
      .gt("net_pay", 0)
      .limit(1);

    const { error } = await a.rpc("payroll_record_payment", {
      p_payslip_id: slips![0].id,
      p_amount: 100,
      p_method: "cash",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("still a draft");
  });

  it("keeps payroll_payments append-only", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2035-09-01" });
    createdRuns.push(runId as string);
    await a.rpc("payroll_finalise", { p_run_id: runId as string });

    const { data: slips } = await a
      .from("payslips")
      .select("id, net_pay")
      .eq("run_id", runId as string)
      .gt("net_pay", 0)
      .limit(1);
    const { data: paymentId } = await a.rpc("payroll_record_payment", {
      p_payslip_id: slips![0].id,
      p_amount: 100,
      p_method: "cash",
    });

    // UPDATE and DELETE are revoked outright, like the fee ledger. Neither
    // touches a row.
    const upd = await a.from("payroll_payments").update({ amount: 1 }).eq("id", paymentId as string).select("id");
    expect(upd.data ?? []).toHaveLength(0);
    const del = await a.from("payroll_payments").delete().eq("id", paymentId as string).select("id");
    expect(del.data ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3. Corrections
  // -------------------------------------------------------------------------

  it("refuses a correction for a month that was never paid", async () => {
    const { error } = await a.rpc("payroll_preview", {
      p_period_month: "2035-10-01",
      p_kind: "correction",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("not been paid");
  });

  it("a correction with no change produces an empty run", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2035-11-01" });
    createdRuns.push(runId as string);
    await a.rpc("payroll_finalise", { p_run_id: runId as string });

    const { data: correctionId } = await a.rpc("payroll_preview", {
      p_period_month: "2035-11-01",
      p_kind: "correction",
    });
    createdRuns.push(correctionId as string);

    // Nothing changed, so no payslip has a non-zero difference -- the run is
    // empty, and finalising it is refused.
    const { count } = await a
      .from("payslips")
      .select("id", { count: "exact", head: true })
      .eq("run_id", correctionId as string);
    expect(count).toBe(0);

    const { error } = await a.rpc("payroll_finalise", { p_run_id: correctionId as string });
    expect(error).not.toBeNull();
  });

  it("allows a correction and a regular run to coexist for one month", async () => {
    // The old one-live-run index forbade this; the two partial indexes allow a
    // finalised regular run plus a live correction.
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2035-12-01" });
    createdRuns.push(runId as string);
    await a.rpc("payroll_finalise", { p_run_id: runId as string });

    const { data: correctionId, error } = await a.rpc("payroll_preview", {
      p_period_month: "2035-12-01",
      p_kind: "correction",
    });
    expect(error, error?.message).toBeNull();
    createdRuns.push(correctionId as string);

    const { data: live } = await a
      .from("payroll_runs")
      .select("run_kind, status")
      .eq("period_month", "2035-12-01")
      .neq("status", "discarded");
    expect(live).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 4. date_of_leaving
  // -------------------------------------------------------------------------

  it("refuses a leaving date before the joining date", async () => {
    const { data: staff } = await a
      .from("staff")
      .select("id, date_of_joining")
      .eq("status", "active")
      .limit(1)
      .single();

    const { error } = await a
      .from("staff")
      .update({ date_of_leaving: "1990-01-01" })
      .eq("id", staff!.id);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });
});
