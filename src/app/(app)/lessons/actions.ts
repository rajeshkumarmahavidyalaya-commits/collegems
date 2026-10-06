"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";

/**
 * The reference's Lessons: study material placed in a chapter of a class's
 * syllabus (0347). Read through the study material policies, so a family sees
 * the published lessons of their own child's class and staff see the rest.
 * "Now", not "ever": this year's lessons (rule 2).
 */

export type LessonRow = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sectionLabel: string;
  subjectId: string | null;
  subjectName: string;
  chapterTitle: string;
  chapterPosition: number;
  externalUrl: string | null;
  hasFile: boolean;
  isPublished: boolean;
  createdAt: string;
};

export type Chapter = { id: string; title: string; classLevelId: string; subjectId: string; position: number };

export async function listLessons(): Promise<LessonRow[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_material")
    .select("id, title, description, kind, section_id, subject_id, unit_id, external_url, storage_path, is_published, created_at")
    .eq("session_id", ctx.currentSessionId)
    .not("unit_id", "is", null)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const unitIds = [...new Set(rows.map((r) => r.unit_id).filter((v): v is string => !!v))];
  const sectionIds = [...new Set(rows.map((r) => r.section_id).filter((v): v is string => !!v))];
  const [units, sections, subjects] = await Promise.all([
    unitIds.length ? supabase.from("syllabus_units").select("id, title, position").in("id", unitIds) : Promise.resolve({ data: [] }),
    sectionIds.length ? supabase.from("sections").select("id, name, class_levels ( name )").in("id", sectionIds) : Promise.resolve({ data: [] }),
    supabase.from("subjects").select("id, name"),
  ]);
  const unitOf = new Map(((units.data ?? []) as { id: string; title: string; position: number }[]).map((u) => [u.id, u]));
  const sectionOf = new Map(
    ((sections.data ?? []) as { id: string; name: string; class_levels: { name: string } | null }[]).map((s) => [
      s.id,
      s.class_levels ? `${s.class_levels.name} · ${s.name}` : s.name,
    ]),
  );
  const subjectOf = new Map((subjects.data ?? []).map((s) => [s.id, s.name]));
  return rows.map((r) => {
    const unit = r.unit_id ? unitOf.get(r.unit_id) : undefined;
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      kind: r.kind,
      sectionLabel: r.section_id ? (sectionOf.get(r.section_id) ?? "—") : "—",
      subjectId: r.subject_id,
      subjectName: r.subject_id ? (subjectOf.get(r.subject_id) ?? "—") : "—",
      // A chapter the caller cannot read (another class's syllabus) has no
      // title to show; the lesson itself was readable, so it stays.
      chapterTitle: unit?.title ?? "—",
      chapterPosition: unit?.position ?? 0,
      externalUrl: r.external_url,
      hasFile: !!r.storage_path,
      isPublished: r.is_published,
      createdAt: r.created_at,
    };
  });
}

/** This year's chapters, for the lesson form's chapter picker. */
export async function listChapters(): Promise<Chapter[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("syllabus_units")
    .select("id, title, class_level_id, subject_id, position")
    .eq("session_id", ctx.currentSessionId)
    .order("position")
    .order("id")
    .limit(2000);
  return (data ?? []).map((u) => ({
    id: u.id,
    title: u.title,
    classLevelId: u.class_level_id,
    subjectId: u.subject_id,
    position: u.position,
  }));
}
