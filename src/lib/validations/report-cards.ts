import { z } from "zod";

/**
 * Phase 3.2 — the report card.
 *
 * The card arrives from Postgres as one `jsonb` document per student
 * (`exams_report_cards`), assembled there rather than joined together here, for
 * the reason every read model in this project is: the thing that prints the
 * card and the thing that froze it must not be free to disagree.
 *
 * These are the shapes it comes in, plus the handful of formatters a card needs
 * — an ordinal, a rank sentence, and an attendance percentage that refuses to
 * divide by zero.
 */

export const cardPaperSchema = z.object({
  subject: z.string(),
  code: z.string().nullable(),
  max: z.number(),
  pass: z.number(),
  obtained: z.number().nullable(),
  grace: z.number().nullable(),
  effective: z.number().nullable(),
  percent: z.number().nullable(),
  passed: z.boolean(),
  counted: z.boolean(),
  optional: z.boolean(),
  absent: z.boolean(),
  note: z.string().nullable(),
});
export type CardPaper = z.infer<typeof cardPaperSchema>;

export const reportCardSchema = z.object({
  school: z.object({ name: z.string() }),
  session: z.object({ id: z.string(), name: z.string() }),
  exam: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    status: z.string(),
    starts_on: z.string().nullable(),
    ends_on: z.string().nullable(),
    published_at: z.string().nullable(),
  }),
  provisional: z.boolean(),
  student: z.object({
    id: z.string(),
    name: z.string(),
    admission_number: z.string().nullable(),
    roll_number: z.string().nullable(),
    section: z.string().nullable(),
    class_teacher: z.string().nullable(),
  }),
  papers: z.array(cardPaperSchema).nullable(),
  totals: z.object({
    obtained: z.number(),
    max: z.number(),
    percentage: z.number(),
    grade: z.string().nullable(),
    grade_point: z.number().nullable(),
    result: z.string(),
    subjects_counted: z.number(),
    subjects_failed: z.number(),
  }),
  rank: z
    .object({
      position: z.number(),
      cohort_size: z.number(),
      scope: z.string(),
    })
    .nullable(),
  attendance: z
    .object({
      upto: z.string().nullable().optional(),
      marked: z.number(),
      present: z.number(),
      absent: z.number(),
      late: z.number(),
      excused: z.number(),
    })
    .nullable(),
  remark: z
    .object({
      text: z.string(),
      updated_at: z.string().nullable(),
    })
    .nullable(),
});
export type ReportCard = z.infer<typeof reportCardSchema>;

/**
 * Parse a card that came back from Postgres. A card that does not match is not
 * rendered at all: half a report card is worse than a message saying it could
 * not be built, because a parent cannot tell which half is missing.
 */
export function parseCard(value: unknown): ReportCard | null {
  const result = reportCardSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const remarkSchema = z.object({
  studentId: z.string().uuid(),
  remark: z
    .string()
    .max(500, "A remark is one line on a card. Keep it under 500 characters."),
});
export type RemarkInput = z.infer<typeof remarkSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** `1` → `1st`, `2` → `2nd`, `11` → `11th`. */
export function ordinal(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${abs}th`;
  switch (abs % 10) {
    case 1:
      return `${abs}st`;
    case 2:
      return `${abs}nd`;
    case 3:
      return `${abs}rd`;
    default:
      return `${abs}th`;
  }
}

const SCOPE_WORDS: Record<string, string> = {
  section: "in the section",
  class_level: "in the class",
  school: "in the school",
};

/**
 * "4th of 38 in the section". The denominator is never dropped: a rank without
 * the size of the cohort it was taken over is the single most misread number on
 * a report card.
 */
export function rankSentence(rank: ReportCard["rank"]): string | null {
  if (!rank) return null;
  const where = SCOPE_WORDS[rank.scope] ?? "in the cohort";
  return `${ordinal(rank.position)} of ${rank.cohort_size} ${where}`;
}

/**
 * Days attended as a percentage. A late arrival still attended; an excused
 * absence did not. A school that reads this differently gets a rules key, not a
 * patch — but until one asks, this is the reading, and it is written down here
 * rather than assumed.
 */
export function attendancePercent(a: ReportCard["attendance"]): number | null {
  if (!a || a.marked <= 0) return null;
  return Math.round(((a.present + a.late) / a.marked) * 1000) / 10;
}

/** "172 of 180 days", or a sentence saying why there is no figure. */
export function attendanceSentence(a: ReportCard["attendance"]): string {
  if (!a) return "Not recorded for this card";
  if (a.marked <= 0) return "No register was taken in this period";
  return `${a.present + a.late} of ${a.marked} days`;
}

/** Marks as they appear in a card's table: absent is `AB`, unmarked is a dash. */
export function paperMark(paper: CardPaper): string {
  if (paper.absent) return "AB";
  if (paper.obtained === null || paper.obtained === undefined) return "—";
  return String(Number(paper.obtained));
}

/**
 * Why a paper reads the way it does — grace applied, dropped by best-of-N,
 * substituted. The engine already wrote the sentence; this only decides whether
 * there is one worth printing.
 */
export function paperNote(paper: CardPaper): string | null {
  if (paper.note && paper.note.trim() !== "") return paper.note;
  if (!paper.counted) return "Not counted towards the aggregate";
  if (paper.grace && paper.grace > 0) return `Includes ${paper.grace} grace mark(s)`;
  return null;
}
