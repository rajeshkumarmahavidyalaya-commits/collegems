import type { Translator } from "@/lib/i18n/translate";
import { labelFor, optionsFor } from "./labels";

/**
 * Exam display helpers with **no Zod**. `exams.ts` begins `import { z }`, so a
 * client screen importing a badge helper from it shipped the whole schema
 * library to draw a word (rule 15's `fees-display.ts` split). `exams.ts`
 * re-exports these, so server callers are unchanged; a client component
 * imports from here.
 */

export const RESULT_STATES = [
  { value: "pass", label: "Pass", tone: "success" },
  { value: "fail", label: "Fail", tone: "danger" },
  { value: "incomplete", label: "Incomplete", tone: "warning" },
] as const;

export function resultLabel(value: string, t: Translator) {
  const found = RESULT_STATES.find((r) => r.value === value);
  return found ? labelFor(`exams.result.${value}`, found.label, t) : value;
}

export function resultTone(value: string) {
  return RESULT_STATES.find((r) => r.value === value)?.tone ?? "muted";
}

/** `61.5` → `"61.5%"`, and a missing aggregate → an em dash rather than `NaN%`. */
export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(1)}%`;
}

export const EXAM_KINDS = [
  { value: "unit", label: "Unit test" },
  { value: "term", label: "Term exam" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "annual", label: "Annual" },
  { value: "practical", label: "Practical" },
  { value: "other", label: "Other" },
] as const;

export const RANK_SCOPES = [
  {
    value: "section",
    label: "Within the section",
    hint: "Position among the children in the same class and section.",
  },
  {
    value: "class_level",
    label: "Within the class",
    hint: "Position across every section of the class level.",
  },
  {
    value: "school",
    label: "Across the school",
    hint: "One position per student across every class sitting the exam.",
  },
] as const;

export const RANK_METHODS = [
  {
    value: "competition",
    label: "Standard (1, 2, 2, 4)",
    hint: "Two students tied for second are both second, and the next is fourth.",
  },
  {
    value: "dense",
    label: "Dense (1, 2, 2, 3)",
    hint: "Two students tied for second are both second, and the next is third.",
  },
] as const;

export function examKindLabel(value: string, t: Translator) {
  const found = EXAM_KINDS.find((k) => k.value === value);
  return found ? labelFor(`exams.kind.${value}`, found.label, t) : value;
}

export function examKindOptions(t: Translator) {
  return optionsFor(EXAM_KINDS, "exams.kind", t);
}

// Moved from `exams.ts` so a screen can use these without loading zod.

/**
 * The other half of "the parts add up to the paper" — said in the browser while
 * somebody is typing, so the total under the form moves as they go. Postgres
 * still enforces it; this only means nobody presses Save to find out.
 */
export function componentTotal(components: { maxMarks: number }[]) {
  return components.reduce(
    (sum, c) => sum + (Number.isFinite(c.maxMarks) ? c.maxMarks : 0),
    0,
  );
}

export function componentTotalProblem(
  components: { maxMarks: number }[],
  paperMaxMarks: number,
): string | null {
  if (components.length === 0) return null;
  const total = componentTotal(components);
  if (total === paperMaxMarks) return null;
  const gap = Math.abs(total - paperMaxMarks);
  return `The parts add up to ${total} but the paper is out of ${paperMaxMarks}, so they are ${gap} ${
    total < paperMaxMarks ? "short" : "over"
  }.`;
}

/**
 * One typed cell on a mark sheet, understood.
 *
 * A mark register filled in by hand has three states in one column — a number,
 * a blank, and "AB" — and so does this. Making absence a *token* rather than a
 * second control is what lets a split paper have one narrow input per part
 * instead of an input and a checkbox per part, and it keeps the grid what the
 * design rules ask it to be: a column you can type down without reaching for
 * the mouse. `formatMark` already renders an absence as "AB", so what a teacher
 * types is what they see afterwards.
 */
export type MarkCell =
  | { kind: "empty" }
  | { kind: "absent" }
  | { kind: "value"; value: number }
  | { kind: "problem"; message: string };

const ABSENT_TOKENS = new Set(["a", "ab", "abs", "absent"]);

export function parseMarkCell(raw: string, maxMarks: number): MarkCell {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  if (ABSENT_TOKENS.has(text.toLowerCase())) return { kind: "absent" };

  const value = Number(text);
  if (!Number.isFinite(value))
    return { kind: "problem", message: "A mark, or AB for absent" };
  if (value < 0) return { kind: "problem", message: "Cannot be negative" };
  if (value > maxMarks)
    return { kind: "problem", message: `Above the maximum of ${maxMarks}` };
  return { kind: "value", value };
}

/** How full a mark sheet is, for the "12 of 40 entered" line. A row counts once
 *  every one of its cells has been resolved — which for a split paper means
 *  every part, because a paper with the practical still to mark is not marked. */
export function enteredCount(rows: { cells: string[] }[], maxima: number[]) {
  return rows.filter((row) =>
    row.cells.every(
      (cell, i) => parseMarkCell(cell, maxima[i] ?? 0).kind !== "empty",
    ),
  ).length;
}
