"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { parseCard, remarkSchema, type ReportCard } from "@/lib/validations/report-cards";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// Reading cards
// ---------------------------------------------------------------------------

/**
 * Every card in one section, in printing order. Bounded by the section, per
 * rule 7 — a class is a few dozen children, and the whole school is a job.
 *
 * Cards that fail to parse are dropped rather than half-rendered, and the count
 * of what was dropped comes back so the screen can say so instead of quietly
 * printing thirty-eight cards where there are thirty-nine children.
 */
export async function getSectionCards(
  examId: string,
  sectionId: string,
): Promise<{ cards: ReportCard[]; unreadable: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_report_cards", {
    p_exam_id: examId,
    p_section_id: sectionId,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown[];
  const cards: ReportCard[] = [];
  for (const row of rows) {
    const card = parseCard(row);
    if (card) cards.push(card);
  }
  return { cards, unreadable: rows.length - cards.length };
}

export async function getStudentCard(
  examId: string,
  studentId: string,
): Promise<ReportCard | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_report_card", {
    p_exam_id: examId,
    p_student_id: studentId,
  });
  // A refusal from Postgres ("You cannot see that student's report card",
  // "These results have not been published yet") is not a crash — it is the
  // answer. The caller renders it.
  if (error) return null;
  return parseCard(data);
}

export type PublishedResultRow = {
  examId: string;
  examName: string;
  kind: string;
  endsOn: string | null;
  publishedAt: string | null;
  percentage: number | null;
  grade: string | null;
  result: string;
  rankInCohort: number | null;
  cohortSize: number | null;
};

export async function listPublishedResults(studentId: string): Promise<PublishedResultRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_published_for_student", {
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    examId: r.exam_id,
    examName: r.exam_name,
    kind: r.kind,
    endsOn: r.ends_on,
    publishedAt: r.published_at,
    percentage: r.percentage === null ? null : Number(r.percentage),
    grade: r.grade,
    result: r.result,
    rankInCohort: r.rank_in_cohort,
    cohortSize: r.cohort_size,
  }));
}

/**
 * The children this signed-in family may open a card for. A guardian may have
 * several; a student is their own single entry.
 */
export type FamilyChild = { studentId: string; name: string; section: string | null };

export async function listMyChildren(): Promise<FamilyChild[]> {
  const ctx = await getUserContext();
  if (!ctx) return [];

  const supabase = await createClient();

  if (ctx.roleCode === "student") {
    if (!ctx.studentId) return [];
    const { data } = await supabase
      .from("students")
      .select("id, people:person_id ( first_name, last_name )")
      .eq("id", ctx.studentId)
      .maybeSingle();
    if (!data) return [];
    const person = data.people as { first_name: string; last_name: string } | null;
    return [
      {
        studentId: data.id,
        name: person ? `${person.first_name} ${person.last_name}` : "This student",
        section: null,
      },
    ];
  }

  if (ctx.roleCode !== "parent" || !ctx.guardianId) return [];

  // RLS on guardian_student already restricts this to the signed-in guardian's
  // links, so there is no `where guardian_id =` doing the security work here —
  // it is a query narrowing, not a boundary.
  const { data, error } = await supabase
    .from("guardian_student")
    .select("student_id, students ( id, people:person_id ( first_name, last_name ) )")
    .eq("guardian_id", ctx.guardianId);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const student = row.students as {
      id: string;
      people: { first_name: string; last_name: string } | null;
    } | null;
    return {
      studentId: row.student_id,
      name: student?.people
        ? `${student.people.first_name} ${student.people.last_name}`
        : "This student",
      section: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Remarks
// ---------------------------------------------------------------------------

export type RemarkRow = {
  studentId: string;
  studentName: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  remark: string | null;
  updatedAt: string | null;
};

export async function getRemarkSheet(examId: string, sectionId: string): Promise<RemarkRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exams_remark_sheet", {
    p_exam_id: examId,
    p_section_id: sectionId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    admissionNumber: r.admission_number,
    rollNumber: r.roll_number,
    remark: r.remark,
    updatedAt: r.updated_at,
  }));
}

/**
 * Write one remark. An empty string deletes it, which is what a class teacher
 * means by clearing the box — the alternative, an empty remark printed as a
 * blank line under a heading, looks like the school forgot.
 */
export async function saveRemark(
  examId: string,
  input: { studentId: string; remark: string },
): Promise<ActionResult<{ cleared: boolean }>> {
  const parsed = remarkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("exams_set_remark", {
    p_exam_id: examId,
    p_student_id: parsed.data.studentId,
    p_remark: parsed.data.remark,
  });
  if (error) return fail(error.message);

  revalidatePath(`/exams/${examId}/remarks`);
  revalidatePath(`/exams/${examId}/report-cards`);
  return { ok: true, data: { cleared: parsed.data.remark.trim() === "" } };
}
