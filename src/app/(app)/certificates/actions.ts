"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  cancelCertificateSchema,
  cleanExtra,
  issueCertificateSchema,
  parsePreview,
  type CertificatePreview,
} from "@/lib/validations/certificates";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type TemplateRow = {
  id: string;
  kind: string;
  name: string;
  body: string;
  fields: unknown;
  isDefault: boolean;
};

export type CertificateRow = {
  id: string;
  serialNo: string;
  issuedOn: string;
  kind: string;
  templateName: string;
  student: string;
  admissionNumber: string;
  classAtIssue: string | null;
  status: string;
  cancelReason: string | null;
};

export async function listTemplates(): Promise<TemplateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("certificate_templates")
    .select("id, kind, name, body, fields, is_default")
    .eq("is_active", true)
    .order("kind")
    .order("name");

  return (data ?? []).map((t) => ({
    id: t.id,
    kind: t.kind,
    name: t.name,
    body: t.body,
    fields: t.fields,
    isDefault: t.is_default,
  }));
}

/**
 * The register, newest first.
 *
 * Every column comes out of `snapshot` rather than out of a join to `students`,
 * for the reason the whole module exists: the register must say what the paper
 * says. A child who has since been renamed, re-enrolled or promoted still
 * appears here as they appeared on the certificate they were handed.
 */
export async function listCertificates(limit = 50): Promise<CertificateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("certificates")
    .select("id, serial_no, issued_on, kind, template_name, snapshot, status, cancel_reason")
    .order("issued_on", { ascending: false })
    .order("serial_no", { ascending: false })
    .limit(limit);

  return (data ?? []).map((c) => {
    const snapshot = (c.snapshot ?? {}) as Record<string, string | null>;
    return {
      id: c.id,
      serialNo: c.serial_no,
      issuedOn: c.issued_on,
      kind: c.kind,
      templateName: c.template_name,
      student: snapshot["student.name"] ?? "—",
      admissionNumber: snapshot["student.admission_number"] ?? "—",
      classAtIssue: snapshot["class.label"] ?? null,
      status: c.status,
      cancelReason: c.cancel_reason,
    };
  });
}

/** Students an administrator may issue to, for the picker. */
export async function searchStudents(term: string) {
  const supabase = await createClient();
  let query = supabase
    .from("students")
    .select("id, admission_number, status, people:person_id ( first_name, last_name )")
    .order("admission_number")
    .limit(20);

  const trimmed = term.trim();
  if (trimmed) {
    query = query.or(
      `admission_number.ilike.%${trimmed}%,people.first_name.ilike.%${trimmed}%,people.last_name.ilike.%${trimmed}%`,
    );
  }

  const { data } = await query;
  return (data ?? []).map((s) => ({
    id: s.id,
    admissionNumber: s.admission_number,
    status: s.status,
    name: `${s.people?.first_name ?? ""} ${s.people?.last_name ?? ""}`.trim(),
  }));
}

/**
 * Preview. Computes and stores nothing — see `docs/modules/certificates.md`.
 *
 * This is called on every keystroke's worth of settled input, which is
 * affordable because the function is `stable` and reads one student. It is
 * *not* an authorization step: `issueCertificate` calls the same function again
 * server-side, so a screen that lied about `can_issue` changes nothing.
 */
export async function previewCertificate(input: {
  studentId: string;
  templateId: string;
  issuedOn?: string;
  extra?: Record<string, string>;
}): Promise<ActionResult<CertificatePreview>> {
  if (!input.studentId || !input.templateId) {
    return { ok: false, error: "Choose a student and a certificate." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("certificate_preview", {
    p_student_id: input.studentId,
    p_template_id: input.templateId,
    p_issued_on: input.issuedOn || undefined,
    p_extra: cleanExtra(input.extra ?? {}),
  });

  if (error) return { ok: false, error: error.message };

  const preview = parsePreview(data);
  if (!preview) {
    return { ok: false, error: "The preview came back in a shape this page did not recognise." };
  }
  return { ok: true, data: preview };
}

export async function issueCertificate(input: unknown): Promise<ActionResult<{ id: string; serialNo: string }>> {
  const parsed = issueCertificateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("certificate_issue", {
    p_student_id: parsed.data.studentId,
    p_template_id: parsed.data.templateId,
    p_issued_on: parsed.data.issuedOn,
    p_extra: cleanExtra(parsed.data.extra),
  });

  if (error) {
    // The engine's refusals are written to be shown to a person -- "Nothing
    // filled {{reason}}", "A transfer certificate has already been issued" --
    // so they are passed through rather than replaced with a generic sentence.
    return { ok: false, error: error.message };
  }

  const row = data as { id: string; serial_no: string } | null;
  if (!row) return { ok: false, error: "The certificate was not created." };

  revalidatePath("/certificates");
  return { ok: true, data: { id: row.id, serialNo: row.serial_no } };
}

export async function cancelCertificate(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = cancelCertificateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("certificate_cancel", {
    p_certificate_id: parsed.data.certificateId,
    p_reason: parsed.data.reason,
  });

  if (error) return { ok: false, error: error.message };

  const row = data as { id: string } | null;
  if (!row) return { ok: false, error: "The certificate was not cancelled." };

  revalidatePath("/certificates");
  revalidatePath(`/certificates/${parsed.data.certificateId}`);
  return { ok: true, data: { id: row.id } };
}

export async function getCertificate(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("certificates")
    .select(
      "id, serial_no, issued_on, kind, template_name, body, snapshot, status, cancelled_at, cancel_reason",
    )
    .eq("id", id)
    .maybeSingle();
  return data;
}
