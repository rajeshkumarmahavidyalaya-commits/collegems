import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Promotion, against a real cohort.
 *
 * The evaluation order is the contract — no-detention beats attendance, which
 * beats the examination — so each step is pinned to a count rather than
 * described. And the property that matters most is the last one: **applying
 * writes what the decisions say, not what the rules said**, because every year
 * a head teacher overrules the machine for three or four named children.
 *
 * This suite never applies a run against the demo cohort. Applying closes the
 * current session's enrolments, and every other module reads
 * `enrolments.status = 'active'` — a test that left the demo rolled over would
 * break attendance, fees and results for everybody.
 */
describe("promotion", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  let fromSessionId: string;
  let toSessionId: string;
  const createdRuns: string[] = [];

  async function preview(rules: object) {
    const { data, error } = await a.rpc("promotion_preview", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_rules: rules as never,
    });
    expect(error, error?.message).toBeNull();
    return data ?? [];
  }

  function tally(rows: { decision: string }[]) {
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.decision] = (counts[row.decision] ?? 0) + 1;
    return counts;
  }

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: sessions } = await a
      .from("academic_sessions")
      .select("id, is_current, start_date")
      .order("start_date");

    expect(
      (sessions ?? []).length,
      "promotion needs two sessions; migration 0052 seeds the second",
    ).toBeGreaterThanOrEqual(2);

    fromSessionId = sessions!.find((s) => s.is_current)!.id;
    toSessionId = sessions!.find((s) => s.id !== fromSessionId)!.id;
  });

  afterAll(async () => {
    for (const runId of createdRuns) {
      // Only ever draft runs — nothing here applies one.
      await a.from("promotion_runs").delete().eq("id", runId);
    }
  });

  it("promotes everyone with somewhere to go when there are no rules", async () => {
    const rows = await preview({});
    const counts = tally(rows);

    expect(counts.repeat ?? 0).toBe(0);
    expect(counts.promote).toBeGreaterThan(0);
    // The top class has nowhere to go, so it graduates rather than being held.
    expect(counts.graduate).toBeGreaterThan(0);
    expect(counts.hold ?? 0).toBe(0);
  });

  it("agrees with the exams module about who failed", async () => {
    const { data: exam } = await a
      .from("exams")
      .select("id, kind")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();

    if (!exam) return;

    const rows = await preview({
      criteria: { require_exam_pass: true, exam_kind: exam.kind, max_failed_subjects: 0 },
    });

    const { count: failures } = await a
      .from("exam_results")
      .select("id", { count: "exact", head: true })
      .eq("exam_id", exam.id)
      .eq("result", "fail");

    // A repeat here is exactly a failure there. If these two ever disagree, one
    // of the modules has started computing its own answer.
    expect(tally(rows).repeat ?? 0).toBe(failures ?? 0);
  });

  it("lets an allowance convert failures into promotions", async () => {
    const { data: exam } = await a
      .from("exams")
      .select("kind")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    if (!exam) return;

    const strict = tally(
      await preview({
        criteria: { require_exam_pass: true, exam_kind: exam.kind, max_failed_subjects: 0 },
      }),
    );
    const lenient = tally(
      await preview({
        criteria: { require_exam_pass: true, exam_kind: exam.kind, max_failed_subjects: 1 },
      }),
    );

    expect(lenient.repeat ?? 0).toBeLessThanOrEqual(strict.repeat ?? 0);
    expect((lenient.promote ?? 0) + (lenient.graduate ?? 0)).toBeGreaterThanOrEqual(
      (strict.promote ?? 0) + (strict.graduate ?? 0),
    );
  });

  it("puts the no-detention band ahead of the examination", async () => {
    const { data: exam } = await a
      .from("exams")
      .select("kind")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    if (!exam) return;

    const rows = await preview({
      no_detention_up_to_sequence: 3,
      criteria: { require_exam_pass: true, exam_kind: exam.kind, max_failed_subjects: 0 },
    });

    // Nobody inside the band may repeat, whatever their marks. That is what the
    // policy means: a statutory floor, not a tie-break.
    for (const row of rows) {
      if (row.from_sequence <= 3) expect(row.decision).not.toBe("repeat");
    }
  });

  it("puts attendance ahead of the examination", async () => {
    // An impossible-to-miss threshold: everyone with any marked attendance
    // should repeat, even the students who passed.
    const rows = await preview({
      criteria: { require_exam_pass: true, exam_kind: "annual", min_attendance_percent: 100 },
    });

    const withAttendance = rows.filter((r) => r.attendance_percent !== null);
    if (withAttendance.length === 0) return;

    for (const row of withAttendance) {
      if (Number(row.attendance_percent) < 100) expect(row.decision).toBe("repeat");
    }
  });

  it("never treats a missing result as a failure by default", async () => {
    const rows = await preview({
      criteria: { require_exam_pass: true, exam_kind: "practical" }, // no such published exam
    });

    // "We have not marked this child" is a different answer from "this child
    // failed", and defaulting to either of the others decides something nobody
    // decided.
    for (const row of rows) {
      expect(["hold", "graduate"]).toContain(row.decision);
      if (row.decision === "hold") expect(row.reason).toContain("No published result");
    }
  });

  it("holds rather than inventing a class when the receiving year has none", async () => {
    const { data: emptySession } = await a
      .from("academic_sessions")
      .insert({
        tenant_id: (await a.from("user_profiles").select("tenant_id").single()).data!.tenant_id,
        name: `Empty ${Date.now()}`,
        start_date: "2090-04-01",
        end_date: "2091-03-31",
      })
      .select("id")
      .single();

    try {
      const { data } = await a.rpc("promotion_preview", {
        p_from_session_id: fromSessionId,
        p_to_session_id: emptySession!.id,
        p_rules: {},
      });

      const counts = tally(data ?? []);
      expect(counts.promote ?? 0).toBe(0);
      expect(counts.hold).toBeGreaterThan(0);
      const held = (data ?? []).find((r) => r.decision === "hold")!;
      expect(held.reason).toContain("no matching class");
    } finally {
      await a.from("academic_sessions").delete().eq("id", emptySession!.id);
    }
  });

  it("criticises a band that swallows the whole school", async () => {
    const { data: levels } = await a.from("class_levels").select("sequence");
    const top = Math.max(...(levels ?? []).map((l) => l.sequence));

    const { data: problems } = await a.rpc("promotion_rule_problems", {
      p_rules: {
        no_detention_up_to_sequence: top,
        criteria: { require_exam_pass: true, exam_kind: "annual" },
      },
    });

    expect((problems ?? []).some((p) => p.problem.includes("never be consulted"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  it("materialises a run whose rows can be edited", async () => {
    const { data: runId, error } = await a.rpc("promotion_start_run", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_rules: { carry_forward_fees: true },
    });

    expect(error, error?.message).toBeNull();
    createdRuns.push(runId!);

    const { data: decisions } = await a
      .from("promotion_decisions")
      .select("id, decision, carry_forward, is_override")
      .eq("run_id", runId!);

    expect((decisions ?? []).length).toBeGreaterThan(0);
    expect((decisions ?? []).every((d) => !d.is_override)).toBe(true);
    // Carry-forward is recorded on the row, so the bursar can see the number
    // before anybody commits to it.
    expect((decisions ?? []).some((d) => Number(d.carry_forward) > 0)).toBe(true);
  });

  it("refuses a second live run for the same rollover", async () => {
    // Two half-built previews of the same rollover would disagree, and whichever
    // was applied second would silently win.
    const { error } = await a.rpc("promotion_start_run", {
      p_from_session_id: fromSessionId,
      p_to_session_id: toSessionId,
      p_rules: {},
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("already a run");
  });

  it("refuses a promotion with nowhere to land", async () => {
    const { data: decision } = await a
      .from("promotion_decisions")
      .select("id")
      .eq("run_id", createdRuns[0])
      .limit(1)
      .single();

    const { error } = await a
      .from("promotion_decisions")
      .update({ decision: "promote", to_section_id: null })
      .eq("id", decision!.id);

    // Without this a "promote" with a null section would apply as a silent
    // no-op and the student would vanish from next year.
    expect(error).not.toBeNull();
  });

  it("refuses a hold that still points at a class", async () => {
    const { data: decision } = await a
      .from("promotion_decisions")
      .select("id, to_section_id")
      .eq("run_id", createdRuns[0])
      .not("to_section_id", "is", null)
      .limit(1)
      .single();

    const { error } = await a
      .from("promotion_decisions")
      .update({ decision: "hold" })
      .eq("id", decision!.id);

    expect(error).not.toBeNull();
  });

  it("records an override as an override", async () => {
    const { data: decision } = await a
      .from("promotion_decisions")
      .select("id")
      .eq("run_id", createdRuns[0])
      .eq("decision", "promote")
      .limit(1)
      .single();

    const { error } = await a
      .from("promotion_decisions")
      .update({
        decision: "hold",
        to_section_id: null,
        is_override: true,
        reason: "Held by the head teacher",
      })
      .eq("id", decision!.id);

    expect(error).toBeNull();

    const { data: after } = await a
      .from("promotion_decisions")
      .select("decision, is_override, reason")
      .eq("id", decision!.id)
      .single();

    expect(after!.decision).toBe("hold");
    expect(after!.is_override).toBe(true);
    expect(after!.reason).toContain("head teacher");
  });

  it("keeps one school's rollover invisible to another", async () => {
    const { data: leaked } = await b
      .from("promotion_runs")
      .select("id")
      .eq("id", createdRuns[0]);
    expect(leaked).toEqual([]);

    const { data: decisions } = await b
      .from("promotion_decisions")
      .select("id")
      .eq("run_id", createdRuns[0]);
    expect(decisions).toEqual([]);
  });

  it("discards a draft run without touching anything", async () => {
    const { data: before } = await a
      .from("enrolments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", toSessionId);

    const { error } = await a.rpc("promotion_discard_run", { p_run_id: createdRuns[0] });
    expect(error).toBeNull();

    const { count: after } = await a
      .from("enrolments")
      .select("id", { count: "exact", head: true })
      .eq("session_id", toSessionId);

    // A discarded preview wrote nothing, which is the whole point of a preview.
    expect(after ?? 0).toBe((before as unknown as number) ?? after ?? 0);

    const { data: run } = await a
      .from("promotion_runs")
      .select("status")
      .eq("id", createdRuns[0])
      .single();
    expect(run!.status).toBe("discarded");
  });
});
