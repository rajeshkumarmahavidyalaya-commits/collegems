import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * Integration coverage for attendance, against the real database through the
 * real RLS policies.
 *
 * Everything asserted here is enforced in Postgres, not in the app: the whole
 * register is one atomic upsert, replaying it converges instead of
 * duplicating, a payload naming another class's enrolments is filtered, future
 * dates are refused, and a second tenant sees none of it. Testing these
 * anywhere but against the live policies would be testing a mock.
 */
describe("attendance marking", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let sectionId: string;
  let enrolmentIds: string[] = [];
  let otherEnrolmentIds: string[] = [];

  /**
   * A date **inside the year those enrolments belong to**, resolved in
   * `beforeAll`.
   *
   * This used to be the constant `2020-02-03` — "well in the past, so the suite
   * can never collide with a register a human is taking today". Migration
   * `0198` made that impossible on purpose: a register's year is the year
   * containing its date, and no academic year covers 2020, so the write is
   * refused with a sentence. The premise was always wrong — a register in a
   * year the school did not have was never a legal row — and the constant was
   * hiding it.
   */
  let testDate = "";

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: sections } = await a
      .from("sections")
      .select("id, enrolments ( id )")
      .limit(10);

    const withStudents = (sections ?? []).filter((s) => (s.enrolments ?? []).length > 0);
    expect(withStudents.length).toBeGreaterThanOrEqual(2);

    sectionId = withStudents[0].id;
    enrolmentIds = withStudents[0].enrolments.map((e) => e.id);
    otherEnrolmentIds = withStudents[1].enrolments.map((e) => e.id);

    // Forty days into the year those children are enrolled in: comfortably
    // inside it, comfortably in the past, and nowhere near a register somebody
    // is taking today.
    const { data: enrolment } = await a
      .from("enrolments")
      .select("academic_sessions ( start_date )")
      .eq("id", enrolmentIds[0])
      .maybeSingle();

    const start = enrolment?.academic_sessions?.start_date;
    expect(start).toBeTruthy();
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 40);
    testDate = d.toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await a.from("attendance_records").delete().eq("attendance_date", testDate);
  });

  it("writes the whole register in one call", async () => {
    const { data: written, error } = await a.rpc("mark_attendance", {
      p_section_id: sectionId,
      p_date: testDate,
      p_entries: enrolmentIds.map((id, i) => ({
        enrolment_id: id,
        status: i === 0 ? "absent" : "present",
      })),
    });

    expect(error).toBeNull();
    expect(written).toBe(enrolmentIds.length);

    const { data: rows } = await a
      .from("attendance_records")
      .select("enrolment_id, status, session_id, period")
      .eq("attendance_date", testDate)
      .in("enrolment_id", enrolmentIds);

    expect(rows).toHaveLength(enrolmentIds.length);
    // The session is resolved server-side; the client never supplies it.
    expect(rows!.every((r) => Boolean(r.session_id))).toBe(true);
    // 0 is whole-day; period-wise marking arrives with the timetable.
    expect(rows!.every((r) => r.period === 0)).toBe(true);
    expect(rows!.filter((r) => r.status === "absent")).toHaveLength(1);
  });

  it("replaying the same register updates instead of duplicating", async () => {
    const { data: written, error } = await a.rpc("mark_attendance", {
      p_section_id: sectionId,
      p_date: testDate,
      p_entries: enrolmentIds.map((id) => ({ enrolment_id: id, status: "late" })),
    });

    expect(error).toBeNull();
    expect(written).toBe(enrolmentIds.length);

    const { data: rows } = await a
      .from("attendance_records")
      .select("status")
      .eq("attendance_date", testDate)
      .in("enrolment_id", enrolmentIds);

    // Same row count as the first pass -- this is what makes an offline phone
    // safe to replay.
    expect(rows).toHaveLength(enrolmentIds.length);
    expect(rows!.every((r) => r.status === "late")).toBe(true);
  });

  it("ignores entries for enrolments outside the named section", async () => {
    const { data: written, error } = await a.rpc("mark_attendance", {
      p_section_id: sectionId,
      p_date: testDate,
      p_entries: [...enrolmentIds, ...otherEnrolmentIds].map((id) => ({
        enrolment_id: id,
        status: "present",
      })),
    });

    expect(error).toBeNull();
    // Only this section's students are written, however the payload was built.
    expect(written).toBe(enrolmentIds.length);

    const { count } = await a
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .eq("attendance_date", testDate)
      .in("enrolment_id", otherEnrolmentIds);

    expect(count).toBe(0);
  });

  it("refuses a future date", async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const { error } = await a.rpc("mark_attendance", {
      p_section_id: sectionId,
      p_date: future,
      p_entries: enrolmentIds.map((id) => ({ enrolment_id: id, status: "present" })),
    });

    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/future date/i);
  });

  it("rejects a status outside the allowed set", async () => {
    const { error } = await a.rpc("mark_attendance", {
      p_section_id: sectionId,
      p_date: testDate,
      p_entries: [{ enrolment_id: enrolmentIds[0], status: "holiday" }],
    });

    // The check constraint is the gate, not the Zod schema in the app.
    expect(error).toBeTruthy();
    expect(error!.code).toBe("23514");
  });

  it("does not leak tenant A's attendance to a tenant B admin", async () => {
    const { data: visible } = await b
      .from("attendance_records")
      .select("id")
      .eq("attendance_date", testDate);

    expect(visible ?? []).toHaveLength(0);
  });

  it("does not let a tenant B admin mark into tenant A's section", async () => {
    const { data: written } = await b.rpc("mark_attendance", {
      p_section_id: sectionId,
      p_date: testDate,
      p_entries: enrolmentIds.map((id) => ({ enrolment_id: id, status: "absent" })),
    });

    // The enrolments are invisible across the tenant boundary, so the payload
    // filters down to nothing rather than writing into another school.
    expect(written).toBe(0);

    const { data: rows } = await a
      .from("attendance_records")
      .select("status")
      .eq("attendance_date", testDate)
      .in("enrolment_id", enrolmentIds);

    expect(rows!.every((r) => r.status === "present")).toBe(true);
  });
});
