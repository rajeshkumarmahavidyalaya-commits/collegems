import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";
import type { ProblemSeverity } from "./severity";
import type { CertificateProblem } from "./certificates";

/**
 * The half of `certificates.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `certificates.ts` re-exports all of it.
 */

// The CHECK on certificate_templates.kind is the list (0101); this is the
// labels for it. `experience` and `service` (0245) were missing here for
// fifty migrations and printed as the raw word on the register.
export const CERTIFICATE_KINDS = [
  "transfer",
  "bonafide",
  "character",
  "study",
  "conduct",
  "experience",
  "service",
  "admission",
  "appointment",
  "custom",
] as const;

export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export const KIND_LABEL: Record<CertificateKind, string> = {
  transfer: "Transfer certificate",
  bonafide: "Bonafide certificate",
  character: "Character certificate",
  study: "Study certificate",
  conduct: "Conduct certificate",
  experience: "Experience certificate",
  service: "Service certificate",
  admission: "Admission letter",
  appointment: "Appointment letter",
  custom: "Other",
};

/**
 * What issuing one *does*, in a sentence, shown next to the button.
 *
 * A transfer certificate is the only kind that changes a record, and somebody
 * clicking "Issue" on a Tuesday afternoon deserves to be told that before it
 * happens rather than to find the child missing from a class list in April.
 */
export const KIND_CONSEQUENCE: Partial<Record<CertificateKind, string>> = {
  transfer:
    "Issuing this marks the student as transferred and takes them off the active roll. Cancelling the certificate puts them back.",
};

export function kindLabel(kind: string, t: Translator): string {
  const fallback = KIND_LABEL[kind as CertificateKind];
  return fallback ? labelFor(`certificate.kind.${kind}`, fallback, t) : kind;
}

// ---------------------------------------------------------------------------
// The template's own extra fields
// ---------------------------------------------------------------------------

// Moved from `certificates.ts` so a screen can use these without loading zod.

/** Errors first, then warnings, then notes — the order somebody acts in. */
export function sortProblems(problems: CertificateProblem[]): CertificateProblem[] {
  const rank: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...problems].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Which of a template's required fields have not been filled in yet. */
export function missingRequiredFields(
  fields: TemplateField[],
  extra: Record<string, string>,
): string[] {
  return fields.filter((f) => f.required && !(extra[f.name] ?? "").trim()).map((f) => f.name);
}

/** A field a template asks the person issuing it to fill in. */
export type TemplateField = { name: string; label: string; required: boolean; placeholder?: string };

/**
 * A template's declared `fields`, read by hand rather than with
 * `z.array(templateFieldSchema)` so the issue form does not load zod to draw
 * them (85 kB on `/certificates/issue`). Same answers as the schema it
 * replaced, which `tests/certificates/certificate-forms.test.ts` pins: all or
 * nothing -- one malformed entry makes the whole list empty, as `safeParse`
 * did -- `required` defaults to false, and unknown keys are dropped.
 */
export function parseTemplateFields(raw: unknown): TemplateField[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const f = item as Record<string, unknown>;
    if (typeof f.name !== "string" || typeof f.label !== "string") return [];
    if (f.required !== undefined && typeof f.required !== "boolean") return [];
    if (f.placeholder !== undefined && typeof f.placeholder !== "string") return [];
    const field: TemplateField = { name: f.name, label: f.label, required: f.required ?? false };
    if (f.placeholder !== undefined) field.placeholder = f.placeholder;
    out.push(field);
  }
  return out;
}
