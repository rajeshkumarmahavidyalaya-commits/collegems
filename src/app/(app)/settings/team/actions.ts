"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inviteSchema, SUBJECT_PROMPT, type RoleSubject } from "@/lib/validations/platform";
import type { RoleTier } from "@/lib/auth/context";
import type { ActionResult } from "../../library/actions";

export type InvitationRow = {
  id: string;
  email: string;
  roleCode: string;
  roleName: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export type RoleOption = {
  id: string;
  code: string;
  name: string;
  tier: RoleTier;
  /**
   * Which record a login with this role stands for (migration `0224`).
   *
   * The tier groups the picker; the subject decides whether there is a second
   * question to ask. They are different: `parent` and `student` are both the
   * `student` tier and need a guardian and a student respectively.
   */
  subject: RoleSubject;
};

export type InviteCandidate = {
  id: string;
  label: string;
  hint: string | null;
  hasLogin: boolean;
};

/**
 * The pending and recent invitations for this school.
 *
 * No `hasPermission` and no `where tenant_id =`: `invitations` has carried an
 * "admins manage invitations" policy since migration 0005, so RLS is the gate
 * and a non-admin reading this gets an empty list rather than somebody else's
 * staff. That policy is why this module needed a screen and not a migration.
 */
export async function listInvitations(): Promise<InvitationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, status, created_at, expires_at, accepted_at, roles ( code, name )")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  return data.map((r) => {
    const role = r.roles as unknown as { code: string; name: string } | null;
    return {
      id: r.id as string,
      email: r.email as string,
      roleCode: role?.code ?? "",
      roleName: role?.name ?? "",
      status: r.status as string,
      createdAt: r.created_at as string,
      expiresAt: r.expires_at as string,
      acceptedAt: (r.accepted_at as string | null) ?? null,
    };
  });
}

/**
 * The roles somebody can be invited as, carrying the tier they belong to.
 *
 * The tier is here for one reason: to group the picker. "Which role?" is a list
 * of six flat names, and "who is this login for?" is the question the person
 * inviting is actually answering — a professor, somebody in the office, a
 * student, or another principal.
 *
 * It groups the choice and nothing else. What each role may do is still
 * `role_permissions`, editable per college, and a librarian invited here still
 * cannot take fees.
 */
export async function listRoles(): Promise<RoleOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("id, code, name, tier, subject").order("code");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    tier: (r.tier as RoleTier | null) ?? "staff",
    subject: (r.subject as RoleSubject | null) ?? "none",
  }));
}

/**
 * Who an invitation of this kind can be for.
 *
 * One RPC (`invite_candidates`, migration `0224`): INVOKER so RLS decides, and
 * gated on `users.manage` inside besides — reading `people` is tenant-wide for
 * every staff role, so the policy alone would let a librarian enumerate the
 * roll through a picker. Bounded at twenty and ordered in SQL.
 */
export async function inviteCandidates(
  subject: string,
  query: string,
): Promise<InviteCandidate[]> {
  if (subject === "none") return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_candidates", {
    p_subject: subject,
    p_query: query,
  });
  if (error) return [];

  return (data ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    hint: c.hint,
    hasLogin: c.has_login,
  }));
}

/**
 * Invite somebody.
 *
 * The row is the whole mechanism: `handle_new_auth_user` resolves it by email
 * on signup and stamps the tenant and role into the JWT. So this action writes
 * one row and stops — there is no account to create here, and creating one
 * would mean holding somebody else's password.
 */
export async function invite(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();

  const { data: ctx } = await supabase.rpc("current_tenant_id");
  if (!ctx) return { ok: false, error: "You do not belong to a school." };

  // Which record this role stands for, read from the database rather than
  // inferred from its code — a college may have roles this product did not
  // ship. The CHECK is still the boundary; asking first is what turns a
  // `23514` into a sentence about the person who was not chosen.
  const { data: role } = await supabase
    .from("roles")
    .select("subject, name")
    .eq("id", parsed.data.roleId)
    .maybeSingle();

  if (!role) return { ok: false, error: "That role does not belong to this school." };

  const subject = (role.subject as RoleSubject | null) ?? "none";
  if (subject !== "none" && !parsed.data.subjectId) {
    return {
      ok: false,
      error: SUBJECT_PROMPT[subject],
      fieldErrors: { subjectId: ["Choose who this login is for"] },
    };
  }

  // A second pending invitation to the same address is not an error worth
  // showing a person — it is the same intent, expressed twice, usually because
  // the first mail went astray. Supersede rather than refuse.
  await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("email", parsed.data.email)
    .eq("status", "pending");

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      tenant_id: ctx as string,
      email: parsed.data.email,
      role_id: parsed.data.roleId,
      // The role decides the column. `role_subject` is deliberately not sent:
      // a trigger fills it from the role (migration `0225`), so no caller has
      // to know the carried column exists.
      staff_id: subject === "staff" ? parsed.data.subjectId : null,
      student_id: subject === "student" ? parsed.data.subjectId : null,
      guardian_id: subject === "guardian" ? parsed.data.subjectId : null,
    })
    .select("id")
    .single();

  if (error) {
    // The seat limit raises a sentence with the numbers in it; show it as
    // written rather than flattening it to "could not invite".
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings/team");
  return { ok: true, data: { id: data.id as string } };
}

/**
 * Withdraw an invitation that has not been accepted.
 *
 * `revoked`, not deleted — the same instinct rule 12 applies to a concession
 * and a bus seat. That somebody was invited on a date and the offer was pulled
 * is a fact about the school, and the audit log has it either way.
 */
export async function revokeInvitation(id: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/team");
  return { ok: true, data: null };
}
