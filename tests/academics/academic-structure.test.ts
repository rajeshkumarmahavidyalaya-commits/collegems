import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The academic structure everything in Phase 1 and 3 stands on.
 *
 * The rules worth testing are the ones in Postgres: a subject that is on a
 * timetable cannot be deleted out from under it, periods cannot end before they
 * start, a closure cannot end before it begins, and "is the school open today"
 * has exactly one answer.
 */
describe("academic structure", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;
  let tenantAId: string;
  let sessionId: string;
  let sectionId: string;

  const suffix = Date.now().toString().slice(-8);

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: profile } = await a.from("user_profiles").select("tenant_id").single();
    tenantAId = profile!.tenant_id;

    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .single();
    sessionId = session!.id;

    const { data: sections } = await a.from("sections").select("id").limit(1);
    sectionId = sections![0].id;
  });

  it("refuses a period that ends before it starts", async () => {
    const { error } = await a.from("time_slots").insert({
      tenant_id: tenantAId,
      kind: "class",
      period_number: 90 + Number(suffix.slice(-1)),
      starts_at: "10:00",
      ends_at: "09:00",
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23514");
  });

  it("refuses a holiday that ends before it begins", async () => {
    const { error } = await a.from("holidays").insert({
      tenant_id: tenantAId,
      session_id: sessionId,
      name: `Backwards ${suffix}`,
      starts_on: "2026-01-10",
      ends_on: "2026-01-05",
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23514");
  });

  it("refuses two periods with the same number in one schedule", async () => {
    const { data: existing } = await a
      .from("time_slots")
      .select("period_number, kind")
      .eq("kind", "class")
      .limit(1)
      .single();

    const { error } = await a.from("time_slots").insert({
      tenant_id: tenantAId,
      kind: existing!.kind,
      period_number: existing!.period_number,
      starts_at: "15:00",
      ends_at: "15:45",
    });

    expect(error).toBeTruthy();
    expect(error!.code).toBe("23505");
  });

  it("allows the same period number in the class and exam schedules", async () => {
    // The two bell schedules are independent -- an exam "period 1" is not the
    // same thing as a lesson "period 1".
    const { data, error } = await a
      .from("time_slots")
      .insert({
        tenant_id: tenantAId,
        kind: "exam",
        period_number: 1,
        label: `Exam slot ${suffix}`,
        starts_at: "09:00",
        ends_at: "12:00",
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    await a.from("time_slots").delete().eq("id", data!.id);
  });

  it("will not delete a subject that a class is still studying", async () => {
    const { data: assignment } = await a
      .from("section_subjects")
      .select("subject_id")
      .limit(1)
      .maybeSingle();

    if (!assignment) return;

    const { error } = await a.from("subjects").delete().eq("id", assignment.subject_id);

    // `on delete restrict`: marks and homework hang off this, so it is
    // deactivated rather than removed.
    expect(error).toBeTruthy();
    expect(error!.code).toBe("23503");
  });

  it("treats assigning a subject a class already has as an edit", async () => {
    const { data: subject } = await a.from("subjects").select("id").limit(1).single();

    const first = await a
      .from("section_subjects")
      .upsert(
        {
          tenant_id: tenantAId,
          session_id: sessionId,
          section_id: sectionId,
          subject_id: subject!.id,
          teacher_staff_id: null,
        },
        { onConflict: "tenant_id,session_id,section_id,subject_id" },
      )
      .select("id")
      .single();

    const second = await a
      .from("section_subjects")
      .upsert(
        {
          tenant_id: tenantAId,
          session_id: sessionId,
          section_id: sectionId,
          subject_id: subject!.id,
          teacher_staff_id: null,
        },
        { onConflict: "tenant_id,session_id,section_id,subject_id" },
      )
      .select("id")
      .single();

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data!.id).toBe(first.data!.id);
  });

  it("answers 'is the school open' from the weekday config and the holiday list", async () => {
    const { data: closedDays } = await a
      .from("weekends")
      .select("weekday")
      .eq("is_teaching", false);

    // Find a date falling on a configured closed weekday.
    if (closedDays && closedDays.length > 0) {
      const target = new Date();
      for (let i = 0; i < 7; i++) {
        const isoDow = target.getDay() === 0 ? 7 : target.getDay();
        if (closedDays.some((d) => d.weekday === isoDow)) break;
        target.setDate(target.getDate() + 1);
      }
      const { data: closed } = await a.rpc("academics_is_teaching_day", {
        p_date: target.toISOString().slice(0, 10),
      });
      expect(closed).toBe(false);
    }

    const { data: holiday } = await a
      .from("holidays")
      .select("starts_on")
      .limit(1)
      .maybeSingle();

    if (holiday) {
      const { data: onHoliday } = await a.rpc("academics_is_teaching_day", {
        p_date: holiday.starts_on,
      });
      expect(onHoliday).toBe(false);
    }
  });

  it("cannot assign another tenant's subject to this tenant's class", async () => {
    const { data: foreignSubject } = await b.from("subjects").select("id").limit(1).maybeSingle();
    if (!foreignSubject) return;

    const { error } = await a.from("section_subjects").insert({
      tenant_id: tenantAId,
      session_id: sessionId,
      section_id: sectionId,
      subject_id: foreignSubject.id,
    });

    // The composite (tenant_id, subject_id) foreign key catches this even
    // though foreign key checks bypass RLS.
    expect(error).toBeTruthy();
    expect(["23503", "42501"]).toContain(String(error!.code));
  });
});
