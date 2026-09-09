import { z } from "zod";
import { labelFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The certificates module's client half.
 *
 * The server owns every judgement here — what a certificate says, whether it
 * can be issued, and what is wrong with it — and this file only parses the
 * answer. That split is deliberate and it is the module's main safety property:
 * `certificate_issue` recomputes the preview server-side and ignores whatever
 * the screen believed, so nothing in this file can talk it into issuing a
 * document with `{{father_name}}` printed on it.
 */

export const CERTIFICATE_KINDS = [
  "transfer",
  "bonafide",
  "character",
  "study",
  "conduct",
  "custom",
] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export const KIND_LABEL: Record<CertificateKind, string> = {
  transfer: "Transfer certificate",
  bonafide: "Bonafide certificate",
  character: "Character certificate",
  study: "Study certificate",
  conduct: "Conduct certificate",
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

/**
 * Rules-as-data, per rule 12: a board that wants three more boxes on its
 * leaving certificate is a row in `certificate_templates.fields`, not a
 * release. Parsed rather than cast for the reason the report catalog is —
 * a descriptor that drifted must degrade to a text input, not crash the page.
 */
export const templateFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  required: z.boolean().optional().default(false),
  placeholder: z.string().optional(),
});
export type TemplateField = z.infer<typeof templateFieldSchema>;

export function parseTemplateFields(raw: unknown): TemplateField[] {
  const result = z.array(templateFieldSchema).safeParse(raw);
  return result.success ? result.data : [];
}

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

export const PROBLEM_SEVERITIES = ["error", "warning", "info"] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

export const problemSchema = z.object({
  severity: z.enum(PROBLEM_SEVERITIES).catch("warning"),
  message: z.string(),
});
export type CertificateProblem = z.infer<typeof problemSchema>;

export const previewSchema = z.object({
  template_id: z.string(),
  template_name: z.string(),
  kind: z.string(),
  fields: z.unknown(),
  snapshot: z.record(z.string(), z.unknown()).nullish(),
  body: z.string(),
  unresolved: z.array(z.string()).nullish().transform((v) => v ?? []),
  problems: z.array(problemSchema).nullish().transform((v) => v ?? []),
  /**
   * The server's answer, not the client's. Never recompute this from
   * `problems` — the two would be free to disagree, and the disagreement would
   * show up as a button that looks enabled and then throws.
   */
  can_issue: z.boolean(),
});
export type CertificatePreview = z.infer<typeof previewSchema>;

export function parsePreview(raw: unknown): CertificatePreview | null {
  const parsed = previewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Errors first, then warnings, then notes — the order somebody acts in. */
export function sortProblems(problems: CertificateProblem[]): CertificateProblem[] {
  const rank: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 };
  return [...problems].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function countBySeverity(problems: CertificateProblem[]): Record<ProblemSeverity, number> {
  return problems.reduce(
    (acc, p) => ({ ...acc, [p.severity]: acc[p.severity] + 1 }),
    { error: 0, warning: 0, info: 0 } as Record<ProblemSeverity, number>,
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * `extra` is a free map because the template decides its own keys. The values
 * are trimmed and empty ones dropped, so a box somebody tabbed through without
 * typing leaves its placeholder standing and the server refuses — rather than
 * printing a certificate with a blank where the reason for leaving should be.
 */
export const issueCertificateSchema = z.object({
  studentId: z.string().uuid("Choose a student"),
  templateId: z.string().uuid("Choose a certificate"),
  issuedOn: z.string().min(1, "Choose the date of issue"),
  extra: z.record(z.string(), z.string()).default({}),
});
export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export const cancelCertificateSchema = z.object({
  certificateId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(4, "Say why it is being cancelled — the certificate stays in the register for ever"),
});

export function cleanExtra(extra: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(extra)
      .map(([k, v]) => [k, (v ?? "").trim()] as const)
      .filter(([, v]) => v !== ""),
  );
}

/** Which of a template's required fields have not been filled in yet. */
export function missingRequiredFields(
  fields: TemplateField[],
  extra: Record<string, string>,
): string[] {
  return fields.filter((f) => f.required && !(extra[f.name] ?? "").trim()).map((f) => f.name);
}
