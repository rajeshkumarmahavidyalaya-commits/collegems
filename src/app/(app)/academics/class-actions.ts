"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { classLevelSchema, sectionSchema } from "@/lib/validations/classes";
import type { ActionResult } from "../library/actions";

export type ClassSectionRow = {
  id: string;
  name: string;
  capacity: number;
  classTeacherStaffId: string | null;
  enrolled: number;
};

export type ClassLevelRow = {
  id: string;
  name: string;
  sequence: number;
  /** This year's sections only: a section belongs to a year (rule 2). */
  sections: ClassSectionRow[];
};

function fail(error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Every class, with the current year's sections and how many children are in each. */
export async function listClassStructure(): Promise<ClassLevelRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  const [{ data: levels, error }, { data: sections }] = await Promise.all([
    supabase.from("class_levels").select("id, name, sequence").order("sequence").order("name"),
    ctx?.currentSessionId
      ? supabase
          .from("sections")
          .select("id, name, capacity, class_level_id, class_teacher_staff_id, enrolments(count)")
          .eq("session_id", ctx.currentSessionId)
          .order("name")
      : Promise.resolve({ data: [] as never[] }),
  ]);
  if (error) throw new Error(error.message);

  return (levels ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    sequence: l.sequence,
    sections: (sections ?? [])
      .filter((s) => s.class_level_id === l.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        capacity: s.capacity,
        classTeacherStaffId: s.class_teacher_staff_id,
        enrolled: (s.enrolments as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
      })),
  }));
}

export async function saveClassLevel(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = classLevelSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  const supabase = await createClient();

  let sequence = parsed.data.sequence ? Number(parsed.data.sequence) : null;
  if (sequence === null && !id) {
    const { data: last } = await supabase
      .from("class_levels")
      .select("sequence")
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    sequence = (last?.sequence ?? 0) + 1;
  }

  const payload = {
    name: parsed.data.name,
    ...(sequence !== null ? { sequence } : {}),
  };
  const { data, error } = id
    ? await supabase.from("class_levels").update(payload).eq("id", id).select("id")
    : await supabase
        .from("class_levels")
        .insert({ ...payload, sequence: sequence ?? 1, tenant_id: ctx.tenantId })
        .select("id");

  if (error) {
    if (error.code === "23505") {
      return error.message.includes("sequence")
        ? fail("Another class already has that position.", { sequence: ["Already used"] })
        : fail("A class with that name already exists.", { name: ["Already used"] });
    }
    return fail(error.message);
  }
  // An update or insert no policy matches writes nothing and raises nothing.
  if (!data || data.length === 0) return fail("Only an administrator can change the classes.");

  revalidatePath("/academics");
  return { ok: true, data: { id: data[0].id } };
}

/** Refused by the database, in a sentence, while the class has any section. */
export async function deleteClassLevel(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("class_levels").delete().eq("id", id).select("id");
  if (error) return fail(error.message);
  if (!data || data.length === 0) return fail("Only an administrator can delete a class.");
  revalidatePath("/academics");
  return { ok: true, data: undefined };
}

export async function saveSection(
  input: unknown,
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = sectionSchema.safeParse(input);
  if (!parsed.success) return fail("Check the highlighted fields.", parsed.error.flatten().fieldErrors);

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  // Rule 2: the year is the server's, never the form's.
  if (!ctx.currentSessionId) return fail("There is no current academic year. Set one under Academic years first.");

  const supabase = await createClient();
  const payload = {
    name: parsed.data.name,
    // The column is NOT NULL with a default of 40; blank keeps 40.
    capacity: parsed.data.capacity ? Number(parsed.data.capacity) : 40,
    class_teacher_staff_id: parsed.data.classTeacherStaffId || null,
  };
  const { data, error } = id
    ? await supabase.from("sections").update(payload).eq("id", id).select("id")
    : await supabase
        .from("sections")
        .insert({
          ...payload,
          tenant_id: ctx.tenantId,
          session_id: ctx.currentSessionId,
          class_level_id: parsed.data.classLevelId,
        })
        .select("id");

  if (error) {
    if (error.code === "23505") {
      return fail("This class already has a section with that name this year.", { name: ["Already used"] });
    }
    return fail(error.message);
  }
  if (!data || data.length === 0) return fail("Only an administrator can change the sections.");

  revalidatePath("/academics");
  return { ok: true, data: { id: data[0].id } };
}

/** Refused by the database, naming the count, while any child is enrolled in it. */
export async function deleteSection(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("sections").delete().eq("id", id).select("id");
  if (error) return fail(error.message);
  if (!data || data.length === 0) return fail("Only an administrator can delete a section.");
  revalidatePath("/academics");
  return { ok: true, data: undefined };
}
