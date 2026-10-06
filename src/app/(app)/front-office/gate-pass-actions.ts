"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../library/actions";

/*
 * Gate passes (0342): visits that name a student, on the front office's own
 * visitor log. `gate_pass_issue` checks the visitor in through
 * `visitor_check_in`, so a pass is numbered, filed in its year and held to one
 * open pass per phone exactly as any visit is. The front-office policy on
 * `visitors` is the gate.
 */

export type GatePassRow = {
  id: string;
  passNumber: string;
  visitorName: string;
  phone: string | null;
  relation: string | null;
  studentId: string | null;
  studentName: string | null;
  admissionNumber: string | null;
  className: string | null;
  sectionName: string | null;
  reason: string;
  authorizedBy: string | null;
  inAt: string;
  outAt: string | null;
};

export async function listGatePasses(): Promise<GatePassRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gate_pass_register", { p_limit: 500 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    passNumber: r.pass_number,
    visitorName: r.visitor_name,
    phone: r.phone,
    relation: r.relation_to_student,
    studentId: r.student_id,
    studentName: r.student_name,
    admissionNumber: r.admission_number,
    className: r.class_name,
    sectionName: r.section_name,
    reason: r.purpose,
    authorizedBy: r.authorized_by,
    inAt: r.checked_in_at,
    outAt: r.checked_out_at,
  }));
}

/** The picker's search: the roll, by name or admission number (`student_search`). */
export async function searchStudentsForGatePass(term: string) {
  const needle = term.trim();
  if (needle.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("student_search", { p_query: needle, p_limit: 10 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: s.id, name: s.full_name, admissionNumber: s.admission_number, status: s.status }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[0-9+()\-\s]{6,20}$/;

export async function issueGatePass(input: {
  studentId: string;
  visitorName: string;
  phone: string;
  relation: string;
  authorizedBy: string;
  reason: string;
}): Promise<ActionResult<{ passNumber: string }>> {
  const fieldErrors: Record<string, string[]> = {};
  const name = (input?.visitorName ?? "").trim();
  const phone = (input?.phone ?? "").trim();
  const relation = (input?.relation ?? "").trim();
  const authorizedBy = (input?.authorizedBy ?? "").trim();
  const reason = (input?.reason ?? "").trim();
  if (!UUID.test(input?.studentId ?? "")) fieldErrors.studentId = ["Choose the student"];
  if (name.length < 1 || name.length > 120) fieldErrors.visitorName = ["Enter the visitor's name"];
  if (!PHONE.test(phone)) fieldErrors.phone = ["Enter a mobile number"];
  if (relation.length < 1 || relation.length > 60) fieldErrors.relation = ["Say what they are to the student"];
  if (authorizedBy.length < 1 || authorizedBy.length > 120) fieldErrors.authorizedBy = ["Say who allowed it"];
  if (reason.length > 300) fieldErrors.reason = ["At most 300 characters"];
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gate_pass_issue", {
    p_student_id: input.studentId,
    p_visitor_name: name,
    p_phone: phone,
    p_relation: relation,
    p_authorized_by: authorizedBy,
    p_reason: reason || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/front-office/gate-passes");
  revalidatePath("/front-office");
  return { ok: true, data: { passNumber: (data as { pass_number: string }).pass_number } };
}
