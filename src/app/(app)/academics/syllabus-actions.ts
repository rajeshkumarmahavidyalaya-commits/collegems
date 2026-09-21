"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/**
 * The syllabus module's server boundary.
 *
 * Reads go straight through the policies; the three writes that are more than
 * one statement — marking, unmarking and reordering — go through their Postgres
 * functions, because a reorder is one act over n rows and marking has a
 * refusal worth reading. The plain unit insert and update are ordinary writes
 * that `academics office writes syllabus_units` decides.
 */

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type CourseRow = {
  classLevelId: string;
  classLevelName: string;
  sequence: number;
  subjectId: string;
  subjectName: string;
  units: number;
  plannedPeriods: number;
};

/**
 * The courses this college teaches this year: one row per (class level,
 * subject), not per section.
 *
 * Built from `section_subjects` and then collapsed, because that table is what
 * says a class studies a subject — and a course with no syllabus has to appear
 * here, since writing one is what this list is for.
 *
 * Bounded by the size of the college: class levels × subjects, 48 here.
 */
export async function listCourses(): Promise<CourseRow[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("section_subjects")
    .select(
      "subject_id, subjects ( name ), sections!inner ( session_id, class_level_id, class_levels ( name, sequence ) )",
    )
    .eq("sections.session_id", ctx.currentSessionId);
  if (error) throw new Error(error.message);

  const { data: units } = await supabase
    .from("syllabus_units")
    .select("class_level_id, subject_id, planned_periods")
    .eq("session_id", ctx.currentSessionId);

  const counted = new Map<string, { units: number; periods: number }>();
  for (const u of units ?? []) {
    const key = `${u.class_level_id}:${u.subject_id}`;
    const at = counted.get(key) ?? { units: 0, periods: 0 };
    at.units += 1;
    at.periods += u.planned_periods;
    counted.set(key, at);
  }

  const seen = new Map<string, CourseRow>();
  for (const row of data ?? []) {
    const section = row.sections as {
      class_level_id: string;
      class_levels: { name: string; sequence: number } | null;
    } | null;
    if (!section) continue;
    const key = `${section.class_level_id}:${row.subject_id}`;
    if (seen.has(key)) continue;
    const tally = counted.get(key) ?? { units: 0, periods: 0 };
    seen.set(key, {
      classLevelId: section.class_level_id,
      classLevelName: section.class_levels?.name ?? "",
      sequence: section.class_levels?.sequence ?? 0,
      subjectId: row.subject_id,
      subjectName: (row.subjects as { name: string } | null)?.name ?? "",
      units: tally.units,
      plannedPeriods: tally.periods,
    });
  }

  return [...seen.values()].sort(
    (a, b) =>
      a.sequence - b.sequence ||
      a.classLevelName.localeCompare(b.classLevelName) ||
      a.subjectName.localeCompare(b.subjectName),
  );
}

export type UnitRow = {
  id: string;
  position: number;
  title: string;
  description: string | null;
  plannedPeriods: number;
};

export async function listUnits(classLevelId: string, subjectId: string): Promise<UnitRow[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("syllabus_units")
    .select("id, position, title, description, planned_periods")
    .eq("session_id", ctx.currentSessionId)
    .eq("class_level_id", classLevelId)
    .eq("subject_id", subjectId)
    .order("position");
  if (error) throw new Error(error.message);

  return (data ?? []).map((u) => ({
    id: u.id,
    position: u.position,
    title: u.title,
    description: u.description,
    plannedPeriods: u.planned_periods,
  }));
}

export type CourseSection = { id: string; name: string; label: string };

/** The classes of one class level that study this year. */
export async function listCourseSections(classLevelId: string): Promise<CourseSection[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sections")
    .select("id, name, class_levels ( name )")
    .eq("session_id", ctx.currentSessionId)
    .eq("class_level_id", classLevelId)
    .order("name");
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    label: `${(s.class_levels as { name: string } | null)?.name ?? ""} · ${s.name}`,
  }));
}

export type CoverageRow = {
  unitId: string;
  position: number;
  title: string;
  description: string | null;
  plannedPeriods: number;
  status: string;
  coveredOn: string | null;
  note: string | null;
  recordedBy: string | null;
};

export async function getCoverage(sectionId: string, subjectId: string): Promise<CoverageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("syllabus_for_section", {
    p_section_id: sectionId,
    p_subject_id: subjectId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    unitId: r.unit_id,
    position: r.unit_position,
    title: r.title,
    description: r.description,
    plannedPeriods: r.planned_periods,
    status: r.status,
    coveredOn: r.covered_on,
    note: r.note,
    recordedBy: r.recorded_by,
  }));
}

export type PaceRow = {
  sectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
  units: number;
  unitsCovered: number;
  periodsPlanned: number;
  periodsCovered: number;
  /** Null where no syllabus exists — a different fact from 0%. */
  shareCovered: number | null;
  shareElapsed: number | null;
  yearState: string;
  lastCoveredOn: string | null;
};

export async function getPace(): Promise<PaceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("syllabus_pace", {});
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    sectionId: r.section_id,
    sectionLabel: r.section_label,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    units: r.units,
    unitsCovered: r.units_covered,
    periodsPlanned: r.periods_planned,
    periodsCovered: r.periods_covered,
    shareCovered: r.share_covered === null ? null : Number(r.share_covered),
    shareElapsed: r.share_elapsed === null ? null : Number(r.share_elapsed),
    yearState: r.year_state,
    lastCoveredOn: r.last_covered_on,
  }));
}

/**
 * How far behind a course has to be before the screen calls it behind.
 *
 * Read from the same setting `syllabus_problems()` reads, so the badge on the
 * list and the sentence on the check page cannot disagree about one college's
 * own threshold. `setting_value` is the only place a default is applied
 * (rule 12), so this passes the value through rather than supplying a second
 * copy of 0.15.
 */
export async function getBehindBy(): Promise<number | undefined> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("setting_value", {
    p_key: "academics.syllabus",
  });
  if (error) return undefined;
  const value = (data as { behind_by?: number } | null)?.behind_by;
  return typeof value === "number" ? value : undefined;
}

export type SyllabusProblem = { severity: string; message: string };

/**
 * Null means "your role may not ask", an array means "here is the answer".
 * The critic refuses rather than returning empty, so the two are different
 * screens and only the server knows which applies.
 */
export async function listSyllabusProblems(): Promise<SyllabusProblem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("syllabus_problems");
  if (error) return null;
  return (data ?? []).map((r) => ({ severity: r.severity, message: r.message }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function saveUnit(
  classLevelId: string,
  subjectId: string,
  input: { id?: string; title: string; description: string; plannedPeriods: number },
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId || !ctx.tenantId) return fail("Sign in again.");

  const title = input.title.trim();
  if (title.length === 0) return fail("Give the unit a title.");
  if (!Number.isInteger(input.plannedPeriods) || input.plannedPeriods < 1) {
    return fail("A unit takes at least one lesson.");
  }

  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from("syllabus_units")
      .update({
        title,
        description: input.description.trim() || null,
        planned_periods: input.plannedPeriods,
      })
      .eq("id", input.id);
    if (error) return fail(error.message);
    revalidatePath("/academics/syllabus");
    return { ok: true, data: { id: input.id } };
  }

  // A new unit goes last. Positions are what a reorder writes, so the only
  // thing a create has to get right is not colliding with an existing one.
  const { data: last } = await supabase
    .from("syllabus_units")
    .select("position")
    .eq("session_id", ctx.currentSessionId)
    .eq("class_level_id", classLevelId)
    .eq("subject_id", subjectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("syllabus_units")
    .insert({
      tenant_id: ctx.tenantId,
      session_id: ctx.currentSessionId,
      class_level_id: classLevelId,
      subject_id: subjectId,
      position: (last?.position ?? 0) + 1,
      title,
      description: input.description.trim() || null,
      planned_periods: input.plannedPeriods,
    })
    .select("id")
    .single();
  if (error) return fail(error.message);

  revalidatePath("/academics/syllabus");
  return { ok: true, data: { id: data.id } };
}

export async function deleteUnit(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  // The progress rows go with it, by the unit foreign key's ON DELETE CASCADE:
  // a unit that is not in the course cannot have been covered.
  const { error } = await supabase.from("syllabus_units").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/academics/syllabus");
  return { ok: true, data: undefined };
}

export async function reorderUnits(unitIds: string[]): Promise<ActionResult<{ reordered: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("syllabus_reorder", { p_unit_ids: unitIds });
  if (error) return fail(error.message);
  revalidatePath("/academics/syllabus");
  return { ok: true, data: { reordered: (data as { reordered: number }).reordered } };
}

export async function markUnit(
  unitId: string,
  sectionId: string,
  status: "in_progress" | "covered",
  coveredOn?: string,
  note?: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("syllabus_mark", {
    p_unit_id: unitId,
    p_section_id: sectionId,
    p_status: status,
    p_covered_on: coveredOn || undefined,
    p_note: note || undefined,
  });
  // The sentence comes from the function that refused, and it names the
  // subject and the class. Replacing it here would throw away the only part
  // that says what to do next.
  if (error) return fail(error.message);
  revalidatePath("/academics/syllabus");
  return { ok: true, data: undefined };
}

export async function unmarkUnit(unitId: string, sectionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("syllabus_unmark", {
    p_unit_id: unitId,
    p_section_id: sectionId,
  });
  if (error) return fail(error.message);
  revalidatePath("/academics/syllabus");
  return { ok: true, data: undefined };
}
