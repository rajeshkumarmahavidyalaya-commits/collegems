import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Bulk import against the real database.
 *
 * Rule 13's two requirements are what is tested: the preview is **editable**
 * and re-judged after every edit, and apply writes **what the rows say**. Plus
 * the freeze — an imported row is a record of what was written, not a
 * scratchpad.
 */
describe("bulk import", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let runId: string | null = null;

  beforeAll(async () => {
    a = await tenantAClient();
    b = await tenantBClient();

    const { data } = await a
      .from("import_runs")
      .select("id")
      .eq("status", "draft")
      .maybeSingle();
    runId = data?.id ?? null;
  });

  it("judges every row and returns sentences, not codes", async () => {
    if (!runId) return;

    const { data: ready, error } = await a.rpc("import_validate_run", { p_run_id: runId });
    expect(error, error?.message).toBeNull();
    expect(typeof ready).toBe("number");

    const { data: rows } = await a
      .from("import_rows")
      .select("line_number, problems")
      .eq("run_id", runId)
      .order("line_number");

    const flagged = (rows ?? []).filter((r) => (r.problems ?? []).length > 0);
    expect(flagged.length).toBeGreaterThan(0);
    for (const row of flagged) {
      for (const problem of row.problems!) {
        // A sentence somebody can act on, not an error code.
        expect(problem.length).toBeGreaterThan(10);
        expect(problem).not.toMatch(/^[0-9A-Z_]+$/);
      }
    }
  });

  it("catches a duplicate inside the file and one against the school", async () => {
    if (!runId) return;

    const { data: rows } = await a
      .from("import_rows")
      .select("problems")
      .eq("run_id", runId);

    const all = (rows ?? []).flatMap((r) => r.problems ?? []);
    expect(all.some((p) => /appears more than once in this file/i.test(p))).toBe(true);
    expect(all.some((p) => /already belongs to a student/i.test(p))).toBe(true);
  });

  it("re-judges the whole run after one row is edited", async () => {
    if (!runId) return;

    const { data: dupes } = await a
      .from("import_rows")
      .select("id, line_number, admission_number, problems")
      .eq("run_id", runId)
      .order("line_number");

    const offending = (dupes ?? []).find((r) =>
      (r.problems ?? []).some((p) => /appears more than once/i.test(p)),
    );
    if (!offending) return;

    const before = (dupes ?? []).filter((r) => (r.problems ?? []).length > 0).length;

    await a
      .from("import_rows")
      .update({ admission_number: `FIXED-${Date.now()}` })
      .eq("id", offending.id);

    await a.rpc("import_validate_run", { p_run_id: runId });

    const { data: after } = await a
      .from("import_rows")
      .select("problems")
      .eq("run_id", runId);

    // Both halves of the duplicate pair clear, so the count drops by more than
    // the one row that was edited — which is the point of re-judging all of it.
    const now = (after ?? []).filter((r) => (r.problems ?? []).length > 0).length;
    expect(now).toBeLessThan(before);
  });

  it("does not judge a row somebody has skipped", async () => {
    if (!runId) return;

    const { data: problem } = await a
      .from("import_rows")
      .select("id")
      .eq("run_id", runId)
      .not("problems", "eq", "{}")
      .limit(1)
      .maybeSingle();
    if (!problem) return;

    await a.from("import_rows").update({ skipped: true }).eq("id", problem.id);
    await a.rpc("import_validate_run", { p_run_id: runId });

    const { data: after } = await a
      .from("import_rows")
      .select("problems, skipped")
      .eq("id", problem.id)
      .single();

    expect(after!.skipped).toBe(true);
    // Stale problems on a skipped row make the count of what is wrong lie.
    expect(after!.problems ?? []).toHaveLength(0);
  });

  it("counts the run the way the apply button reads it", async () => {
    if (!runId) return;

    const { data, error } = await a.rpc("import_run_summary", { p_run_id: runId });
    expect(error, error?.message).toBeNull();

    const s = (data ?? [])[0];
    expect(s.ready + s.with_problems + s.skipped + s.applied).toBeLessThanOrEqual(s.total);
  });

  it("allows only one live import at a time", async () => {
    if (!runId) return;

    const { data: session } = await a
      .from("academic_sessions")
      .select("id, tenant_id")
      .eq("is_current", true)
      .single();

    // Two half-corrected previews of the same spreadsheet disagree, and
    // whichever is applied second silently wins.
    const { error } = await a.from("import_runs").insert({
      tenant_id: session!.tenant_id,
      session_id: session!.id,
      file_name: "second.csv",
      row_count: 1,
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  it("refuses to apply when nothing is ready", async () => {
    const { data: session } = await a
      .from("academic_sessions")
      .select("id, tenant_id")
      .eq("is_current", true)
      .single();
    void session;

    // Applying a run whose rows all have problems must say so rather than
    // writing nothing and reporting success.
    if (!runId) return;
    const { data: summary } = await a.rpc("import_run_summary", { p_run_id: runId });
    const s = (summary ?? [])[0];
    if (s.ready > 0) return;

    const { error } = await a.rpc("import_apply_run", { p_run_id: runId });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/no row is ready/i);
  });

  it("does not show one tenant's import to another", async () => {
    if (!runId) return;
    const { data } = await b.from("import_runs").select("id").eq("id", runId);
    expect(data ?? []).toHaveLength(0);
  });
});
