import { z } from "zod";

/**
 * Phase 1.4 — promotion, as a preview you can argue with.
 *
 * The rules are a JSONB document (rule 12) and the evaluation order is part of
 * the contract, so it is written down here as well as in the migration and the
 * docs — a person reading the form needs to know that no-detention beats
 * attendance, which beats the examination.
 */

export const DECISIONS = [
  {
    value: "promote",
    label: "Promote",
    tone: "success",
    hint: "Moves up a class in the receiving session.",
  },
  {
    value: "repeat",
    label: "Repeat",
    tone: "warning",
    hint: "Stays in the same class in the receiving session.",
  },
  {
    value: "graduate",
    label: "Graduate",
    tone: "info",
    hint: "Leaves the school as an alumnus. No new enrolment.",
  },
  {
    value: "hold",
    label: "Hold",
    tone: "muted",
    hint: "Nothing happens. The outgoing enrolment stays open.",
  },
] as const;

export type Decision = (typeof DECISIONS)[number]["value"];

export const ON_MISSING_RESULT = [
  {
    value: "hold",
    label: "Hold them",
    hint: "The safe answer: somebody has to look at it.",
  },
  { value: "promote", label: "Promote anyway", hint: "Treat a missing result as a pass." },
  { value: "repeat", label: "Make them repeat", hint: "Treat a missing result as a failure." },
] as const;

export const EXAM_KINDS_FOR_PROMOTION = [
  { value: "annual", label: "Annual" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "term", label: "Term exam" },
  { value: "unit", label: "Unit test" },
] as const;

/**
 * The order in which the rules are consulted. Rendered on the screen because
 * "why was this child promoted despite failing" is answered by the order, not
 * by any single rule.
 */
export const EVALUATION_ORDER = [
  "The no-detention band promotes regardless of anything else.",
  "Attendance below the minimum makes a student repeat, even having passed.",
  "The examination decides everyone else.",
  "A missing result falls to whatever you chose for it — never silently a failure.",
] as const;

export const promotionRulesSchema = z.object({
  no_detention_up_to_sequence: z.number().int().min(1).max(20).nullable().optional(),
  criteria: z
    .object({
      require_exam_pass: z.boolean().optional(),
      exam_kind: z.string().optional(),
      max_failed_subjects: z.number().int().min(0).max(20).optional(),
      min_attendance_percent: z.number().min(0).max(100).nullable().optional(),
    })
    .optional(),
  on_missing_result: z.enum(["hold", "promote", "repeat"]).optional(),
  carry_forward_fees: z.boolean().optional(),
});
export type PromotionRules = z.infer<typeof promotionRulesSchema>;

/**
 * The form is flat because react-hook-form is; the union above is rebuilt on
 * submit. Numbers arrive as strings from `<input type="number">` and are
 * converted here rather than with `z.coerce`, which would split the schema's
 * input and output types and break the resolver.
 */
export const promotionFormSchema = z.object({
  fromSessionId: z.string().uuid("Choose the session to promote from"),
  toSessionId: z.string().uuid("Choose the session to promote into"),
  noDetentionUpTo: z.string(),
  requireExamPass: z.boolean(),
  examKind: z.string(),
  maxFailedSubjects: z.string(),
  minAttendancePercent: z.string(),
  onMissingResult: z.enum(["hold", "promote", "repeat"]),
  carryForwardFees: z.boolean(),
});
export type PromotionFormInput = z.infer<typeof promotionFormSchema>;

function optionalNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Turn the flat form into the document Postgres evaluates. */
export function toRules(input: PromotionFormInput): PromotionRules {
  const band = optionalNumber(input.noDetentionUpTo);
  const attendance = optionalNumber(input.minAttendancePercent);
  const maxFailed = optionalNumber(input.maxFailedSubjects);

  return {
    // Omitted rather than null when unset: `promotion_preview` reads a missing
    // key as "no band", and an explicit null would mean the same thing twice.
    ...(band === null ? {} : { no_detention_up_to_sequence: band }),
    criteria: {
      require_exam_pass: input.requireExamPass,
      exam_kind: input.examKind,
      max_failed_subjects: maxFailed ?? 0,
      ...(attendance === null ? {} : { min_attendance_percent: attendance }),
    },
    on_missing_result: input.onMissingResult,
    carry_forward_fees: input.carryForwardFees,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function decisionLabel(value: string) {
  return DECISIONS.find((d) => d.value === value)?.label ?? value;
}

export function decisionTone(value: string) {
  return DECISIONS.find((d) => d.value === value)?.tone ?? "muted";
}

/**
 * Which decisions a person may switch a row to, given where the student is.
 * `graduate` is not offered: whether there is a next class is a fact about the
 * school, not a choice — and offering it would let somebody graduate a
 * seven-year-old.
 */
export function switchableDecisions(hasNextClass: boolean): Decision[] {
  return hasNextClass ? ["promote", "repeat", "hold"] : ["repeat", "hold"];
}

/**
 * A promotion or a repeat has to land somewhere; a graduate and a hold must
 * not. The database says the same thing with a check constraint — this is so
 * the form can say it before the save is refused.
 */
export function needsTargetSection(decision: string) {
  return decision === "promote" || decision === "repeat";
}
