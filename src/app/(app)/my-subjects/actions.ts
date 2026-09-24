"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseMySubjects, type MySubjects } from "@/lib/validations/electives";
import type { ActionResult } from "../library/actions";

/** The signed-in student's subjects this year -- only their own class's. */
export async function getMySubjects(): Promise<MySubjects> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subject_choices_for_student", {});
  if (error) throw new Error(error.message);
  return parseMySubjects(data);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Save one group's choice. The student is never sent: `subject_choice_save`
 * resolves them from the login, and checks the window, the class, the count
 * and that every subject was allotted -- this action only shapes the call.
 */
export async function saveMyChoice(groupId: string, subjectIds: string[]): Promise<ActionResult> {
  if (!UUID.test(groupId ?? "")) return { ok: false, error: "That choice does not exist." };
  const ids = (Array.isArray(subjectIds) ? subjectIds : []).filter((x) => UUID.test(x));
  const supabase = await createClient();
  const { error } = await supabase.rpc("subject_choice_save", { p_group_id: groupId, p_subject_ids: ids });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/my-subjects");
  return { ok: true, data: undefined };
}
