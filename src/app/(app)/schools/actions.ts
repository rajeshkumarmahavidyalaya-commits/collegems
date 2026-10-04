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
  const { data: added, error } = await supabase.rpc("school_add", {
    p_school_name: parsed.data.schoolName,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_session_name: parsed.data.sessionName || undefined,
    p_session_start: parsed.data.sessionStart || undefined,
    p_session_end: parsed.data.sessionEnd || undefined,
  });
  if (error) return { error: error.message };

  // Copy setup from another school this login administers, when asked (0326).
  // The school exists either way; a refused copy is a sentence on the next
  // page, never a failed founding.
  const copyFrom = String(formData.get("copyFrom") ?? "");
  const newId = String((added as { tenant_id?: string } | null)?.tenant_id ?? "");
  let copied = "";
  if (UUID.test(copyFrom) && UUID.test(newId)) {
    const r = await supabase.rpc("school_copy_setup", { p_from: copyFrom, p_to: newId });
    copied = r.error ? `failed:${r.error.message}` : `${(r.data as { classes?: number } | null)?.classes ?? 0}`;
  }

  revalidatePath("/schools");
  revalidatePath("/schools/manage");
  // The page says what happened: a redirect cannot carry a toast.
  const query = new URLSearchParams({ added: parsed.data.schoolName });
  if (copied) query.set("copied", copied.slice(0, 200));
  redirect(`/schools/manage?${query.toString()}`);
}

// ---------------------------------------------------------------------------
// What a super admin does with several schools (0326, 0327). Every function
// below is a definer that opens with school_require_admin(that school), so a
// caller who does not administer it is refused by the database in a sentence;
// nothing here decides who may.

const UUID = /^[0-9a-f-]{36}$/i;
type Done<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export type SchoolFigures = {
  tenantId: string;
  logo: string | null;
  isPaused: boolean;
  sessionName: string | null;
  studentsOnRoll: number;
  collectedThisMonth: number;
  duesOutstanding: number;
};

/** Totals for each school this login administers; nothing for the others. */
export async function listSchoolFigures(): Promise<Map<string, SchoolFigures>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_school_figures");
  if (error) return new Map();
  return new Map(
    (data ?? []).map((r) => [
      r.tenant_id,
      {
        tenantId: r.tenant_id,
        logo: r.logo ?? null,
        isPaused: r.is_paused,
        sessionName: r.session_name ?? null,
        studentsOnRoll: Number(r.students_on_roll ?? 0),
        collectedThisMonth: Number(r.collected_this_month ?? 0),
        duesOutstanding: Number(r.dues_outstanding ?? 0),
      },
    ]),
  );
}

export type SchoolAdmin = { userId: string | null; email: string; name: string; status: string; isYou: boolean };

export async function listSchoolAdmins(tenantId: string): Promise<Done<SchoolAdmin[]>> {
  if (!UUID.test(tenantId)) return { ok: false, error: "Choose a school." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("school_admins", { p_tenant: tenantId });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      userId: r.user_id ?? null,
      email: r.email,
      name: r.display_name,
      status: r.status,
      isYou: r.is_you,
    })),
  };
}

export async function assignSchoolAdmin(tenantId: string, email: string): Promise<Done<{ message: string }>> {
  if (!UUID.test(tenantId)) return { ok: false, error: "Choose a school." };
  const clean = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, error: "Enter a valid email address." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("school_assign_admin", { p_tenant: tenantId, p_email: clean });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/schools/${tenantId}/admins`);
  revalidatePath("/schools/manage");
  return { ok: true, data: { message: String((data as { message?: string } | null)?.message ?? `${clean} is an administrator.`) } };
}

export async function removeSchoolAdmin(tenantId: string, userId: string): Promise<Done> {
  if (!UUID.test(tenantId) || !UUID.test(userId)) return { ok: false, error: "Choose an administrator." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("school_remove_admin", { p_tenant: tenantId, p_user: userId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/schools/${tenantId}/admins`);
  revalidatePath("/schools/manage");
  return { ok: true, data: undefined };
}

export type SchoolProfileForm = {
  tenantId: string;
  name: string;
  slug: string;
  logo: string | null;
  isActive: boolean;
  profile: Record<string, string>;
  menu: Record<string, boolean>;
  classCount: number;
};

export async function getSchoolForEdit(tenantId: string): Promise<Done<SchoolProfileForm>> {
  if (!UUID.test(tenantId)) return { ok: false, error: "Choose a school." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("school_profile", { p_tenant: tenantId });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  const profile = (d.profile ?? {}) as Record<string, unknown>;
  const menu = (d.menu ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      tenantId,
      name: String(d.name ?? ""),
      slug: String(d.slug ?? ""),
      logo: typeof d.logo === "string" ? d.logo : null,
      isActive: d.is_active !== false,
      profile: Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, typeof v === "string" ? v : ""])),
      menu: Object.fromEntries(Object.entries(menu).map(([k, v]) => [k, v !== false])),
      classCount: Number(d.class_count ?? 0),
    },
  };
}

const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * Save a school's name, contact lines, logo and menu switches. The logo is
 * "keep", "" (remove) or a small data URL the browser has already resized;
 * the CHECK on tenants is the boundary, this is only the sentence.
 */
export async function updateSchool(input: {
  tenantId: string;
  name: string;
  profile: Record<string, string>;
  logo: string;
  menu: Record<string, boolean>;
}): Promise<Done<{ name: string }>> {
  if (!UUID.test(input.tenantId)) return { ok: false, error: "Choose a school." };
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 160) return { ok: false, error: "A school needs a name of 2 to 160 characters." };
  const logo = input.logo === "keep" || input.logo === "" ? input.logo : String(input.logo ?? "");
  if (logo !== "keep" && logo !== "" && (!LOGO.test(logo) || logo.length > 200_000)) {
    return { ok: false, error: "The logo must be a PNG, JPEG or WebP image of at most about 150 KB after resizing." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("school_update_profile", {
    p_tenant: input.tenantId,
    p_name: name,
    p_profile: input.profile,
    p_logo: logo,
    p_menu: input.menu,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, data: { name } };
}

/** Pause or resume a school. Not a boundary: logins and data are untouched. */
export async function setSchoolActive(tenantId: string, active: boolean): Promise<Done<{ active: boolean }>> {
  if (!UUID.test(tenantId)) return { ok: false, error: "Choose a school." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("school_set_active", { p_tenant: tenantId, p_active: active });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, data: { active } };
}

export type CopiedSetup = Record<string, number>;

/** Copy classes, subjects, periods, fee heads and amounts into a school with no classes yet. */
export async function copySchoolSetup(fromTenantId: string, toTenantId: string): Promise<Done<CopiedSetup>> {
  if (!UUID.test(fromTenantId) || !UUID.test(toTenantId)) return { ok: false, error: "Choose both schools." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("school_copy_setup", { p_from: fromTenantId, p_to: toTenantId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/schools", "layout");
  return { ok: true, data: (data ?? {}) as CopiedSetup };
}
