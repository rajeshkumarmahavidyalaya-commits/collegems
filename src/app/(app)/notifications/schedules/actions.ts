"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { paramsFor, scheduleSchema } from "@/lib/validations/schedules";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type ScheduleRow = {
  id: string;
  kind: string;
  name: string;
  params: Record<string, unknown>;
  runAt: string;
  weekdays: number[];
  dayOfMonth: number | null;
  graceMinutes: number;
  channels: string[] | null;
  isEnabled: boolean;
};

export type RunRow = {
  id: string;
  scheduleId: string;
  occurrenceAt: string;
  status: string;
  matched: number;
  notified: number;
  note: string | null;
};

export type ScheduleProblem = { scheduleId: string; severity: string; message: string };

export async function listSchedules(): Promise<ScheduleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("schedules")
    .select("id, kind, name, params, run_at, weekdays, day_of_month, grace_minutes, channels, is_enabled")
    .order("name");

  return (data ?? []).map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    params: (s.params ?? {}) as Record<string, unknown>,
    runAt: s.run_at,
    weekdays: s.weekdays ?? [],
    dayOfMonth: s.day_of_month,
    graceMinutes: s.grace_minutes,
    channels: s.channels,
    isEnabled: s.is_enabled,
  }));
}

/** The last few occurrences of each schedule — the register, in miniature. */
export async function listRecentRuns(limit = 40): Promise<RunRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("schedule_runs")
    .select("id, schedule_id, occurrence_at, status, matched, notified, note")
    .order("occurrence_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => ({
    id: r.id,
    scheduleId: r.schedule_id,
    occurrenceAt: r.occurrence_at,
    status: r.status,
    matched: r.matched,
    notified: r.notified,
    note: r.note,
  }));
}

/**
 * The critic's sentences.
 *
 * Not a health check the page computes: a schedule that runs is not a schedule
 * that works, and whether anybody is hearing it depends on channel settings and
 * provider credentials that only the database knows about.
 */
export async function listScheduleProblems(): Promise<ScheduleProblem[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("schedule_problems");
  return (data ?? []).map((p) => ({
    scheduleId: p.schedule_id,
    severity: p.severity,
    message: p.message,
  }));
}

export async function saveSchedule(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const row = {
    kind: parsed.data.kind,
    name: parsed.data.name,
    params: paramsFor(parsed.data),
    run_at: `${parsed.data.runAt}:00`,
    weekdays: parsed.data.weekdays,
    day_of_month: parsed.data.dayOfMonth,
    grace_minutes: parsed.data.graceMinutes,
    is_enabled: parsed.data.isEnabled,
  };

  if (parsed.data.id) {
    const { error } = await supabase.from("schedules").update(row).eq("id", parsed.data.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/notifications/schedules");
    return { ok: true, data: { id: parsed.data.id } };
  }

  // The tenant is written explicitly and RLS checks it again. Redundant on
  // purpose: the policy is the boundary, and this is what makes the insert
  // legible to somebody reading the action.
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Sign in again." };

  const { data, error } = await supabase
    .from("schedules")
    .insert({ ...row, tenant_id: ctx.tenantId })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notifications/schedules");
  return { ok: true, data: { id: data.id } };
}

/**
 * The switch, on its own action.
 *
 * Turning one on is the whole decision this module asks a school to make, so it
 * is one click rather than a form — and turning one on never backfills, which
 * the screen says beside it.
 */
export async function setScheduleEnabled(
  id: string,
  enabled: boolean,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { error } = await supabase.from("schedules").update({ is_enabled: enabled }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notifications/schedules");
  return { ok: true, data: { id } };
}

export async function deleteSchedule(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notifications/schedules");
  return { ok: true, data: { id } };
}
