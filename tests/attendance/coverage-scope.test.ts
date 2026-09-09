import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * The two functions that answer *"which registers were never taken"*, and the
 * one property that makes them honest.
 *
 * Both compare a list of sections against a list of days somebody wrote a
 * register on. `sections` is tenant-wide; `attendance_records` and `enrolments`
 * carry row-ownership policies. Before migration 0201 only the second half was
 * narrowed, so **absence and invisibility were the same shape** — measured on
 * the demo school, a class teacher saw eleven of twelve classes at 0.0% and a
 * report of 388 gaps where the true number is 168.
 *
 * This suite signs in as an administrator, which is exactly the seat the bug
 * was invisible from, so it cannot re-measure that. What it *can* pin is the
 * property that makes the narrowing safe, and it is the property a later edit
 * would break:
 *
 *   - the two functions agree, to the row;
 *   - the section list is the sections whose enrolments the caller can read,
 *     rather than every section in the tenant.
 *
 * Narrow one side and not the other and the first assertion fails. Widen the
 * section list back and the second does.
 */
describe("attendance coverage is scoped the same way its evidence is", () => {
  let a: SupabaseClient<Database>;
  const from = "2026-08-01";
  const to = "2026-09-09";

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("reports one row per section whose enrolments the caller can read", async () => {
    const [coverage, sections] = await Promise.all([
      a.rpc("attendance_coverage", { p_from: from, p_to: to }),
      a
        .from("sections")
        .select("id, enrolments!inner(id)")
        .eq("enrolments.status", "active"),
    ]);

    expect(coverage.error).toBeNull();
    expect(sections.error).toBeNull();

    const inScope = new Set((sections.data ?? []).map((s) => s.id));
    const reported = new Set((coverage.data ?? []).map((r) => r.section_id));

    // Every reported section is one the caller can see children in. The reverse
    // does not hold in general — `sections` here is not session-filtered — so
    // this is the direction that catches a widening.
    for (const id of reported) {
      expect(inScope.has(id), `coverage reported a section with no readable enrolment`).toBe(true);
    }
    expect(reported.size).toBeGreaterThan(0);
  });

  it("agrees with the report that answers the same question", async () => {
    const [coverage, report] = await Promise.all([
      a.rpc("attendance_coverage", { p_from: from, p_to: to }),
      a.rpc("report_run", {
        p_key: "attendance.gaps",
        p_params: { from, to },
        p_limit: 1,
        p_offset: 0,
      }),
    ]);

    expect(coverage.error).toBeNull();
    expect(report.error).toBeNull();

    const missing = (coverage.data ?? []).reduce((sum, r) => sum + (r.days_missing ?? 0), 0);
    const total = Number(report.data?.[0]?.total_count ?? 0);

    // One fact, one number. The card on `/attendance/report` and the row in the
    // report catalogue are two renderings of it, and a school reading two
    // different totals for "how many registers are missing" trusts neither.
    expect(total).toBe(missing);
  });

  it("asks for the permission held by somebody who can take the register", async () => {
    // `attendance.view` is held by a parent and a student. Nobody who cannot
    // mark a register can do anything about a missing one, and migration 0189's
    // rule is that a critic is gated on the permission to act.
    // `database.types.ts` is generated for `public` only, so the catalogue is
    // reached through an untyped handle rather than by widening the generated
    // types for one assertion.
    const untyped = a as unknown as SupabaseClient;
    const { data, error } = await untyped
      .schema("reference")
      .from("reports")
      .select("required_permission")
      .eq("key", "attendance.gaps")
      .single();

    expect(error).toBeNull();
    expect(data?.required_permission).toBe("attendance.mark");
  });
});
