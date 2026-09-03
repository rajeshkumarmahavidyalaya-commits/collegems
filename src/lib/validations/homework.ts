import { z } from "zod";

/**
 * Phase 4.3 — homework, submissions, and study material.
 *
 * The only module whose value is mostly *files*, so most of what is worth
 * validating here is about the thing a person types *around* a file: a title, a
 * due date, a mark. The file itself is checked in `src/lib/storage/files.ts`
 * against the bucket's own declared limits, because that is where the limits
 * are written down.
 */

export const HOMEWORK_STATUSES = [
  {
    value: "draft",
    label: "Draft",
    tone: "muted",
    hint: "Only you can see this. Nobody has been set it yet.",
  },
  {
    value: "published",
    label: "Set",
    tone: "success",
    hint: "The class can see this and hand work in.",
  },
] as const;

export const SUBMISSION_STATUSES = [
  { value: "pending", label: "Not handed in", tone: "muted" },
  { value: "submitted", label: "Handed in", tone: "info" },
  { value: "graded", label: "Marked", tone: "success" },
  { value: "returned", label: "Returned", tone: "success" },
] as const;

export const MATERIAL_KINDS = [
  { value: "document", label: "File", hint: "A PDF, worksheet, slide deck or image." },
  { value: "video", label: "Video", hint: "A link to a recording somewhere else." },
  { value: "link", label: "Link", hint: "A page on the web." },
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

/**
 * `maxMarks` is a string for the same reason a mark is on the exam sheet: an
 * empty box means "this homework is not marked out of anything", which is a
 * different fact from zero, and `z.coerce` would collapse the two as well as
 * splitting the input/output types and breaking the resolver.
 */
export const homeworkSchema = z
  .object({
    sectionId: z.string().uuid("Choose a class"),
    subjectId: z.string().uuid("Choose a subject"),
    title: z.string().min(1, "Give the homework a title").max(200),
    instructions: z.string().max(4000).optional(),
    assignedOn: isoDate,
    dueOn: isoDate,
    maxMarks: z.string(),
    collectsSubmissions: z.boolean(),
  })
  .refine((v) => v.dueOn >= v.assignedOn, {
    message: "The due date cannot be before the day it was set",
    path: ["dueOn"],
  })
  .refine((v) => v.maxMarks.trim() === "" || Number(v.maxMarks) > 0, {
    message: "A maximum must be above zero, or left blank",
    path: ["maxMarks"],
  })
  .refine((v) => v.maxMarks.trim() === "" || Number.isFinite(Number(v.maxMarks)), {
    message: "That is not a number",
    path: ["maxMarks"],
  })
  // Marking work nobody hands in is a screen with nothing on it. Caught here
  // rather than in Postgres because it is advice, not corruption.
  .refine((v) => v.collectsSubmissions || v.maxMarks.trim() === "", {
    message: "Homework that is not collected cannot be marked out of anything",
    path: ["maxMarks"],
  });
export type HomeworkInput = z.infer<typeof homeworkSchema>;

export const submitSchema = z.object({
  homeworkId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});
export type SubmitInput = z.infer<typeof submitSchema>;

export const gradeSchema = z.object({
  submissionId: z.string().uuid(),
  marks: z.string(),
  feedback: z.string().max(2000).optional(),
});
export type GradeInput = z.infer<typeof gradeSchema>;

export const studyMaterialSchema = z
  .object({
    title: z.string().min(1, "Give the material a title").max(200),
    description: z.string().max(2000).optional(),
    kind: z.enum(["document", "video", "link"]),
    // Empty string is "the whole school" / "general", which are real answers
    // rather than missing ones — see the nullable columns on `study_material`.
    sectionId: z.union([z.string().uuid(), z.literal("")]).optional(),
    subjectId: z.union([z.string().uuid(), z.literal("")]).optional(),
    externalUrl: z.union([z.string().url("That is not a web address"), z.literal("")]).optional(),
    isPublished: z.boolean(),
  })
  // Mirrors `study_material_source_chk`: a file or a link, never both and never
  // neither. The file half cannot be seen from here — it is a `File` on the
  // FormData — so the action completes the check with what it can see.
  .refine((v) => v.kind === "document" || (v.externalUrl ?? "") !== "", {
    message: "A video or a link needs a web address",
    path: ["externalUrl"],
  });
export type StudyMaterialInput = z.infer<typeof studyMaterialSchema>;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export type SubmissionStatusTone = (typeof SUBMISSION_STATUSES)[number]["tone"];

export function submissionStatusLabel(value: string) {
  return SUBMISSION_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export function submissionStatusTone(value: string) {
  return SUBMISSION_STATUSES.find((s) => s.value === value)?.tone ?? "muted";
}

export function materialKindLabel(value: string) {
  return MATERIAL_KINDS.find((k) => k.value === value)?.label ?? value;
}

/**
 * "Due tomorrow", "3 days late". A date on its own makes a parent count on
 * their fingers, and the whole point of the screen is that they should not
 * have to.
 *
 * `today` is a parameter rather than a `new Date()` so this is testable and so
 * the caller decides which clock counts — the server renders in UTC and the
 * school does not.
 */
export function dueLabel(dueOn: string, today: string): string {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return dueOn;

  const days = Math.round((due - now) / 86_400_000);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "Due yesterday";
  if (days > 1) return `Due in ${days} days`;
  return `${Math.abs(days)} days overdue`;
}

/** Today where the school is, not where Vercel is. */
export function schoolToday(timeZone = "Asia/Kolkata", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Validate a typed mark against the homework's maximum in the browser, so a
 * teacher typing 25 into a 20-mark exercise is told at the keystroke. The
 * database still enforces it — `homework_submissions_marks_chk` against a
 * `max_marks` the composite key holds equal to the parent's.
 */
export function markProblem(raw: string, maxMarks: number | null): string | null {
  const text = raw.trim();
  if (text === "") return null;
  if (maxMarks === null) return "This homework is not marked out of anything";

  const value = Number(text);
  if (!Number.isFinite(value)) return "Not a number";
  if (value < 0) return "Cannot be negative";
  if (value > maxMarks) return `Above the maximum of ${maxMarks}`;
  return null;
}

/** `18 / 20`, and an unmarked submission as an em dash rather than `null / 20`. */
export function formatMark(marks: number | null | undefined, maxMarks: number | null | undefined) {
  if (maxMarks === null || maxMarks === undefined) return "—";
  if (marks === null || marks === undefined) return `— / ${Number(maxMarks)}`;
  return `${Number(marks)} / ${Number(maxMarks)}`;
}

/** How far through marking a teacher is, for the "12 of 30 marked" line. */
export function markingProgress(rows: { status: string }[]) {
  const handedIn = rows.filter((r) => r.status !== "pending").length;
  const marked = rows.filter((r) => r.status === "graded" || r.status === "returned").length;
  return { total: rows.length, handedIn, marked, pending: rows.length - handedIn };
}
