import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The school calendar and what it makes visible, through real RLS.
 *
 * The claim under test is the one migration 0153 exists for: **there is one
 * definition of "is the school open", and the other two are wrappers.** Before
 * it there were three, and two of them disagreed about any holiday outside the
 * current session — `academics_is_teaching_day` filtered by `session_id` and
 * `hr_working_days` did not, so a query about last April counted last year's
 * Diwali as a working day in one and a closure in the other.
 *
 * Payroll prorates on `hr_working_days` in six places, which is why these
 * assertions are worth their weight: a calendar that drifts is a payslip that
 * drifts.
 */
describe("the school calendar", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  it("gives the same answer to all three callers", async () => {
    const from = "2026-08-01";
    const to = "2026-08-31";

    const { data: calendar, error } = await a.rpc("attendance_calendar", {
      p_from: from,
      p_to: to,
    });
    expect(error).toBeNull();

    const working = (calendar ?? []).filter((d) => d.is_working).length;

    const { data: payrollCount } = await a.rpc("hr_working_days", { p_from: from, p_to: to });
    expect(payrollCount, "payroll and the register must count the same days").toBe(working);

    // ...and the per-day wrapper agrees with the per-day row.
    for (const day of (calendar ?? []).slice(0, 10)) {
      const { data: isTeaching } = await a.rpc("academics_is_teaching_day", { p_date: day.day });
      expect(isTeaching).toBe(day.is_working);
    }
  });

  it("says why a day is closed rather than only that it is", async () => {
    const { data } = await a.rpc("attendance_calendar", {
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });

    for (const day of data ?? []) {
      // A reason and a closure arrive together, in both directions. A closed
      // day with no reason is a day nobody can explain to a parent.
      expect(day.is_working).toBe(day.reason === null);
      if (day.reason) expect(day.reason.length).toBeGreaterThan(3);
    }
  });

  it("refuses an oversized range rather than truncating it", async () => {
    // Rule 13's instinct: silently answering about a year when somebody asked
    // about five is the worst available outcome, because the number looks fine.
    const result = await a.rpc("attendance_calendar", {
      p_from: "2020-01-01",
      p_to: "2026-12-31",
    });
    expect(result.error).not.toBeNull();
    expect(result.error!.message).toMatch(/400/);
  });

  it("refuses a range that ends before it starts", async () => {
    const result = await a.rpc("attendance_calendar", {
      p_from: "2026-08-31",
      p_to: "2026-08-01",
    });
    expect(result.error).not.toBeNull();
  });

  it("counts coverage against working days, not against the calendar", async () => {
    const { data, error } = await a.rpc("attendance_coverage", {
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });
    expect(error).toBeNull();

    const { data: calendar } = await a.rpc("attendance_calendar", {
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });
    const working = (calendar ?? []).filter((d) => d.is_working).length;

    for (const row of data ?? []) {
      expect(row.working_days, "weekends and holidays are not school days").toBe(working);
      expect(row.days_marked + row.days_missing).toBe(row.working_days);
      expect(row.days_marked).toBeLessThanOrEqual(row.working_days);
    }
  });

  it("lists the missing days themselves, newest first", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "attendance.gaps",
      p_params: { from: "2026-08-01", to: "2026-08-31" },
      p_limit: 500,
    });
    expect(error).toBeNull();

    let previous: string | null = null;
    for (const row of data ?? []) {
      const r = row.row_data as Record<string, string>;
      expect(r.section).toBeTruthy();
      expect(r.missing_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (previous) expect(r.missing_on <= previous).toBe(true);
      previous = r.missing_on;
    }
  });

  it("never reports a weekend or a holiday as a missing register", async () => {
    const { data: gaps } = await a.rpc("report_run", {
      p_key: "attendance.gaps",
      p_params: { from: "2026-08-01", to: "2026-08-31" },
      p_limit: 500,
    });
    const { data: calendar } = await a.rpc("attendance_calendar", {
      p_from: "2026-08-01",
      p_to: "2026-08-31",
    });

    const closed = new Set(
      (calendar ?? []).filter((d) => !d.is_working).map((d) => d.day),
    );

    for (const row of gaps ?? []) {
      const day = (row.row_data as Record<string, string>).missing_on;
      // "You did not take a register on Sunday" is the fastest way to make a
      // report nobody opens twice.
      expect(closed.has(day)).toBe(false);
    }
  });

  it("keeps one school's calendar out of another's", async () => {
    const { data: mine } = await a.from("holidays").select("tenant_id");
    const { data: theirs } = await b.from("holidays").select("tenant_id");

    const aTenants = new Set((mine ?? []).map((r) => r.tenant_id));
    for (const t of new Set((theirs ?? []).map((r) => r.tenant_id))) {
      expect(aTenants.has(t)).toBe(false);
    }
  });
});
