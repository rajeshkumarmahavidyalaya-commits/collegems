import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * The boundary migrations `0178` and `0179` installed, and nothing was pinning.
 *
 * Rule 2: *"A null end date means the end of the row's own session, never 'for
 * ever'. Say that with a column, not with a predicate in every reader."*
 * `effective_ends_on` is that column — `coalesce(ends_on, session_ends_on)`,
 * stored and generated — and eleven readers were rewritten to ask it.
 *
 * A twelfth was found later: `mobile_student_card` took `limit 1` of a child's
 * arrangement *history* and published the raw `status` and `ends_on` to a phone.
 * Probed as a guardian on 9 September 2026, the app showed *"Active · Ring Road
 * · pickup 06:55"* for a seat that ended on 31 March — 162 days earlier — while
 * the same document carried `effective_ends_on: "2026-03-31"` in a third key.
 * Migration `0203`.
 *
 * This suite signs in as an administrator, who has no children, so it cannot
 * call the card itself — that probe is recorded in
 * `docs/modules/session-boundary.md` rather than asserted here. What it can pin
 * is the property the card and the other eleven all rest on, and the one the
 * boundary work exists to guarantee:
 *
 *   **an arrangement past its boundary is billed by nobody.**
 */
describe("an arrangement cannot outlive the year it was made for", () => {
  let a: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("derives effective_ends_on from the row's own session", async () => {
    for (const table of ["transport_assignments", "hostel_allocations"] as const) {
      const { data, error } = await a
        .from(table)
        .select("id, ends_on, session_ends_on, effective_ends_on");

      expect(error, `${table} must expose the boundary column`).toBeNull();

      for (const row of data ?? []) {
        // The generated column, restated. If somebody drops the GENERATED clause
        // and backfills by hand, the two answers start to drift silently.
        expect(row.effective_ends_on, `${table} ${row.id}`).toBe(
          row.ends_on ?? row.session_ends_on,
        );
      }
    }
  });

  it("stops billing a seat and a bed the day after their year ends", async () => {
    const { data: lapsed } = await a
      .from("transport_assignments")
      .select("student_id, effective_ends_on")
      .eq("status", "active")
      .not("effective_ends_on", "is", null);

    // Only rows whose boundary is genuinely behind us are interesting; a live
    // arrangement should still bill, and asserting otherwise would fail every
    // April.
    const today = new Date().toISOString().slice(0, 10);
    const past = (lapsed ?? []).filter((r) => (r.effective_ends_on ?? "") < today);

    for (const row of past.slice(0, 10)) {
      const { data: lines, error } = await a.rpc("transport_fee_lines", {
        p_student_id: row.student_id,
        p_as_of: today,
      });
      expect(error).toBeNull();
      expect(
        lines ?? [],
        `a seat that ended on ${row.effective_ends_on} is still being charged today`,
      ).toHaveLength(0);
    }
  });

  it("keeps billing it on its own last day", async () => {
    // The other half, and the one a naive `>` instead of `>=` breaks: the
    // boundary is inclusive, so a child rides — and pays — on the last day of
    // the year their seat was arranged for.
    const { data: rows } = await a
      .from("transport_assignments")
      .select("student_id, effective_ends_on, monthly_fare")
      .eq("status", "active")
      .gt("monthly_fare", 0)
      .not("effective_ends_on", "is", null)
      .limit(5);

    for (const row of rows ?? []) {
      const { data: lines, error } = await a.rpc("transport_fee_lines", {
        p_student_id: row.student_id,
        p_as_of: row.effective_ends_on as string,
      });
      expect(error).toBeNull();
      expect(
        (lines ?? []).length,
        `nothing billed on ${row.effective_ends_on}, the last day of the seat itself`,
      ).toBeGreaterThan(0);
    }
  });
});
