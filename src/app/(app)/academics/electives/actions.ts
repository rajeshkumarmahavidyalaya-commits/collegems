"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/permissions";
import { parseOverview, type GroupOverview } from "@/lib/validations/electives";
import type { ActionResult } from "../../library/actions";

/** Every elective group this year, with how far the class has got. */
export async function listElectiveGroups(): Promise<GroupOverview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subject_group_overview");
  if (error) throw new Error(error.message);
  return parseOverview(data);
}

export type ClassLevelOption = { id: string; name: string };
export type SubjectOption = { id: string; name: string; code: string };

export async function listElectiveInputs(): Promise<{ classLevels: ClassLevelOption[]; subjects: SubjectOption[] }> {
  const supabase = await createClient();
  const [levels, subjects] = await Promise.all([
    supabase.from("class_levels").select("id, name").order("sequence"),
    supabase.from("subjects").select("id, name, code").eq("is_active", true).order("name"),
  ]);
  if (levels.error) throw new Error(levels.error.message);
  if (subjects.error) throw new Error(subjects.error.message);
  return { classLevels: levels.data ?? [], subjects: subjects.data ?? [] };
}

type CreateInput = {
  classLevelId: string;
  name: string;
  min: number;
  max: number;
  subjectIds: string[];
  closesOn: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function createElectiveGroup(input: CreateInput): Promise<ActionResult<{ id: string }>> {
  if (!(await hasPermission("academics.manage"))) {
    return { ok: false, error: "Your role does not set up elective choices." };
  }
  const ids = Array.isArray(input?.subjectIds) ? input.subjectIds.filter((x) => UUID.test(x)) : [];
  if (!UUID.test(input?.classLevelId ?? "")) return { ok: false, error: "Pick the class this choice is for." };
  if (input.closesOn && !DAY.test(input.closesOn)) return { ok: false, error: "The closing date is not a date." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subject_group_create", {
    p_class_level_id: input.classLevelId,
    p_name: String(input.name ?? ""),
    p_min: Math.trunc(Number(input.min)),
    p_max: Math.trunc(Number(input.max)),
    p_subject_ids: ids,
    p_closes_on: input.closesOn || undefined,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "This class already has a choice with that name this year." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/academics/electives");
  return { ok: true, data: { id: data as string } };
}

/** Open or close a group for choosing, and move its closing date. */
export async function setElectiveWindow(
  groupId: string,
  isOpen: boolean,
  closesOn: string | null,
): Promise<ActionResult> {
  if (!(await hasPermission("academics.manage"))) {
    return { ok: false, error: "Your role does not open or close elective choices." };
  }
  if (!UUID.test(groupId)) return { ok: false, error: "That choice does not exist." };
  if (closesOn && !DAY.test(closesOn)) return { ok: false, error: "The closing date is not a date." };

  const supabase = await createClient();
  // An UPDATE no policy matches touches nothing and raises nothing (rule 6),
  // so the count is the answer.
  const { error, count } = await supabase
    .from("subject_groups")
    .update({ is_open: isOpen, closes_on: closesOn }, { count: "exact" })
    .eq("id", groupId);
  if (error) return { ok: false, error: error.message };
  if (count !== 1) return { ok: false, error: "Nothing was changed: only the super admin can open or close a choice." };
  revalidatePath("/academics/electives");
  return { ok: true, data: undefined };
}

export async function deleteElectiveGroup(groupId: string): Promise<ActionResult> {
  if (!(await hasPermission("academics.manage"))) {
    return { ok: false, error: "Your role does not remove elective choices." };
  }
  if (!UUID.test(groupId)) return { ok: false, error: "That choice does not exist." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("subject_groups").delete({ count: "exact" }).eq("id", groupId);
  if (error) return { ok: false, error: error.message };
  if (count !== 1) return { ok: false, error: "Nothing was removed: only the super admin can remove a choice." };
  revalidatePath("/academics/electives");
  return { ok: true, data: undefined };
}

/**
 * The office choosing on a child's behalf -- a late admission, a student with
 * no login, a change of mind after the window closed. `subject_choice_save`
 * lets an administrator pass the student and skips the window for them; it
 * still checks the class, the count and that each subject was allotted.
 */
export async function saveChoiceFor(
  studentId: string,
  groupId: string,
  subjectIds: string[],
): Promise<ActionResult> {
  if (!(await hasPermission("academics.manage"))) {
    return { ok: false, error: "Your role does not change a student's electives." };
  }
  if (!UUID.test(studentId ?? "") || !UUID.test(groupId ?? "")) {
    return { ok: false, error: "That choice does not exist." };
  }
  const ids = (Array.isArray(subjectIds) ? subjectIds : []).filter((x) => UUID.test(x));
  const supabase = await createClient();
  const { error } = await supabase.rpc("subject_choice_save", {
    p_group_id: groupId,
    p_subject_ids: ids,
    p_student_id: studentId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/academics/electives");
  return { ok: true, data: undefined };
}
