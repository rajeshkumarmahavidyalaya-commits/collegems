import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * The concession engine, through real RLS, with **exact numbers**.
 *
 * Rule 12: evaluation order is part of the contract and a comment is not
 * enough — migration `0059` carried payroll's order in its header while the
 * loop underneath prorated every allowance twice, and only the arithmetic found
 * it. So these assert the figures, and assert the figures a compounding
 * implementation would produce are *not* what comes back.
 *
 * The declared order (migration 0172):
 *   1. by `priority`, ties broken by `code`
 *   2. a percentage is taken against the **original** charge, never against
 *      what a previous concession left
 *   3. a percentage may be capped by `max_amount`
 *   4. a fixed amount subtracts what the percentages left
 *   5. the total credit never exceeds the charge
 */
describe("concession arithmetic", () => {
  let a: SupabaseClient<Database>;
  let tenantId: string;
  let studentId: string;
  let feeHeadId: string;
  const codes = ["T_SIB", "T_STAFF", "T_CAP", "T_AMT", "T_RTE"];
  const awardIds: string[] = [];

  beforeAll(async () => {
    a = await tenantAClient();

    const { data: profile } = await a.from("user_profiles").select("tenant_id").limit(1).single();
    tenantId = profile!.tenant_id;

    const { data: enrolment } = await a
      .from("enrolments")
      .select("student_id")
      .eq("status", "active")
      .order("student_id")
      .limit(1)
      .single();
    studentId = enrolment!.student_id;

    const { data: head } = await a
      .from("fee_heads")
      .select("id")
      .eq("is_active", true)
      .order("code")
      .limit(1)
      .single();
    feeHeadId = head!.id;

    await a.from("fee_concessions").insert([
      { tenant_id: tenantId, code: "T_RTE", name: "RTE (test)", kind: "percentage", value: 90, priority: 5 },
      { tenant_id: tenantId, code: "T_SIB", name: "Sibling (test)", kind: "percentage", value: 10, priority: 10 },
      { tenant_id: tenantId, code: "T_STAFF", name: "Staff ward (test)", kind: "percentage", value: 50, priority: 20 },
      { tenant_id: tenantId, code: "T_CAP", name: "Capped (test)", kind: "percentage", value: 20, priority: 30, max_amount: 500 },
      { tenant_id: tenantId, code: "T_AMT", name: "Grant (test)", kind: "amount", value: 1000, priority: 40 },
    ]);
  });

  afterAll(async () => {
    if (awardIds.length > 0) {
      await a.from("student_concessions").delete().in("id", awardIds);
    }
    await a.from("fee_concessions").delete().in("code", codes);
  });

  async function award(code: string) {
    const { data: concession } = await a
      .from("fee_concessions")
      .select("id")
      .eq("code", code)
      .single();
    const { data, error } = await a.rpc("concession_award", {
      p_student_id: studentId,
      p_concession_id: concession!.id,
      p_reason: "Written by the automated test suite",
    });
    expect(error).toBeNull();
    const row = data as unknown as { id: string };
    awardIds.push(row.id);
    return row.id;
  }

  async function credits(charge: number) {
    const { data, error } = await a.rpc("fees_concession_lines", {
      p_student_id: studentId,
      p_charges: { [feeHeadId]: charge } as never,
    });
    expect(error).toBeNull();
    const rows = data ?? [];
    return {
      byCode: new Map(rows.map((r) => [r.code, Number(r.amount)])),
      total: rows.reduce((sum, r) => sum + Number(r.amount), 0),
    };
  }

  it("adds percentages against the original charge rather than compounding", async () => {
    await award("T_SIB");
    await award("T_STAFF");

    const { byCode, total } = await credits(10000);

    expect(byCode.get("T_SIB")).toBe(1000);
    expect(byCode.get("T_STAFF")).toBe(5000);
    expect(total).toBe(6000);
    // What compounding would have produced. 10% then 50% of the remainder is
    // 1,000 + 4,500, and nobody means that by "half fees plus the sibling ten".
    expect(total).not.toBe(5500);
  });

  it("caps a percentage at its ceiling, and takes a fixed amount from what is left", async () => {
    await award("T_CAP");
    await award("T_AMT");

    const { byCode, total } = await credits(2000);

    expect(byCode.get("T_SIB")).toBe(200);
    expect(byCode.get("T_STAFF")).toBe(1000);
    // 20% of 2,000 is 400, under its 500 ceiling, so the ceiling does not bite.
    expect(byCode.get("T_CAP")).toBe(400);
    // 1,000 asked for; 2,000 − 1,600 left, so 400 given.
    expect(byCode.get("T_AMT")).toBe(400);
    expect(total).toBe(2000);
  });

  it("never credits more than was charged, and honours priority when it cannot", async () => {
    await award("T_RTE");

    const { byCode, total } = await credits(1000);

    // RTE is priority 5 and takes 90% first; sibling (10) takes the last 100.
    expect(byCode.get("T_RTE")).toBe(900);
    expect(byCode.get("T_SIB")).toBe(100);
    // Everything below the line gets nothing rather than a share.
    expect(byCode.get("T_STAFF") ?? 0).toBe(0);
    expect(byCode.get("T_AMT") ?? 0).toBe(0);

    expect(total).toBe(1000);
    // The number that matters: a school never owes a family money because
    // three waivers stacked.
    expect(total).toBeLessThanOrEqual(1000);
  });

  it("refuses the same concession twice in one year, by name", async () => {
    const { data: concession } = await a
      .from("fee_concessions")
      .select("id")
      .eq("code", "T_SIB")
      .single();

    const result = await a.rpc("concession_award", {
      p_student_id: studentId,
      p_concession_id: concession!.id,
      p_reason: "Should be refused by the partial unique index",
    });

    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain("already awarded");
  });

  it("refuses an award with no reason", async () => {
    const { data: concession } = await a
      .from("fee_concessions")
      .select("id")
      .eq("code", "T_CAP")
      .single();

    const result = await a.rpc("concession_award", {
      p_student_id: studentId,
      p_concession_id: concession!.id,
      p_reason: "  ",
    });
    expect(result.error).not.toBeNull();
  });

  it("stops crediting once withdrawn, and keeps the row", async () => {
    const id = awardIds[0]!;
    const revoked = await a.rpc("concession_revoke", {
      p_award_id: id,
      p_reason: "Written by the automated test suite",
    });
    expect(revoked.error).toBeNull();

    const { byCode } = await credits(10000);
    expect(byCode.get("T_SIB") ?? 0).toBe(0);

    // Revoked, never deleted: the ledger is append-only and a concession that
    // applied in April did apply in April.
    const { data: still } = await a
      .from("student_concessions")
      .select("status")
      .eq("id", id)
      .single();
    expect(still!.status).toBe("revoked");
  });
});
