import { WEEKDAYS } from "./academics-display";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The half of `timetable.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `timetable.ts` re-exports all of it.
 */

/** Monday–Saturday. Sunday exists in the model but no grid renders it by default. */
export const GRID_WEEKDAYS = WEEKDAYS.filter((d) => d.value <= 6);

export function weekdayShort(value: number) {
  return WEEKDAYS.find((d) => d.value === value)?.short ?? String(value);
}

export function weekdayName(value: number) {
  return WEEKDAYS.find((d) => d.value === value)?.label ?? String(value);
}

/**
 * "Period 3" or the school's own label for it. Schools that name periods
 * ("Assembly", "Games") mean the name; the rest get the number.
 */
export function periodLabel(periodNumber: number, label: string | null, t: Translator) {
  // A school's own name for a period ("Assembly", "Games") is the school's
  // word and is not translated -- only the fallback is ours to say.
  return label?.trim() || t("timetable.period", { n: periodNumber });
}

/**
 * A stable key for one cell of the grid. Used for React keys and for the
 * busy-lookup cache, so both agree on what "the same cell" means.
 */
export function cellKey(weekday: number, timeSlotId: string) {
  return `${weekday}:${timeSlotId}`;
}

/**
 * Periods per teaching day, from the entries themselves — the number a head
 * teacher reads to see whether the grid is actually finished.
 */
export function fillRate(filled: number, possible: number) {
  if (possible === 0) return 0;
  return Math.round((filled / possible) * 100);
}
