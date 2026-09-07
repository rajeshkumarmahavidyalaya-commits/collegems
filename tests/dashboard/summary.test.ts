import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";
import { parseDashboardSummary, studentRegisterReading } from "@/lib/validations/dashboard";

/**
 * `dashboard_summary()` against the real database.
 *
 * The claim under test is the one the home page rests on: **the brief must not
 * answer a question the module it borrows from would answer differently.** A
 * dashboard free to disagree with the screen the money is actually taken on is
 * worse than a dashboard without the number, because somebody will act on the
 * wrong one. So every figure here is checked against the module read path it
 * wraps, not against a constant.
 *
 * A note on what this file can and cannot reach. The suite has two logins, both
 * administrators, in two different tenants — that is what makes the
 * cross-tenant suite possible and it is also its limit. An administrator is
 * withheld nothing, so the `withheld` branch cannot be exercised by signing in;
 * it is covered structurally here (every block present is one not named in
 * `withheld`, and vice versa) and by role in `tests/dashboard/readings.test.ts`,
 * which tests the sentence the page builds from it. The gating itself was
 * probed by running the function under each role's JWT claims directly.
 */
describe("the dashboard brief", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  it("comes back in one call, in the shape the page parses", async () => {
    const { data, error } = await a.rpc("dashboard_summary");
    expect(error).toBeNull();

    const brief = parseDashboardSummary(data);
    expect(brief, "the page renders an error state when this is null").not.toBeNull();
    expect(brief!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(brief!.withheld)).toBe(true);
  });

  it("names every block it did not return, and returns every block it did not name", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;

    const blocks = {
      school: brief.school,
      student_attendance: brief.student_attendance,
      staff_attendance: brief.staff_attendance,
      fees: brief.fees,
      library: brief.library,
    };

    for (const [key, value] of Object.entries(blocks)) {
      if (brief.withheld.includes(key)) {
        expect(value, `${key} is withheld, so it must be absent`).toBeUndefined();
      } else {
        expect(value, `${key} is not withheld, so it must be present`).toBeDefined();
      }
    }

    // `exam` is the one block that is legitimately null while not withheld:
    // the role may see results and no exam has been published. Absent and
    // empty are different sentences on the card, which is why this is not
    // folded into the loop above.
    if (brief.withheld.includes("exam")) {
      expect(brief.exam == null).toBe(true);
    }
  });

  it("only ever names blocks the page knows how to explain", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;
    const known = [
      "school",
      "student_attendance",
      "staff_attendance",
      "fees",
      "exam",
      "library",
    ];
    for (const key of brief.withheld) expect(known).toContain(key);
  });

  it("reports the same outstanding balance as the fees module's own read path", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;
    if (!brief.fees) return;

    const { data: balances, error } = await a.rpc("fees_student_balances", {
      p_section_id: undefined,
      p_only_outstanding: false,
    });
    expect(error).toBeNull();

    const outstanding = (balances ?? []).reduce((sum, row) => sum + Number(row.balance), 0);
    const owing = (balances ?? []).filter((row) => Number(row.balance) > 0).length;

    // To the paisa. This is the assertion that would catch somebody
    // "optimising" the dashboard by summing `ledger_entries` directly and
    // quietly leaving out write-offs.
    expect(Number(brief.fees.outstanding)).toBeCloseTo(outstanding, 2);
    expect(brief.fees.students_owing).toBe(owing);
  });

  it("reports the same staff register as the HR screen", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;
    if (!brief.staff_attendance) return;

    const { data: sheet, error } = await a.rpc("hr_attendance_sheet", { p_date: brief.today });
    expect(error).toBeNull();

    const rows = sheet ?? [];
    expect(brief.staff_attendance.roll).toBe(rows.length);
    expect(brief.staff_attendance.marked).toBe(rows.filter((r) => r.status !== null).length);
    expect(brief.staff_attendance.present).toBe(
      rows.filter((r) => r.status === "present").length,
    );
  });

  it("counts pass and fail off the frozen result rows, not off marks", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;
    if (!brief.exam) return;

    const { data: results, error } = await a
      .from("exam_results")
      .select("result")
      .eq("exam_id", brief.exam.id);
    expect(error).toBeNull();

    const rows = results ?? [];
    expect(brief.exam.graded).toBe(rows.length);
    expect(brief.exam.passed).toBe(rows.filter((r) => r.result === "pass").length);
    expect(brief.exam.failed).toBe(rows.filter((r) => r.result === "fail").length);

    // The pass rate excludes incompletes from both halves: a child who sat no
    // paper has not failed, and counting them as one understates the year.
    const decided = brief.exam.passed + brief.exam.failed;
    if (decided > 0) {
      expect(Number(brief.exam.pass_percent)).toBeCloseTo(
        Math.round((brief.exam.passed / decided) * 1000) / 10,
        1,
      );
    }
  });

  it("reads the register the same way the card does", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;
    if (!brief.student_attendance) return;

    const reading = studentRegisterReading(brief.student_attendance);
    if (brief.student_attendance.marked === 0) {
      expect(reading.kind).toBe("not-taken");
    } else {
      expect(["taken", "not-taken"]).toContain(reading.kind);
    }
  });

  it("adds its enrolment chart up to its own roll", async () => {
    const { data } = await a.rpc("dashboard_summary");
    const brief = parseDashboardSummary(data)!;
    if (!brief.school || !brief.enrolment) return;

    const charted = brief.enrolment.reduce((sum, row) => sum + row.students, 0);
    // A bar chart that does not add up to the number printed above it is the
    // single most reported dashboard bug there is. Note this can legitimately
    // be *less* than the roll — an active student not yet enrolled in the
    // current session has no bar to sit in — so it is bounded, not equal.
    expect(charted).toBeLessThanOrEqual(brief.school.students);

    for (const row of brief.enrolment) {
      // Every slice of the gender donut, including the unstated one, so the
      // parts always add up to the whole.
      expect(row.male + row.female + row.other + row.unstated).toBe(row.students);
    }
  });

  it("does not show one school another school's brief", async () => {
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      a.rpc("dashboard_summary"),
      b.rpc("dashboard_summary"),
    ]);

    const A = parseDashboardSummary(mine)!;
    const B = parseDashboardSummary(theirs)!;

    expect(A.session_id).not.toBe(B.session_id);
    // Two tenants with the same roll would be a coincidence; two tenants with
    // the same roll AND the same fee ledger would be a leak.
    if (A.fees && B.fees && A.school && B.school) {
      expect(
        A.school.students === B.school.students &&
          Number(A.fees.outstanding) === Number(B.fees.outstanding),
      ).toBe(false);
    }
  });
});

/**
 * The three reports migration 0126 added, through `report_run`.
 *
 * `tests/reports/reporting-kernel.test.ts` already runs every catalogued
 * report, which covers "does it execute". What it cannot cover is whether the
 * numbers mean what the column headings say, which is what this does.
 */
describe("the staff and teacher reports", () => {
  let a: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("counts staff attendance over what was marked, never over the calendar", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "hr.staff_attendance",
      p_params: { from: "2000-01-01", to: "2099-12-31" },
      p_limit: 200,
    });
    expect(error).toBeNull();

    for (const row of data ?? []) {
      const r = row.row_data as Record<string, number | string | null>;
      const marked = Number(r.days_marked);
      const parts =
        Number(r.present) +
        Number(r.absent) +
        Number(r.half_day) +
        Number(r.on_leave) +
        Number(r.on_duty);

      // Every marked day is exactly one of the five statuses, so these must
      // agree. A drift here means a status was added without being counted.
      expect(parts).toBe(marked);

      if (marked === 0) {
        // Nothing marked is null, not 0% -- somebody with no register taken
        // must not read as the worst attender in the school.
        expect(r.attendance_percent).toBeNull();
      } else {
        expect(Number(r.attendance_percent)).toBeGreaterThanOrEqual(0);
        expect(Number(r.attendance_percent)).toBeLessThanOrEqual(100);
      }
    }
  });

  it("narrows to teaching staff when asked, and never widens", async () => {
    const all = await a.rpc("report_run", {
      p_key: "hr.staff_attendance",
      p_params: {},
      p_limit: 200,
    });
    const teaching = await a.rpc("report_run", {
      p_key: "hr.staff_attendance",
      p_params: { teachers_only: "true" },
      p_limit: 200,
    });

    expect(all.error).toBeNull();
    expect(teaching.error).toBeNull();
    expect((teaching.data ?? []).length).toBeLessThanOrEqual((all.data ?? []).length);
  });

  it("names each class teacher's section once, not once per year", async () => {
    // `sections` carries `session_id`, so a school in its second year has two
    // rows called "Grade 4 A" and the same teacher against both. Migration
    // 0128 is this assertion's reason for existing.
    const { data, error } = await a.rpc("report_run", {
      p_key: "hr.teacher_summary",
      p_params: {},
      p_limit: 200,
    });
    expect(error).toBeNull();

    for (const row of data ?? []) {
      const label = (row.row_data as Record<string, string | null>).class_teacher_of;
      if (!label) continue;
      const parts = label.split(", ");
      expect(new Set(parts).size, `"${label}" repeats a section`).toBe(parts.length);
    }
  });

  it("orders exam results worst first, so the list opens on the children who need something", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "exams.results",
      p_params: {},
      p_limit: 500,
    });
    expect(error).toBeNull();

    const rank = { fail: 0, incomplete: 1, pass: 2 } as Record<string, number>;
    let previous = -1;
    for (const row of data ?? []) {
      const result = String((row.row_data as Record<string, unknown>).result);
      expect(rank[result]).toBeGreaterThanOrEqual(previous);
      previous = rank[result];
    }
  });

  it("filters to one outcome without inventing rows", async () => {
    const all = await a.rpc("report_run", { p_key: "exams.results", p_params: {}, p_limit: 500 });
    const failed = await a.rpc("report_run", {
      p_key: "exams.results",
      p_params: { result: "fail" },
      p_limit: 500,
    });

    expect(failed.error).toBeNull();
    for (const row of failed.data ?? []) {
      expect((row.row_data as Record<string, unknown>).result).toBe("fail");
    }
    expect((failed.data ?? []).length).toBeLessThanOrEqual((all.data ?? []).length);
  });
});
