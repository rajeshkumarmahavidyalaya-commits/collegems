"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { copyDaySchema, timetableEntrySchema } from "@/lib/validations/timetable";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

/**
 * `timetable_set_entry` raises with sentences a person can act on — "That
 * teacher is already taking Grade 7A · Mathematics (period 3)" — so a `P0001`
 * is passed straight through.
 *
 * A `23505` means the unique index caught a clash the function's own check
 * missed, which is only possible when two saves race. That is not a bug and it
 * is not the user's fault, so it gets a sentence explaining what to do rather
 * than the constraint name.
 */
function rpcError(error: { code?: string; message: string }): ActionResult<never> {
  if (error.code === "23505") {
    return fail(
      "Someone else changed that period a moment ago, so this save would have created a clash. Reload the grid and try again.",
    );
  }
  return fail(error.message);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type RoutineEntry = {
  id: string;
  weekday: number;
  timeSlotId: string;
  periodNumber: number;
  slotLabel: string | null;
  startsAt: string;
  endsAt: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  teacherStaffId: string | null;
  teacherName: string | null;
  classRoomId: string | null;
  roomName: string | null;
  note: string | null;
};

export async function getSectionRoutine(sectionId: string): Promise<RoutineEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timetable_for_section", {
    p_section_id: sectionId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    weekday: row.weekday,
    timeSlotId: row.time_slot_id,
    periodNumber: row.period_number,
    slotLabel: row.slot_label,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    subjectCode: row.subject_code,
    teacherStaffId: row.teacher_staff_id,
    teacherName: row.teacher_name,
    classRoomId: row.class_room_id,
    roomName: row.room_name,
    note: row.note,
  }));
}

export type TeacherRoutineEntry = {
  id: string;
  weekday: number;
  timeSlotId: string;
  periodNumber: number;
  startsAt: string;
  endsAt: string;
  sectionId: string;
  sectionLabel: string;
  subjectName: string;
  subjectCode: string;
  roomName: string | null;
};

/**
 * Omitting `staffId` asks for the caller's own week — the RPC resolves it from
 * `user_profiles`, so a teacher's own routine is not something the client can
 * get wrong or point at somebody else.
 */
export async function getTeacherRoutine(staffId?: string): Promise<TeacherRoutineEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timetable_for_teacher", {
    p_staff_id: staffId || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    weekday: row.weekday,
    timeSlotId: row.time_slot_id,
    periodNumber: row.period_number,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sectionId: row.section_id,
    sectionLabel: row.section_label,
    subjectName: row.subject_name,
    subjectCode: row.subject_code,
    roomName: row.room_name,
  }));
}

export type BusyRow = { entity: "teacher" | "room"; entityId: string; busyWith: string };

/**
 * Who is already committed in this period. Asked before the dropdown opens, so
 * a teacher who is demonstrably elsewhere is shown as unavailable rather than
 * being offered and then refused.
 */
export async function getBusyInSlot(
  weekday: number,
  timeSlotId: string,
  sectionId: string,
): Promise<BusyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timetable_busy_in_slot", {
    p_weekday: weekday,
    p_time_slot_id: timeSlotId,
    p_section_id: sectionId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    entity: row.entity as "teacher" | "room",
    entityId: row.entity_id,
    busyWith: row.busy_with,
  }));
}

export type TeacherLoadRow = {
  staffId: string;
  teacherName: string;
  employeeCode: string;
  periods: number;
  sections: number;
  subjects: number;
};

export async function getTeacherLoad(): Promise<TeacherLoadRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timetable_teacher_load");
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    staffId: row.staff_id,
    teacherName: row.teacher_name,
    employeeCode: row.employee_code,
    periods: row.periods,
    sections: row.sections,
    subjects: row.subjects,
  }));
}

/** The lesson periods a grid has rows for. Breaks are rendered, not scheduled. */
export type SlotRow = {
  id: string;
  periodNumber: number;
  label: string | null;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
};

export async function listLessonSlots(): Promise<SlotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_slots")
    .select("id, period_number, label, starts_at, ends_at, is_break")
    .eq("kind", "class")
    .order("period_number");

  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    periodNumber: s.period_number,
    label: s.label,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    isBreak: s.is_break,
  }));
}

/** The weekdays this school actually teaches on. A missing row means "open". */
export async function listTeachingWeekdays(): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("weekends").select("weekday, is_teaching");

  const closed = new Set((data ?? []).filter((w) => !w.is_teaching).map((w) => w.weekday));
  return [1, 2, 3, 4, 5, 6, 7].filter((d) => !closed.has(d));
}

/**
 * What this class is allowed to be taught, with its default teacher. The grid's
 * subject dropdown reads this rather than the whole subject list, because the
 * composite foreign key will refuse anything that is not on the curriculum —
 * better to not offer it than to explain the refusal.
 */
export type CurriculumRow = {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  defaultTeacherStaffId: string | null;
};

export async function getCurriculum(sectionId: string): Promise<CurriculumRow[]> {
  const supabase = await createClient();

  // Two queries rather than an embed. `section_subjects` reaches `subjects`
  // through a composite (tenant_id, subject_id) foreign key, and embedding
  // across a composite key is not something this project has been able to
  // verify from its test environment. Two round trips on a list of eight
  // subjects is not worth an unverified assumption.
  const { data: assignments, error } = await supabase
    .from("section_subjects")
    .select("subject_id, teacher_staff_id")
    .eq("section_id", sectionId);

  if (error) throw new Error(error.message);
  if (!assignments?.length) return [];

  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, code")
    .in("id", assignments.map((a) => a.subject_id));

  const byId = new Map((subjects ?? []).map((s) => [s.id, s]));

  return assignments
    .map((row) => {
      const subject = byId.get(row.subject_id);
      return {
        subjectId: row.subject_id,
        subjectName: subject?.name ?? "Unknown subject",
        subjectCode: subject?.code ?? "",
        defaultTeacherStaffId: row.teacher_staff_id,
      };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

export async function listRooms(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("class_rooms")
    .select("id, name, capacity")
    .eq("is_active", true)
    .order("name");

  return (data ?? []).map((r) => ({ id: r.id, label: `${r.name} · ${r.capacity} seats` }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function saveEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = timetableEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timetable_set_entry", {
    p_section_id: parsed.data.sectionId,
    p_weekday: parsed.data.weekday,
    p_time_slot_id: parsed.data.timeSlotId,
    p_subject_id: parsed.data.subjectId,
    p_teacher_staff_id: parsed.data.teacherStaffId || undefined,
    p_class_room_id: parsed.data.classRoomId || undefined,
    p_note: parsed.data.note || undefined,
  });

  if (error) return rpcError(error);
  if (!data) return fail("The period was not saved.");

  revalidatePath("/timetable");
  return { ok: true, data: { id: data.id } };
}

/**
 * A plain delete: the admin policy on `timetable_entries` already scopes it to
 * this tenant, and clearing a cell has none of the cross-row consequences that
 * made saving one worth a function.
 */
export async function clearEntry(entryId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("timetable_entries").delete().eq("id", entryId);
  if (error) return fail(error.message);

  revalidatePath("/timetable");
  return { ok: true, data: undefined };
}

export async function copyDay(
  input: unknown,
): Promise<ActionResult<{ copied: number; skipped: number }>> {
  const parsed = copyDaySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("timetable_copy_day", {
    p_section_id: parsed.data.sectionId,
    p_from_weekday: parsed.data.fromWeekday,
    p_to_weekday: parsed.data.toWeekday,
  });

  if (error) return rpcError(error);

  const result = data?.[0];
  revalidatePath("/timetable");
  return { ok: true, data: { copied: result?.copied ?? 0, skipped: result?.skipped ?? 0 } };
}

/** The signed-in user's own staff record, so "My week" knows whether to offer itself. */
export async function getOwnStaffId(): Promise<string | null> {
  const ctx = await getUserContext();
  return ctx?.staffId ?? null;
}
