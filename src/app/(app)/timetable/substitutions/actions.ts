"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { arrangeCoverSchema, clearCoverSchema } from "@/lib/validations/substitutions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type GapRow = {
  timetableEntryId: string;
  timeSlotId: string;
  periodNumber: number | null;
  startsAt: string | null;
  sectionLabel: string;
  subjectName: string;
  absentStaffId: string;
  absentTeacher: string;
  substituteStaffId: string | null;
  substituteTeacher: string | null;
  note: string | null;
  arranged: boolean;
  /** `away` — cover it today. `unassigned` — the timetable needs a teacher. */
  reason: string;
};

export type CandidateRow = {
  staffId: string;
  staffName: string;
  designation: string | null;
  teachesSubject: boolean;
  coversToday: number;
  periodsToday: number;
};

export type ProblemRow = {
  timetableEntryId: string | null;
  severity: string;
  message: string;
};

export type MyCoverRow = {
  periodNumber: number | null;
  startsAt: string | null;
  endsAt: string | null;
  sectionLabel: string;
  subjectName: string;
  room: string | null;
  coveringFor: string;
  note: string | null;
};

/**
 * The office's list. Empty for a teacher — not because of a check here, but
 * because `substitution_gaps` is built on `staff_is_away`, which reads a table
 * whose RLS is row-ownership. See migration 0158: the page asks for this only
 * when the caller may manage cover, because "no cover needed today" is a quiet
 * wrong answer and a permission error is a loud one.
 */
export async function listGaps(onDate?: string): Promise<GapRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("substitution_gaps", { p_date: onDate ?? undefined });

  return (data ?? []).map((g) => ({
    timetableEntryId: g.timetable_entry_id,
    timeSlotId: g.time_slot_id,
    periodNumber: g.period_number,
    startsAt: g.starts_at,
    sectionLabel: g.section_label ?? "",
    subjectName: g.subject_name ?? "",
    absentStaffId: g.absent_staff_id,
    absentTeacher: g.absent_teacher ?? "",
    substituteStaffId: g.substitute_staff_id,
    substituteTeacher: g.substitute_teacher,
    note: g.note,
    arranged: Boolean(g.arranged),
    reason: g.reason ?? "away",
  }));
}

export async function listCandidates(
  timetableEntryId: string,
  onDate?: string,
): Promise<CandidateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("substitution_candidates", {
    p_timetable_entry_id: timetableEntryId,
    p_date: onDate ?? undefined,
  });

  return (data ?? []).map((c) => ({
    staffId: c.staff_id,
    staffName: c.staff_name ?? "",
    designation: c.designation,
    teachesSubject: Boolean(c.teaches_subject),
    coversToday: Number(c.covers_today ?? 0),
    periodsToday: Number(c.periods_today ?? 0),
  }));
}

export async function listProblems(onDate?: string): Promise<ProblemRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("substitution_problems", { p_date: onDate ?? undefined });

  return (data ?? []).map((p) => ({
    timetableEntryId: p.timetable_entry_id,
    severity: p.severity ?? "info",
    message: p.message ?? "",
  }));
}

/** What the signed-in member of staff is covering. Every role may ask. */
export async function listMyCovers(onDate?: string): Promise<MyCoverRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("substitution_my_covers", { p_date: onDate ?? undefined });

  return (data ?? []).map((c) => ({
    periodNumber: c.period_number,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    sectionLabel: c.section_label ?? "",
    subjectName: c.subject_name ?? "",
    room: c.room,
    coveringFor: c.covering_for ?? "",
    note: c.note,
  }));
}

export async function arrangeCover(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = arrangeCoverSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("substitution_arrange", {
    p_timetable_entry_id: parsed.data.timetableEntryId,
    p_date: parsed.data.onDate,
    p_substitute_staff_id: parsed.data.substituteStaffId ?? undefined,
    p_note: parsed.data.note ?? undefined,
  });

  // Every refusal from that function is already a sentence naming a person and
  // a date — the double-booking index, the wrong weekday, the teacher who is
  // not marked away. Passing the message straight through is the point of
  // having written them there.
  if (error) return { ok: false, error: error.message };

  const row = data as unknown as { id: string } | null;
  if (!row) return { ok: false, error: "Nothing was arranged." };

  revalidatePath("/timetable/substitutions");
  return { ok: true, data: { id: row.id } };
}

export async function clearCover(input: unknown): Promise<ActionResult<void>> {
  const parsed = clearCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("substitution_clear", {
    p_timetable_entry_id: parsed.data.timetableEntryId,
    p_date: parsed.data.onDate,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/timetable/substitutions");
  return { ok: true, data: undefined };
}
