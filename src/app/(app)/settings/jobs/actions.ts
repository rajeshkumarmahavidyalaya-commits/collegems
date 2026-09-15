"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type JobRow = {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  progressDone: number;
  progressNote: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
};

export type JobKind = { key: string; label: string; description: string };

/**
 * The college's background work.
 *
 * **No permission check here, and that is the rule rather than an omission.**
 * `jobs` carries a row-scoped SELECT policy since `0007` — an administrator
 * sees the college's jobs, everybody else sees the ones they started — so a
 * second answer in this action would be a second place to get it wrong. The
 * *queueing* is gated, by a trigger, because that is a write.
 */
export async function listJobs(limit = 25): Promise<JobRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, job_type, status, progress_done, progress_note, error, attempts, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  // `reference.job_kinds` is outside `public`, so PostgREST cannot reach it —
  // the same as `reference.reports`. Names come through a function.
  const { data: kinds } = await supabase.rpc("job_kind_labels");
  const labels = new Map((kinds ?? []).map((k) => [k.key, k.label]));

  return (data ?? []).map((j) => ({
    id: j.id,
    kind: j.job_type,
    // Falls back to the raw key rather than to a blank: a kind retired from the
    // catalogue still has rows in the register, and "" is not a name.
    kindLabel: labels.get(j.job_type) ?? j.job_type,
    status: j.status,
    progressDone: j.progress_done ?? 0,
    progressNote: j.progress_note,
    error: j.error,
    attempts: j.attempts ?? 0,
    createdAt: j.created_at,
    completedAt: j.completed_at,
  }));
}

/**
 * What this person could start.
 *
 * `job_kinds_available()` filters by the caller's own permission matrix, so the
 * picker offers exactly what `job_enqueue` would accept — `report_list()`'s
 * shape, and the reason is the one this codebase keeps relearning: *a control
 * that will refuse you is worse than no control.*
 */
export async function listJobKinds(): Promise<JobKind[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("job_kinds_available");
  return (data ?? []).map((k) => ({ key: k.key, label: k.label, description: k.description }));
}

/**
 * Start one.
 *
 * The refusals a person can actually meet here — no permission, an unknown
 * kind, one already running — are all raised by Postgres with a sentence
 * written for a reader, so this passes the message through rather than
 * inventing its own. See `0242`.
 */
export async function startJob(kind: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_enqueue", { p_kind: kind });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/jobs");
  revalidatePath("/accounts");
  return { ok: true, data: { id: (data as unknown as { id: string }).id } };
}

export async function stopJob(id: string): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("job_cancel", { p_job_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/jobs");
  return { ok: true, data: { id } };
}
