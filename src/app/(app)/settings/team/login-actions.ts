"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../../library/actions";

export type LoginRow = {
  userId: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  roleSubject: string;
  /** Which record the login is linked to: staff, guardian, student, or none. */
  recordKind: string;
  active: boolean;
  lastSignInAt: string | null;
  isYou: boolean;
};

/**
 * Everybody who can sign in to this college (0289). Until then the team screen
 * listed invitations only, and an accepted one vanished from every screen, so
 * nobody could see who had access, let alone take it away.
 *
 * `null` means the caller may not see the list; `[]` means there is nobody.
 */
export async function listLogins(): Promise<LoginRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_logins");
  if (error) return null;
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email,
    name: r.display_name,
    roleId: r.role_id,
    roleName: r.role_name,
    roleSubject: r.role_subject,
    recordKind: r.record_kind,
    active: r.is_active,
    lastSignInAt: r.last_sign_in_at,
    isYou: r.is_you,
  }));
}

/**
 * Switch a login off or back on in this college (`team_set_access`, 0323).
 * Somebody who belongs to no other active college is banned and signed out,
 * as before; somebody who does is only switched off here, and if this was the
 * college they were working in, their next page opens their other one. A
 * token already issued lasts until it expires, at most an hour. The function
 * refuses the caller's own login and the last login that can manage users.
 */
export async function setLoginAccess(
  userId: string,
  active: boolean,
): Promise<ActionResult<{ name: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_set_access", {
    p_user_id: userId,
    p_active: active,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true, data: { name: (data as { name: string }).name } };
}

/**
 * Change what a login is for in this college (`team_set_role`, 0323). If they
 * are working here today they are signed out so it applies now; if they are
 * working in another college it applies when they switch back.
 */
export async function setLoginRole(
  userId: string,
  roleId: string,
): Promise<ActionResult<{ name: string; role: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_set_role", {
    p_user_id: userId,
    p_role_id: roleId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/team");
  return { ok: true, data: data as { name: string; role: string } };
}
