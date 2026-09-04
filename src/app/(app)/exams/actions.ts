"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  examComponentSetSchema,
  examPaperSchema,
  examSchema,
  gradingSchemeSchema,
  markSheetSchema,
  parseRules,
} from "@/lib/validations/exams";
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

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

export type ExamRow = {
  id: string;
  name: string;
  kind: string;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
  publishedAt: string | null;
  gradingSchemeId: string | null;
  gradingSchemeName: string | null;
  paperCount: number;
};

export async function listExams(): Promise<ExamRow[]> {
  const supabase = await createClient();

  // Three explicit queries rather than embeds: `exam_subjects` reaches `exams`
  // through a composite (tenant_id, exam_id) key, and embedding across a
  // composite key is not something this project has been able to verify.
  const [examsRes, schemesRes, papersRes] = await Promise.all([
    supabase
      .from("exams")
      .select("id, name, kind, starts_on, ends_on, status, published_at, grading_scheme_id")
      .order("starts_on", { ascending: false, nullsFirst: false }),
    supabase.from("grading_schemes").select("id, name"),
    supabase.from("exam_subjects").select("exam_id"),
  ]);

  if (examsRes.error) throw new Error(examsRes.error.message);

  const schemeName = new Map((schemesRes.data ?? []).map((s) => [s.id, s.name]));
  const papers = new Map<string, number>();
  for (const row of papersRes.data ?? []) {
    papers.set(row.exam_id, (papers.get(row.exam_id) ?? 0) + 1);
  }

  return (examsRes.data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    startsOn: e.starts_on,
    endsOn: e.ends_on,
    status: e.status,
    publishedAt: e.published_at,
    gradingSchemeId: e.grading_scheme_id,
    gradingSchemeName: e.grading_scheme_id ? (schemeName.get(e.grading_scheme_id) ?? null) : null,
    paperCount: papers.get(e.id) ?? 0,
  }));
}

export async function saveExam(input: unknown, id?: string): Promise<ActionResult<{ id: string }>> {
  const parsed = examSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no current academic session.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    starts_on: parsed.data.startsOn || null,
    ends_on: parsed.data.endsOn || null,
    grading_scheme_id: parsed.data.gradingSchemeId || null,
  };

  const { data, error } = id
    ? await supabase.from("exams").update(payload).eq("id", id).select("id").single()
    : await supabase.from("exams").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "This session already has an exam with that name.",
        fieldErrors: { name: ["Already in use"] },
      };
    }
    return fail(error.message);
  }

  revalidatePath("/exams");
  return { ok: true, data: { id: data.id } };
}

export async function deleteExam(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("exams").delete().eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/exams");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

export type PaperRow = {
  id: string;
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  maxMarks: number;
  passMarks: number;
  weight: number;
  isOptional: boolean;
  examDate: string | null;
  markedCount: number;
  studentCount: number;
  components: PaperComponent[];
};

export type PaperComponent = {
  id: string;
  code: string;
  name: string;
  maxMarks: number;
  passMarks: number;
  position: number;
};

export async function listPapers(examId: string): Promise<PaperRow[]> {
  const supabase = await createClient();

  const { data: papers, error } = await supabase
    .from("exam_subjects")
    .select("id, section_id, subject_id, max_marks, pass_marks, weight, is_optional, exam_date")
    .eq("exam_id", examId);

  if (error) throw new Error(error.message);
  if (!papers?.length) return [];

  const [sectionsRes, subjectsRes, marksRes, enrolmentsRes, componentsRes] = await Promise.all([
    supabase.from("sections").select("id, name, class_levels ( name, sequence )"),
    supabase.from("subjects").select("id, name, code"),
    supabase
      .from("marks")
      .select("exam_subject_id, exam_component_id, student_id, marks_obtained, is_absent")
      .in("exam_subject_id", papers.map((p) => p.id)),
    supabase.from("enrolments").select("section_id").eq("status", "active"),
    supabase
      .from("exam_components")
      .select("id, exam_subject_id, code, name, max_marks, pass_marks, position")
      .in("exam_subject_id", papers.map((p) => p.id)),
  ]);

  const sections = new Map(
    (sectionsRes.data ?? []).map((s) => [
      s.id,
      {
        label: s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
        sequence: s.class_levels?.sequence ?? 0,
      },
    ]),
  );
  const subjects = new Map((subjectsRes.data ?? []).map((s) => [s.id, s]));

  const components = new Map<string, PaperComponent[]>();
  for (const c of componentsRes.data ?? []) {
    const list = components.get(c.exam_subject_id) ?? [];
    list.push({
      id: c.id,
      code: c.code,
      name: c.name,
      maxMarks: Number(c.max_marks),
      passMarks: Number(c.pass_marks),
      position: c.position,
    });
    components.set(c.exam_subject_id, list);
  }
  for (const list of components.values()) {
    list.sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));
  }

  // "Marked" means resolved — a mark, or an absence. An unmarked paper is what
  // keeps a result incomplete, so the count that matters is how many are still
  // outstanding.
  //
  // A split paper counts a child once every one of its parts is resolved, which
  // is the same rule `exams_subject_breakdown` applies: a paper with the
  // practical still to mark is not marked, however full the theory column looks.
  const resolvedParts = new Map<string, Set<string>>();
  const marked = new Map<string, number>();
  for (const m of marksRes.data ?? []) {
    if (m.marks_obtained === null && !m.is_absent) continue;
    if (m.exam_component_id === null) {
      if (components.has(m.exam_subject_id)) continue;
      marked.set(m.exam_subject_id, (marked.get(m.exam_subject_id) ?? 0) + 1);
    } else {
      const key = `${m.exam_subject_id}:${m.student_id}`;
      const seen = resolvedParts.get(key) ?? new Set<string>();
      seen.add(m.exam_component_id);
      resolvedParts.set(key, seen);
    }
  }
  for (const [key, seen] of resolvedParts) {
    const paperId = key.slice(0, key.indexOf(":"));
    const expected = components.get(paperId)?.length ?? 0;
    if (expected > 0 && seen.size === expected) {
      marked.set(paperId, (marked.get(paperId) ?? 0) + 1);
    }
  }

  const roll = new Map<string, number>();
  for (const e of enrolmentsRes.data ?? []) {
    roll.set(e.section_id, (roll.get(e.section_id) ?? 0) + 1);
  }

  return papers
    .map((p) => {
      const section = sections.get(p.section_id);
      const subject = subjects.get(p.subject_id);
      return {
        id: p.id,
        sectionId: p.section_id,
        sectionLabel: section?.label ?? "Unknown class",
        sequence: section?.sequence ?? 0,
        subjectId: p.subject_id,
        subjectName: subject?.name ?? "Unknown subject",
        subjectCode: subject?.code ?? "",
        maxMarks: Number(p.max_marks),
        passMarks: Number(p.pass_marks),
        weight: Number(p.weight),
        isOptional: p.is_optional,
        examDate: p.exam_date,
        markedCount: marked.get(p.id) ?? 0,
        studentCount: roll.get(p.section_id) ?? 0,
        components: components.get(p.id) ?? [],
      };
    })
    .sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.sectionLabel.localeCompare(b.sectionLabel) ||
        a.subjectName.localeCompare(b.subjectName),
    )
    .map((row) => {
      const { sequence, ...rest } = row;
      void sequence;
      return rest;
    });
}

export async function savePaper(
  examId: string,
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = examPaperSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  if (!ctx.currentSessionId) return fail("This school has no current academic session.");

  const supabase = await createClient();
  const payload = {
    tenant_id: ctx.tenantId,
    session_id: ctx.currentSessionId,
    exam_id: examId,
    section_id: parsed.data.sectionId,
    subject_id: parsed.data.subjectId,
    max_marks: parsed.data.maxMarks,
    pass_marks: parsed.data.passMarks,
    weight: parsed.data.weight,
    is_optional: parsed.data.isOptional,
    exam_date: parsed.data.examDate || null,
  };

  const { data, error } = id
    ? await supabase.from("exam_subjects").update(payload).eq("id", id).select("id").single()
    : await supabase.from("exam_subjects").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") {
      return fail("That class already sits this subject in this exam.");
    }
    if (error.code === "23503") {
      return fail(
        "That subject is not on this class's curriculum, so it cannot be examined. Assign it under Academics first.",
      );
    }
    if (error.code === "23514") {
      // The marks-within-maximum check firing through the FK's cascade.
      return fail(
        "Marks already entered for this paper are above the new maximum, so the maximum cannot be lowered.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/exams");
  return { ok: true, data: { id: data.id } };
}

export async function deletePaper(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("exam_subjects").delete().eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/exams");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export type MarkSheetRow = {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  rollNumber: string | null;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
  /** Keyed by component id, so a cell is found by identity rather than by
   *  position — the one thing that goes wrong when a part is added later. */
  componentMarks: Record<string, { marks: number | null; absent: boolean }>;
};

export async function getMarkSheet(examSubjectId: string): Promise<MarkSheetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_mark_sheet", {
    p_exam_subject_id: examSubjectId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    studentId: r.student_id,
    admissionNumber: r.admission_number,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    marksObtained: r.marks_obtained === null ? null : Number(r.marks_obtained),
    isAbsent: r.is_absent,
    remarks: r.remarks,
    componentMarks: Object.fromEntries(
      Object.entries(
        (r.component_marks ?? {}) as Record<string, { marks: number | null; absent: boolean }>,
      ).map(([id, cell]) => [
        id,
        { marks: cell.marks === null ? null : Number(cell.marks), absent: Boolean(cell.absent) },
      ]),
    ),
  }));
}

export async function saveMarks(input: unknown): Promise<ActionResult<{ written: number }>> {
  const parsed = markSheetSchema.safeParse(input);
  if (!parsed.success) return fail("That mark sheet is not one this system understands.");

  const supabase = await createClient();

  const entries = parsed.data.entries.map((e) => ({
    student_id: e.studentId,
    exam_component_id: e.componentId,
    // An empty box is "not entered yet", which the RPC stores as null. It is
    // not zero, and collapsing the two would turn an unmarked paper into a
    // failed one.
    marks_obtained: e.isAbsent || e.marks.trim() === "" ? null : Number(e.marks),
    is_absent: e.isAbsent,
    remarks: e.remarks ?? null,
  }));

  const { data, error } = await supabase.rpc("exams_enter_marks", {
    p_exam_subject_id: parsed.data.examSubjectId,
    p_entries: entries,
  });

  if (error) return fail(error.message);

  revalidatePath("/exams");
  return { ok: true, data: { written: data ?? 0 } };
}

// ---------------------------------------------------------------------------
// Components — how a paper is split
// ---------------------------------------------------------------------------

/**
 * Replace a paper's parts wholesale. The interesting refusals all live in
 * `exams_set_components` — the parts have to add up, a part carrying marks
 * cannot be removed or shrunk below one of them — and they arrive here as
 * sentences already, so this passes them through rather than paraphrasing.
 */
export async function savePaperComponents(
  input: unknown,
): Promise<ActionResult<{ parts: number }>> {
  const parsed = examComponentSetSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_set_components", {
    p_exam_subject_id: parsed.data.examSubjectId,
    p_components: parsed.data.components.map((c, index) => ({
      code: c.code.trim(),
      name: c.name.trim(),
      max_marks: c.maxMarks,
      pass_marks: c.passMarks,
      position: index,
    })),
  });

  if (error) return fail(error.message);

  revalidatePath("/exams");
  return { ok: true, data: { parts: data ?? 0 } };
}

/**
 * What is wrong with this exam, in sentences. The list comes from Postgres for
 * the reason rule 12 gives: the thing that criticises a scheme has to live next
 * to the thing that evaluates it, or the two drift and the criticism is the one
 * that goes stale.
 */
export async function listExamProblems(examId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_problems", { p_exam_id: examId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.problem).filter((p): p is string => Boolean(p));
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ResultRow = {
  studentId: string;
  admissionNumber: string;
  studentName: string;
  rollNumber: string | null;
  sectionLabel: string;
  totalMarks: number;
  maxMarks: number;
  percentage: number | null;
  grade: string | null;
  gradePoint: number | null;
  result: string;
  subjectsCounted: number;
  subjectsFailed: number;
  subjectsUnmarked: number;
  detail: unknown;
};

export async function getResultSheet(
  examId: string,
  sectionId?: string,
): Promise<ResultRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_result_sheet", {
    p_exam_id: examId,
    p_section_id: sectionId || undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    studentId: r.student_id,
    admissionNumber: r.admission_number,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    sectionLabel: r.section_label,
    totalMarks: Number(r.total_marks),
    maxMarks: Number(r.max_marks),
    percentage: r.percentage === null ? null : Number(r.percentage),
    grade: r.grade,
    gradePoint: r.grade_point === null ? null : Number(r.grade_point),
    result: r.result,
    subjectsCounted: r.subjects_counted,
    subjectsFailed: r.subjects_failed,
    subjectsUnmarked: r.subjects_unmarked,
    detail: r.detail,
  }));
}

export async function publishExam(examId: string): Promise<ActionResult<{ frozen: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_publish", { p_exam_id: examId });
  if (error) return fail(error.message);

  revalidatePath("/exams");
  return { ok: true, data: { frozen: data ?? 0 } };
}

export async function unpublishExam(examId: string): Promise<ActionResult<{ removed: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_unpublish", { p_exam_id: examId });
  if (error) return fail(error.message);

  revalidatePath("/exams");
  return { ok: true, data: { removed: data ?? 0 } };
}

// ---------------------------------------------------------------------------
// Grading schemes
// ---------------------------------------------------------------------------

export type SchemeRow = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  rules: unknown;
  problems: string[];
  usedByExams: number;
};

export async function listSchemes(): Promise<SchemeRow[]> {
  const supabase = await createClient();

  const [schemesRes, examsRes] = await Promise.all([
    supabase
      .from("grading_schemes")
      .select("id, name, description, is_default, rules")
      .order("name"),
    supabase.from("exams").select("grading_scheme_id"),
  ]);

  if (schemesRes.error) throw new Error(schemesRes.error.message);

  const usage = new Map<string, number>();
  for (const e of examsRes.data ?? []) {
    if (!e.grading_scheme_id) continue;
    usage.set(e.grading_scheme_id, (usage.get(e.grading_scheme_id) ?? 0) + 1);
  }

  // Every scheme is criticised by Postgres, not by this file — the engine that
  // reads the rules and the thing that judges them must not drift apart.
  const problems = await Promise.all(
    (schemesRes.data ?? []).map(async (s) => {
      const { data } = await supabase.rpc("grading_scheme_problems", { p_rules: s.rules });
      return (data ?? []).map((p) => p.problem);
    }),
  );

  return (schemesRes.data ?? []).map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    isDefault: s.is_default,
    rules: s.rules,
    problems: problems[i],
    usedByExams: usage.get(s.id) ?? 0,
  }));
}

export async function saveScheme(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string; problems: string[] }>> {
  const parsed = gradingSchemeSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const rules = parseRules(parsed.data.rules);
  if (!rules.ok) {
    return { ok: false, error: rules.error, fieldErrors: { rules: [rules.error] } };
  }

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");

  const supabase = await createClient();

  // At most one default per tenant is a partial unique index, so the previous
  // default has to stand down first. Two statements rather than one, and the
  // window between them is why the index exists.
  if (parsed.data.isDefault) {
    let clear = supabase.from("grading_schemes").update({ is_default: false }).eq("is_default", true);
    if (id) clear = clear.neq("id", id);
    await clear;
  }

  const payload = {
    tenant_id: ctx.tenantId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    is_default: parsed.data.isDefault,
    rules: rules.rules as never,
  };

  const { data, error } = id
    ? await supabase.from("grading_schemes").update(payload).eq("id", id).select("id").single()
    : await supabase.from("grading_schemes").insert(payload).select("id").single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "A scheme with that name already exists.",
        fieldErrors: { name: ["Already in use"] },
      };
    }
    return fail(error.message);
  }

  const { data: problems } = await supabase.rpc("grading_scheme_problems", {
    p_rules: rules.rules as never,
  });

  revalidatePath("/exams");
  return {
    ok: true,
    data: { id: data.id, problems: (problems ?? []).map((p) => p.problem) },
  };
}

export async function deleteScheme(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("grading_schemes").delete().eq("id", id);

  if (error) {
    if (error.code === "23503") {
      return fail(
        "An exam is using this scheme, so it cannot be deleted. Point that exam at another scheme first.",
      );
    }
    return fail(error.message);
  }

  revalidatePath("/exams");
  return { ok: true, data: undefined };
}
