import { z } from "zod";

// Everything that is not a schema lives in `promotion-display.ts` (no Zod).
export * from "./promotion-display";

export const promotionRulesSchema = z.object({
  no_detention_up_to_sequence: z
    .number()
    .int()
    .min(1)
    .max(20)
    .nullable()
    .optional(),
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

function optionalNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
