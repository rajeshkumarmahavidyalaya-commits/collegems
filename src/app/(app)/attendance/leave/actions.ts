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
export async function listStudentsForLeave() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, admission_number, people:person_id ( first_name, last_name )")
    .eq("status", "active")
    .order("admission_number")
    .limit(200);

  return (data ?? []).map((s) => ({
    id: s.id,
    admissionNumber: s.admission_number,
    name: `${s.people?.first_name ?? ""} ${s.people?.last_name ?? ""}`.trim(),
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
