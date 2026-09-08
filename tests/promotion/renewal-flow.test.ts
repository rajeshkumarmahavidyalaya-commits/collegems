import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantAClient, tenantBClient } from "../helpers/client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Carrying a bus seat and a hostel bed into the next academic year.
 *
 * Nothing here applies a run: applying writes live arrangements into a real
 * tenant, and a test that did it would leave a school with a bus roster it did
 * not ask for. What is asserted is the shape of the preview and the two things
 * that are easy to get wrong — a child who is not enrolled next year must not
 * be carried, and a second live run for the same rollover must be refused.
 */
describe("renewals", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  let fromSessionId: string;
  let toSessionId: string;
  const createdRuns: string[] = [];

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: sessions } = await a
      .from("academic_sessions")
      .select("id, is_current, start_date")
      .order("start_date");

    fromSessionId = sessions!.find((s) => s.is_current)!.id;
    toSessionId = sessions!.find((s) => s.id !== fromSessionId)!.id;
  });

  afterAll(async () => {
    for (const runId of createdRuns) {
      // Draft runs only. `renewal_decisions` cascades on the composite key.
      await a.from("renewal_runs").delete().eq("id", runId);
    }
  });

  it("previews without writing anything", async () => {
    const before = await a
      .from("renewal_runs")
      .select("id", { count: "exact", head: true });

    const { data, error } = await a.rpc("renewal_preview", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_kind: "transport",
    });

    expect(error, error?.message).toBeNull();
    expect(Array.isArray(data)).toBe(true);

    const after = await a.from("renewal_runs").select("id", { count: "exact", head: true });
    expect(after.count ?? 0).toBe(before.count ?? 0);
  });

  it("never proposes carrying a child who is not enrolled in the receiving year", async () => {
    const { data } = await a.rpc("renewal_preview", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_kind: "transport",
    });

    const { data: enrolled } = await a
      .from("enrolments")
      .select("student_id")
      .eq("session_id", toSessionId)
      .eq("status", "active");

    const enrolledIds = new Set((enrolled ?? []).map((e) => e.student_id));

    for (const row of data ?? []) {
      if (row.decision === "renew") {
        expect(
          enrolledIds.has(row.student_id),
          `${row.student_name} is proposed for renewal but has no enrolment next year`,
        ).toBe(true);
      }
    }
  });

  it("gives every row a sentence, including the ones it skips", async () => {
    const { data } = await a.rpc("renewal_preview", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_kind: "hostel",
    });

    for (const row of data ?? []) {
      expect(row.reason?.length ?? 0).toBeGreaterThan(3);
      // A skip must point at nothing: the target check refuses it otherwise,
      // and a skip with a target would apply as a silent write.
      if (row.decision === "skip") {
        expect(row.to_stop_id).toBeNull();
        expect(row.to_room_id).toBeNull();
      }
    }
  });

  it("refuses a second live run for the same rollover and kind", async () => {
    const { data: runId, error } = await a.rpc("renewal_start_run", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_kind: "transport",
    });

    if (error) {
      // A tenant with no transport at all cannot start one, which is its own
      // correct answer — say which case this is rather than failing vaguely.
      expect(error.message).toContain("Nothing to carry");
      return;
    }

    createdRuns.push(runId!);

    const second = await a.rpc("renewal_start_run", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_kind: "transport",
    });

    expect(second.error).not.toBeNull();
    expect(second.error!.message).toContain("already a run");
  });

  it("keeps one tenant's renewal runs invisible to another", async () => {
    if (createdRuns.length === 0) return;

    const { data } = await b.from("renewal_runs").select("id").eq("id", createdRuns[0]);
    expect(data ?? []).toHaveLength(0);
  });
});
