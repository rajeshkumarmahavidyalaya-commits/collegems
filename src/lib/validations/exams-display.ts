import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

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
