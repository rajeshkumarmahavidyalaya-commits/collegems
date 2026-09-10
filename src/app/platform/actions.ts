"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The platform operator's read and write paths.
 *
 * Every one of these is a thin call to a `SECURITY DEFINER` function that
 * checks `platform.require_operator()` itself and writes an access-log row
 * before it answers. **Nothing here is the gate** — this file could be called
 * by a college principal, a student, or a stranger with a valid session, and
 * they would each get the same refusal from Postgres.
 *
 * That is the point of the design rather than an accident of it: an operator
 * belongs to no tenant, so `current_tenant_id()` is null for them and every RLS
 * policy in `public` already refuses them every row. Probed: a signed-in
 * operator reads **0** students, **0** people, **0** ledger entries and **0**
 * subscriptions. Their whole reach is these functions.
 */

export type College = {
  tenantId: string;
  name: string;
  slug: string;
  timezone: string;
  createdAt: string;
  planCode: string | null;
  planStatus: string | null;
  trialEndsOn: string | null;
  students: number;
  staff: number;
  logins: number;
  studentLimit: number | null;
  staffLimit: number | null;
  overLimit: boolean;
  lastActivity: string | null;
};

/** Null when the caller is not an operator — the page renders a refusal, not an empty list. */
export async function listColleges(): Promise<College[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_colleges");

  // The function raises `insufficient_privilege` with a deliberately flat
  // message. Distinguishing "not an operator" from "no colleges" matters to the
  // screen — one is a refusal and the other is an empty product — so the null
  // carries that difference rather than collapsing to [].
  if (error) return null;

  return (data ?? []).map((r) => ({
    tenantId: r.tenant_id as string,
    name: r.name as string,
    slug: r.slug as string,
    timezone: r.timezone as string,
    createdAt: r.created_at as string,
    planCode: (r.plan_code as string | null) ?? null,
    planStatus: (r.plan_status as string | null) ?? null,
    trialEndsOn: (r.trial_ends_on as string | null) ?? null,
    students: Number(r.students ?? 0),
    staff: Number(r.staff ?? 0),
    logins: Number(r.logins ?? 0),
    studentLimit: r.student_limit === null ? null : Number(r.student_limit),
    staffLimit: r.staff_limit === null ? null : Number(r.staff_limit),
    overLimit: Boolean(r.over_limit),
    lastActivity: (r.last_activity as string | null) ?? null,
  }));
}

export type SetPlanResult = { ok: true; from: string; to: string } | { ok: false; error: string };

/**
 * Move a college between plans — the other half of what `/settings/plan`
 * promises when it tells a college that changing is not self-serve yet.
 *
 * Logged before it acts, so an attempt that then fails still leaves a record
 * that somebody tried.
 */
export async function setPlan(
  tenantId: string,
  planCode: string,
  status: string,
): Promise<SetPlanResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_set_plan", {
    p_tenant_id: tenantId,
    p_plan_code: planCode,
    p_status: status,
  });

  if (error) return { ok: false, error: error.message };

  const result = data as { from?: { plan?: string }; to?: { plan?: string } } | null;
  revalidatePath("/platform");
  return {
    ok: true,
    from: result?.from?.plan ?? "?",
    to: result?.to?.plan ?? planCode,
  };
}
