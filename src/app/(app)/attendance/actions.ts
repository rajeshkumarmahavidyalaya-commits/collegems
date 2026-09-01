"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { markAttendanceSchema } from "@/lib/validations/attendance";
import type { ActionResult } from "../library/actions";

export type SectionOption = {
  id: string;
  label: string;
  sequence: number;
};

export type RegisterStudent = {
  enrolmentId: string;
  studentId: string;
  admissionNumber: string;
  rollNumber: string | null;
  fullName: string;
  /** null = not yet marked for this date and period. */
  status: string | null;
  note: string | null;
};

export type Register = {
  sectionId: string;
  date: string;
  period: number;
  students: RegisterStudent[];
  /** When the register was last written, for the "saved at" indicator. */
  lastMarkedAt: string | null;
};

type SectionRow = {
  id: string;
  name: string;
  class_levels: { name: string; sequence: number } | null;
};

function sortSections(rows: SectionRow[]): SectionOption[] {
  return rows
    .map((s) => ({
      id: s.id,
      label: s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
      sequence: s.class_levels?.sequence ?? 0,
    }))
    .sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label));
}

/**
 * The classes this user may actually mark.
 *
 * RLS lets every tenant member *see* the section list, but only a section's
 * class teacher may write its attendance. Offering a teacher a class whose
 * save would be rejected is a worse experience than not offering it, so the
 * picker is narrowed here. This is convenience, not security -- the policy
 * still decides, and a teacher who forges a section id gets zero rows written.
 */
export async function listMarkableSections(): Promise<SectionOption[]> {
  const ctx = await getUserContext();
  if (!ctx) return [];

  const supabase = await createClient();
  let query = supabase.from("sections").select("id, name, class_levels ( name, sequence )");

  if (ctx.roleCode === "teacher") {
    if (!ctx.staffId) return [];
    query = query.eq("class_teacher_staff_id", ctx.staffId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return sortSections(data ?? []);
}

/** Every section in the tenant, for read-only views (reports, a parent's child). */
export async function listAllSections(): Promise<SectionOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sections")
    .select("id, name, class_levels ( name, sequence )");
  if (error) throw new Error(error.message);
  return sortSections(data ?? []);
}

/**
 * Roll numbers are text ("7", "07", "7A"), so compare numerically when both
 * sides look numeric and lexically otherwise -- otherwise "10" sorts before
 * "2" and the on-screen register stops matching the paper one.
 */
function compareRoll(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * The roster for one class on one date, with whatever has already been marked
 * folded in. Two queries rather than one join: the roster is the source of
 * truth for *who should be there*, and attendance is an overlay on it, so an
 * unmarked student has to appear with `status: null` rather than not appear.
 */
export async function getRegister(
  sectionId: string,
  date: string,
  period = 0,
): Promise<Register> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  let enrolmentQuery = supabase
    .from("enrolments")
    .select(
      `id, roll_number,
       students ( id, admission_number, people:person_id ( first_name, last_name ) )`,
    )
    .eq("section_id", sectionId)
    .eq("status", "active");

  // A section belongs to exactly one session, so this filter is redundant
  // today -- but rule 2 says every transactional query names the session, and
  // the day sections outlive a year is the day the redundancy stops being one.
  if (ctx?.currentSessionId) {
    enrolmentQuery = enrolmentQuery.eq("session_id", ctx.currentSessionId);
  }

  const { data: enrolments, error: enrolmentError } = await enrolmentQuery;

  if (enrolmentError) throw new Error(enrolmentError.message);

  const enrolmentIds = (enrolments ?? []).map((e) => e.id);

  let marks: { enrolment_id: string; status: string; note: string | null; updated_at: string }[] = [];
  if (enrolmentIds.length > 0) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("enrolment_id, status, note, updated_at")
      .eq("attendance_date", date)
      .eq("period", period)
      .in("enrolment_id", enrolmentIds);

    if (error) throw new Error(error.message);
    marks = data ?? [];
  }

  const byEnrolment = new Map(marks.map((m) => [m.enrolment_id, m]));

  const students: RegisterStudent[] = (enrolments ?? [])
    .map((e) => {
      const student = e.students;
      const person = student?.people;
      const mark = byEnrolment.get(e.id);
      return {
        enrolmentId: e.id,
        studentId: student?.id ?? "",
        admissionNumber: student?.admission_number ?? "",
        rollNumber: e.roll_number,
        fullName: person ? `${person.first_name} ${person.last_name}` : "Unknown",
        status: mark?.status ?? null,
        note: mark?.note ?? null,
      };
    })
    .sort((a, b) => compareRoll(a.rollNumber, b.rollNumber) || a.fullName.localeCompare(b.fullName));

  const lastMarkedAt = marks.reduce<string | null>(
    (latest, m) => (latest === null || m.updated_at > latest ? m.updated_at : latest),
    null,
  );

  return { sectionId, date, period, students, lastMarkedAt };
}

/**
 * Save a whole register in one atomic, idempotent write.
 *
 * The RPC upserts on (tenant, enrolment, date, period), so a phone that
 * replayed a queued save converges on the same rows instead of double-marking.
 * It also re-derives the session and filters the payload to enrolments really
 * in this section, so nothing here has to be trusted from the client.
 */
export async function saveAttendance(input: unknown): Promise<ActionResult<{ written: number }>> {
  const parsed = markAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { sectionId, date, period, entries } = parsed.data;

  // A future date is rejected in Postgres too -- this check only produces a
  // better message than the raised exception would.
  const today = new Date().toISOString().slice(0, 10);
  if (date > today) {
    return {
      ok: false,
      error: "You cannot mark attendance for a date that has not happened yet.",
      fieldErrors: { date: ["Pick today or an earlier date"] },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_attendance", {
    p_section_id: sectionId,
    p_date: date,
    p_period: period,
    p_entries: entries.map((e) => ({
      enrolment_id: e.enrolmentId,
      status: e.status,
      note: e.note ?? "",
    })),
  });

  if (error) return { ok: false, error: error.message };

  const written = typeof data === "number" ? data : 0;
  if (written === 0) {
    return {
      ok: false,
      error:
        "Nothing was saved. You may not have permission to mark this class, or those students are no longer enrolled in it.",
    };
  }

  revalidatePath("/attendance");
  return { ok: true, data: { written } };
}

export type AttendanceSummaryRow = {
  studentId: string;
  enrolmentId: string;
  admissionNumber: string;
  rollNumber: string | null;
  fullName: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  marked: number;
  /** Present + late, over days marked. Null when nothing is marked yet. */
  percentage: number | null;
};

/**
 * Per-student totals for a class over a date range.
 *
 * Aggregated in the request rather than in SQL because the numbers are per
 * class per term -- a few thousand rows at most. When this needs to span a
 * whole school for a year it belongs in a read model built by a job, not in a
 * bigger query here.
 */
export async function getAttendanceSummary(params: {
  sectionId: string;
  from: string;
  to: string;
}): Promise<AttendanceSummaryRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const { sectionId, from, to } = params;

  let enrolmentQuery = supabase
    .from("enrolments")
    .select(
      `id, roll_number,
       students ( id, admission_number, people:person_id ( first_name, last_name ) )`,
    )
    .eq("section_id", sectionId)
    .eq("status", "active");

  if (ctx?.currentSessionId) {
    enrolmentQuery = enrolmentQuery.eq("session_id", ctx.currentSessionId);
  }

  const { data: enrolments, error: enrolmentError } = await enrolmentQuery;

  if (enrolmentError) throw new Error(enrolmentError.message);

  const enrolmentIds = (enrolments ?? []).map((e) => e.id);
  if (enrolmentIds.length === 0) return [];

  const { data: marks, error } = await supabase
    .from("attendance_records")
    .select("enrolment_id, status")
    .gte("attendance_date", from)
    .lte("attendance_date", to)
    .in("enrolment_id", enrolmentIds);

  if (error) throw new Error(error.message);

  const tally = new Map<string, { present: number; absent: number; late: number; excused: number }>();
  for (const id of enrolmentIds) {
    tally.set(id, { present: 0, absent: 0, late: 0, excused: 0 });
  }
  for (const m of marks ?? []) {
    const row = tally.get(m.enrolment_id);
    if (!row) continue;
    if (m.status === "present") row.present += 1;
    else if (m.status === "absent") row.absent += 1;
    else if (m.status === "late") row.late += 1;
    else if (m.status === "excused") row.excused += 1;
  }

  return (enrolments ?? [])
    .map((e) => {
      const student = e.students;
      const person = student?.people;
      const t = tally.get(e.id) ?? { present: 0, absent: 0, late: 0, excused: 0 };
      const marked = t.present + t.absent + t.late + t.excused;
      // Late still counts as attended; excused days leave the denominator
      // rather than counting against the student.
      const denominator = t.present + t.absent + t.late;
      return {
        studentId: student?.id ?? "",
        enrolmentId: e.id,
        admissionNumber: student?.admission_number ?? "",
        rollNumber: e.roll_number,
        fullName: person ? `${person.first_name} ${person.last_name}` : "Unknown",
        ...t,
        marked,
        percentage:
          denominator === 0 ? null : Math.round(((t.present + t.late) / denominator) * 1000) / 10,
      };
    })
    .sort((a, b) => compareRoll(a.rollNumber, b.rollNumber) || a.fullName.localeCompare(b.fullName));
}

/**
 * The dates in a range on which this class has any marks, so the report can
 * say "18 days marked" instead of implying the register is complete when half
 * of it was never taken.
 */
export async function getMarkedDates(params: {
  sectionId: string;
  from: string;
  to: string;
}): Promise<string[]> {
  const supabase = await createClient();

  const { data: enrolments } = await supabase
    .from("enrolments")
    .select("id")
    .eq("section_id", params.sectionId)
    .eq("status", "active");

  const ids = (enrolments ?? []).map((e) => e.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("attendance_records")
    .select("attendance_date")
    .gte("attendance_date", params.from)
    .lte("attendance_date", params.to)
    .in("enrolment_id", ids);

  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.attendance_date))].sort();
}
