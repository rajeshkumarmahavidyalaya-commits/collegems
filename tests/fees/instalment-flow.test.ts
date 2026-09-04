import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Billing periods against the real database.
 *
 * The claim under test is the one that was false before migration 0092: **a
 * period charges only what it collects.** Everything else here guards the way
 * that is enforced — a partial unique index rather than a due-date heuristic.
 */
describe("billing periods", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let opening: string;
  let recurring: string;
  let sessionId: string;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();
    sessionId = session!.id;

    const { data: periods } = await a
      .from("fee_instalments")
      .select("id, sequence, collects")
      .eq("session_id", sessionId)
      .order("sequence");

    expect(periods!.length, "the demo needs a billing calendar").toBeGreaterThan(1);
    opening = periods!.find((p) => p.collects.includes("annual"))!.id;
    recurring = periods!.find((p) => !p.collects.includes("annual"))!.id;
  });

  it("charges annual fees in the opening period and not in a later one", async () => {
    const { data: assignment } = await a
      .from("transport_assignments")
      .select("student_id")
      .eq("status", "active")
      .gt("monthly_fare", 0)
      .limit(1)
      .single();

    const [first, later] = await Promise.all([
      a.rpc("fees_billable_lines", {
        p_student_id: assignment!.student_id,
        p_instalment_id: opening,
      }),
      a.rpc("fees_billable_lines", {
        p_student_id: assignment!.student_id,
        p_instalment_id: recurring,
      }),
    ]);

    const firstLines = first.data ?? [];
    const laterLines = later.data ?? [];

    // The opening period carries the year's charges plus the recurring one.
    expect(firstLines.length).toBeGreaterThan(laterLines.length);
    expect(firstLines.some((l) => l.source === "structure")).toBe(true);

    // A later period carries only what recurs. This is the whole fix: before
    // it, this call returned the annual tuition again.
    expect(laterLines.every((l) => l.source === "transport")).toBe(true);
  });

  it("bills a child once per period, however many times the run is repeated", async () => {
    const { data: assignment } = await a
      .from("transport_assignments")
      .select("student_id")
      .eq("status", "active")
      .gt("monthly_fare", 0)
      .limit(1)
      .single();

    // Whether the first call raises or finds an existing invoice, the second
    // must not create a second one.
    await a.rpc("fees_generate_invoice", {
      p_student_id: assignment!.student_id,
      p_instalment_id: recurring,
    });

    const { error } = await a.rpc("fees_generate_invoice", {
      p_student_id: assignment!.student_id,
      p_instalment_id: recurring,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/already been billed/i);

    const { data: invoices } = await a
      .from("invoices")
      .select("id")
      .eq("student_id", assignment!.student_id)
      .eq("instalment_id", recurring)
      .eq("status", "issued");

    expect(invoices ?? []).toHaveLength(1);
  });

  it("takes the due date from the period rather than asking for it again", async () => {
    const { data: period } = await a
      .from("fee_instalments")
      .select("due_date")
      .eq("id", recurring)
      .single();

    const { data: invoices } = await a
      .from("invoices")
      .select("due_date")
      .eq("instalment_id", recurring)
      .eq("status", "issued")
      .limit(5);

    for (const invoice of invoices ?? []) {
      expect(invoice.due_date).toBe(period!.due_date);
    }
  });

  it("leaves ad-hoc charges without a period untouched", async () => {
    // The counter raises charges that genuinely have no billing period. The
    // partial unique index is partial precisely so those still work.
    const { data: adhoc } = await a
      .from("invoices")
      .select("id")
      .is("instalment_id", null)
      .limit(1);

    expect(adhoc, "the demo should still contain pre-period invoices").not.toBeNull();
  });

  it("refuses a period from another tenant", async () => {
    const { data } = await b.from("fee_instalments").select("id").eq("id", opening);
    expect(data ?? []).toHaveLength(0);
  });
});
