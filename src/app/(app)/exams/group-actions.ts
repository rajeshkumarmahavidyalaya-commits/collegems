"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/*
 * Exam groups (0341): the reference's "Exam Groups". Read by every member of
 * the college, written by the administrator; the policy is the boundary and
 * each write asserts its row count, because a write no policy matches touches
 * nothing and raises nothing (rule 6).
 */

export type ExamGroupRow = { id: string; name: string; isActive: boolean; exams: number };

export async function listExamGroups(): Promise<ExamGroupRow[]> {
  const supabase = await createClient();
  const [{ data, error }, used] = await Promise.all([
    supabase.from("exam_groups").select("id, name, is_active").order("name").order("id"),
    // How many exams each holds, so a group in use says why it cannot be
    // removed. Every year's, deliberately: a group filed last year is in use.
    supabase.from("exams").select("exam_group_id").not("exam_group_id", "is", null),
  ]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of used.data ?? []) {
    if (row.exam_group_id) counts.set(row.exam_group_id, (counts.get(row.exam_group_id) ?? 0) + 1);
  }
  return (data ?? []).map((g) => ({ id: g.id, name: g.name, isActive: g.is_active, exams: counts.get(g.id) ?? 0 }));
}

export async function saveExamGroup(
  input: { name: string; isActive: boolean },
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const name = (input?.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: "Give the exam group a title of up to 80 characters.", fieldErrors: { name: ["Up to 80 characters"] } };
  }
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const row = { name, is_active: input.isActive !== false };
  const { data, error } = id
    ? await supabase.from("exam_groups").update(row).eq("id", id).select("id")
    : await supabase.from("exam_groups").insert({ ...row, tenant_id: ctx.tenantId }).select("id");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `There is already an exam group called "${name}".`, fieldErrors: { name: ["Already used"] } };
    }
    if (error.code === "42501") return { ok: false, error: "Only an administrator can change exam groups." };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Only an administrator can change exam groups." };
  revalidatePath("/exams/groups");
  revalidatePath("/exams");
  return { ok: true, data: { id: data[0].id } };
}

export async function removeExamGroup(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("exam_groups").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Exams are filed under this group. Mark it inactive instead, so it is not offered for new exams." };
    }
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Only an administrator can remove an exam group." };
  revalidatePath("/exams/groups");
  return { ok: true, data: undefined };
}
