"use server";

import { createClient } from "@/lib/supabase/server";
import { HONEYPOT_FIELD } from "@/lib/validations/admissions-display";
import {
  DATE_PATTERN,
  EMAIL_PATTERN,
  ENQUIRY_KEYS,
  EXPERIENCE_PATTERN,
  PHONE_PATTERN,
  PUBLIC_LIMITS,
  STAFF_APPLICATION_KEYS,
  publicRefusalKey,
  readAdmitCard,
  readCertificate,
  readResults,
  type AdmitCard,
  type CertificateCheck,
  type PublicResult,
} from "@/lib/validations/public-pages";

/**
 * The college's public pages (migration 0361).
 *
 * Every action here runs as whoever is asking, which is almost always `anon`.
 * The client carries no service key and needs none: each function is granted
 * to `anon` on purpose, named in `definer_guard_violations()`, and decides
 * inside itself every column that matters. So an action sends what the person
 * typed and the slug from the URL, and **nothing else**.
 *
 * Errors come back as message keys where this file knows the sentence, so the
 * page shows them in the reader's language; a sentence it does not know is
 * shown as the function wrote it.
 */

export type PublicFormState = {
  errorKey?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  done?: { reference: string | null; duplicate: boolean };
};

export type LookupState<T> = {
  errorKey?: string;
  error?: string;
  values?: Record<string, string>;
  result?: T | null;
};

function text(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function refusal(message: string, fallback: string): { errorKey?: string; error?: string } {
  const key = publicRefusalKey(message);
  return key ? { errorKey: key } : message ? { error: message } : { errorKey: fallback };
}

/** A bot filled the field no person sees: answer as a success with no number. */
function isBot(formData: FormData): boolean {
  return text(formData, HONEYPOT_FIELD) !== "";
}

function contactErrors(values: Record<string, string>, fe: Record<string, string>) {
  if (!values.phone && !values.email) fe.phone = "apply.error.contact";
  if (values.phone && !PHONE_PATTERN.test(values.phone)) fe.phone = "apply.error.phone";
  if (values.email && (values.email.length > PUBLIC_LIMITS.email || !EMAIL_PATTERN.test(values.email))) {
    fe.email = "apply.error.email";
  }
}

export async function sendEnquiry(slug: string, _prev: PublicFormState, formData: FormData): Promise<PublicFormState> {
  if (isBot(formData)) return { done: { reference: null, duplicate: false } };

  const values = Object.fromEntries(ENQUIRY_KEYS.map((k) => [k, text(formData, k)])) as Record<
    (typeof ENQUIRY_KEYS)[number],
    string
  >;
  const fe: Record<string, string> = {};
  if (!values.student_name) fe.student_name = "public.enquiry.error.studentName";
  else if (values.student_name.length > PUBLIC_LIMITS.studentName) fe.student_name = "apply.error.tooLong";
  if (!values.contact_name) fe.contact_name = "apply.error.contactName";
  else if (values.contact_name.length > PUBLIC_LIMITS.contactName) fe.contact_name = "apply.error.tooLong";
  if (values.message.length > PUBLIC_LIMITS.enquiryMessage) fe.message = "apply.error.tooLong";
  contactErrors(values, fe);
  if (Object.keys(fe).length > 0) return { errorKey: "apply.error.fields", fieldErrors: fe, values };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_enquiry", { p_slug: slug, p_enquiry: values });
  if (error) {
    if (error.code !== "P0001") console.error("[college] public_enquiry failed:", error.code, error.message);
    return { ...refusal(error.code === "P0001" ? error.message : "", "public.error.generic"), values };
  }
  const result = (data ?? {}) as { reference?: unknown; duplicate?: unknown };
  return {
    done: {
      reference: typeof result.reference === "string" ? result.reference : null,
      duplicate: result.duplicate === true,
    },
  };
}

export async function sendStaffApplication(
  slug: string,
  _prev: PublicFormState,
  formData: FormData,
): Promise<PublicFormState> {
  if (isBot(formData)) return { done: { reference: null, duplicate: false } };

  const values = Object.fromEntries(STAFF_APPLICATION_KEYS.map((k) => [k, text(formData, k)])) as Record<
    (typeof STAFF_APPLICATION_KEYS)[number],
    string
  >;
  const fe: Record<string, string> = {};
  if (!values.first_name) fe.first_name = "apply.error.firstName";
  for (const k of ["first_name", "last_name"] as const) {
    if (values[k].length > PUBLIC_LIMITS.name) fe[k] = "apply.error.tooLong";
  }
  if (!values.position) fe.position = "public.jobs.error.position";
  else if (values.position.length > PUBLIC_LIMITS.position) fe.position = "apply.error.tooLong";
  if (values.date_of_birth && !DATE_PATTERN.test(values.date_of_birth)) fe.date_of_birth = "apply.error.dateOfBirth";
  if (values.experience_years && !EXPERIENCE_PATTERN.test(values.experience_years)) {
    fe.experience_years = "public.jobs.error.experience";
  }
  if (values.city.length > PUBLIC_LIMITS.city) fe.city = "apply.error.tooLong";
  if (values.qualification.length > PUBLIC_LIMITS.qualification) fe.qualification = "apply.error.tooLong";
  if (values.message.length > PUBLIC_LIMITS.jobMessage) fe.message = "apply.error.tooLong";
  contactErrors(values, fe);
  if (Object.keys(fe).length > 0) return { errorKey: "apply.error.fields", fieldErrors: fe, values };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("public_staff_apply", { p_slug: slug, p_application: values });
  if (error) {
    if (error.code !== "P0001") console.error("[college] public_staff_apply failed:", error.code, error.message);
    return { ...refusal(error.code === "P0001" ? error.message : "", "public.error.generic"), values };
  }
  const result = (data ?? {}) as { reference?: unknown; duplicate?: unknown };
  return {
    done: {
      reference: typeof result.reference === "string" ? result.reference : null,
      duplicate: result.duplicate === true,
    },
  };
}

/**
 * The three lookups share one shape: two facts the person holds, one call,
 * one null for every reason nothing is shown. Each call is counted against the
 * college's hourly limit inside the function, whatever it finds.
 */
async function lookup<T>(
  values: Record<string, string>,
  call: () => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>,
  read: (data: unknown) => T | null,
): Promise<LookupState<T>> {
  if (Object.values(values).some((v) => !v)) return { errorKey: "public.lookup.missing", values };
  if (Object.values(values).some((v) => v.length > PUBLIC_LIMITS.lookup)) return { errorKey: "public.lookup.notFound", values };
  if (values.dob !== undefined && !DATE_PATTERN.test(values.dob)) return { errorKey: "apply.error.dateOfBirth", values };
  const { data, error } = await call();
  if (error) {
    if (error.code !== "P0001") console.error("[college] lookup failed:", error.code, error.message);
    return { ...refusal(error.code === "P0001" ? error.message : "", "public.lookup.error"), values };
  }
  const result = read(data);
  return result ? { result, values } : { errorKey: "public.lookup.notFound", values };
}

export async function checkCertificate(
  slug: string,
  _prev: LookupState<CertificateCheck>,
  formData: FormData,
): Promise<LookupState<CertificateCheck>> {
  const values = { serial: text(formData, "serial"), dob: text(formData, "dob") };
  const supabase = await createClient();
  return lookup(
    values,
    () => supabase.rpc("public_certificate_check", { p_slug: slug, p_serial: values.serial, p_date_of_birth: values.dob }),
    readCertificate,
  );
}

export async function findAdmitCard(
  slug: string,
  _prev: LookupState<AdmitCard>,
  formData: FormData,
): Promise<LookupState<AdmitCard>> {
  const values = {
    exam: text(formData, "exam"),
    admission: text(formData, "admission"),
    dob: text(formData, "dob"),
  };
  const supabase = await createClient();
  return lookup(
    values,
    () =>
      supabase.rpc("public_admit_card", {
        p_slug: slug,
        p_exam_id: /^[0-9a-f-]{36}$/i.test(values.exam) ? values.exam : "00000000-0000-0000-0000-000000000000",
        p_admission_number: values.admission,
        p_date_of_birth: values.dob,
      }),
    readAdmitCard,
  );
}

export async function findResults(
  slug: string,
  _prev: LookupState<{ student: string; results: PublicResult[] }>,
  formData: FormData,
): Promise<LookupState<{ student: string; results: PublicResult[] }>> {
  const values = { admission: text(formData, "admission"), dob: text(formData, "dob") };
  const supabase = await createClient();
  return lookup(
    values,
    () => supabase.rpc("public_results", { p_slug: slug, p_admission_number: values.admission, p_date_of_birth: values.dob }),
    readResults,
  );
}
