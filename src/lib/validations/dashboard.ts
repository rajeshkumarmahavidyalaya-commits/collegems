import { z } from "zod";

/**
 * The home page's contract with `dashboard_summary()`.
 *
 * The function returns one jsonb document per request — the whole brief in a
 * single round trip, because a home page opened by every member of staff every
 * morning is the one screen where a dozen separate queries actually costs
 * somebody something.
 *
 * Three things this file is deliberately responsible for, and the page is not:
 *
 *   1. **Parsing, not casting.** The brief is written by a migration, so this
 *      is not a trust boundary — but a block that drifted from what the page
 *      can render should degrade to "not available" rather than crash the home
 *      page for everybody. Every block is `.nullish()` and the whole document
 *      is `safeParse`d.
 *   2. **Saying why a block is missing.** `withheld` names the blocks the
 *      caller's role may not see. Absent-and-withheld ("your role does not see
 *      fee figures") and absent-and-empty ("no exam has been published") are
 *      different sentences, and only the server knows which one applies.
 *   3. **Turning numbers into the phrasing the cards use** — `registerState`,
 *      `attendanceRate`, `collectionRate` — so those readings are unit-tested
 *      without a database and cannot drift between the two register cards.
 */

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const count = z.number().nullish().transform((v) => v ?? 0);
const money = z.coerce.number().nullish().transform((v) => v ?? 0);

export const schoolBlockSchema = z.object({
  students: count,
  sections: count,
  /** Null when the caller may see the roll but not the staff directory. */
  staff: z.number().nullable().catch(null),
});

export const enrolmentRowSchema = z.object({
  grade: z.string(),
  sequence: z.number(),
  students: count,
  male: count,
  female: count,
  other: count,
  unstated: count,
});

export const studentRegisterSchema = z.object({
  present: count,
  late: count,
  absent: count,
  excused: count,
  marked: count,
});

export const staffRegisterSchema = z.object({
  present: count,
  absent: count,
  half_day: count,
  on_leave: count,
  on_duty: count,
  marked: count,
  roll: count,
  is_working_day: z.boolean().nullish().transform((v) => v ?? true),
});

export const feesBlockSchema = z.object({
  billed: money,
  collected: money,
  outstanding: money,
  students_owing: count,
  collected_today: money,
  receipts_today: count,
});

export const examBlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  published_at: z.string().nullable().catch(null),
  passed: count,
  failed: count,
  incomplete: count,
  graded: count,
  average_percent: z.coerce.number().nullable().catch(null),
  pass_percent: z.coerce.number().nullable().catch(null),
});

export const libraryBlockSchema = z.object({
  issued: count,
  overdue: count,
});

export const dashboardSummarySchema = z.object({
  today: z.string(),
  role: z.string().nullable().catch(null),
  session_id: z.string().nullable().catch(null),
  school: schoolBlockSchema.nullish(),
  enrolment: z.array(enrolmentRowSchema).nullish(),
  student_attendance: studentRegisterSchema.nullish(),
  staff_attendance: staffRegisterSchema.nullish(),
  fees: feesBlockSchema.nullish(),
  exam: examBlockSchema.nullish(),
  library: libraryBlockSchema.nullish(),
  withheld: z.array(z.string()).nullish().transform((v) => v ?? []),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type EnrolmentRow = z.infer<typeof enrolmentRowSchema>;

export function parseDashboardSummary(raw: unknown): DashboardSummary | null {
  const parsed = dashboardSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The blocks a person's role is not allowed to see, in the order they'd read. */
export const BLOCK_LABEL: Record<string, string> = {
  school: "the roll",
  student_attendance: "student attendance",
  staff_attendance: "staff attendance",
  fees: "fee figures",
  exam: "exam results",
  library: "the library",
};

export function withheldSentence(withheld: string[]): string | null {
  if (withheld.length === 0) return null;
  const names = withheld.map((k) => BLOCK_LABEL[k] ?? k);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Your role does not see ${list}, so ${names.length === 1 ? "that card is" : "those cards are"} not shown.`;
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/**
 * What a register card should *say*, which is not always a number.
 *
 * Three states, and conflating any two of them is how a dashboard lies:
 *
 *   - `holiday`  — the school is closed, so an empty register is correct.
 *   - `not-taken` — it is a working day and nobody has marked anybody yet.
 *     This is the state that must never render as 0%: "0% present" and "nobody
 *     has taken the register" look identical on a card and mean opposite
 *     things.
 *   - `taken`    — there is a percentage, and it is over what was marked rather
 *     than over the roll, so a register half taken reads as half taken instead
 *     of as a school half empty.
 */
export type RegisterState =
  | { kind: "holiday" }
  | { kind: "not-taken" }
  | { kind: "taken"; percent: number };

export function registerState(input: {
  marked: number;
  counted: number;
  present: number;
  isWorkingDay?: boolean;
}): RegisterState {
  if (input.isWorkingDay === false) return { kind: "holiday" };
  if (input.marked === 0 || input.counted === 0) return { kind: "not-taken" };
  return { kind: "taken", percent: Math.round((input.present / input.counted) * 100) };
}

/** The student register: present and late both attended; excused is neither. */
export function studentRegisterReading(r: z.infer<typeof studentRegisterSchema>): RegisterState {
  return registerState({
    marked: r.marked,
    counted: r.present + r.absent,
    present: r.present,
  });
}

/** The staff register: on duty is in; a half day is half. Leave is neither. */
export function staffRegisterReading(r: z.infer<typeof staffRegisterSchema>): RegisterState {
  const counted = r.present + r.absent + r.on_duty + r.half_day;
  return registerState({
    marked: r.marked,
    counted,
    present: r.present + r.on_duty + 0.5 * r.half_day,
    isWorkingDay: r.is_working_day,
  });
}

/**
 * How much of what was billed has come in. Null rather than 0 when nothing has
 * been billed: a school that has not raised an invoice yet has not collected
 * 0% of its fees, it has no collection rate at all, and a progress bar sitting
 * at empty says the first thing.
 */
export function collectionRate(fees: { billed: number; collected: number }): number | null {
  if (fees.billed <= 0) return null;
  return Math.round((fees.collected / fees.billed) * 100);
}

/** Green above 85, amber above 60, red below — the same thresholds everywhere. */
export function attendanceTone(percent: number | null): "default" | "success" | "warning" | "danger" {
  if (percent === null) return "default";
  if (percent >= 85) return "success";
  if (percent >= 60) return "warning";
  return "danger";
}
