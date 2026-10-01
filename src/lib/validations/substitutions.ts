import { z } from "zod";
/**
 * Substitutions — the client half.
 *
 * The vocabulary and the sentences a person reads at half past seven in the
 * morning. Every judgement is in Postgres: who is away (`staff_is_away`), who
 * is free (`substitution_candidates`), whether an arrangement double-books
 * somebody (a partial unique index), and what has gone stale since it was made
 * (`substitution_problems`).
 */
/**
 * How bad a finding is lives in `./severity` — one definition, consulted by
 * everything. This module had the list and one of the six `severityTone`
 * copies; re-exported here so a caller that thinks of it as part of the
 * substitutions vocabulary still finds it, and so there is still exactly one
 * body.
 */
import { PROBLEM_SEVERITIES, SEVERITY_LABEL, severityLabel, severityTone, type ProblemSeverity } from "./severity";
export { PROBLEM_SEVERITIES, SEVERITY_LABEL, severityLabel, severityTone };
export type { ProblemSeverity };
export { severityRank, candidateReason, coverSummary, reasonLabel, reasonTone, periodLabel, todayIso } from "./substitutions-display";

export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a day");

export const arrangeCoverSchema = z.object({
  timetableEntryId: z.string().uuid(),
  onDate: dateStringSchema,
  /**
   * Null is a real answer, not a missing one: "the class is merged into 5B" or
   * "supervised study". The server stores a row with no substitute, which is an
   * arrangement — the *gap* is the absence of a row. Collapsing the two would
   * make the morning list wrong in the direction that leaves a class alone.
   */
  substituteStaffId: z.string().uuid().nullable().default(null),
  note: z.string().trim().max(300).optional(),
});

export type ArrangeCoverInput = z.infer<typeof arrangeCoverSchema>;

export const clearCoverSchema = z.object({
  timetableEntryId: z.string().uuid(),
  onDate: dateStringSchema,
});
