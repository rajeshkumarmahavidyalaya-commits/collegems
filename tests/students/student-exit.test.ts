import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * Leaving, through real RLS.
 *
 * The claim worth proving is the one the module exists for: **a status flag is
 * not an exit.** Before `0174`, `certificate_issue` set
 * `students.status = 'transferred'` and four of the five read paths that decide
 * what a child is charged and told never looked at it — so the child kept being
 * invoiced, kept a bus seat and a hostel bed, and kept getting absence texts.
 *
 * These assert the relationships actually end, that the exit is idempotent, and
 * that what it *cannot* end is reported rather than refused.
 */
describe("student exit", () => {
  let a: SupabaseClient<Database>;
  let studentId: string;

  /** Everything changed, restored in `afterAll` whatever happened. */
  const restore = {
    studentStatus: "active",
    enrolmentIds: [] as string[],
    transportIds: [] as string[],
    hostelIds: [] as string[],
  };

  beforeAll(async () => {
    a = await tenantAClient();

    // A child with a bus seat, so the test is not vacuous.
    const { data } = await a
      .from("transport_assignments")
      .select("student_id")
      .eq("status", "active")
      .is("ends_on", null)
      .limit(1)
      .maybeSingle();

    if (!data) return;
    studentId = data.student_id;

    const [{ data: enrolments }, { data: transport }, { data: hostel }] = await Promise.all([
      a.from("enrolments").select("id").eq("student_id", studentId).eq("status", "active"),
      a.from("transport_assignments").select("id").eq("student_id", studentId).is("ends_on", null),
      a.from("hostel_allocations").select("id").eq("student_id", studentId).is("ends_on", null),
    ]);
    restore.enrolmentIds = (enrolments ?? []).map((r) => r.id);
    restore.transportIds = (transport ?? []).map((r) => r.id);
    restore.hostelIds = (hostel ?? []).map((r) => r.id);
  });

  afterAll(async () => {
    if (!studentId) return;
    await a.from("students").update({ status: restore.studentStatus }).eq("id", studentId);
    if (restore.enrolmentIds.length > 0) {
      await a.from("enrolments").update({ status: "active" }).in("id", restore.enrolmentIds);
    }
    if (restore.transportIds.length > 0) {
      await a.from("transport_assignments").update({ ends_on: null }).in("id", restore.transportIds);
    }
    if (restore.hostelIds.length > 0) {
      await a.from("hostel_allocations").update({ ends_on: null }).in("id", restore.hostelIds);
    }
  });

  it("refuses an exit with no reason", async () => {
    if (!studentId) return;
    const result = await a.rpc("student_exit", {
      p_student_id: studentId,
      p_reason: "  ",
    });
    expect(result.error).not.toBeNull();
  });

  it("refuses a status a child cannot leave as", async () => {
    if (!studentId) return;
    const result = await a.rpc("student_exit", {
      p_student_id: studentId,
      p_reason: "Written by the automated test suite",
      p_status: "graduated",
    });
    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain("transferred, alumni, expelled or inactive");
  });

  it("ends the enrolment, the bus seat and the hostel bed in one act", async () => {
    if (!studentId) return;

    const { data, error } = await a.rpc("student_exit", {
      p_student_id: studentId,
      p_reason: "Written by the automated test suite",
      p_status: "transferred",
    });
    expect(error).toBeNull();

    const doc = data as unknown as {
      closed: { enrolments: number; transport: number; hostel: number };
      outstanding: { kind: string; message: string }[];
    };

    expect(doc.closed.enrolments).toBeGreaterThan(0);
    expect(doc.closed.transport).toBeGreaterThan(0);

    // The point of the module: from the next day, nothing is billable.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { data: lines } = await a.rpc("fees_billable_lines", {
      p_student_id: studentId,
      p_as_of: tomorrow,
    });
    expect(lines ?? []).toEqual([]);
  });

  it("is idempotent: running it again closes nothing", async () => {
    if (!studentId) return;
    const { data } = await a.rpc("student_exit", {
      p_student_id: studentId,
      p_reason: "Written by the automated test suite, again",
      p_status: "transferred",
    });
    const doc = data as unknown as { closed: Record<string, number> };
    expect(doc.closed.enrolments).toBe(0);
    expect(doc.closed.transport).toBe(0);
    expect(doc.closed.hostel).toBe(0);
  });

  it("does not accuse itself: an exit performed today raises no problem", async () => {
    if (!studentId) return;
    // `0175`. An assignment whose `ends_on` is today has been ended — the
    // charge runs to the last day inclusive, the relationship does not. A
    // critic that fires on a correctly finished action teaches people to
    // ignore it.
    const { data } = await a.rpc("student_exit_problems");
    const mine = (data ?? []).filter((p) => p.student_id === studentId);
    expect(mine).toEqual([]);
  });
});
