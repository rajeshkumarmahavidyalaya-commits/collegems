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

export const PROBLEM_SEVERITIES = ["error", "warning", "info"] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

export const SEVERITY_LABEL: Record<ProblemSeverity, string> = {
  error: "Needs fixing",
  warning: "Check this",
  info: "Note",
};

export function severityLabel(severity: string): string {
  return SEVERITY_LABEL[severity as ProblemSeverity] ?? severity;
}

/** Never colour alone — `severityLabel` always sits beside this. */
export function severityTone(severity: string): "destructive" | "warning" | "secondary" {
  switch (severity) {
    case "error":
      return "destructive";
    case "warning":
      return "warning";
    default:
      return "secondary";
  }
}

/** Worst first: a class with nobody in it outranks a note about a merge. */
export function severityRank(severity: string): number {
  const index = (PROBLEM_SEVERITIES as readonly string[]).indexOf(severity);
  return index === -1 ? PROBLEM_SEVERITIES.length : index;
}

/**
 * Why the server put this person near the top. The order is advice — a head of
 * department overruling it is the normal case — so the reason is shown rather
 * than the rank, which would read as a score somebody has to trust.
 */
export function candidateReason(candidate: {
  teachesSubject: boolean;
  coversToday: number;
  periodsToday: number;
}): string {
  const parts: string[] = [];
  parts.push(candidate.teachesSubject ? "Teaches the subject" : "Different subject");
  parts.push(
    candidate.coversToday === 0
      ? "no cover yet today"
      : candidate.coversToday === 1
        ? "1 cover already today"
        : `${candidate.coversToday} covers already today`,
  );
  parts.push(
    candidate.periodsToday === 1 ? "1 lesson of their own" : `${candidate.periodsToday} lessons of their own`,
  );
  return parts.join(" · ");
}

/**
 * The one line at the top of the screen. Two numbers, not one: "3 of 7
 * arranged" and "7 lessons need cover" are different mornings, and a single
 * percentage hides which.
 */
export function coverSummary(gaps: { arranged: boolean }[]): string {
  if (gaps.length === 0) return "Nobody is away. Nothing to arrange.";
  const arranged = gaps.filter((g) => g.arranged).length;
  const outstanding = gaps.length - arranged;
  if (outstanding === 0) {
    return gaps.length === 1
      ? "The one lesson needing cover is arranged."
      : `All ${gaps.length} lessons needing cover are arranged.`;
  }
  return `${outstanding} of ${gaps.length} still to arrange.`;
}

/** "Period 3 · 10:15" — the two things a person actually looks for. */
export function periodLabel(periodNumber: number | null, startsAt: string | null): string {
  const period = periodNumber === null ? "Period" : `Period ${periodNumber}`;
  if (!startsAt) return period;
  return `${period} · ${startsAt.slice(0, 5)}`;
}

/** Today, in the browser's own calendar, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
