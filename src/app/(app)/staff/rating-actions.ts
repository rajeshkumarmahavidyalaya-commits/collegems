"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../library/actions";

/*
 * Staff ratings (0344): the reference's "Staff Rating". A student rates the
 * teacher of each subject they are taught through `staff_rate`, which decides
 * whom the rating is about; the administrator reads the summary and the
 * sentences behind it, and may take one down. A teacher reads none.
 */

export type RatingSummaryRow = {
  key: string;
  sectionId: string;
  subjectId: string;
  staffId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  teacherName: string | null;
  ratings: number;
  withFeedback: number;
  average: number;
};

export async function listRatingSummary(): Promise<RatingSummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_rating_summary");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    key: `${r.section_id}:${r.subject_id}:${r.staff_id}`,
    sectionId: r.section_id,
    subjectId: r.subject_id,
    staffId: r.staff_id,
    className: r.class_name,
    sectionName: r.section_name,
    subjectName: r.subject_name,
    teacherName: r.teacher_name,
    ratings: Number(r.ratings),
    withFeedback: Number(r.with_feedback),
    average: Number(r.average_rating),
  }));
}

export type RatingFeedbackRow = {
  id: string;
  rating: number;
  feedback: string | null;
  studentName: string;
  at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ratings behind one row of the summary: this year's, by policy the administrator's alone. */
export async function listRatingFeedback(sectionId: string, subjectId: string, staffId: string): Promise<RatingFeedbackRow[]> {
  if (![sectionId, subjectId, staffId].every((v) => UUID.test(v))) return [];
  const supabase = await createClient();
  const { data: session } = await supabase.from("academic_sessions").select("id").eq("is_current", true).maybeSingle();
  if (!session) return [];
  const { data, error } = await supabase
    .from("staff_ratings")
    .select("id, rating, feedback, student_id, updated_at")
    .eq("session_id", session.id)
    .eq("section_id", sectionId)
    .eq("subject_id", subjectId)
    .eq("staff_id", staffId)
    .order("updated_at", { ascending: false })
    .order("id");
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map((r) => r.student_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: students } = await supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", ids);
    for (const s of students ?? []) {
      names.set(s.id, s.people ? `${s.people.first_name} ${s.people.last_name}` : s.admission_number);
    }
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    rating: r.rating,
    feedback: r.feedback,
    studentName: names.get(r.student_id) ?? "—",
    at: r.updated_at,
  }));
}

/** Take an abusive rating down. Nobody edits a rating. */
export async function removeRating(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("staff_ratings").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only an administrator can take a rating down." };
  revalidatePath("/staff/ratings");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// A student's own teachers

export type MyTeacherRow = {
  sectionSubjectId: string;
  subjectName: string;
  teacherName: string | null;
  rating: number | null;
  feedback: string | null;
  ratedAt: string | null;
};

export async function listMyTeachers(): Promise<MyTeacherRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_rating_my_teachers");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    sectionSubjectId: r.section_subject_id,
    subjectName: r.subject_name,
    teacherName: r.teacher_name,
    rating: r.rating,
    feedback: r.feedback,
    ratedAt: r.rated_at,
  }));
}

export async function rateTeacher(sectionSubjectId: string, rating: number, feedback: string): Promise<ActionResult> {
  if (!UUID.test(sectionSubjectId)) return { ok: false, error: "That subject cannot be found." };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Choose a rating from 1 to 5.", fieldErrors: { rating: ["From 1 to 5"] } };
  }
  if ((feedback ?? "").trim().length > 1000) {
    return { ok: false, error: "Feedback is at most 1,000 characters.", fieldErrors: { feedback: ["At most 1,000 characters"] } };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_rate", {
    p_section_subject_id: sectionSubjectId,
    p_rating: rating,
    p_feedback: (feedback ?? "").trim(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/staff/ratings");
  return { ok: true, data: undefined };
}
