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
