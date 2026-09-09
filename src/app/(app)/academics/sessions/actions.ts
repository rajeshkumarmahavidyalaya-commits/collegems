"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { academicSessionSchema } from "@/lib/validations/academics";
import type { ActionResult } from "../../library/actions";

export type AcademicYear = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  hasStarted: boolean;
  hasEnded: boolean;
  enrolments: number;
  sections: number;
};

/**
 * Every academic year this school has, newest first.
 *
 * `has_started` and `has_ended` are computed in Postgres rather than compared
 * against `new Date()` here, for the reason rule 11 gives about
 * `report_day_bounds`: Vercel runs in UTC and the school does not, so "has this
 * year ended" answered in Node is answered in the wrong timezone for several
 * hours a day.
 */
export async function listAcademicYears(): Promise<AcademicYear[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academics_sessions");
  if (error) throw new Error(error.message);

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.start_date,
    endDate: s.end_date,
    isCurrent: s.is_current,
    hasStarted: s.has_started,
    hasEnded: s.has_ended,
    enrolments: s.enrolments,
    sections: s.sections,
  }));
}

export async function createAcademicYear(
  input: unknown,
  makeCurrent: boolean,
): Promise<ActionResult<{ id: string }>> {
  const parsed = academicSessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("academics_session_create", {
    p_name: parsed.data.name,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
    p_make_current: makeCurrent,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/academics/sessions");
  revalidatePath("/checks");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

export async function updateAcademicYear(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = academicSessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("academics_session_update", {
    p_session_id: id,
    p_name: parsed.data.name,
    p_start_date: parsed.data.startDate,
    p_end_date: parsed.data.endDate,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/academics/sessions");
  revalidatePath("/checks");
  return { ok: true, data: { id } };
}

/**
 * Moving the flag.
 *
 * This is the write the whole product was missing: `current_session_id()` reads
 * `is_current`, everything dates a row today and stamps it with whatever that
 * flag says, and until now nothing in the application could move it. Every path
 * touched by the change is revalidated because the answer to "what year is it"
 * is on most screens.
 */
export async function activateAcademicYear(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("academics_session_activate", { p_session_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}
