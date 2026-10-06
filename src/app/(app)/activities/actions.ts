"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import type { ActionResult } from "../library/actions";

/*
 * Activities (0348): the reference's SM Activities (Name, Class, Fee,
 * Description, Status). The administrator writes activities through the
 * policy. Joining a child raises the fee as an invoice and withdrawing
 * cancels it, both in Postgres (`activity_join`, `activity_withdraw`), so
 * the place and the bill cannot come apart.
 */

export type ActivityRow = {
  id: string;
  name: string;
  classLevelId: string | null;
  className: string | null;
  fee: number;
  feeHeadId: string | null;
  feeHeadName: string | null;
  description: string | null;
  isActive: boolean;
  participants: number;
};

export type ActivityOptions = {
  classes: { id: string; name: string }[];
  feeHeads: { id: string; name: string }[];
};

/** This year's activities ("now", rule 2) with each one's active participants. */
export async function listActivities(): Promise<ActivityRow[]> {
  const ctx = await getUserContext();
  if (!ctx?.currentSessionId) return [];
  const supabase = await createClient();
  const [{ data, error }, parts, classes, heads] = await Promise.all([
    supabase
      .from("activities")
      .select("id, name, class_level_id, fee, fee_head_id, description, is_active")
      .eq("session_id", ctx.currentSessionId)
      .order("name")
      .order("id"),
    supabase.from("activity_participants").select("activity_id").eq("status", "active"),
    supabase.from("class_levels").select("id, name"),
    supabase.from("fee_heads").select("id, name"),
  ]);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const p of parts.data ?? []) counts.set(p.activity_id, (counts.get(p.activity_id) ?? 0) + 1);
  const classOf = new Map((classes.data ?? []).map((c) => [c.id, c.name]));
  const headOf = new Map((heads.data ?? []).map((h) => [h.id, h.name]));
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    classLevelId: a.class_level_id,
    className: a.class_level_id ? (classOf.get(a.class_level_id) ?? null) : null,
    fee: Number(a.fee),
    feeHeadId: a.fee_head_id,
    feeHeadName: a.fee_head_id ? (headOf.get(a.fee_head_id) ?? null) : null,
    description: a.description,
    isActive: a.is_active,
    participants: counts.get(a.id) ?? 0,
  }));
}

/** One activity by id: a lookup, not a list (rule 2). */
export async function getActivity(id: string): Promise<ActivityRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select("id, name, class_level_id, fee, fee_head_id, description, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [cls, head] = await Promise.all([
    data.class_level_id ? supabase.from("class_levels").select("name").eq("id", data.class_level_id).maybeSingle() : Promise.resolve({ data: null }),
    data.fee_head_id ? supabase.from("fee_heads").select("name").eq("id", data.fee_head_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    id: data.id,
    name: data.name,
    classLevelId: data.class_level_id,
    className: (cls.data as { name: string } | null)?.name ?? null,
    fee: Number(data.fee),
    feeHeadId: data.fee_head_id,
    feeHeadName: (head.data as { name: string } | null)?.name ?? null,
    description: data.description,
    isActive: data.is_active,
    participants: 0,
  };
}

export async function activityOptions(): Promise<ActivityOptions> {
  const supabase = await createClient();
  const [classes, heads] = await Promise.all([
    supabase.from("class_levels").select("id, name, sequence").order("sequence").order("id"),
    supabase.from("fee_heads").select("id, name, is_active").eq("is_active", true).order("name").order("id"),
  ]);
  return {
    classes: (classes.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    feeHeads: (heads.data ?? []).map((h) => ({ id: h.id, name: h.name })),
  };
}

export async function saveActivity(
  input: { name: string; classLevelId: string; fee: string; feeHeadId: string; description: string; isActive: boolean },
  id?: string,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!ctx.currentSessionId) return { ok: false, error: "This college has no current academic year." };
  const fieldErrors: Record<string, string[]> = {};
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) fieldErrors.name = ["Give it a name of up to 120 characters"];
  const fee = input.fee.trim() === "" ? 0 : Number(input.fee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 10_000_000) fieldErrors.fee = ["Enter a fee of 0 or more"];
  if (fee > 0 && !input.feeHeadId) fieldErrors.feeHeadId = ["A fee is billed under a fee type: choose one"];
  if ((input.description ?? "").length > 4000) fieldErrors.description = ["At most 4,000 characters"];
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Check the highlighted fields.", fieldErrors };

  const supabase = await createClient();
  const row = {
    name,
    class_level_id: input.classLevelId || null,
    fee: Math.round(fee * 100) / 100,
    fee_head_id: fee > 0 ? input.feeHeadId : input.feeHeadId || null,
    description: input.description.trim() || null,
    is_active: input.isActive !== false,
  };
  const { data, error } = id
    ? await supabase.from("activities").update(row).eq("id", id).select("id")
    : await supabase.from("activities").insert({ ...row, tenant_id: ctx.tenantId, session_id: ctx.currentSessionId }).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: `There is already an activity called "${name}" this year.`, fieldErrors: { name: ["Already used"] } };
    if (error.code === "42501") return { ok: false, error: "Only an administrator can add or change activities." };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Only an administrator can add or change activities." };
  revalidatePath("/activities");
  return { ok: true, data: { id: data[0].id } };
}

/** An activity anybody ever joined keeps its record; it is switched off instead. */
export async function removeActivity(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("activities").delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Students have taken part in this activity, so it stays on record. Mark it inactive instead." };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "Only an administrator can remove an activity." };
  revalidatePath("/activities");
  return { ok: true, data: undefined };
}

export type ActivityParticipant = {
  id: string;
  studentId: string;
  name: string;
  admissionNumber: string;
  status: string;
  joinedOn: string;
  withdrawnOn: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
};

export async function listActivityParticipants(activityId: string): Promise<ActivityParticipant[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_participants")
    .select("id, student_id, status, joined_on, withdrawn_on, invoice_id")
    .eq("activity_id", activityId)
    .order("status")
    .order("joined_on")
    .order("id");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const studentIds = rows.map((r) => r.student_id);
  const invoiceIds = rows.map((r) => r.invoice_id).filter((v): v is string => !!v);
  const [students, invoices] = await Promise.all([
    studentIds.length
      ? supabase.from("students").select("id, admission_number, people:person_id ( first_name, last_name )").in("id", studentIds)
      : Promise.resolve({ data: [] }),
    invoiceIds.length ? supabase.from("invoices").select("id, invoice_number, status").in("id", invoiceIds) : Promise.resolve({ data: [] }),
  ]);
  const who = new Map(
    ((students.data ?? []) as { id: string; admission_number: string; people: { first_name: string; last_name: string | null } | null }[]).map(
      (s) => [s.id, { name: s.people ? `${s.people.first_name} ${s.people.last_name ?? ""}`.trim() : s.admission_number, adm: s.admission_number }],
    ),
  );
  const inv = new Map(((invoices.data ?? []) as { id: string; invoice_number: string; status: string }[]).map((i) => [i.id, i]));
  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    name: who.get(r.student_id)?.name ?? "—",
    admissionNumber: who.get(r.student_id)?.adm ?? "",
    status: r.status,
    joinedOn: r.joined_on,
    withdrawnOn: r.withdrawn_on,
    invoiceNumber: r.invoice_id ? (inv.get(r.invoice_id)?.invoice_number ?? null) : null,
    invoiceStatus: r.invoice_id ? (inv.get(r.invoice_id)?.status ?? null) : null,
  }));
}

/** The picker's search: the roll, by name or admission number (`student_search`). */
export async function searchStudentsForActivity(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", { p_query: needle, p_limit: 10 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name, admissionNumber: s.admission_number, status: s.status }));
}

export async function joinActivity(activityId: string, studentId: string): Promise<ActionResult<{ already: boolean; invoiceNumber: string | null }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activity_join", { p_activity_id: activityId, p_student_id: studentId });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { already?: boolean; invoice_number?: string | null };
  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/activities");
  return { ok: true, data: { already: !!r.already, invoiceNumber: r.invoice_number ?? null } };
}

export async function withdrawFromActivity(activityId: string, participantId: string): Promise<ActionResult<{ invoiceCancelled: boolean }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("activity_withdraw", { p_participant_id: participantId });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as { invoice_cancelled?: boolean };
  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/activities");
  return { ok: true, data: { invoiceCancelled: !!r.invoice_cancelled } };
}
