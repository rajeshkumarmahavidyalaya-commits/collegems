import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient, tenantBClient } from "../helpers/client";

/**
 * The routine, through real RLS.
 *
 * A timetable is defined by what it refuses, so most of this file is refusals.
 * Each one is enforced by a unique index or a foreign key rather than by
 * application code — the point of the tests is that the *database* says no, not
 * that some TypeScript remembered to ask.
 */
describe("class routine", () => {
  let a: SupabaseClient<Database>;
  let b: SupabaseClient<Database>;

  let sectionA: string;
  let sectionB: string;
  let subjectA: string;
  let subjectB: string;
  let teacher: string;
  let room: string;
  let slot1: string;
  let slot2: string;
  let breakSlot: string | null = null;

  // A weekday no fixture uses, so this suite cannot collide with the seeded
  // demo week (which fills Monday–Friday) or with a re-run of itself.
  const day = 6;
  const created: string[] = [];

  beforeAll(async () => {
    [a, b] = await Promise.all([tenantAClient(), tenantBClient()]);

    const { data: slots } = await a
      .from("time_slots")
      .select("id, is_break, schedulable")
      .eq("kind", "class")
      .order("period_number");

    const lesson = (slots ?? []).filter((s) => s.schedulable);
    slot1 = lesson[0].id;
    slot2 = lesson[1].id;
    breakSlot = (slots ?? []).find((s) => s.is_break)?.id ?? null;

    // Two different classes that share a teacher — which is what makes a clash
    // possible at all, and therefore what makes this suite meaningful.
    const { data: assignments } = await a
      .from("section_subjects")
      .select("section_id, subject_id, teacher_staff_id")
      .not("teacher_staff_id", "is", null);

    const byTeacher = new Map<string, typeof assignments>();
    for (const row of assignments ?? []) {
      const list = byTeacher.get(row.teacher_staff_id!) ?? [];
      list.push(row);
      byTeacher.set(row.teacher_staff_id!, list as never);
    }

    const shared = [...byTeacher.entries()].find(
      ([, rows]) => new Set((rows ?? []).map((r) => r.section_id)).size >= 2,
    );
    expect(shared, "the demo tenant needs one teacher across two classes").toBeDefined();

    teacher = shared![0];
    const rows = shared![1]!;
    const first = rows[0];
    const second = rows.find((r) => r.section_id !== first.section_id)!;

    sectionA = first.section_id;
    subjectA = first.subject_id;
    sectionB = second.section_id;
    subjectB = second.subject_id;

    const { data: rooms } = await a.from("class_rooms").select("id").eq("is_active", true).limit(1);
    room = rooms![0].id;
  });

  afterAll(async () => {
    // Saturday is not part of the seeded week, so clearing it leaves the demo
    // data exactly as this suite found it.
    await a.from("timetable_entries").delete().eq("weekday", day);
  });

  it("saves a period and reads it back through the grid query", async () => {
    const { data, error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionA,
      p_weekday: day,
      p_time_slot_id: slot1,
      p_subject_id: subjectA,
      p_teacher_staff_id: teacher,
      p_class_room_id: room,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    created.push(data!.id);

    const { data: grid } = await a.rpc("timetable_for_section", { p_section_id: sectionA });
    const saved = (grid ?? []).find((row) => row.id === data!.id);

    expect(saved).toBeDefined();
    expect(saved!.weekday).toBe(day);
    // The grid query resolves names so the UI never has to join four tables.
    expect(saved!.subject_name).toBeTruthy();
    expect(saved!.teacher_name).toBeTruthy();
  });

  it("replaces the lesson in a cell rather than refusing it", async () => {
    // A person clicking a filled cell and choosing another subject means
    // "change this", not "create a second lesson in the same period".
    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionA,
      p_weekday: day,
      p_time_slot_id: slot1,
      p_subject_id: subjectA,
      p_teacher_staff_id: teacher,
      p_class_room_id: undefined,
    });

    expect(error).toBeNull();

    const { data: rows } = await a
      .from("timetable_entries")
      .select("id, class_room_id")
      .eq("section_id", sectionA)
      .eq("weekday", day)
      .eq("time_slot_id", slot1);

    expect(rows).toHaveLength(1);
    expect(rows![0].class_room_id).toBeNull();
  });

  it("refuses to put one teacher in two classes at once, and says where", async () => {
    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionB,
      p_weekday: day,
      p_time_slot_id: slot1,
      p_subject_id: subjectB,
      p_teacher_staff_id: teacher,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("already taking");
    // The message names the conflicting lesson, not a constraint.
    expect(error!.message).not.toContain("timetable_entries_teacher_clash");
  });

  it("refuses to put two classes in one room at once", async () => {
    await a.rpc("timetable_set_entry", {
      p_section_id: sectionA,
      p_weekday: day,
      p_time_slot_id: slot2,
      p_subject_id: subjectA,
      p_class_room_id: room,
    });

    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionB,
      p_weekday: day,
      p_time_slot_id: slot2,
      p_subject_id: subjectB,
      p_class_room_id: room,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("already in use");
  });

  it("reports who is busy in a period before anything is saved", async () => {
    const { data, error } = await a.rpc("timetable_busy_in_slot", {
      p_weekday: day,
      p_time_slot_id: slot1,
      p_section_id: sectionB,
    });

    expect(error).toBeNull();
    const teachers = (data ?? []).filter((r) => r.entity === "teacher");
    expect(teachers.some((r) => r.entity_id === teacher)).toBe(true);
    expect(teachers[0].busy_with).toBeTruthy();
  });

  it("does not count the cell being edited as a conflict with itself", async () => {
    const { data } = await a.rpc("timetable_busy_in_slot", {
      p_weekday: day,
      p_time_slot_id: slot1,
      p_section_id: sectionA,
    });

    expect((data ?? []).some((r) => r.entity_id === teacher)).toBe(false);
  });

  it("refuses a lesson in the lunch break", async () => {
    if (!breakSlot) return;

    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionA,
      p_weekday: day,
      p_time_slot_id: breakSlot,
      p_subject_id: subjectA,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("no lesson can be scheduled");
  });

  it("refuses a subject that is not on this class's curriculum", async () => {
    // Enforced by the composite foreign key onto `section_subjects`, so it
    // holds no matter which code path writes the row.
    const { data: foreign } = await a
      .from("subjects")
      .select("id")
      .not(
        "id",
        "in",
        `(${[subjectA, subjectB].join(",")})`,
      )
      .limit(1);

    if (!foreign?.length) return;

    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionA,
      p_weekday: day,
      p_time_slot_id: slot2,
      p_subject_id: foreign[0].id,
    });

    expect(error).not.toBeNull();
  });

  it("refuses a day the school is closed on", async () => {
    const { data: closed } = await a
      .from("weekends")
      .select("weekday")
      .eq("is_teaching", false)
      .limit(1);

    if (!closed?.length) return;

    const { error } = await a.rpc("timetable_set_entry", {
      p_section_id: sectionA,
      p_weekday: closed[0].weekday,
      p_time_slot_id: slot1,
      p_subject_id: subjectA,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("closed on that weekday");
  });

  it("copies a day into empty periods without overwriting what is there", async () => {
    const target = 7;

    // Saturday→Sunday would normally be refused as a closed day, so this test
    // only runs where Sunday is a teaching day. Where it is not, the refusal is
    // already covered above.
    const { data: sunday } = await a
      .from("weekends")
      .select("is_teaching")
      .eq("weekday", target)
      .maybeSingle();

    if (sunday && !sunday.is_teaching) return;

    const { data, error } = await a.rpc("timetable_copy_day", {
      p_section_id: sectionA,
      p_from_weekday: day,
      p_to_weekday: target,
    });

    expect(error).toBeNull();
    expect(data![0].copied + data![0].skipped).toBeGreaterThan(0);

    await a.from("timetable_entries").delete().eq("weekday", target);
  });

  it("refuses copying a day onto itself", async () => {
    const { error } = await a.rpc("timetable_copy_day", {
      p_section_id: sectionA,
      p_from_weekday: day,
      p_to_weekday: day,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("two different days");
  });

  it("keeps one school's routine invisible to another", async () => {
    const { data: mine } = await a
      .from("timetable_entries")
      .select("id")
      .eq("weekday", day)
      .limit(1);

    const { data: leaked } = await b
      .from("timetable_entries")
      .select("id")
      .eq("id", mine![0].id);

    expect(leaked).toEqual([]);

    const { data: foreignGrid } = await b.rpc("timetable_for_section", {
      p_section_id: sectionA,
    });
    expect(foreignGrid ?? []).toEqual([]);
  });

  it("reports a teacher's own week without being told who they are", async () => {
    const { data, error } = await a.rpc("timetable_for_teacher", { p_staff_id: teacher });

    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.section_label).toBeTruthy();
      expect(row.subject_code).toBeTruthy();
    }
  });

  it("counts periods per teacher for the load view", async () => {
    const { data, error } = await a.rpc("timetable_teacher_load");

    expect(error).toBeNull();
    const row = (data ?? []).find((r) => r.staff_id === teacher);
    expect(row).toBeDefined();
    expect(row!.periods).toBeGreaterThan(0);
    // Sections and subjects are distinct counts, so they can never exceed the
    // period count they are derived from.
    expect(row!.sections).toBeLessThanOrEqual(row!.periods);
    expect(row!.subjects).toBeLessThanOrEqual(row!.periods);
  });
});
