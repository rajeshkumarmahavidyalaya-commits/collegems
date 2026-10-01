import { z } from "zod";
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
import { PROBLEM_SEVERITIES, type ProblemSeverity } from "./severity";
export { PROBLEM_SEVERITIES, type ProblemSeverity };
export { CERTIFICATE_KINDS, KIND_LABEL, KIND_CONSEQUENCE, kindLabel } from "./certificates-display";
export type { CertificateKind } from "./certificates-display";
export { sortProblems, missingRequiredFields, parseTemplateFields } from "./certificates-display";
export type { TemplateField } from "./certificates-display";

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

// `TemplateField` and `parseTemplateFields` live in certificates-display.ts:
// the issue form reads a template's fields to draw them, and that is not a
// reason for the page to load zod. `templateFieldSchema` stays here for the
// server; the test pins the two to the same answers.

// ---------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------

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
  // Whoever the certificate is about. The *template* says which kind of
  // person that is, so the client sends one id and the server decides which
  // column it lands in — `0224`'s invitation lesson, one module along.
  subjectId: z.string().uuid("Choose who the certificate is for"),
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
