"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  cellKey,
  isGrade,
  parseScale,
  type BehaviourGrade,
  type BehaviourScale,
  type GradeMap,
} from "@/lib/validations/behaviour";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type BehaviourTrait = { id: string; name: string; kind: string; isActive: boolean };
export type BehaviourStudent = { studentId: string; studentName: string; rollNumber: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The college's scale (0307), through `setting_value` so the default is the catalogue's. */
export async function getBehaviourScale(): Promise<BehaviourScale> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("setting_value", { p_key: "exams.behaviour_scale" });
  return parseScale(data);
}

/** The college's traits, behaviour first, in its own order (0303). */
export async function listTraits(): Promise<BehaviourTrait[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("behaviour_traits")
    .select("id, name, kind, is_active, sort")
    .order("kind")
    .order("sort")
    .order("name");
  return (data ?? []).map((t) => ({ id: t.id, name: t.name, kind: t.kind, isActive: t.is_active }));
}

/**
 * One class's grid for one exam. The children come from the remark sheet's
 * own read (`exams_remark_sheet`, called directly so the two action modules
 * do not import each other), which already answers "which children is this
 * person grading" for exactly the people who may; the grades come through
 * behaviour_ratings' own policies.
 */
export async function getBehaviourSheet(
  examId: string,
  sectionId: string,
): Promise<{ traits: BehaviourTrait[]; students: BehaviourStudent[]; grades: GradeMap; scale: BehaviourScale }> {
  const supabase = await createClient();
  const [traits, { data: rows, error }, scale] = await Promise.all([
    listTraits(),
    supabase.rpc("exams_remark_sheet", { p_exam_id: examId, p_section_id: sectionId }),
    getBehaviourScale(),
  ]);
  if (error) throw new Error(error.message);
  const students = (rows ?? []).map((r) => ({
    studentId: r.student_id,
    studentName: r.student_name,
    rollNumber: r.roll_number,
  }));

  const grades: GradeMap = {};
  if (students.length > 0) {
    const { data } = await supabase
      .from("behaviour_ratings")
      .select("student_id, trait_id, grade")
      .eq("exam_id", examId)
      .in(
        "student_id",
        students.map((s) => s.studentId),
      );
    for (const r of data ?? []) {
      if (isGrade(r.grade)) grades[cellKey(r.student_id, r.trait_id)] = r.grade;
    }
  }
  return { traits: traits.filter((t) => t.isActive), students, grades, scale };
}

/**
 * Save what changed. Upserts and deletes both go through the table's policies:
 * a class teacher's own section, a draft exam. A cell the policy will not let
 * this person write is not silently dropped -- the row counts are compared
 * with what was asked (rule 6), and a shortfall is a sentence.
 */
export async function saveBehaviour(
  examId: string,
  changes: {
    upserts: { studentId: string; traitId: string; grade: string }[];
    deletes: { studentId: string; traitId: string }[];
  },
): Promise<Result<{ saved: number; cleared: number }>> {
  if (!UUID.test(examId)) return { ok: false, error: "That exam cannot be found." };
  const upserts = changes.upserts ?? [];
  const deletes = changes.deletes ?? [];
  if (upserts.length + deletes.length > 2000) {
    return { ok: false, error: "Save one class at a time." };
  }
  for (const u of upserts) {
    if (!UUID.test(u.studentId) || !UUID.test(u.traitId) || !isGrade(u.grade)) {
      return { ok: false, error: "A grade is A, B, C, D or E." };
    }
  }

  const supabase = await createClient();
  const [{ data: exam }, { data: tenant }, { data: auth }] = await Promise.all([
    supabase.from("exams").select("session_id, status").eq("id", examId).maybeSingle(),
    supabase.rpc("current_tenant_id"),
    supabase.auth.getUser(),
  ]);
  if (!exam || !tenant) return { ok: false, error: "That exam cannot be found." };
  if (exam.status !== "draft") {
    return { ok: false, error: "These results are published, so the grades are frozen. Unpublish the exam to change them." };
  }

  let saved = 0;
  if (upserts.length > 0) {
    const { data, error } = await supabase
      .from("behaviour_ratings")
      .upsert(
        upserts.map((u) => ({
          tenant_id: tenant as string,
          session_id: exam.session_id,
          exam_id: examId,
          student_id: u.studentId,
          trait_id: u.traitId,
          grade: u.grade as BehaviourGrade,
          rated_by: auth.user?.id ?? null,
        })),
        { onConflict: "tenant_id,exam_id,student_id,trait_id" },
      )
      .select("id");
    if (error) {
      return {
        ok: false,
        error: error.code === "42501"
          ? "You can grade only the children of a class you are class teacher of."
          : error.message,
      };
    }
    saved = data?.length ?? 0;
    if (saved !== upserts.length) {
      return { ok: false, error: `${upserts.length - saved} of ${upserts.length} grades could not be saved.` };
    }
  }

  let cleared = 0;
  for (const d of deletes) {
    if (!UUID.test(d.studentId) || !UUID.test(d.traitId)) continue;
    const { data, error } = await supabase
      .from("behaviour_ratings")
      .delete()
      .eq("exam_id", examId)
      .eq("student_id", d.studentId)
      .eq("trait_id", d.traitId)
      .select("id");
    if (error) return { ok: false, error: error.message };
    cleared += data?.length ?? 0;
  }
  if (cleared !== deletes.length) {
    return { ok: false, error: `${deletes.length - cleared} of ${deletes.length} grades could not be cleared.` };
  }

  revalidatePath(`/exams/${examId}/behaviour`);
  revalidatePath(`/exams/${examId}/report-cards`);
  return { ok: true, data: { saved, cleared } };
}

/** Add a trait to the college's list. The policy is the gate (exams.manage). */
export async function addTrait(input: { name: string; kind: string }): Promise<Result<{ id: string }>> {
  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > 80) return { ok: false, error: "Give the trait a name of up to 80 characters." };
  if (input.kind !== "behaviour" && input.kind !== "skill") return { ok: false, error: "Choose behaviour or skill." };

  const supabase = await createClient();
  const { data: tenant } = await supabase.rpc("current_tenant_id");
  if (!tenant) return { ok: false, error: "You do not belong to a school." };
  const { data, error } = await supabase
    .from("behaviour_traits")
    .insert({ tenant_id: tenant as string, name, kind: input.kind, sort: 1000 })
    .select("id")
    .single();
  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? `"${name}" is already on the list.` : error.message,
    };
  }
  revalidatePath("/exams");
  return { ok: true, data: { id: data.id } };
}

/**
 * Retire or restore a trait. Retiring hides it from new grading and keeps
 * every grade already given, so a card from last term still prints it.
 */
export async function setTraitActive(id: string, active: boolean): Promise<Result<null>> {
  if (!UUID.test(id)) return { ok: false, error: "That trait cannot be found." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("behaviour_traits")
    .update({ is_active: active })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only the exams office can change the list of traits." };
  revalidatePath("/exams");
  return { ok: true, data: null };
}

export type CardBehaviour = { name: string; kind: string; grade: string };

/**
 * The grades printed on report cards, per child. Read through the policies,
 * so a family gets their own child's, and only once the exam is published.
 */
export async function behaviourForCards(
  examId: string,
  studentIds: string[],
): Promise<Record<string, CardBehaviour[]>> {
  if (studentIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("behaviour_ratings")
    .select("student_id, grade, behaviour_traits ( name, kind, sort )")
    .eq("exam_id", examId)
    .in("student_id", studentIds);

  const out: Record<string, (CardBehaviour & { sort: number })[]> = {};
  for (const r of data ?? []) {
    const t = r.behaviour_traits;
    if (!t) continue;
    (out[r.student_id] ??= []).push({ name: t.name, kind: t.kind, grade: r.grade, sort: t.sort });
  }
  const sorted: Record<string, CardBehaviour[]> = {};
  for (const [id, list] of Object.entries(out)) {
    sorted[id] = list
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name))
      .map(({ name, kind, grade }) => ({ name, kind, grade }));
  }
  return sorted;
}
