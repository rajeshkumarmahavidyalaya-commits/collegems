"use server";

import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages/en";
import { applicationPayload, applicationSchema, refusalKey } from "@/lib/validations/admissions";
import { HONEYPOT_FIELD } from "@/lib/validations/admissions-display";

export type ApplyState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  /**
   * What was submitted, handed back on a refusal. React resets an uncontrolled
   * form once its action settles, so without this a parent who mistyped one
   * digit of a phone number would find all ten fields empty.
   */
  values?: Record<string, string>;
  done?: { reference: string | null; duplicate: boolean };
};

const FIELDS = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "classLevelId",
  "contactName",
  "relationship",
  "contactPhone",
  "contactEmail",
  "notes",
] as const;

/**
 * Send one application.
 *
 * Runs as whoever is asking, which is almost always `anon`. The Supabase
 * client carries no service key and needs none: `admission_apply` is granted
 * to `anon` on purpose and decides, inside itself, every column that matters.
 * So this action sends the child and the contact and **nothing else** — no
 * college id, no year, no source, no status. The slug comes from the URL, which
 * is the one fact the applicant genuinely chose.
 */
export async function submitApplication(
  slug: string,
  _prev: ApplyState,
  formData: FormData,
): Promise<ApplyState> {
  const t = await getT();

  // The honeypot (see `admissions-display.ts`). Answered as a success with no
  // number, because a bot does not read the page and a person never reaches
  // this branch. An error would teach a script which field to leave alone.
  if (String(formData.get(HONEYPOT_FIELD) ?? "").trim() !== "") {
    return { error: null, done: { reference: null, duplicate: false } };
  }

  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };

  const values: Record<string, string> = {};
  for (const name of FIELDS) values[name] = text(name) ?? "";

  const parsed = applicationSchema.safeParse({
    firstName: text("firstName") ?? "",
    lastName: text("lastName"),
    dateOfBirth: text("dateOfBirth"),
    gender: text("gender") ?? "",
    classLevelId: text("classLevelId") ?? "",
    contactName: text("contactName") ?? "",
    relationship: text("relationship"),
    contactPhone: text("contactPhone"),
    contactEmail: text("contactEmail"),
    notes: text("notes"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      if (field && !fieldErrors[field]) fieldErrors[field] = t(issue.message as MessageKey);
    }
    return { error: t("apply.error.fields"), fieldErrors, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admission_apply", {
    p_slug: slug,
    p_application: applicationPayload(parsed.data),
  });

  if (error) {
    // `P0001` is a sentence `admission_apply` wrote for this reader. Three of
    // them are mapped so they arrive in the reader's language; any other is a
    // bound the schema above failed to copy, and is shown as written rather
    // than hidden behind "try again", which would be a lie about what to do.
    if (error.code === "P0001") {
      const mapped = refusalKey(error.message);
      return { error: mapped ? t(mapped) : error.message, values };
    }
    console.error("[apply] admission_apply failed:", error.code, error.message);
    return { error: t("apply.error.generic"), values };
  }

  const result = (data ?? {}) as { reference?: string; duplicate?: boolean };
  return {
    error: null,
    done: { reference: result.reference ?? null, duplicate: Boolean(result.duplicate) },
  };
}
