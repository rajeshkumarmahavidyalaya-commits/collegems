"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { applyLeaveSchema, decideLeaveSchema } from "@/lib/validations/student-leave";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type LeaveRow = {
  id: string;
  studentId: string;
  student: string;
  admissionNumber: string;
  startsOn: string;
  endsOn: string;
  kind: string;
  reason: string;
  status: string;
  decisionNote: string | null;
  decidedAt: string | null;
};

/**
 * What this returns is decided entirely by RLS: an administrator sees the
 * school, a class teacher sees their own section, a guardian sees their own
 * children. There is no role branch here, and adding one would be a second
 * answer to a question Postgres already answers.
 */
export async function listLeave(status?: string): Promise<LeaveRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  let query = supabase
    .from("student_leave_requests")
    .select(
      "id, student_id, starts_on, ends_on, kind, reason, status, decision_note, decided_at, students ( admission_number, people:person_id ( first_name, last_name ) )",
    )
    .order("status")
    .order("starts_on", { ascending: false })
    .limit(200);

  // The year, which RLS does not supply — and with a cap of 200 rows, last
  // year's decided requests would crowd out the ones still waiting.
  if (ctx?.currentSessionId) query = query.eq("session_id", ctx.currentSessionId);

  if (status) query = query.eq("status", status);

  const { data } = await query;

  return (data ?? []).map((l) => {
    const person = l.students?.people;
    return {
      id: l.id,
      studentId: l.student_id,
      student: person ? `${person.first_name} ${person.last_name}` : "Unknown",
      admissionNumber: l.students?.admission_number ?? "",
      startsOn: l.starts_on,
      endsOn: l.ends_on,
      kind: l.kind,
      reason: l.reason,
      status: l.status,
      decisionNote: l.decision_note,
      decidedAt: l.decided_at,
    };
  });
}

/** Students the caller may apply for. RLS decides the list. */
/**
 * The children leave may be applied for, for the picker.
 *
 * This used to be `listStudentsForLeave()` — the active roll, `.limit(200)`,
 * loaded on every view and rendered into a flat `<Select>`. On this college
 * that is **200 of 302**, so **102 children could not have leave applied for
 * them from this screen at all**, and the list also supplied the dialog's
 * default (`students[0]`), which is the `/timetable` defect: a picker's default
 * is decided by what the picker was given.
 *
 * > **The bound was invisible from the seat the screen was built for.** RLS
 * > scopes this read, so a guardian sees their own one or two children and a
 * > dropdown of two looks perfect. The truncation only exists for the office,
 * > and the 102 it drops look exactly like children who are not enrolled.
 *
 * The cost of the fix is named rather than hidden: a family with one child now
 * types two characters where they used to open a list of one. Giving them their
 * own short list back is `family_my_students()` (rule 14's relationship, not a
 * role branch) and is deliberately not built here — one screen, one mechanism,
 * and the thing being removed is a correctness defect rather than a keystroke.
 */
export async function searchStudentsForLeave(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", {
    p_query: needle,
    p_limit: 20,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    admissionNumber: s.admission_number,
    name: s.full_name,
    status: s.status,
  }));
}

export async function applyForLeave(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = applyLeaveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_leave_apply", {
    p_student_id: parsed.data.studentId,
    p_starts_on: parsed.data.startsOn,
    p_ends_on: parsed.data.endsOn,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
  });

  // The overlap refusal is already a sentence naming the dates — the function
  // translates `23P01` rather than letting "conflicting key value violates
  // exclusion constraint" reach a parent.
  if (error) return { ok: false, error: error.message };

  const row = data as unknown as { id: string } | null;
  if (!row) return { ok: false, error: "The request was not created." };

  revalidatePath("/attendance/leave");
  return { ok: true, data: { id: row.id } };
}

export async function decideLeave(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = decideLeaveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_leave_decide", {
    p_leave_id: parsed.data.leaveId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note ?? undefined,
  });

  if (error) return { ok: false, error: error.message };

  const row = data as unknown as { id: string } | null;
  if (!row) return { ok: false, error: "Nothing was decided." };

  revalidatePath("/attendance/leave");
  revalidatePath("/attendance");
  return { ok: true, data: { id: row.id } };
}

export async function cancelLeave(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("student_leave_cancel", { p_leave_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance/leave");
  return { ok: true, data: { id } };
}
