import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Student leave, through real RLS.
 *
 * The claims worth proving from the app's side:
 *
 *   1. **Two live requests cannot cover the same day for one child** — an
 *      exclusion constraint, not a check-then-insert, so two people submitting
 *      at once have one of them lose in the database. And the refusal is a
 *      sentence naming the dates, not `23P01`.
 *   2. **A refused or cancelled request stops blocking** — the constraint is
 *      partial for exactly that reason.
 *   3. **The scheduler's question is unreachable with a JWT.**
 *      `student_is_on_leave` takes a tenant as an argument.
 *   4. **Approving leave writes no attendance.** The register is what a teacher
 *      observed, and an approval quietly rewriting yesterday's register is the
 *      edit an attendance record must not permit.
 */
describe("student leave", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  async function anActiveStudent(): Promise<string> {
    const { data } = await a
      .from("students")
      .select("id")
      .eq("status", "active")
      .order("admission_number")
      .limit(1)
      .single();
    return data!.id;
  }

  /** Far enough out that it cannot collide with anything a person created. */
  function farFutureDates(offset: number) {
    const start = new Date(Date.now() + (400 + offset * 20) * 86_400_000);
    const end = new Date(start.getTime() + 2 * 86_400_000);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  it("refuses a second live request over the same days, in a sentence", async () => {
    const studentId = await anActiveStudent();
    const { from, to } = farFutureDates(1);

    const first = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: from,
      p_ends_on: to,
      p_kind: "planned",
      p_reason: "Written by the automated test suite",
    });
    expect(first.error).toBeNull();
    const firstId = (first.data as unknown as { id: string }).id;

    const overlapping = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: to,
      p_ends_on: to,
      p_kind: "planned",
      p_reason: "Should be refused by the exclusion constraint",
    });
    expect(overlapping.error).not.toBeNull();
    // Named dates, not "conflicting key value violates exclusion constraint".
    expect(overlapping.error!.message).toContain("already a leave request");

    // ...and once it is cancelled the dates are free again, because the
    // constraint is partial on pending/approved.
    const cancelled = await a.rpc("student_leave_cancel", { p_leave_id: firstId });
    expect(cancelled.error).toBeNull();

    const again = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: from,
      p_ends_on: to,
      p_kind: "planned",
      p_reason: "Re-applying after a cancellation",
    });
    expect(again.error, "a cancelled request must not block the same dates").toBeNull();

    await a.rpc("student_leave_cancel", {
      p_leave_id: (again.data as unknown as { id: string }).id,
    });
  });

  it("refuses a request with no reason", async () => {
    const studentId = await anActiveStudent();
    const { from, to } = farFutureDates(2);

    const result = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: from,
      p_ends_on: to,
      p_kind: "other",
      p_reason: "  ",
    });
    expect(result.error).not.toBeNull();
  });

  it("refuses a range that ends before it starts", async () => {
    const studentId = await anActiveStudent();
    const { from, to } = farFutureDates(3);

    const result = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: to,
      p_ends_on: from,
      p_kind: "other",
      p_reason: "Backwards on purpose",
    });
    expect(result.error).not.toBeNull();
  });

  it("does not write attendance when leave is approved", async () => {
    const studentId = await anActiveStudent();
    const { from, to } = farFutureDates(4);

    const applied = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: from,
      p_ends_on: to,
      p_kind: "planned",
      p_reason: "Written by the automated test suite",
    });
    expect(applied.error).toBeNull();
    const id = (applied.data as unknown as { id: string }).id;

    const before = await a
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .gte("attendance_date", from)
      .lte("attendance_date", to);

    const decided = await a.rpc("student_leave_decide", { p_leave_id: id, p_approve: true });
    expect(decided.error).toBeNull();

    const after = await a
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .gte("attendance_date", from)
      .lte("attendance_date", to);

    // The register is what a teacher observed. Approving leave is not an
    // observation, and pre-writing the future is not a register.
    expect(after.count).toBe(before.count);

    // ...but the question "is this child away that day" is answerable.
    const { data: onLeave } = await a.rpc("student_leave_on", { p_date: from });
    expect((onLeave ?? []).some((l) => l.student_id === studentId)).toBe(true);

    await a.rpc("student_leave_cancel", { p_leave_id: id });
  });

  it("will not decide something that is not waiting", async () => {
    const studentId = await anActiveStudent();
    const { from, to } = farFutureDates(5);

    const applied = await a.rpc("student_leave_apply", {
      p_student_id: studentId,
      p_starts_on: from,
      p_ends_on: to,
      p_kind: "other",
      p_reason: "Written by the automated test suite",
    });
    const id = (applied.data as unknown as { id: string }).id;

    expect((await a.rpc("student_leave_decide", { p_leave_id: id, p_approve: false })).error)
      .toBeNull();
    // Deciding twice must raise rather than silently touching nothing --
    // otherwise a refusal could be quietly turned into an approval.
    expect((await a.rpc("student_leave_decide", { p_leave_id: id, p_approve: true })).error)
      .not.toBeNull();
  });

  it("hides the scheduler's question from everybody holding a JWT", async () => {
    const studentId = await anActiveStudent();
    const result = await a.rpc("student_is_on_leave", {
      p_tenant_id: "00000000-0000-4000-8000-000000000001",
      p_student_id: studentId,
      p_date: "2026-09-07",
    });
    // It takes a tenant as an argument, so it must be unreachable with a JWT --
    // the `fees_settle_gateway_payment` shape.
    expect(result.error).not.toBeNull();
  });

  it("does not show one school another school's leave", async () => {
    const { data: mine } = await a.from("student_leave_requests").select("tenant_id");
    const { data: theirs } = await b.from("student_leave_requests").select("tenant_id");

    const aTenants = new Set((mine ?? []).map((r) => r.tenant_id));
    const bTenants = new Set((theirs ?? []).map((r) => r.tenant_id));
    for (const t of bTenants) expect(aTenants.has(t)).toBe(false);
  });

  it("puts waiting requests first in the catalog report", async () => {
    const { data, error } = await a.rpc("report_run", {
      p_key: "attendance.student_leave",
      p_params: {},
      p_limit: 200,
    });
    expect(error).toBeNull();

    let seenDecided = false;
    for (const row of data ?? []) {
      const status = String((row.row_data as Record<string, unknown>).status);
      if (status !== "pending") seenDecided = true;
      // Once a decided one has appeared, no waiting one may follow: the list is
      // read to find what is still somebody's job today.
      else expect(seenDecided).toBe(false);
    }
  });
});
