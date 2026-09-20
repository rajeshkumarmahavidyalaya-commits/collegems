"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/**
 * The seating module's server boundary.
 *
 * Every write here is a thin call to a Postgres function, because every one of
 * them is a multi-step act that must be atomic — generating a plan inserts a
 * parent and three hundred children, and a swap is two UPDATEs that have to
 * happen together. supabase-js cannot open a transaction, so a sequence of
 * client calls can interleave.
 *
 * All of them are `SECURITY INVOKER`, so the policies decide, and the sentences
 * they raise are written to be shown to a person. That is why the catch blocks
 * below pass `error.message` through rather than replacing it: the database is
 * where the refusal is decided and it already knows how to say why.
 */

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type SittingRow = {
  sitsOn: string;
  papers: number;
  sections: number;
  candidates: number;
  optionalPapers: number;
  planId: string | null;
  planStatus: string | null;
  seats: number;
};

/**
 * The sittings of one exam: one row per date a paper is written on.
 *
 * Deliberately built from `exam_subjects` rather than from `exam_seat_plans`,
 * because the list has to show the dates that have **no** plan — those are the
 * rows the office is here to act on, and a list driven off the plans would show
 * an empty screen on the day the work starts.
 *
 * The candidate count is the expensive half, and it is bounded by the size of
 * the college: one row per candidate per paper across at most a fortnight of
 * dates. Rule 7's test is boundedness, not category.
 */
export async function listSittings(examId: string): Promise<SittingRow[]> {
  const supabase = await createClient();

  const { data: papers, error } = await supabase
    .from("exam_subjects")
    .select("id, exam_date, section_id, is_optional")
    .eq("exam_id", examId)
    .not("exam_date", "is", null)
    .order("exam_date");
  if (error) throw new Error(error.message);

  const sections = [...new Set((papers ?? []).map((p) => p.section_id))];
  const { data: enrolments } = await supabase
    .from("enrolments")
    .select("section_id")
    .in("section_id", sections.length ? sections : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "active");

  const roll = new Map<string, number>();
  for (const e of enrolments ?? []) roll.set(e.section_id, (roll.get(e.section_id) ?? 0) + 1);

  const { data: plans } = await supabase
    .from("exam_seat_plans")
    .select("id, sits_on, status")
    .eq("exam_id", examId)
    .neq("status", "discarded");

  const { data: seatCounts } = await supabase
    .from("exam_seat_allocations")
    .select("plan_id")
    .in("plan_id", (plans ?? []).map((p) => p.id).length
      ? (plans ?? []).map((p) => p.id)
      : ["00000000-0000-0000-0000-000000000000"]);

  const seatsByPlan = new Map<string, number>();
  for (const s of seatCounts ?? []) seatsByPlan.set(s.plan_id, (seatsByPlan.get(s.plan_id) ?? 0) + 1);

  const byDate = new Map<string, SittingRow>();
  for (const p of papers ?? []) {
    const date = p.exam_date as string;
    const row = byDate.get(date) ?? {
      sitsOn: date,
      papers: 0,
      sections: 0,
      candidates: 0,
      optionalPapers: 0,
      planId: null,
      planStatus: null,
      seats: 0,
    };
    row.papers += 1;
    row.sections += 1;
    row.candidates += roll.get(p.section_id) ?? 0;
    if (p.is_optional) row.optionalPapers += 1;
    byDate.set(date, row);
  }

  for (const plan of plans ?? []) {
    const row = byDate.get(plan.sits_on);
    if (!row) continue;
    row.planId = plan.id;
    row.planStatus = plan.status;
    row.seats = seatsByPlan.get(plan.id) ?? 0;
  }

  return [...byDate.values()].sort((a, b) => a.sitsOn.localeCompare(b.sitsOn));
}

export type SeatPlanRow = {
  id: string;
  examId: string;
  examName: string;
  sitsOn: string;
  status: string;
  publishedAt: string | null;
  rules: Record<string, unknown>;
};

export async function getSeatPlan(planId: string): Promise<SeatPlanRow | null> {
  const supabase = await createClient();
  // A lookup by primary key, so it is deliberately not session-scoped: the id
  // names the row and RLS decides whether the caller may have it.
  const { data } = await supabase
    .from("exam_seat_plans")
    .select("id, exam_id, sits_on, status, published_at, rules, exams(name)")
    .eq("id", planId)
    .maybeSingle();
  if (!data) return null;

  return {
    id: data.id,
    examId: data.exam_id,
    examName: (data.exams as { name: string } | null)?.name ?? "",
    sitsOn: data.sits_on,
    status: data.status,
    publishedAt: data.published_at,
    rules: (data.rules ?? {}) as Record<string, unknown>,
  };
}

export type SeatRow = {
  allocationId: string;
  roomId: string;
  roomName: string;
  plannedCapacity: number;
  seatNo: number;
  studentId: string;
  studentName: string;
  rollNumber: string | null;
  admissionNumber: string;
  paper: string;
  sectionLabel: string;
  isOverride: boolean;
  note: string | null;
};

/**
 * The chart, in room and seat order.
 *
 * `exam_seat_chart` does not return its own primary key — it is written for the
 * invigilator's sheet, where a uuid is noise — so the allocation ids are read
 * alongside and joined here. The alternative was widening the published read
 * model to carry a column only this screen wants.
 */
export async function getSeatChart(planId: string): Promise<SeatRow[]> {
  const supabase = await createClient();

  const [{ data: chart, error }, { data: ids }] = await Promise.all([
    supabase.rpc("exam_seat_chart", { p_plan_id: planId }),
    supabase
      .from("exam_seat_allocations")
      .select("id, room_id, seat_no")
      .eq("plan_id", planId),
  ]);
  if (error) throw new Error(error.message);

  const idBySeat = new Map<string, string>();
  for (const a of ids ?? []) idBySeat.set(`${a.room_id}:${a.seat_no}`, a.id);

  return (chart ?? []).map((r) => ({
    allocationId: idBySeat.get(`${r.room_id}:${r.seat_no}`) ?? "",
    roomId: r.room_id,
    roomName: r.room_name,
    plannedCapacity: r.planned_capacity,
    seatNo: r.seat_no,
    studentId: r.student_id,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    admissionNumber: r.admission_number,
    paper: r.paper,
    sectionLabel: r.section_label,
    isOverride: r.is_override,
    note: r.note,
  }));
}

export type SeatingProblem = { severity: string; message: string };

/**
 * The critic, which **refuses** a caller without `exams.manage` rather than
 * answering nothing. So this returns null for "you may not ask" and an array
 * for "here is the answer, which may be empty" — two different screens, and
 * only the server knows which applies.
 */
export async function listSeatingProblems(planId: string): Promise<SeatingProblem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_seating_problems", { p_plan_id: planId });
  if (error) return null;
  return (data ?? []).map((r) => ({ severity: r.severity, message: r.message }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function generateSeatPlan(
  examId: string,
  sitsOn: string,
  roomIds?: string[],
): Promise<ActionResult<{ planId: string; seated: number; rooms: number }>> {
  const ctx = await getUserContext();
  if (!ctx) return fail("Sign in again.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_seat_plan_generate", {
    p_exam_id: examId,
    p_sits_on: sitsOn,
    // The period is not offered by this screen: no paper at this college
    // carries one. The parameter exists so a college that examines twice a day
    // is representable rather than refused, and the day a screen needs to ask,
    // the function is already able to answer.
    p_time_slot_id: undefined,
    p_room_ids: roomIds && roomIds.length ? roomIds : undefined,
  });
  if (error) return fail(error.message);

  const doc = data as { plan_id: string; seated: number; rooms_used: number };
  revalidatePath(`/exams/${examId}/seating`);
  return { ok: true, data: { planId: doc.plan_id, seated: doc.seated, rooms: doc.rooms_used } };
}

export async function publishSeatPlan(planId: string): Promise<ActionResult<{ published: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_seat_plan_publish", { p_plan_id: planId });
  if (error) return fail(error.message);
  revalidatePath(`/exams`);
  return { ok: true, data: { published: (data as { published: number }).published } };
}

export async function reopenSeatPlan(planId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("exam_seat_plan_unpublish", { p_plan_id: planId });
  if (error) return fail(error.message);
  revalidatePath(`/exams`);
  return { ok: true, data: undefined };
}

export async function discardSeatPlan(planId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("exam_seat_plan_discard", { p_plan_id: planId });
  if (error) return fail(error.message);
  revalidatePath(`/exams`);
  return { ok: true, data: undefined };
}

export async function moveSeat(
  allocationId: string,
  roomId: string,
  seatNo: number,
  note: string,
): Promise<ActionResult<{ swapped: boolean }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_seat_move", {
    p_allocation_id: allocationId,
    p_room_id: roomId,
    p_seat_no: seatNo,
    p_note: note,
  });
  if (error) return fail(error.message);
  revalidatePath(`/exams`);
  return { ok: true, data: { swapped: Boolean((data as { swapped: boolean }).swapped) } };
}
