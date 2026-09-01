"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  classRoomSchema,
  holidaySchema,
  sectionSubjectSchema,
  subjectSchema,
  timeSlotSchema,
} from "@/lib/validations/academics";
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
 * A unique violation here is always a human naming collision — a duplicate
 * subject code, a room name reused, two periods numbered the same — so it maps
 * onto the field rather than surfacing Postgres' wording.
 */
function duplicate(field: string, message: string): ActionResult<never> {
  return { ok: false, error: message, fieldErrors: { [field]: ["Already in use"] } };
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export type SubjectRow = {
  id: string;
  name: string;
  code: string;
  kind: string;
  isActive: boolean;
  /** How many class-section slots reference it, so deletion can be honest. */
  assignmentCount: number;
};

export async function listSubjects(): Promise<SubjectRow[]> {
  const supabase = await createClient();

  const [subjectsRes, assignmentsRes] = await Promise.all([
    supabase.from("subjects").select("id, name, code, kind, is_active").order("name"),
    supabase.from("section_subjects").select("subject_id"),
  ]);

  if (subjectsRes.error) throw new Error(subjectsRes.error.message);

  const counts = new Map<string, number>();
  for (const row of assignmentsRes.data ?? []) {
    counts.set(row.subject_id, (counts.get(row.subject_id) ?? 0) + 1);
  }

  return (subjectsRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    code: s.code,
    kind: s.kind,
    isActive: s.is_active,
    assignmentCount: counts.get(s.id) ?? 0,
  }));
}

export async function saveSubject(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    name: parsed.data.name,
    code: parsed.data.code.toUpperCase(),
    kind: parsed.data.kind,
    is_active: parsed.data.isActive,
  };

  const { data, error } = id
    ? await supabase.from("subjects").update(payload).eq("id", id).select("id").single()
    : await supabase.from("subjects").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") return duplicate("code", "Another subject already uses that code.");
    return fail(error.message);
  }

  revalidatePath("/academics");
  return { ok: true, data: { id: data.id } };
}

/**
 * Subjects are deactivated rather than deleted once they are on a timetable:
 * the `on delete restrict` from `section_subjects` would refuse anyway, and a
 * subject that ever had marks against it must stay resolvable.
 */
export async function deleteSubject(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("subjects").delete().eq("id", id);

  if (error) {
    if (error.code === "23503") {
      return fail(
        "This subject is assigned to at least one class, so it cannot be deleted. Mark it inactive instead — it will stop appearing on new assignments while its history stays intact.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/academics");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type ClassRoomRow = {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
};

export async function listClassRooms(): Promise<ClassRoomRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_rooms")
    .select("id, name, capacity, is_active")
    .order("name");
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    isActive: r.is_active,
  }));
}

export async function saveClassRoom(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = classRoomSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    name: parsed.data.name,
    capacity: parsed.data.capacity,
    is_active: parsed.data.isActive,
  };

  const { data, error } = id
    ? await supabase.from("class_rooms").update(payload).eq("id", id).select("id").single()
    : await supabase.from("class_rooms").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") return duplicate("name", "Another room already has that name.");
    return fail(error.message);
  }

  revalidatePath("/academics");
  return { ok: true, data: { id: data.id } };
}

export async function deleteClassRoom(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("class_rooms").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/academics");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type TimeSlotRow = {
  id: string;
  kind: string;
  periodNumber: number;
  label: string | null;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
};

export async function listTimeSlots(): Promise<TimeSlotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_slots")
    .select("id, kind, period_number, label, starts_at, ends_at, is_break")
    .order("kind")
    .order("period_number");
  if (error) throw new Error(error.message);

  return (data ?? []).map((t) => ({
    id: t.id,
    kind: t.kind,
    periodNumber: t.period_number,
    label: t.label,
    startsAt: t.starts_at,
    endsAt: t.ends_at,
    isBreak: t.is_break,
  }));
}

export async function saveTimeSlot(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = timeSlotSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    kind: parsed.data.kind,
    period_number: parsed.data.periodNumber,
    label: parsed.data.label?.trim() || null,
    starts_at: parsed.data.startsAt,
    ends_at: parsed.data.endsAt,
    is_break: parsed.data.isBreak,
  };

  const { data, error } = id
    ? await supabase.from("time_slots").update(payload).eq("id", id).select("id").single()
    : await supabase.from("time_slots").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") {
      return duplicate("periodNumber", "That period number is already used in this schedule.");
    }
    return fail(error.message);
  }

  revalidatePath("/academics");
  return { ok: true, data: { id: data.id } };
}

export async function deleteTimeSlot(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("time_slots").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/academics");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// The week, and the closures in it
// ---------------------------------------------------------------------------

export async function listWeekdays(): Promise<{ weekday: number; isTeaching: boolean }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekends")
    .select("weekday, is_teaching")
    .order("weekday");
  if (error) throw new Error(error.message);

  return (data ?? []).map((w) => ({ weekday: w.weekday, isTeaching: w.is_teaching }));
}

export async function setTeachingDay(weekday: number, isTeaching: boolean): Promise<ActionResult> {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return fail("That is not a weekday.");
  }

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("weekends")
    .upsert(
      { tenant_id: ctx.tenantId, weekday, is_teaching: isTeaching },
      { onConflict: "tenant_id,weekday" },
    );

  if (error) return fail(error.message);

  revalidatePath("/academics");
  return { ok: true, data: undefined };
}

export type HolidayRow = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  note: string | null;
  days: number;
};

export async function listHolidays(): Promise<HolidayRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  let query = supabase
    .from("holidays")
    .select("id, name, starts_on, ends_on, note")
    .order("starts_on");

  if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    startsOn: h.starts_on,
    endsOn: h.ends_on,
    note: h.note,
    // Inclusive of both ends: a one-day holiday is one day, not zero.
    days: Math.round((Date.parse(h.ends_on) - Date.parse(h.starts_on)) / 86_400_000) + 1,
  }));
}

export async function saveHoliday(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = holidaySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no active academic session.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    name: parsed.data.name,
    starts_on: parsed.data.startsOn,
    ends_on: parsed.data.endsOn,
    note: parsed.data.note?.trim() || null,
  };

  const { data, error } = id
    ? await supabase.from("holidays").update(payload).eq("id", id).select("id").single()
    : await supabase.from("holidays").insert(payload).select("id").single();

  if (error) return fail(error.message);

  revalidatePath("/academics");
  revalidatePath("/attendance");
  return { ok: true, data: { id: data.id } };
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/academics");
  revalidatePath("/attendance");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Who teaches what
// ---------------------------------------------------------------------------

export type AssignmentRow = {
  id: string;
  sectionId: string;
  sectionLabel: string;
  sequence: number;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  subjectKind: string;
  teacherStaffId: string | null;
  teacherName: string | null;
};

/**
 * A section's subject list is what marks entry, homework and the routine grid
 * all read, so this is the join those modules will build on.
 */
export async function listAssignments(sectionId?: string): Promise<AssignmentRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  let query = supabase
    .from("section_subjects")
    .select(
      `id, section_id, subject_id, teacher_staff_id,
       sections ( name, class_levels ( name, sequence ) ),
       subjects ( name, code, kind ),
       staff ( people:person_id ( first_name, last_name ) )`,
    );

  if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);
  if (sectionId) query = query.eq("section_id", sectionId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((r) => {
      const level = r.sections?.class_levels;
      const teacherPerson = r.staff?.people;
      return {
        id: r.id,
        sectionId: r.section_id,
        sectionLabel:
          level && r.sections ? `${level.name} · ${r.sections.name}` : (r.sections?.name ?? "—"),
        sequence: level?.sequence ?? 0,
        subjectId: r.subject_id,
        subjectName: r.subjects?.name ?? "—",
        subjectCode: r.subjects?.code ?? "",
        subjectKind: r.subjects?.kind ?? "theory",
        teacherStaffId: r.teacher_staff_id,
        teacherName: teacherPerson
          ? `${teacherPerson.first_name} ${teacherPerson.last_name}`
          : null,
      };
    })
    .sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.sectionLabel.localeCompare(b.sectionLabel) ||
        a.subjectName.localeCompare(b.subjectName),
    );
}

export async function saveAssignment(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = sectionSubjectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no active academic session.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    section_id: parsed.data.sectionId,
    subject_id: parsed.data.subjectId,
    teacher_staff_id: parsed.data.teacherStaffId || null,
  };

  const { data, error } = id
    ? await supabase.from("section_subjects").update(payload).eq("id", id).select("id").single()
    : await supabase
        .from("section_subjects")
        // Assigning a subject a class already has is an edit of who teaches it,
        // not a duplicate row.
        .upsert(payload, { onConflict: "tenant_id,session_id,section_id,subject_id" })
        .select("id")
        .single();

  if (error) return fail(error.message);

  revalidatePath("/academics");
  return { ok: true, data: { id: data.id } };
}

export async function deleteAssignment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("section_subjects").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/academics");
  return { ok: true, data: undefined };
}

export async function listTeachers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, employee_code, designation, people:person_id ( first_name, last_name )")
    .eq("status", "active")
    .order("employee_code");

  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    label: s.people
      ? `${s.people.first_name} ${s.people.last_name} · ${s.employee_code}`
      : s.employee_code,
  }));
}
