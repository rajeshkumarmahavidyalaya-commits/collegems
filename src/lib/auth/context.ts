import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type UserContext = {
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  displayName: string;
  staffId: string | null;
  studentId: string | null;
  guardianId: string | null;
  currentSessionId: string | null;
  currentSessionName: string | null;
};

/**
 * The authenticated user's tenant, role, and current academic session,
 * resolved server-side. `cache()` de-dupes this across every Server
 * Component that calls it within one request. Never accept tenant_id or
 * session_id from client input -- this is the only source of truth.
 */
export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const supabase = await createClient();

  // Same reasoning as middleware.ts: a revoked/stale refresh token can reject
  // rather than return an error, and missing build-time env throws outright.
  // Returning null routes the caller to /login, which is what "we could not
  // establish who this is" should mean -- not a 500 on a rendered page.
  let user: { id: string } | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data?.user ?? null;
  } catch (error) {
    console.error("[getUserContext] auth check failed, treating as signed out:", error);
    return null;
  }

  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select(
      `tenant_id, role_id, staff_id, student_id, guardian_id,
       roles ( code, name ),
       people:person_id ( first_name, last_name ),
       tenants ( name )`,
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  const { data: currentSession } = await supabase
    .from("academic_sessions")
    .select("id, name")
    .eq("tenant_id", profile.tenant_id)
    .eq("is_current", true)
    .maybeSingle();

  const person = profile.people;
  const role = profile.roles;

  return {
    userId: user.id,
    email: user.email ?? null,
    tenantId: profile.tenant_id,
    tenantName: profile.tenants?.name ?? "",
    roleId: profile.role_id,
    roleCode: role?.code ?? "",
    roleName: role?.name ?? "",
    displayName: person ? `${person.first_name} ${person.last_name}` : (user.email ?? "Unknown"),
    staffId: profile.staff_id,
    studentId: profile.student_id,
    guardianId: profile.guardian_id,
    currentSessionId: currentSession?.id ?? null,
    currentSessionName: currentSession?.name ?? null,
  };
});
