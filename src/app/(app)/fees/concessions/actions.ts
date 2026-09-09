"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  awardConcessionSchema,
  createConcessionSchema,
  revokeConcessionSchema,
} from "@/lib/validations/concessions";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type ConcessionRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: string;
  value: number;
  maxAmount: number | null;
  priority: number;
  isActive: boolean;
  feeHeadIds: string[];
  awardCount: number;
};

export type AwardRow = {
  id: string;
  studentId: string;
  student: string;
  admissionNumber: string;
  concessionId: string;
  concession: string;
  kind: string;
  value: number;
  reason: string;
  grantedOn: string;
  endsOn: string | null;
  status: string;
  revokeReason: string | null;
  credited: number;
};

export type ConcessionProblem = { studentId: string | null; severity: string; message: string };

export async function listConcessions(): Promise<ConcessionRow[]> {
  const supabase = await createClient();
  const [{ data: rows }, { data: awards }] = await Promise.all([
    supabase
      .from("fee_concessions")
      .select("id, code, name, description, kind, value, max_amount, priority, is_active, fee_head_ids")
      .order("priority")
      .order("code"),
    supabase.from("student_concessions").select("concession_id").eq("status", "active"),
  ]);

  const counts = new Map<string, number>();
  for (const a of awards ?? []) {
    counts.set(a.concession_id, (counts.get(a.concession_id) ?? 0) + 1);
  }

  return (rows ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    kind: c.kind,
    value: Number(c.value),
    maxAmount: c.max_amount === null ? null : Number(c.max_amount),
    priority: c.priority,
    isActive: c.is_active,
    feeHeadIds: c.fee_head_ids ?? [],
    awardCount: counts.get(c.id) ?? 0,
  }));
}

/**
 * Who holds what. `credited` comes from the ledger rather than being recomputed
 * from the rule — rule 11's instinct applied to a screen: a number free to
 * disagree with the family's statement is worse than no number.
 */
export async function listAwards(): Promise<AwardRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();

  // Three flat queries rather than one embedded select. `student_concessions`
  // reaches both parents through **composite** foreign keys
  // (`(tenant_id, concession_id)`), which PostgREST does not infer, so the
  // embed silently resolves to an error shape instead of a row. Joining here
  // is the honest version and it is still three round trips, not N+1.
  // This year's awards. The cap of 500 is what makes the year load-bearing
  // rather than cosmetic: last year's revoked awards would otherwise fill the
  // board and push this year's off the end of it.
  let awardQuery = supabase
    .from("student_concessions")
    .select("id, student_id, concession_id, reason, granted_on, ends_on, status, revoke_reason")
    .order("status")
    .order("granted_on", { ascending: false })
    .limit(500);
  if (ctx?.currentSessionId) awardQuery = awardQuery.eq("session_id", ctx.currentSessionId);

  const { data: awards } = await awardQuery;

  const rows = awards ?? [];
  if (rows.length === 0) return [];

  const studentIds = [...new Set(rows.map((a) => a.student_id))];
  const concessionIds = [...new Set(rows.map((a) => a.concession_id))];
  const awardIds = rows.map((a) => a.id);

  const [{ data: students }, { data: concessions }, { data: entries }] = await Promise.all([
    supabase
      .from("students")
      .select("id, admission_number, people:person_id ( first_name, last_name )")
      .in("id", studentIds),
    supabase.from("fee_concessions").select("id, name, kind, value").in("id", concessionIds),
    supabase
      .from("ledger_entries")
      .select("concession_award_id, amount")
      .in("concession_award_id", awardIds)
      .is("reverses_entry_id", null),
  ]);

  const studentById = new Map(
    (students ?? []).map((s) => [
      s.id,
      {
        name: `${s.people?.first_name ?? ""} ${s.people?.last_name ?? ""}`.trim() || "Unknown",
        admissionNumber: s.admission_number,
      },
    ]),
  );
  const concessionById = new Map((concessions ?? []).map((c) => [c.id, c]));

  const credited = new Map<string, number>();
  for (const e of entries ?? []) {
    if (!e.concession_award_id) continue;
    // The ledger stores a discount negative (rule 6); a screen shows what it
    // was worth, so the sign is flipped once, here.
    credited.set(
      e.concession_award_id,
      (credited.get(e.concession_award_id) ?? 0) - Number(e.amount),
    );
  }

  return rows.map((a) => {
    const student = studentById.get(a.student_id);
    const concession = concessionById.get(a.concession_id);
    return {
      id: a.id,
      studentId: a.student_id,
      student: student?.name ?? "Unknown",
      admissionNumber: student?.admissionNumber ?? "",
      concessionId: a.concession_id,
      concession: concession?.name ?? "",
      kind: concession?.kind ?? "",
      value: Number(concession?.value ?? 0),
      reason: a.reason,
      grantedOn: a.granted_on,
      endsOn: a.ends_on,
      status: a.status,
      revokeReason: a.revoke_reason,
      credited: credited.get(a.id) ?? 0,
    };
  });
}

export async function listConcessionProblems(): Promise<ConcessionProblem[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("concession_problems");
  return (data ?? []).map((p) => ({
    studentId: p.student_id,
    severity: p.severity ?? "info",
    message: p.message ?? "",
  }));
}

export async function listStudentsForConcession() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, admission_number, people:person_id ( first_name, last_name )")
    .eq("status", "active")
    .order("admission_number")
    .limit(500);

  return (data ?? []).map((s) => ({
    id: s.id,
    admissionNumber: s.admission_number,
    name: `${s.people?.first_name ?? ""} ${s.people?.last_name ?? ""}`.trim(),
  }));
}

export async function createConcession(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createConcessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase.from("user_profiles").select("tenant_id").limit(1).single();
  if (!profile) return { ok: false, error: "No tenant in session." };

  const { data, error } = await supabase
    .from("fee_concessions")
    .insert({
      tenant_id: profile.tenant_id,
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description || null,
      kind: parsed.data.kind,
      value: parsed.data.value,
      max_amount: parsed.data.kind === "percentage" ? parsed.data.maxAmount : null,
      priority: parsed.data.priority,
      fee_head_ids: parsed.data.feeHeadIds.length > 0 ? parsed.data.feeHeadIds : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A concession with that code already exists." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/fees/concessions");
  return { ok: true, data: { id: data.id } };
}

export async function awardConcession(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = awardConcessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("concession_award", {
    p_student_id: parsed.data.studentId,
    p_concession_id: parsed.data.concessionId,
    p_reason: parsed.data.reason,
    p_ends_on: parsed.data.endsOn ?? undefined,
  });

  // Every refusal from that function is already a sentence naming the
  // concession — including the "already awarded this year" one.
  if (error) return { ok: false, error: error.message };

  const row = data as unknown as { id: string } | null;
  if (!row) return { ok: false, error: "Nothing was awarded." };

  revalidatePath("/fees/concessions");
  return { ok: true, data: { id: row.id } };
}

export async function revokeConcession(input: unknown): Promise<ActionResult<void>> {
  const parsed = revokeConcessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Say why this is being withdrawn." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("concession_revoke", {
    p_award_id: parsed.data.awardId,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/fees/concessions");
  return { ok: true, data: undefined };
}
