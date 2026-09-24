"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { studentTypeCode, type StudentTypeOption } from "@/lib/validations/student-types";
import type { ActionResult } from "../../library/actions";

/*
 * Kinds of student (migration 0281). The policies are the boundary -- finance
 * roles write types and assignments, everybody in the college may read the
 * list of types, and only finance roles may read who is which -- and every
 * write here reports what Postgres said rather than assuming it.
 */

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export async function listStudentTypes(): Promise<StudentTypeOption[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const [typesRes, assignedRes] = await Promise.all([
    supabase.from("student_types").select("id, code, name, description, is_active").order("name"),
    ctx?.currentSessionId
      ? supabase
          .from("student_type_assignments")
          .select("student_type_id")
          .eq("session_id", ctx.currentSessionId)
      : Promise.resolve({ data: [] as { student_type_id: string }[], error: null }),
  ]);
  if (typesRes.error) throw new Error(typesRes.error.message);

  // A caller who may not read assignments sees none, and counts of 0. The
  // count is a convenience on a finance screen, not a claim about the college.
  const counts = new Map<string, number>();
  for (const a of assignedRes.data ?? []) {
    counts.set(a.student_type_id, (counts.get(a.student_type_id) ?? 0) + 1);
  }
  return (typesRes.data ?? []).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    isActive: t.is_active,
    studentCount: counts.get(t.id) ?? 0,
  }));
}

export async function saveStudentType(input: {
  id?: string;
  name: string;
  description?: string;
  isActive?: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) {
    return { ok: false, error: "Give it a name between 2 and 60 characters.", fieldErrors: { name: ["Between 2 and 60 characters"] } };
  }
  const description = input.description?.trim() || null;

  const ctx = await getUserContext();
  if (!ctx) return fail("Not signed in.");
  const supabase = await createClient();

  if (input.id) {
    const { data, error } = await supabase
      .from("student_types")
      .update({ name, description, is_active: input.isActive ?? true })
      .eq("id", input.id)
      .select("id");
    if (error) return fail(error.message);
    // An UPDATE no policy matches touches nothing and raises nothing (rule 6).
    if (!data?.length) return fail("Only an administrator or an accountant can change the kinds of student.");
    revalidatePath("/fees/setup");
    return { ok: true, data: { id: data[0].id } };
  }

  // The code is derived from the name; two names that derive the same code
  // (two Hindi names both leave "t_type") get a number.
  const base = studentTypeCode(name);
  const { data: taken } = await supabase.from("student_types").select("code").like("code", `${base}%`);
  const used = new Set((taken ?? []).map((t) => t.code));
  let code = base;
  for (let i = 2; used.has(code); i++) code = `${base.slice(0, 36)}_${i}`;

  const { data, error } = await supabase
    .from("student_types")
    .insert({ tenant_id: ctx.tenantId, code, name, description })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501") return fail("Only an administrator or an accountant can add a kind of student.");
    if (error.code === "23505") return fail(`There is already a kind of student called something very like "${name}".`);
    return fail(error.message);
  }
  revalidatePath("/fees/setup");
  return { ok: true, data: { id: data.id } };
}

export async function deleteStudentType(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("student_types").delete().eq("id", id).select("id");
  if (error) {
    // on delete restrict, from a fee or a student still using it.
    if (error.code === "23503") {
      return fail("This kind of student still has fees or students attached. Switch it off instead: it then cannot be given to anybody new, and nothing already set changes.");
    }
    return fail(error.message);
  }
  if (!data?.length) return fail("Only an administrator or an accountant can remove a kind of student.");
  revalidatePath("/fees/setup");
  return { ok: true, data: undefined };
}

export type TypedStudent = {
  studentId: string;
  name: string;
  admissionNumber: string;
  classLabel: string | null;
  studentTypeId: string;
};

/** Who is which kind of student this year. Finance roles only, by policy. */
export async function listTypedStudents(): Promise<TypedStudent[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();

  const { data: assigned, error } = await supabase
    .from("student_type_assignments")
    .select("student_id, student_type_id")
    .eq("session_id", ctx.currentSessionId);
  if (error) throw new Error(error.message);
  if (!assigned?.length) return [];

  const ids = assigned.map((a) => a.student_id);
  const [studentsRes, enrolRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", ids),
    supabase
      .from("enrolments")
      .select("student_id, sections ( name, class_levels ( name ) )")
      .eq("session_id", ctx.currentSessionId)
      .in("student_id", ids),
  ]);
  const student = new Map((studentsRes.data ?? []).map((s) => [s.id, s]));
  const klass = new Map(
    (enrolRes.data ?? []).map((e) => [
      e.student_id,
      e.sections
        ? e.sections.class_levels
          ? `${e.sections.class_levels.name} · ${e.sections.name}`
          : e.sections.name
        : null,
    ]),
  );

  return assigned
    .map((a) => {
      const s = student.get(a.student_id);
      return {
        studentId: a.student_id,
        name: s?.people ? `${s.people.first_name} ${s.people.last_name ?? ""}`.trim() : "—",
        admissionNumber: s?.admission_number ?? "",
        classLabel: klass.get(a.student_id) ?? null,
        studentTypeId: a.student_type_id,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.admissionNumber.localeCompare(b.admissionNumber));
}

/** Null takes the type away: the student pays regular fees again. */
export async function assignStudentType(
  studentId: string,
  studentTypeId: string | null,
): Promise<ActionResult<{ type: string | null; changed: boolean }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_type_assign", {
    p_student_id: studentId,
    p_student_type_id: studentTypeId,
  });
  if (error) return fail(error.message);
  const result = (data ?? {}) as { type?: string | null; changed?: boolean };

  revalidatePath("/fees/setup");
  revalidatePath(`/students/${studentId}`);
  return { ok: true, data: { type: result.type ?? null, changed: result.changed === true } };
}

export async function searchStudentsForType(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", {
    p_query: needle,
    p_limit: 20,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    admissionNumber: s.admission_number,
    name: s.full_name,
    status: s.status,
  }));
}

const CLASS_LIMIT = 200;

export type ClassStudent = { id: string; name: string; admissionNumber: string };

/**
 * One class's roll this year, for giving several children a kind at once. A
 * class is bounded by the size of a class; the cap says so rather than
 * trusting it.
 */
export async function listClassForType(sectionId: string): Promise<ClassStudent[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId || !/^[0-9a-f-]{36}$/i.test(sectionId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrolments")
    .select("student_id, students ( admission_number, people:person_id ( first_name, last_name ) )")
    .eq("session_id", ctx.currentSessionId)
    .eq("section_id", sectionId)
    .eq("status", "active")
    .limit(CLASS_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((e) => ({
      id: e.student_id,
      name: e.students?.people
        ? `${e.students.people.first_name} ${e.students.people.last_name ?? ""}`.trim()
        : "—",
      admissionNumber: e.students?.admission_number ?? "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.admissionNumber.localeCompare(b.admissionNumber));
}


/**
 * Give several children one kind (or make them regular, with null). Each goes
 * through `student_type_assign`, the one write path, so a bulk change cannot
 * disagree with a single one; a child it refuses keeps its reason and the rest
 * carry on (rule 13: apply partially and say why).
 */
export async function assignStudentTypeToMany(
  studentIds: string[],
  studentTypeId: string | null,
): Promise<ActionResult<{ changed: number; unchanged: number; failed: string[] }>> {
  const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!ids.length) return fail("Tick at least one student.");
  if (ids.length > CLASS_LIMIT) return fail(`At most ${CLASS_LIMIT} students at a time.`);

  const supabase = await createClient();
  let changed = 0;
  let unchanged = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const { data, error } = await supabase.rpc("student_type_assign", {
      p_student_id: id,
      p_student_type_id: studentTypeId,
    });
    if (error) {
      failed.push(error.message);
      // The first refusal about the caller's role is every refusal: stop there.
      if (error.code === "42501") break;
      continue;
    }
    if ((data as { changed?: boolean } | null)?.changed) changed += 1;
    else unchanged += 1;
  }
  revalidatePath("/fees/setup");
  return { ok: true, data: { changed, unchanged, failed } };
}
