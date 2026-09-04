"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/context";
import {
  convertSchema,
  enquirySchema,
  followUpSchema,
  visitorSchema,
} from "@/lib/validations/front-office";
import type { ActionResult } from "../library/actions";

function fail(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

function invalid(error: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) {
  return {
    ok: false as const,
    error: "Check the highlighted fields.",
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------

export type EnquiryRow = {
  id: string;
  enquiryNumber: string;
  applicantName: string;
  classLevelName: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  source: string;
  status: string;
  assignedName: string | null;
  nextFollowUpOn: string | null;
  overdue: boolean;
  followUpCount: number;
  lastContact: string | null;
  lostReason: string | null;
  convertedStudentId: string | null;
  createdAt: string;
};

export async function listEnquiries(): Promise<EnquiryRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enquiry_board", {
    p_session_id: ctx?.currentSessionId ?? undefined,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((e) => ({
    id: e.id,
    enquiryNumber: e.enquiry_number,
    applicantName: e.applicant_name,
    classLevelName: e.class_level_name,
    contactName: e.contact_name,
    contactPhone: e.contact_phone,
    contactEmail: e.contact_email,
    source: e.source,
    status: e.status,
    assignedName: e.assigned_name,
    nextFollowUpOn: e.next_follow_up_on,
    overdue: e.overdue,
    followUpCount: e.follow_up_count,
    lastContact: e.last_contact,
    lostReason: e.lost_reason,
    convertedStudentId: e.converted_student_id,
    createdAt: e.created_at,
  }));
}

export type FunnelRow = { status: string; count: number; share: number };

export async function getFunnel(): Promise<FunnelRow[]> {
  const ctx = await getUserContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enquiry_funnel", {
    p_session_id: ctx?.currentSessionId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    status: r.status,
    count: r.count,
    share: Number(r.share ?? 0),
  }));
}

export async function createEnquiry(input: unknown): Promise<ActionResult<{ number: string }>> {
  const parsed = enquirySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enquiry_create", {
    p_applicant: {
      first_name: parsed.data.applicantFirstName,
      last_name: parsed.data.applicantLastName ?? "",
      date_of_birth: parsed.data.dateOfBirth || null,
      gender: parsed.data.gender ?? null,
    },
    p_contact: {
      name: parsed.data.contactName,
      phone: parsed.data.contactPhone ?? "",
      email: parsed.data.contactEmail ?? "",
      relationship: parsed.data.relationship ?? "",
    },
    p_class_level_id: parsed.data.classLevelId || undefined,
    p_source: parsed.data.source,
    p_assigned_staff_id: parsed.data.assignedStaffId || undefined,
    p_next_follow_up_on: parsed.data.nextFollowUpOn || undefined,
    p_notes: parsed.data.notes || undefined,
  });

  if (error) return fail(error.message);

  revalidatePath("/front-office");
  return { ok: true, data: { number: (data as { enquiry_number: string }).enquiry_number } };
}

export type FollowUpRow = {
  id: string;
  happenedAt: string;
  channel: string;
  note: string;
  outcome: string | null;
};

export async function listFollowUps(enquiryId: string): Promise<FollowUpRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enquiry_follow_ups")
    .select("id, happened_at, channel, note, outcome")
    .eq("enquiry_id", enquiryId)
    .order("happened_at", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((f) => ({
    id: f.id,
    happenedAt: f.happened_at,
    channel: f.channel,
    note: f.note,
    outcome: f.outcome,
  }));
}

export async function logFollowUp(input: unknown): Promise<ActionResult> {
  const parsed = followUpSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("enquiry_log_follow_up", {
    p_enquiry_id: parsed.data.enquiryId,
    p_note: parsed.data.note,
    p_channel: parsed.data.channel,
    p_outcome: parsed.data.outcome ?? undefined,
    p_next_follow_up_on: parsed.data.nextFollowUpOn || undefined,
    p_lost_reason: parsed.data.lostReason || undefined,
  });
  if (error) return fail(error.message);

  revalidatePath("/front-office");
  return { ok: true, data: undefined };
}

/**
 * Admit the child the enquiry is about.
 *
 * The RPC calls `admit_student`, not its own inserts: there is one admission
 * path in this system, and a child arriving through the front office is not a
 * different kind of child. A second insert path is how two admission numbering
 * schemes end up in one database.
 */
export async function convertEnquiry(
  input: unknown,
): Promise<ActionResult<{ studentId: string; admissionNumber: string }>> {
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("enquiry_convert", {
    p_enquiry_id: parsed.data.enquiryId,
    p_admission_number: parsed.data.admissionNumber.trim(),
    p_section_id: parsed.data.sectionId || undefined,
    p_roll_number: parsed.data.rollNumber || undefined,
    p_admission_date: parsed.data.admissionDate || undefined,
  });
  if (error) return fail(error.message);

  const student = data as { id: string; admission_number: string };
  revalidatePath("/front-office");
  revalidatePath("/students");
  return { ok: true, data: { studentId: student.id, admissionNumber: student.admission_number } };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type VisitorRow = {
  id: string;
  passNumber: string;
  visitorName: string;
  phone: string | null;
  organisation: string | null;
  purpose: string;
  hostName: string | null;
  studentName: string | null;
  checkedInAt: string;
  checkedOutAt: string | null;
  minutesInside: number;
};

export async function listVisitors(openOnly = true): Promise<VisitorRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visitor_register", {
    p_open_only: openOnly,
    p_limit: 200,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((v) => ({
    id: v.id,
    passNumber: v.pass_number,
    visitorName: v.visitor_name,
    phone: v.phone,
    organisation: v.organisation,
    purpose: v.purpose,
    hostName: v.host_name,
    studentName: v.student_name,
    checkedInAt: v.checked_in_at,
    checkedOutAt: v.checked_out_at,
    minutesInside: v.minutes_inside,
  }));
}

export async function checkInVisitor(input: unknown): Promise<ActionResult<{ pass: string }>> {
  const parsed = visitorSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("visitor_check_in", {
    p_visitor_name: parsed.data.visitorName,
    p_purpose: parsed.data.purpose,
    p_phone: parsed.data.phone || undefined,
    p_organisation: parsed.data.organisation || undefined,
    p_host_staff_id: parsed.data.hostStaffId || undefined,
    p_host_note: parsed.data.hostNote || undefined,
    p_student_id: parsed.data.studentId || undefined,
    p_id_proof_kind: parsed.data.idProofKind || undefined,
    p_id_proof_last4: parsed.data.idProofLast4 || undefined,
    p_vehicle_number: parsed.data.vehicleNumber || undefined,
  });

  // "That number is already signed in on pass VP-2025-00001 since 07:45" is
  // written in Postgres and shown as written: a refusal that names the existing
  // pass is an instruction, not an error.
  if (error) return fail(error.message);

  revalidatePath("/front-office");
  return { ok: true, data: { pass: (data as { pass_number: string }).pass_number } };
}

export async function checkOutVisitor(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("visitor_check_out", { p_visitor_id: id });
  if (error) return fail(error.message);

  revalidatePath("/front-office");
  return { ok: true, data: undefined };
}

/** The classes an enquiry can ask about, in school order. */
export async function listClassLevelOptions(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_levels")
    .select("id, name, sequence")
    .order("sequence");
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ id: c.id, label: c.name }));
}
