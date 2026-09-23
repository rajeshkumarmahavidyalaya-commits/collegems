"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cancelSchema, providerName, scheduleSchema } from "@/lib/validations/live-classes";
import type { ActionResult } from "../library/actions";

export type Lesson = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  provider: string;
  joinUrl: string;
  status: string;
  cancelReason: string | null;
  sectionLabel: string;
  subjectName: string;
  teacherName: string | null;
  timezone: string;
  canManage: boolean;
};

export type Course = { value: string; label: string; sessionName: string; teacherName: string | null };

const DAY = 24 * 60 * 60 * 1000;

/**
 * The last week and the next two, as the caller may see them.
 *
 * A window of **dates**, not the current session: *"what is on this week"* is
 * a question about the calendar, and the demo college's session flag still
 * points at a year that ended in March (rule 2). The instants are computed
 * here and compared in Postgres, so no timezone is involved in choosing rows --
 * only in showing them, which the page does where the college is.
 */
export async function listLessons(): Promise<Lesson[]> {
  const supabase = await createClient();
  const now = Date.now();
  const { data, error } = await supabase.rpc("live_classes_between", {
    p_from: new Date(now - 7 * DAY).toISOString(),
    p_to: new Date(now + 14 * DAY).toISOString(),
  });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    provider: r.provider,
    joinUrl: r.join_url,
    status: r.status,
    cancelReason: r.cancel_reason,
    sectionLabel: r.section_label,
    subjectName: r.subject_name,
    teacherName: r.teacher_name,
    timezone: r.timezone,
    canManage: r.can_manage,
  }));
}

/** What the caller may schedule for: every year not yet over (migration 0272). */
export async function listCourses(): Promise<Course[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("live_class_courses");
  if (error || !data) return [];
  return data.map((c) => ({
    value: `${c.section_id}:${c.subject_id}`,
    label: c.label.replace(" -- ", " · "),
    sessionName: c.session_name,
    teacherName: c.teacher_name,
  }));
}

export async function scheduleLesson(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const v = parsed.data;
  const [sectionId, subjectId] = v.course.split(":");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("live_class_schedule", {
    p_class: {
      section_id: sectionId,
      subject_id: subjectId,
      title: v.title,
      date: v.date,
      time: v.time,
      minutes: Number(v.minutes),
      provider: v.provider,
      join_url: v.provider === "jitsi" ? null : v.joinUrl,
    },
  });

  if (error) {
    // The two constraints speak Postgres; the person scheduling does not.
    if (error.code === "23P01") {
      return {
        ok: false,
        error: "That class already has a live lesson at that time. Cancel it first, or choose another time.",
      };
    }
    if (error.code === "23514" && error.message.includes("live_classes_url_chk")) {
      return {
        ok: false,
        error: `That is not a ${providerName(v.provider)} meeting link.`,
        fieldErrors: { joinUrl: ["Copy the link from the meeting's invitation."] },
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/live-classes");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function cancelLesson(input: unknown): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("live_class_cancel", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/live-classes");
  return { ok: true, data: undefined };
}
