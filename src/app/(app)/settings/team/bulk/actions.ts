"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../../../library/actions";

/**
 * Inviting a school rather than a person.
 *
 * `0224` made an invitation able to name a person and `0227` made it arrive.
 * Both work on **one** invitation, and the demo college has 555 guardians of
 * 302 children, none of whom can sign in. An office asked to do that through a
 * search box 555 times will not do it — which leaves the family half of this
 * product unreachable in practice, however correct each single invitation is.
 *
 * Rule 13's third instance after promotion and renewals: a preview that
 * materialises as rows a person can edit, applied through the module's own
 * write function.
 */

export type DecisionRow = {
  id: string;
  fullName: string;
  email: string | null;
  decision: "invite" | "skip";
  reason: string | null;
  isOverride: boolean;
  applied: boolean;
  error: string | null;
};

export type RunView = {
  id: string;
  roleId: string;
  roleName: string;
  sectionLabel: string | null;
  status: string;
  rows: DecisionRow[];
};

/** The live draft, if there is one. Rule 13 allows exactly one at a time. */
export async function getDraftRun(): Promise<RunView | null> {
  const supabase = await createClient();
  const { data: run } = await supabase
    .from("invitation_runs")
    .select("id, role_id, status, roles ( name ), sections ( name, class_levels ( name ) )")
    .eq("status", "draft")
    .maybeSingle();

  if (!run) return null;

  const { data: rows } = await supabase
    .from("invitation_decisions")
    .select("id, full_name, email, decision, reason, is_override, applied_invitation_id, error")
    .eq("run_id", run.id)
    .order("decision")
    .order("full_name");

  const section = run.sections as unknown as
    | { name: string; class_levels: { name: string } | null }
    | null;

  return {
    id: run.id,
    roleId: run.role_id,
    roleName: (run.roles as unknown as { name: string } | null)?.name ?? "",
    sectionLabel: section ? `${section.class_levels?.name ?? ""} · ${section.name}`.trim() : null,
    status: run.status,
    rows: (rows ?? []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      decision: r.decision as "invite" | "skip",
      reason: r.reason,
      isOverride: r.is_override,
      applied: r.applied_invitation_id !== null,
      error: r.error,
    })),
  };
}

export async function buildList(
  roleId: string,
  sectionId: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_preview", {
    p_role_id: roleId,
    p_section_id: sectionId || undefined,
  });

  // Every refusal this function raises is already a sentence — the one-live-run
  // rule, the oversize cap with its numbers, a role that stands for nobody — so
  // they are shown as written rather than flattened to "could not build a list".
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/team/bulk");
  return { ok: true, data: { id: (data as { id: string }).id } };
}

/**
 * Editing a row.
 *
 * `is_override` is the difference between *"the rules decided"* and *"the
 * office decided"*, and both belong in the audit log — rule 13's second
 * device. It is set here rather than in the database because only this layer
 * knows a person did it: `invitation_preview` writes the same columns.
 */
export async function editDecision(
  id: string,
  patch: { email?: string; decision?: "invite" | "skip"; reason?: string },
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitation_decisions")
    .update({
      ...(patch.email !== undefined ? { email: patch.email.trim() || null } : {}),
      ...(patch.decision !== undefined ? { decision: patch.decision } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason.trim() || null } : {}),
      is_override: true,
    })
    .eq("id", id);

  // `invitation_decisions_target_chk` refuses an invite with no address and a
  // skip with no reason. Both are worth saying in words rather than as 23514.
  if (error) {
    if (error.code === "23514") {
      return {
        ok: false,
        error:
          patch.decision === "skip"
            ? "Say why this person is being left out — the list is read by somebody who will ask."
            : "An invitation needs an email address.",
      };
    }
    if (error.code === "23505") {
      return { ok: false, error: "Another row in this list already uses that address." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings/team/bulk");
  return { ok: true, data: null };
}

export async function discardList(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitation_runs")
    .update({ status: "discarded" })
    .eq("id", id)
    .eq("status", "draft");

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team/bulk");
  return { ok: true, data: null };
}

/**
 * Where this deployment lives, for the link in the emails.
 *
 * The same reasoning as the single-invitation path: Postgres does not know this
 * app's address, and returning null rather than guessing is deliberate —
 * `invitation_announce` refuses anything that is not an `http(s)` URL, and an
 * email containing `undefined/signup` is worse than none.
 */
async function signupUrl(): Promise<string | null> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin?.startsWith("http")) return origin;

  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type ApplyResult = {
  invited: number;
  failed: number;
  emailed: number;
  texted: number;
  smsParts: number;
};

export async function applyList(id: string): Promise<ActionResult<ApplyResult>> {
  const url = await signupUrl();
  if (!url) {
    return {
      ok: false,
      error: "Could not work out this site's web address to put in the messages.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invitation_apply", {
    p_run_id: id,
    p_signup_url: url,
  });
  if (error) return { ok: false, error: error.message };

  const raw = (
    data as {
      invited: number;
      failed: number;
      emailed: number;
      texted: number;
      sms_parts: number;
    }[]
  )[0];
  // `sms_parts` beside `texted` rather than inferred from it: a school is
  // billed per part, and 555 texts is 555 parts only while every one of them
  // fits in a segment. Migration 0233 measured that it does, today, for every
  // one of this college's 555 guardians — which is a fact about their names
  // and addresses, not a guarantee.
  const row: ApplyResult = {
    invited: raw?.invited ?? 0,
    failed: raw?.failed ?? 0,
    emailed: raw?.emailed ?? 0,
    texted: raw?.texted ?? 0,
    smsParts: raw?.sms_parts ?? 0,
  };

  revalidatePath("/settings/team/bulk");
  revalidatePath("/settings/team");
  return { ok: true, data: row };
}
