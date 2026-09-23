"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import { supabaseUrl } from "@/lib/supabase/env";
import { deviceNameSchema, staffCodeSchema } from "@/lib/validations/biometric";
import type { ActionResult } from "../../library/actions";

/**
 * Attendance readers (migration 0273). Every read here is an administrator's
 * through RLS -- both tables' policies are admin-only -- and every write is a
 * function that checks for itself, so nothing in this file is a gate.
 */

export type Device = { id: string; name: string; isActive: boolean; createdAt: string };
export type StaffCode = { staffId: string; employeeCode: string; name: string; code: string | null };
export type Punch = {
  id: string;
  deviceId: string;
  code: string;
  punchedAt: string;
  staffId: string | null;
};
export type Problem = { kind: string; subject: string; detail: string };

export async function listDevices(): Promise<Device[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("biometric_devices")
    // Never `secret_hash`: it is not granted, and asking for it is an error.
    .select("id, name, is_active, created_at")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    isActive: d.is_active,
    createdAt: d.created_at,
  }));
}

export async function listStaffCodes(): Promise<StaffCode[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id, employee_code, biometric_code, people:person_id ( first_name, last_name )")
    .eq("status", "active")
    .order("employee_code")
    .order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    staffId: s.id,
    employeeCode: s.employee_code,
    name: s.people ? `${s.people.first_name} ${s.people.last_name}` : s.employee_code,
    code: s.biometric_code,
  }));
}

/** The last fifty punches, newest first -- what the gate saw this morning. */
export async function listRecentPunches(): Promise<Punch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("biometric_punches")
    .select("id, device_id, device_user_code, punched_at, staff_id")
    .order("punched_at", { ascending: false })
    .order("id")
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id,
    deviceId: p.device_id,
    code: p.device_user_code,
    punchedAt: p.punched_at,
    staffId: p.staff_id,
  }));
}

export async function listProblems(): Promise<Problem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("biometric_problems");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ kind: p.kind, subject: p.subject, detail: p.detail }));
}

/** The college's wall clock, for writing punch times where the college is. */
export async function collegeTimezone(): Promise<string> {
  const ctx = await getUserContext();
  if (!ctx) return "Asia/Kolkata";
  const supabase = await createClient();
  const { data } = await supabase.from("tenants").select("timezone").eq("id", ctx.tenantId).maybeSingle();
  return data?.timezone ?? "Asia/Kolkata";
}

/**
 * Where a reader posts. A fact about the deployment, read from the same
 * configuration the app's own client uses -- never typed into a setting, which
 * would be a second copy free to disagree.
 */
export async function readerEndpoint(): Promise<string> {
  return `${supabaseUrl().replace(/\/$/, "")}/functions/v1/biometric-punch`;
}

export async function registerDevice(
  input: unknown,
): Promise<ActionResult<{ id: string; secret: string }>> {
  const parsed = deviceNameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("biometric_device_register", { p_name: parsed.data.name });
  if (error) return { ok: false, error: error.message };
  const result = data as { id: string; secret: string };
  revalidatePath("/hr/biometric");
  // The only time the secret leaves the database. It is not stored anywhere a
  // later request could read it back.
  return { ok: true, data: { id: result.id, secret: result.secret } };
}

export async function retireDevice(id: string): Promise<ActionResult> {
  if (typeof id !== "string" || id.length !== 36) return { ok: false, error: "That is not a reader." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("biometric_device_retire", { p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hr/biometric");
  return { ok: true, data: undefined };
}

export async function setStaffCode(input: unknown): Promise<ActionResult> {
  const parsed = staffCodeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the code.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("staff_set_biometric_code", {
    p_staff_id: parsed.data.staffId,
    p_code: parsed.data.code,
  });
  if (error) {
    // The partial unique index is the boundary; the function's own check gives
    // the sentence. A race between two tabs reaches the index instead.
    if (error.code === "23505") return { ok: false, error: "That code is already given to somebody else." };
    return { ok: false, error: error.message };
  }
  revalidatePath("/hr/biometric");
  return { ok: true, data: undefined };
}
