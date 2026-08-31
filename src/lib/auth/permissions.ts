import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "./context";

/**
 * The calling user's permission codes (role x module x ability), for
 * gating menus and actions in the UI. This is the second, non-authoritative
 * layer described in CLAUDE.md -- RLS is what actually enforces access;
 * this only decides what to render. Never trust it as a security boundary.
 */
export const getPermissionCodes = cache(async (): Promise<Set<string>> => {
  const ctx = await getUserContext();
  if (!ctx) return new Set();

  const supabase = await createClient();
  const { data } = await supabase
    .from("role_permissions")
    .select("permission_code")
    .eq("tenant_id", ctx.tenantId)
    .eq("role_id", ctx.roleId)
    .eq("allowed", true);

  return new Set((data ?? []).map((row) => row.permission_code));
});

export async function hasPermission(code: string): Promise<boolean> {
  const codes = await getPermissionCodes();
  return codes.has(code);
}
