import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * `academics.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `academics.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
/**
 * The academic structure the rest of Phase 1 and 3 stand on: what is taught,
 * by whom, where, when, and on which days the school is open.
 */

export const SUBJECT_KINDS = [
  { value: "theory", label: "Theory" },
  { value: "practical", label: "Practical" },
] as const;

export const SLOT_KINDS = [
  { value: "class", label: "Class periods" },
  { value: "exam", label: "Exam periods" },
] as const;

/**
 * ISO weekday numbering (1 = Monday … 7 = Sunday), matching
 * `extract(isodow …)` so the app, the RPCs and every calendar query agree
 * without a translation table in someone's head.
 */
/**
 * The seven days, as **values**. `label` and `short` are the English fallback
 * for a runtime with no ICU data, not the thing to render — `formatWeekday`
 * asks `Intl` instead, because twenty-one weekday names in three catalogues
 * would be storing what every JavaScript runtime already ships.
 */
export const WEEKDAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
] as const;

export function subjectKindLabel(value: string, t: Translator) {
  const kind = SUBJECT_KINDS.find((k) => k.value === value);
  return kind
    ? labelFor(`academics.subjectKind.${kind.value}`, kind.label, t)
    : value;
}

// `weekdayLabel` stood here and had **no caller** — the second dead label found
// in this pass, after `CATEGORY_LABEL`. Rule 15's own sentence: a correct string
// nobody renders is not a feature. The live answer is `formatWeekday` in
// `src/lib/i18n/format.ts`, which asks ICU rather than this list.

/** `08:45:00` from Postgres, `08:45` in a form — normalise on the way in. */
export function toClockTime(value: string) {
  return value.slice(0, 5);
}

export function formatSlotRange(startsAt: string, endsAt: string) {
  return `${toClockTime(startsAt)} – ${toClockTime(endsAt)}`;
}
