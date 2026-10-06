"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/*
 * Mediums and houses (0328): two short named lists an administrator writes and
 * the admission form reads. The admin policies are the boundary; each write
 * asserts its row count, because a write no policy matches touches nothing and
 * raises nothing (rule 6).
 */

const KINDS = {
  mediums: { column: "medium_id", countFrom: "students", path: "/academics/mediums", one: "medium", inUse: "Some students are still in this medium. Move them first, or rename it instead." },
  houses: { column: "house_id", countFrom: "students", path: "/academics/houses", one: "house", inUse: "Some students are still in this house. Move them first, or rename it instead." },
  // A college's own labels for its subjects (0347); what uses one is a subject.
  subject_types: { column: "subject_type_id", countFrom: "subjects", path: "/academics/subject-types", one: "subject type", inUse: "Some subjects still have this type. Change their type first, or rename it instead." },
} as const;
type Kind = keyof typeof KINDS;

export type NamedRow = { id: string; name: string; students: number };

function kindOf(kind: string): Kind | null {
  return kind === "mediums" || kind === "houses" || kind === "subject_types" ? kind : null;
}

export async function listNamed(kind: Kind): Promise<NamedRow[]> {
  const k = kindOf(kind);
  if (!k) return [];
  const supabase = await createClient();
  const column = KINDS[k].column;
  const [{ data, error }, used] = await Promise.all([
    supabase.from(k).select("id, name").order("name").order("id"),
    // How many children carry each, so a row in use says why it cannot be
    // removed. Bounded by the size of the roll.
    supabase.from(KINDS[k].countFrom).select(column).not(column, "is", null),
  ]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of (used.data ?? []) as unknown as Record<string, string | null>[]) {
    const id = row[column];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, students: counts.get(r.id) ?? 0 }));
}

export async function saveNamed(kind: Kind, name: string, id?: string): Promise<ActionResult<{ id: string }>> {
  const k = kindOf(kind);
  if (!k) return { ok: false, error: "Unknown list." };
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length < 1 || clean.length > 60) {
    return { ok: false, error: "Give it a name of up to 60 characters.", fieldErrors: { name: ["Up to 60 characters"] } };
  }
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data, error } = id
    ? await supabase.from(k).update({ name: clean }).eq("id", id).select("id")
    : await supabase.from(k).insert({ tenant_id: ctx.tenantId, name: clean }).select("id");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `There is already a ${KINDS[k].one} called "${clean}".`, fieldErrors: { name: ["Already used"] } };
    }
    if (error.code === "42501") return { ok: false, error: `Only an administrator can change the ${KINDS[k].one}s.` };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: `Only an administrator can change the ${KINDS[k].one}s.` };
  revalidatePath(KINDS[k].path);
  revalidatePath("/students/new");
  return { ok: true, data: { id: data[0].id } };
}

export async function removeNamed(kind: Kind, id: string): Promise<ActionResult> {
  const k = kindOf(kind);
  if (!k) return { ok: false, error: "Unknown list." };
  const supabase = await createClient();
  const { data, error } = await supabase.from(k).delete().eq("id", id).select("id");
  if (error) {
    // The foreign key from students keeps a value that is still in use.
    if (error.code === "23503") {
      return { ok: false, error: KINDS[k].inUse };
    }
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: `Only an administrator can remove a ${KINDS[k].one}.` };
  revalidatePath(KINDS[k].path);
  revalidatePath("/students/new");
  return { ok: true, data: undefined };
}
