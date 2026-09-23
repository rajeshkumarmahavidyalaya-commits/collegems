import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * `homework.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `homework.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
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
  {
    value: "document",
    label: "File",
    hint: "A PDF, worksheet, slide deck or image.",
  },
  {
    value: "video",
    label: "Video",
    hint: "A link to a recording somewhere else.",
  },
  { value: "link", label: "Link", hint: "A page on the web." },
] as const;

export type SubmissionStatusTone = (typeof SUBMISSION_STATUSES)[number]["tone"];

export function submissionStatusLabel(value: string, t: Translator) {
  const found = SUBMISSION_STATUSES.find((s) => s.value === value);
  return found
    ? labelFor(`homework.submission.${value}`, found.label, t)
    : value;
}

export function submissionStatusTone(value: string) {
  return SUBMISSION_STATUSES.find((s) => s.value === value)?.tone ?? "muted";
}

export function materialKindLabel(value: string, t: Translator) {
  const found = MATERIAL_KINDS.find((k) => k.value === value);
  return found ? labelFor(`material.kind.${value}`, found.label, t) : value;
}

export function materialKindOptions(t: Translator) {
  return optionsFor(MATERIAL_KINDS, "material.kind", t);
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
export function dueLabel(dueOn: string, today: string, t: Translator): string {
  const due = Date.parse(`${dueOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(now)) return dueOn;

  const days = Math.round((due - now) / 86_400_000);

  // Today, tomorrow and yesterday are their own words in every language this
  // ships in — not "in 1 day" and not "1 day overdue". Rule 2's sentence about
  // number agreement, arriving as a vocabulary question rather than a plural
  // one: some counts have a name, and a language that has the name uses it.
  if (days === 0) return t("homework.due.today");
  if (days === 1) return t("homework.due.tomorrow");
  if (days === -1) return t("homework.due.yesterday");

  // ...and past that the count and the noun are one sentence, so `t.plural`
  // picks both. English needs "days"; Urdu's plural rule is not English's, and
  // neither is derivable from a stem.
  return days > 1
    ? t.plural("homework.due.inDays", days)
    : t.plural("homework.due.overdue", Math.abs(days));
}

/** Today where the school is, not where Vercel is. */
export function schoolToday(
  timeZone = "Asia/Kolkata",
  now = new Date(),
): string {
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
export function markProblem(
  raw: string,
  maxMarks: number | null,
): string | null {
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
export function formatMark(
  marks: number | null | undefined,
  maxMarks: number | null | undefined,
) {
  if (maxMarks === null || maxMarks === undefined) return "—";
  if (marks === null || marks === undefined) return `— / ${Number(maxMarks)}`;
  return `${Number(marks)} / ${Number(maxMarks)}`;
}

/** How far through marking a teacher is, for the "12 of 30 marked" line. */
export function markingProgress(rows: { status: string }[]) {
  const handedIn = rows.filter((r) => r.status !== "pending").length;
  const marked = rows.filter(
    (r) => r.status === "graded" || r.status === "returned",
  ).length;
  return {
    total: rows.length,
    handedIn,
    marked,
    pending: rows.length - handedIn,
  };
}
