"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { promotionFormSchema, toRules } from "@/lib/validations/promotion";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export type SessionOption = { id: string; name: string; isCurrent: boolean; sectionCount: number };

export async function listSessions(): Promise<SessionOption[]> {
  const supabase = await createClient();

  const [sessionsRes, sectionsRes] = await Promise.all([
    supabase.from("academic_sessions").select("id, name, is_current, start_date").order("start_date"),
    supabase.from("sections").select("session_id"),
  ]);

  if (sessionsRes.error) throw new Error(sessionsRes.error.message);

  const counts = new Map<string, number>();
  for (const row of sectionsRes.data ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1);
  }

  return (sessionsRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    isCurrent: s.is_current,
    sectionCount: counts.get(s.id) ?? 0,
  }));
}

export type PreviewRow = {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  rollNumber: string | null;
  fromEnrolmentId: string;
  fromSectionLabel: string;
  fromSequence: number;
  decision: string;
  reason: string;
  toSectionId: string | null;
  toSectionLabel: string | null;
  examResult: string | null;
  subjectsFailed: number | null;
  attendancePercent: number | null;
  outstanding: number;
};

export type PreviewResult = {
  rows: PreviewRow[];
  problems: string[];
};

/**
 * The dry run. Computes without writing anything, so an administrator can try
 * three sets of rules and look at what each does before committing to one —
 * which is the difference between this and a button that moves everybody up.
 */
export async function previewPromotion(input: unknown): Promise<ActionResult<PreviewResult>> {
  const parsed = promotionFormSchema.safeParse(input);
  if (!parsed.success) return fail("Choose both sessions first.");
  if (parsed.data.fromSessionId === parsed.data.toSessionId) {
    return fail("A promotion run moves students between two different sessions.");
  }

  const supabase = await createClient();
  const rules = toRules(parsed.data);

  const [previewRes, problemsRes] = await Promise.all([
    supabase.rpc("promotion_preview", {
      p_from_session_id: parsed.data.fromSessionId,
      p_to_session_id: parsed.data.toSessionId,
      p_rules: rules,
    }),
    // Criticised in Postgres, next to the engine, so the thing that judges the
    // rules and the thing that evaluates them cannot drift apart.
    supabase.rpc("promotion_rule_problems", { p_rules: rules }),
  ]);

  if (previewRes.error) return fail(previewRes.error.message);

  return {
    ok: true,
    data: {
      rows: (previewRes.data ?? []).map(mapPreviewRow),
      problems: (problemsRes.data ?? []).map((p) => p.problem),
    },
  };
}

function mapPreviewRow(row: {
  student_id: string;
  admission_number: string;
  student_name: string;
  roll_number: string | null;
  from_enrolment_id: string;
  from_section_label: string;
  from_sequence: number;
  decision: string;
  reason: string;
  to_section_id: string | null;
  to_section_label: string | null;
  exam_result: string | null;
  subjects_failed: number | null;
  attendance_percent: number | null;
  outstanding: number;
}): PreviewRow {
  return {
    studentId: row.student_id,
    admissionNumber: row.admission_number,
    studentName: row.student_name,
    rollNumber: row.roll_number,
    fromEnrolmentId: row.from_enrolment_id,
    fromSectionLabel: row.from_section_label,
    fromSequence: row.from_sequence,
    decision: row.decision,
    reason: row.reason,
    toSectionId: row.to_section_id,
    toSectionLabel: row.to_section_label,
    examResult: row.exam_result,
    subjectsFailed: row.subjects_failed,
    attendancePercent: row.attendance_percent === null ? null : Number(row.attendance_percent),
    outstanding: Number(row.outstanding),
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunRow = {
  id: string;
  fromSessionName: string;
  toSessionName: string;
  status: string;
  rules: unknown;
  appliedAt: string | null;
  createdAt: string;
  counts: Record<string, number>;
  overrides: number;
  carriedTotal: number;
};

export async function listRuns(): Promise<RunRow[]> {
  const supabase = await createClient();

  const { data: runs, error } = await supabase
    .from("promotion_runs")
    .select("id, from_session_id, to_session_id, status, rules, applied_at, created_at")
    .neq("status", "discarded")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!runs?.length) return [];

  const [sessionsRes, decisionsRes] = await Promise.all([
    supabase.from("academic_sessions").select("id, name"),
    supabase
      .from("promotion_decisions")
      .select("run_id, decision, is_override, carry_forward")
      .in("run_id", runs.map((r) => r.id)),
  ]);

  const sessionName = new Map((sessionsRes.data ?? []).map((s) => [s.id, s.name]));

  return runs.map((run) => {
    const decisions = (decisionsRes.data ?? []).filter((d) => d.run_id === run.id);
    const counts: Record<string, number> = {};
    for (const d of decisions) counts[d.decision] = (counts[d.decision] ?? 0) + 1;

    return {
      id: run.id,
      fromSessionName: sessionName.get(run.from_session_id) ?? "Unknown session",
      toSessionName: sessionName.get(run.to_session_id) ?? "Unknown session",
      status: run.status,
      rules: run.rules,
      appliedAt: run.applied_at,
      createdAt: run.created_at,
      counts,
      overrides: decisions.filter((d) => d.is_override).length,
      carriedTotal: decisions.reduce((sum, d) => sum + Number(d.carry_forward), 0),
    };
  });
}

export type DecisionRow = {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  rollNumber: string | null;
  fromSectionLabel: string;
  decision: string;
  reason: string;
  toSectionId: string | null;
  toSectionLabel: string | null;
  isOverride: boolean;
  carryForward: number;
  hasNextClass: boolean;
};

export async function getRunDecisions(runId: string): Promise<DecisionRow[]> {
  const supabase = await createClient();

  const { data: decisions, error } = await supabase
    .from("promotion_decisions")
    .select(
      "id, student_id, from_enrolment_id, decision, reason, to_section_id, is_override, carry_forward",
    )
    .eq("run_id", runId);

  if (error) throw new Error(error.message);
  if (!decisions?.length) return [];

  // Explicit queries rather than embeds: `promotion_decisions` reaches students
  // and sections through composite (tenant_id, …) keys, and embedding across a
  // composite key is not something this project has been able to verify.
  const [studentsRes, enrolmentsRes, sectionsRes, levelsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", decisions.map((d) => d.student_id)),
    supabase
      .from("enrolments")
      .select("id, roll_number, section_id")
      .in("id", decisions.map((d) => d.from_enrolment_id)),
    supabase.from("sections").select("id, name, class_level_id"),
    supabase.from("class_levels").select("id, name, sequence"),
  ]);

  const levels = new Map((levelsRes.data ?? []).map((l) => [l.id, l]));
  const maxSequence = Math.max(0, ...(levelsRes.data ?? []).map((l) => l.sequence));

  const sectionLabel = new Map(
    (sectionsRes.data ?? []).map((s) => {
      const level = levels.get(s.class_level_id);
      return [s.id, { label: `${level?.name ?? "?"} ${s.name}`, sequence: level?.sequence ?? 0 }];
    }),
  );

  const students = new Map(
    (studentsRes.data ?? []).map((s) => [
      s.id,
      {
        admissionNumber: s.admission_number,
        name: s.people ? `${s.people.first_name} ${s.people.last_name}` : "Unnamed student",
      },
    ]),
  );

  const enrolments = new Map((enrolmentsRes.data ?? []).map((e) => [e.id, e]));

  return decisions
    .map((d) => {
      const student = students.get(d.student_id);
      const enrolment = enrolments.get(d.from_enrolment_id);
      const from = enrolment ? sectionLabel.get(enrolment.section_id) : undefined;

      return {
        id: d.id,
        studentId: d.student_id,
        studentName: student?.name ?? "Unnamed student",
        admissionNumber: student?.admissionNumber ?? "",
        rollNumber: enrolment?.roll_number ?? null,
        fromSectionLabel: from?.label ?? "Unknown class",
        fromSequence: from?.sequence ?? 0,
        decision: d.decision,
        reason: d.reason,
        toSectionId: d.to_section_id,
        toSectionLabel: d.to_section_id ? (sectionLabel.get(d.to_section_id)?.label ?? null) : null,
        isOverride: d.is_override,
        carryForward: Number(d.carry_forward),
        hasNextClass: (from?.sequence ?? 0) < maxSequence,
      };
    })
    .sort(
      (a, b) =>
        a.fromSequence - b.fromSequence ||
        a.fromSectionLabel.localeCompare(b.fromSectionLabel) ||
        a.studentName.localeCompare(b.studentName),
    )
    .map((row) => {
      const { fromSequence, ...rest } = row;
      void fromSequence;
      return rest;
    });
}

/** Sections in the receiving session, for the override picker. */
export async function listTargetSections(
  runId: string,
): Promise<{ id: string; label: string; sequence: number }[]> {
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("promotion_runs")
    .select("to_session_id")
    .eq("id", runId)
    .single();

  if (!run) return [];

  const [sectionsRes, levelsRes] = await Promise.all([
    supabase.from("sections").select("id, name, class_level_id").eq("session_id", run.to_session_id),
    supabase.from("class_levels").select("id, name, sequence"),
  ]);

  const levels = new Map((levelsRes.data ?? []).map((l) => [l.id, l]));

  return (sectionsRes.data ?? [])
    .map((s) => {
      const level = levels.get(s.class_level_id);
      return {
        id: s.id,
        label: `${level?.name ?? "?"} ${s.name}`,
        sequence: level?.sequence ?? 0,
      };
    })
    .sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label));
}

export async function startRun(input: unknown): Promise<ActionResult<{ runId: string }>> {
  const parsed = promotionFormSchema.safeParse(input);
  if (!parsed.success) return fail("Choose both sessions first.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("promotion_start_run", {
    p_from_session_id: parsed.data.fromSessionId,
    p_to_session_id: parsed.data.toSessionId,
    p_rules: toRules(parsed.data),
  });

  if (error) return fail(error.message);

  revalidatePath("/promotion");
  return { ok: true, data: { runId: data! } };
}

/**
 * Changing one row. The whole reason the preview is rows rather than a report:
 * every year there are three or four children the rules get wrong, and the
 * person who knows that is standing at the screen.
 */
export async function overrideDecision(
  decisionId: string,
  decision: string,
  toSectionId: string | null,
  reason: string,
): Promise<ActionResult> {
  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("promotion_decisions")
    .update({
      decision,
      to_section_id: toSectionId,
      reason: reason.trim() || "Changed by an administrator",
      is_override: true,
    })
    .eq("id", decisionId);

  if (error) {
    if (error.code === "23514") {
      return fail(
        "A promotion or a repeat has to land in a class, and a graduate or a hold must not have one.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/promotion");
  return { ok: true, data: undefined };
}

export async function applyRun(
  runId: string,
): Promise<ActionResult<{ promoted: number; repeated: number; graduated: number; held: number; carried: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("promotion_apply", { p_run_id: runId });

  if (error) return fail(error.message);

  const result = data?.[0];
  revalidatePath("/promotion");
  revalidatePath("/students");
  return {
    ok: true,
    data: {
      promoted: result?.promoted ?? 0,
      repeated: result?.repeated ?? 0,
      graduated: result?.graduated ?? 0,
      held: result?.held ?? 0,
      carried: result?.carried ?? 0,
    },
  };
}

export async function discardRun(runId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("promotion_discard_run", { p_run_id: runId });
  if (error) return fail(error.message);

  revalidatePath("/promotion");
  return { ok: true, data: undefined };
}

/**
 * Copy this year's classes into next year's session. Promotion cannot invent
 * them — a section carries a capacity and a class teacher, which are decisions
 * — but making somebody retype twelve of them before they can see a preview is
 * the kind of friction that gets a product abandoned in June.
 */
export async function rollForwardSections(
  fromSessionId: string,
  toSessionId: string,
): Promise<ActionResult<{ created: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academics_roll_forward_sections", {
    p_from_session_id: fromSessionId,
    p_to_session_id: toSessionId,
  });

  if (error) return fail(error.message);

  revalidatePath("/promotion");
  return { ok: true, data: { created: data ?? 0 } };
}
