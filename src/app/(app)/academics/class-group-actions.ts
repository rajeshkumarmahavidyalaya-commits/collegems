"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../library/actions";

/*
 * Class groups (0341): the reference's "Class Groups" (Class Group Name,
 * Classes, Head of Group). A group and its classes are written together by
 * `class_group_save`, so the administrator policies on both tables are the
 * gate and the two writes cannot half-happen.
 */

export type ClassGroupRow = {
  id: string;
  name: string;
  headStaffId: string | null;
  headName: string | null;
  classes: { id: string; name: string }[];
};

export type ClassLevelOption = { id: string; name: string; groupId: string | null };

export async function listClassGroups(): Promise<{ groups: ClassGroupRow[]; classes: ClassLevelOption[] }> {
  const supabase = await createClient();
  const [groupsRes, levelsRes, staffRes] = await Promise.all([
    supabase.from("class_groups").select("id, name, head_staff_id").order("name").order("id"),
    supabase.from("class_levels").select("id, name, sequence, class_group_id").order("sequence"),
    supabase.from("staff").select("id, people:person_id ( first_name, last_name )"),
  ]);
  if (groupsRes.error) throw new Error(groupsRes.error.message);
  const staffName = new Map(
    (staffRes.data ?? []).map((s) => [s.id, s.people ? `${s.people.first_name} ${s.people.last_name}` : null]),
  );
  const classes = (levelsRes.data ?? []).map((l) => ({ id: l.id, name: l.name, groupId: l.class_group_id }));
  return {
    groups: (groupsRes.data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      headStaffId: g.head_staff_id,
      headName: g.head_staff_id ? (staffName.get(g.head_staff_id) ?? null) : null,
      classes: classes.filter((c) => c.groupId === g.id).map((c) => ({ id: c.id, name: c.name })),
    })),
    classes,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveClassGroup(
  input: { name: string; headStaffId: string; classLevelIds: string[] },
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const name = (input?.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: "Give the class group a name of up to 80 characters.", fieldErrors: { name: ["Up to 80 characters"] } };
  }
  const head = input.headStaffId && UUID.test(input.headStaffId) ? input.headStaffId : null;
  const classIds = (Array.isArray(input.classLevelIds) ? input.classLevelIds : []).filter((c) => UUID.test(c));
  if (id && !UUID.test(id)) return { ok: false, error: "That class group does not exist." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("class_group_save", {
    p_id: id ?? null,
    p_name: name,
    p_head_staff_id: head,
    p_class_level_ids: classIds,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `There is already a class group called "${name}".`, fieldErrors: { name: ["Already used"] } };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/academics/class-groups");
  return { ok: true, data: { id: data as string } };
}

/** Its classes are ungrouped, not refused: the key clears them (0341). */
export async function removeClassGroup(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("class_groups").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only an administrator can remove a class group." };
  revalidatePath("/academics/class-groups");
  return { ok: true, data: undefined };
}
