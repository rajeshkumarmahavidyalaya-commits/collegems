"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inviteSchema } from "@/lib/validations/platform";
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

export type RoleOption = { id: string; code: string; name: string };

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

export async function listRoles(): Promise<RoleOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("id, code, name").order("code");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
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
      staff_id: parsed.data.staffId || null,
      student_id: parsed.data.studentId || null,
      guardian_id: parsed.data.guardianId || null,
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
