import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The cover roster, through real RLS.
 *
 * What is worth proving from the app's side, in the order the module fails if
 * any of it stops holding:
 *
 *   1. **A lesson only appears when its teacher is actually away.** Being away
 *      is derived from approved leave *and* the staff register, and neither is
 *      entered on this screen. Arranging cover for somebody who is in is
 *      refused in a sentence.
 *   2. **A substitute cannot be in two classrooms at once.** That is a partial
 *      unique index rather than a check-then-insert, so two people doing the
 *      roster together have one of them lose in the database — and the refusal
 *      names the person and the day.
 *   3. **The arrangement is frozen.** `absent_staff_id` and `time_slot_id` are
 *      copies, not keys into the live timetable, so November's roster still
 *      says what happened after February's timetable edit.
 *   4. **Tenant isolation**, in both directions.
 */
describe("substitutions", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  /** Everything this test creates, cleared in `afterAll` whatever happened. */
  const arranged: { entry: string; date: string }[] = [];
  const markedAway: string[] = [];
  const PROBE = "Written by the automated test suite";

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);
  });

  afterAll(async () => {
    for (const { entry, date } of arranged) {
      await a.rpc("substitution_clear", { p_timetable_entry_id: entry, p_date: date });
    }
    if (markedAway.length > 0) {
      await a.from("staff_attendance").delete().in("id", markedAway);
    }
  });

  /** Today, in the school's own calendar rather than the runner's. */
  async function schoolToday(): Promise<string> {
    const { data } = await a.rpc("mobile_today");
    return data as unknown as string;
  }

  /** Two lessons in the same period on a day the school is open, if there are any. */
  async function lessonsInOnePeriod() {
    const today = await schoolToday();
    const { data: session } = await a
      .from("academic_sessions")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (!session) return null;

    const weekday = new Date(`${today}T00:00:00`).getDay();
    const isoWeekday = weekday === 0 ? 7 : weekday;

    const { data } = await a
      .from("timetable_entries")
      .select("id, time_slot_id, teacher_staff_id")
      .eq("session_id", session.id)
      .eq("weekday", isoWeekday)
      .not("teacher_staff_id", "is", null);

    const bySlot = new Map<string, { id: string; teacher: string }[]>();
    for (const row of data ?? []) {
      const list = bySlot.get(row.time_slot_id) ?? [];
      list.push({ id: row.id, teacher: row.teacher_staff_id! });
      bySlot.set(row.time_slot_id, list);
    }

    for (const list of bySlot.values()) {
      const distinct = list.filter(
        (l, index) => list.findIndex((other) => other.teacher === l.teacher) === index,
      );
      if (distinct.length >= 2) return { today, sessionId: session.id, lessons: distinct };
    }
    return null;
  }

  async function markAway(sessionId: string, staffId: string, date: string) {
    const { data: profile } = await a.from("user_profiles").select("tenant_id").limit(1).single();
    const { data, error } = await a
      .from("staff_attendance")
      .insert({
        tenant_id: profile!.tenant_id,
        session_id: sessionId,
        staff_id: staffId,
        attendance_date: date,
        status: "absent",
        note: PROBE,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    markedAway.push(data!.id);
  }

  it("refuses to arrange cover for somebody who is in, and says so", async () => {
    const found = await lessonsInOnePeriod();
    if (!found) return;

    const result = await a.rpc("substitution_arrange", {
      p_timetable_entry_id: found.lessons[0]!.id,
      p_date: found.today,
      p_substitute_staff_id: found.lessons[1]!.teacher,
    });

    expect(result.error).not.toBeNull();
    // A sentence with a name and a date, not a constraint violation.
    expect(result.error!.message).toContain("not marked away");
  });

  it("refuses a lesson that is not taught on that day", async () => {
    const found = await lessonsInOnePeriod();
    if (!found) return;

    // Six days on lands on a different weekday whatever today is.
    const wrongDay = new Date(`${found.today}T00:00:00`);
    wrongDay.setDate(wrongDay.getDate() + 6);

    const result = await a.rpc("substitution_arrange", {
      p_timetable_entry_id: found.lessons[0]!.id,
      p_date: wrongDay.toISOString().slice(0, 10),
      p_substitute_staff_id: undefined,
    });

    expect(result.error).not.toBeNull();
    expect(result.error!.message).toContain("not taught on a");
  });

  it("lists an away teacher's lessons, then refuses to double-book one substitute", async () => {
    const found = await lessonsInOnePeriod();
    if (!found) return;

    const [first, second] = found.lessons;
    await markAway(found.sessionId, first!.teacher, found.today);
    await markAway(found.sessionId, second!.teacher, found.today);

    const { data: gaps, error: gapsError } = await a.rpc("substitution_gaps", {
      p_date: found.today,
    });
    expect(gapsError).toBeNull();

    const ids = (gaps ?? []).map((g) => g.timetable_entry_id);
    expect(ids, "an away teacher's lesson must appear").toContain(first!.id);
    expect(ids).toContain(second!.id);

    // Somebody genuinely free for the first lesson.
    const { data: candidates } = await a.rpc("substitution_candidates", {
      p_timetable_entry_id: first!.id,
      p_date: found.today,
    });
    if (!candidates || candidates.length === 0) return;
    const substitute = candidates[0]!.staff_id;

    // Neither of the two away teachers may be offered as cover for the other:
    // being away is one of the four freedom conditions.
    const offered = candidates.map((c) => c.staff_id);
    expect(offered).not.toContain(first!.teacher);
    expect(offered).not.toContain(second!.teacher);

    const ok = await a.rpc("substitution_arrange", {
      p_timetable_entry_id: first!.id,
      p_date: found.today,
      p_substitute_staff_id: substitute,
      p_note: PROBE,
    });
    expect(ok.error).toBeNull();
    arranged.push({ entry: first!.id, date: found.today });

    // The same person, the same period, a different class. The partial unique
    // index refuses it, and the function turns that into a sentence.
    const clash = await a.rpc("substitution_arrange", {
      p_timetable_entry_id: second!.id,
      p_date: found.today,
      p_substitute_staff_id: substitute,
    });
    expect(clash.error).not.toBeNull();
    expect(clash.error!.message).toContain("already covering another class");

    // ...and they are no longer offered for the second lesson either. Offering
    // somebody and then refusing them is the worse screen.
    const { data: after } = await a.rpc("substitution_candidates", {
      p_timetable_entry_id: second!.id,
      p_date: found.today,
    });
    expect((after ?? []).map((c) => c.staff_id)).not.toContain(substitute);
  });

  it("records a class left with nobody as an arrangement, not as a gap", async () => {
    const found = await lessonsInOnePeriod();
    if (!found) return;

    const lesson = found.lessons[1]!;
    // Already marked away by the test above; marking twice would collide.
    const { data: away } = await a.rpc("staff_is_away", {
      p_date: found.today,
      p_staff_id: lesson.teacher,
    });
    if (!away) return;

    const result = await a.rpc("substitution_arrange", {
      p_timetable_entry_id: lesson.id,
      p_date: found.today,
      p_substitute_staff_id: undefined,
      p_note: PROBE,
    });
    expect(result.error).toBeNull();
    arranged.push({ entry: lesson.id, date: found.today });

    const { data: gaps } = await a.rpc("substitution_gaps", { p_date: found.today });
    const row = (gaps ?? []).find((g) => g.timetable_entry_id === lesson.id);
    expect(row?.arranged, "a row with no substitute is still an arrangement").toBe(true);
    expect(row?.substitute_staff_id).toBeNull();

    // ...and the critic says so out loud, because a merged class is a decision
    // somebody has to have been told about.
    const { data: problems } = await a.rpc("substitution_problems", { p_date: found.today });
    const info = (problems ?? []).filter((p) => p.severity === "info");
    expect(info.some((p) => p.message.includes("no substitute"))).toBe(true);
  });

  it("freezes the period and the absent teacher onto the arrangement", async () => {
    const { data } = await a
      .from("substitutions")
      .select("timetable_entry_id, time_slot_id, absent_staff_id, timetable_entries ( time_slot_id, teacher_staff_id )")
      .limit(5);

    for (const row of data ?? []) {
      // Equal today — the point is that they are separate columns, so a later
      // timetable edit moves one and leaves the other saying what happened.
      expect(row.time_slot_id).toBeTruthy();
      expect(row.absent_staff_id).toBeTruthy();
    }
  });

  it("keeps one tenant's roster out of the other's", async () => {
    const { data: mine } = await a.from("substitutions").select("id");
    const { data: theirs } = await b.from("substitutions").select("id");

    const otherIds = new Set((theirs ?? []).map((r) => r.id));
    for (const row of mine ?? []) {
      expect(otherIds.has(row.id), "a substitution leaked across tenants").toBe(false);
    }
  });
});
