import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Staff attendance, leave and payroll against the real database.
 *
 * The properties worth pinning are the ones a careless migration would remove
 * without any test noticing:
 *
 *   - A finalised payslip is immutable **because no policy matches it any
 *     more**. The composite key cascades the run's status onto every child, and
 *     the draft-only policy then matches nothing. Nothing is revoked; the
 *     immutability is a consequence of the key.
 *   - Overlapping leave is refused by an exclusion constraint, and so are two
 *     salaries in force on the same day. Neither rule can be a CHECK, because
 *     neither can be decided from one row.
 *   - A working day with no register entry counts as PRESENT. A school that has
 *     not started marking must not have its first payroll dock everybody.
 */
describe("HR and payroll", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  let tenantId: string;
  let sessionId: string;
  let staffId: string;
  let leaveTypeId: string;
  let unpaidTypeId: string;

  const createdRuns: string[] = [];
  const createdRequests: string[] = [];

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: profile } = await a.from("user_profiles").select("tenant_id").single();
    tenantId = profile!.tenant_id;

    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();
    sessionId = session!.id;

    const { data: staff } = await a
      .from("staff")
      .select("id")
      .eq("status", "active")
      .order("employee_code")
      .limit(1);
    expect(staff?.length, "the demo tenant needs staff").toBe(1);
    staffId = staff![0].id;

    const { data: types } = await a.from("leave_types").select("id, code, is_paid");
    expect(types?.length, "migration 0062 seeds four leave types").toBeGreaterThan(0);
    leaveTypeId = types!.find((t) => t.is_paid)!.id;
    unpaidTypeId = types!.find((t) => !t.is_paid)!.id;
  });

  afterAll(async () => {
    for (const id of createdRequests) await a.from("leave_requests").delete().eq("id", id);
    for (const id of createdRuns) await a.from("payroll_runs").delete().eq("id", id);
  });

  // -------------------------------------------------------------------------
  // The school calendar
  // -------------------------------------------------------------------------

  it("counts working days from the weekend and holiday configuration", async () => {
    const { data, error } = await a.rpc("hr_working_days", {
      p_from: "2026-02-01",
      p_to: "2026-02-28",
    });
    expect(error, error?.message).toBeNull();

    // Fewer than the 28 calendar days, because weekends are excluded — the
    // whole reason payroll cannot just count calendar days.
    expect(data).toBeGreaterThan(0);
    expect(data).toBeLessThan(28);
  });

  it("counts a single day as one or zero, which is how the leave writer tests it", async () => {
    const { data } = await a.rpc("hr_working_days", {
      p_from: "2026-02-17",
      p_to: "2026-02-17",
    });
    expect([0, 1]).toContain(data);
  });

  // -------------------------------------------------------------------------
  // Leave
  // -------------------------------------------------------------------------

  it("refuses leave that overlaps leave already applied for", async () => {
    const first = await a
      .from("leave_requests")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        staff_id: staffId,
        leave_type_id: leaveTypeId,
        starts_on: "2030-05-04",
        ends_on: "2030-05-06",
      })
      .select("id")
      .single();

    expect(first.error, first.error?.message).toBeNull();
    createdRequests.push(first.data!.id);

    const { error } = await a.from("leave_requests").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      staff_id: staffId,
      leave_type_id: leaveTypeId,
      starts_on: "2030-05-06",
      ends_on: "2030-05-08",
    });

    // 23P01 — the exclusion constraint. No CHECK can see a second row.
    expect(error?.code).toBe("23P01");
  });

  it("allows the same dates once the first request is refused", async () => {
    const { data: refused } = await a
      .from("leave_requests")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        staff_id: staffId,
        leave_type_id: leaveTypeId,
        starts_on: "2030-06-10",
        ends_on: "2030-06-11",
      })
      .select("id")
      .single();
    createdRequests.push(refused!.id);

    await a.rpc("hr_decide_leave", { p_request_id: refused!.id, p_approve: false });

    const again = await a
      .from("leave_requests")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        staff_id: staffId,
        leave_type_id: leaveTypeId,
        starts_on: "2030-06-10",
        ends_on: "2030-06-11",
      })
      .select("id")
      .single();

    // The exclusion is partial on (pending, approved), so a refusal does not
    // block re-applying.
    expect(again.error, again.error?.message).toBeNull();
    createdRequests.push(again.data!.id);
  });

  it("refuses a one-day request that is half at both ends", async () => {
    const { error } = await a.from("leave_requests").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      staff_id: staffId,
      leave_type_id: leaveTypeId,
      starts_on: "2030-07-01",
      ends_on: "2030-07-01",
      half_day_start: true,
      half_day_end: true,
    });
    expect(error?.code).toBe("23514");
  });

  it("writes the register when leave is approved, working days only", async () => {
    const { data: request } = await a
      .from("leave_requests")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        staff_id: staffId,
        leave_type_id: leaveTypeId,
        starts_on: "2030-08-05",
        ends_on: "2030-08-11",
      })
      .select("id")
      .single();
    createdRequests.push(request!.id);

    const { data: marked, error } = await a.rpc("hr_decide_leave", {
      p_request_id: request!.id,
      p_approve: true,
    });
    expect(error, error?.message).toBeNull();

    // A week spans at least one non-teaching day, so fewer than seven rows.
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(7);

    const { data: rows } = await a
      .from("staff_attendance")
      .select("status, leave_request_id")
      .eq("leave_request_id", request!.id);

    expect(rows?.length).toBe(marked);
    for (const row of rows ?? []) expect(row.status).toBe("on_leave");
  });

  it("refuses to decide a request twice", async () => {
    const { data: request } = await a
      .from("leave_requests")
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        staff_id: staffId,
        leave_type_id: leaveTypeId,
        starts_on: "2030-09-02",
        ends_on: "2030-09-02",
      })
      .select("id")
      .single();
    createdRequests.push(request!.id);

    await a.rpc("hr_decide_leave", { p_request_id: request!.id, p_approve: true });
    const { error } = await a.rpc("hr_decide_leave", {
      p_request_id: request!.id,
      p_approve: false,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("already");
  });

  it("derives a balance from the requests rather than storing one", async () => {
    const { data, error } = await a.rpc("hr_leave_balance", { p_staff_id: staffId });
    expect(error, error?.message).toBeNull();

    const unpaid = (data ?? []).find((r) => r.leave_type_id === unpaidTypeId);
    // A null quota is "as much as is approved", and stays null rather than
    // becoming a misleading number.
    expect(unpaid?.annual_quota_days).toBeNull();
    expect(unpaid?.remaining_days).toBeNull();

    const paid = (data ?? []).find((r) => r.leave_type_id === leaveTypeId);
    expect(Number(paid?.remaining_days)).toBe(
      Number(paid?.annual_quota_days) - Number(paid?.taken_days),
    );
  });

  // -------------------------------------------------------------------------
  // The register
  // -------------------------------------------------------------------------

  it("shows an unmarked person as unmarked, not as present", async () => {
    const { data, error } = await a.rpc("hr_attendance_sheet", { p_date: "2030-11-04" });
    expect(error, error?.message).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    for (const row of data ?? []) expect(row.status).toBeNull();
  });

  it("costs nothing for a day nobody marked", async () => {
    // The conservative default that stops a school's first payroll run docking
    // everybody for a month it never marked.
    const { data, error } = await a.rpc("payroll_lop_days", {
      p_staff_id: staffId,
      p_from: "2030-11-01",
      p_to: "2030-11-30",
    });
    expect(error, error?.message).toBeNull();
    expect(Number(data)).toBe(0);
  });

  it("marks a register idempotently", async () => {
    const entries = [{ staff_id: staffId, status: "present" }];

    await a.rpc("hr_mark_attendance", { p_date: "2030-12-02", p_entries: entries as never });
    await a.rpc("hr_mark_attendance", { p_date: "2030-12-02", p_entries: entries as never });

    const { count } = await a
      .from("staff_attendance")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffId)
      .eq("attendance_date", "2030-12-02");

    expect(count).toBe(1);

    await a.rpc("hr_mark_attendance", {
      p_date: "2030-12-02",
      p_entries: [{ staff_id: staffId }] as never,
    });

    const { count: cleared } = await a
      .from("staff_attendance")
      .select("id", { count: "exact", head: true })
      .eq("staff_id", staffId)
      .eq("attendance_date", "2030-12-02");

    // An entry with no status clears the row: "not marked" has to be reachable
    // again after a mistake.
    expect(cleared).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Salary assignments
  // -------------------------------------------------------------------------

  it("refuses two salaries in force on the same day", async () => {
    const { data: structures } = await a.from("salary_structures").select("id").limit(1);
    const structureId = structures![0].id;

    const { error } = await a.from("staff_salary_assignments").insert({
      tenant_id: tenantId,
      staff_id: staffId,
      structure_id: structureId,
      effective_from: "2025-04-01",
    });

    // The demo seed already gave this person an open assignment from 2025-04-01.
    expect(error?.code).toBe("23P01");
  });

  // -------------------------------------------------------------------------
  // Payroll
  // -------------------------------------------------------------------------

  it("builds a payslip and its lines for everybody with a salary", async () => {
    const { data: runId, error } = await a.rpc("payroll_preview", {
      p_period_month: "2030-04-01",
      p_note: "test run",
    });
    expect(error, error?.message).toBeNull();
    createdRuns.push(runId as string);

    const { data: register } = await a.rpc("payroll_register", { p_run_id: runId as string });
    expect((register ?? []).length).toBeGreaterThan(0);

    for (const row of register ?? []) {
      expect(Number(row.working_days)).toBeGreaterThan(0);
      // Nothing was marked in 2030, so nobody lost pay.
      expect(Number(row.lop_days)).toBe(0);
      expect(Number(row.net_pay)).toBe(
        Number(row.gross_earnings) - Number(row.total_deductions),
      );
    }

    const { data: slips } = await a
      .from("payslips")
      .select("id")
      .eq("run_id", runId as string);
    const { count: lines } = await a
      .from("payslip_lines")
      .select("id", { count: "exact", head: true })
      .in("payslip_id", (slips ?? []).map((s) => s.id));

    expect(lines).toBeGreaterThan(0);
  });

  it("replaces the draft rather than adding a second one when re-run", async () => {
    const first = await a.rpc("payroll_preview", { p_period_month: "2030-05-01" });
    createdRuns.push(first.data as string);

    const second = await a.rpc("payroll_preview", { p_period_month: "2030-05-01" });
    expect(second.error, second.error?.message).toBeNull();
    createdRuns.push(second.data as string);

    const { data: runs } = await a
      .from("payroll_runs")
      .select("id, status")
      .eq("period_month", "2030-05-01");

    // The re-run deletes the previous draft outright rather than leaving it
    // discarded: a draft nobody finalised is a proposal, not a record, and two
    // of them for one month would disagree. Exactly one row survives.
    expect(runs).toHaveLength(1);
    expect(runs![0].id).toBe(second.data as string);
  });

  it("makes a payslip immutable by finalising, without revoking anything", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2030-06-01" });
    createdRuns.push(runId as string);

    const { data: before } = await a
      .from("payslips")
      .select("id, net_pay")
      .eq("run_id", runId as string)
      .limit(1);
    const slipId = before![0].id;
    const originalNet = Number(before![0].net_pay);

    // Editable while the run is a draft.
    const draftEdit = await a
      .from("payslips")
      .update({ net_pay: originalNet + 1, is_override: true })
      .eq("id", slipId)
      .select("id");
    expect(draftEdit.data).toHaveLength(1);

    const { error } = await a.rpc("payroll_finalise", { p_run_id: runId as string });
    expect(error, error?.message).toBeNull();

    // The composite key cascaded the run's status onto every child, so the
    // draft-only policy now matches nothing. The update touches no rows —
    // silently, which is what RLS does.
    const afterEdit = await a
      .from("payslips")
      .update({ net_pay: 999999 })
      .eq("id", slipId)
      .select("id");
    expect(afterEdit.data ?? []).toHaveLength(0);

    const { data: unchanged } = await a
      .from("payslips")
      .select("net_pay, run_status")
      .eq("id", slipId)
      .single();
    expect(Number(unchanged!.net_pay)).toBe(originalNet + 1);
    expect(unchanged!.run_status).toBe("finalised");
  });

  it("refuses to discard or re-run a finalised month", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2030-07-01" });
    createdRuns.push(runId as string);
    await a.rpc("payroll_finalise", { p_run_id: runId as string });

    const discard = await a.rpc("payroll_discard", { p_run_id: runId as string });
    expect(discard.error).not.toBeNull();
    expect(discard.error!.message).toContain("cannot be discarded");

    const rerun = await a.rpc("payroll_preview", { p_period_month: "2030-07-01" });
    expect(rerun.error).not.toBeNull();
    expect(rerun.error!.message).toContain("cannot be replaced");
  });

  it("refuses to finalise a run with nothing in it", async () => {
    // A month before anybody was employed produces no payslips.
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2010-01-01" });
    createdRuns.push(runId as string);

    const { error } = await a.rpc("payroll_finalise", { p_run_id: runId as string });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("nothing to finalise");
  });

  it("recomputes a corrected payslip back to what the structure says", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2030-08-01" });
    createdRuns.push(runId as string);

    const { data: slips } = await a
      .from("payslips")
      .select("id, net_pay")
      .eq("run_id", runId as string)
      .limit(1);
    const slipId = slips![0].id;
    const original = Number(slips![0].net_pay);

    await a
      .from("payslips")
      .update({ net_pay: original + 5000, is_override: true, note: "corridor deal" })
      .eq("id", slipId);

    const { error } = await a.rpc("payroll_recompute_payslip", { p_payslip_id: slipId });
    expect(error, error?.message).toBeNull();

    const { data: after } = await a
      .from("payslips")
      .select("net_pay, is_override, note")
      .eq("id", slipId)
      .single();

    expect(Number(after!.net_pay)).toBe(original);
    expect(after!.is_override).toBe(false);
    expect(after!.note).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Isolation
  // -------------------------------------------------------------------------

  it("keeps the other tenant's payroll invisible", async () => {
    const { data: runId } = await a.rpc("payroll_preview", { p_period_month: "2030-09-01" });
    createdRuns.push(runId as string);

    const { data: leaked } = await b.from("payroll_runs").select("id").eq("id", runId as string);
    expect(leaked ?? []).toEqual([]);

    const { data: leakedSlips } = await b
      .from("payslips")
      .select("id")
      .eq("run_id", runId as string);
    expect(leakedSlips ?? []).toEqual([]);
  });
});
