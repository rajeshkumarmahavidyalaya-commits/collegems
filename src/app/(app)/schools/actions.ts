"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { startSchoolSchema } from "@/lib/validations/platform";
import type { StartActionState } from "../../start/actions";

export type MySchool = {
  tenantId: string;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  roleName: string;
  isAdmin: boolean;
  isActive: boolean;
  planStatus: string | null;
  isCurrent: boolean;
  classCount: number | null;
  adminCount: number | null;
};

/**
 * The colleges this login belongs to (0323). `my_schools` is filtered by the
 * caller's own id and projects metadata only; the counts are present only
 * where the caller administers that college.
 */
export async function listMySchools(): Promise<MySchool[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_schools");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    tenantId: r.tenant_id,
    name: r.name,
    slug: r.slug,
    phone: r.phone,
    email: r.email,
    address: r.address,
    roleName: r.role_name,
    isAdmin: r.is_admin,
    isActive: r.is_active,
    planStatus: r.plan_status,
    isCurrent: r.is_current,
    classCount: r.class_count,
    adminCount: r.admin_count,
  }));
}

export type SwitchState = { error: string | null };

/**
 * Open one of this login's schools. `school_switch` moves the active profile
 * and the token's claims; the session is then refreshed, because every policy
 * reads the college from the token and the old token still names the old one.
 */
export async function switchSchool(tenantId: string): Promise<SwitchState> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { error: "Choose a school." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("school_switch", { p_tenant_id: tenantId });
  if (error) return { error: error.message };
  if ((data as { refresh_session_required?: boolean } | null)?.refresh_session_required) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      return { error: "The school was chosen, but the session could not be refreshed. Sign out and in again." };
    }
  }
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Add New School (0323). The caller stays in the school they are in; the new
 * one is a card on the dashboard to switch to. `school_add` refuses anybody
 * without users.manage, an operator, and a login already holding ten schools.
 */
export async function addSchool(_prev: StartActionState, formData: FormData): Promise<StartActionState> {
  const parsed = startSchoolSchema.safeParse({
    schoolName: formData.get("schoolName"),
    slug: formData.get("slug"),
    timezone: formData.get("timezone") || "Asia/Kolkata",
    sessionName: formData.get("sessionName") || undefined,
    sessionStart: formData.get("sessionStart") || undefined,
    sessionEnd: formData.get("sessionEnd") || undefined,
  });
  if (!parsed.success) {
    return { error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("school_add", {
    p_school_name: parsed.data.schoolName,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_session_name: parsed.data.sessionName || undefined,
    p_session_start: parsed.data.sessionStart || undefined,
    p_session_end: parsed.data.sessionEnd || undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/schools");
  revalidatePath("/schools/manage");
  // The page says what happened: a redirect cannot carry a toast.
  redirect(`/schools/manage?added=${encodeURIComponent(parsed.data.schoolName)}`);
}
