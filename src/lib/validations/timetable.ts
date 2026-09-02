import { z } from "zod";
import { WEEKDAYS, toClockTime } from "./academics";

/**
 * Phase 1.2 — the class routine.
 *
 * Weekday numbering, the teaching-week configuration and the bell schedule all
 * come from the academic structure module; this file deliberately re-exports
 * rather than redefining them, because two lists of weekdays is two chances to
 * disagree about whether Sunday is 0 or 7.
 */

export { WEEKDAYS, toClockTime };

/** Monday–Saturday. Sunday exists in the model but no grid renders it by default. */
export const GRID_WEEKDAYS = WEEKDAYS.filter((d) => d.value <= 6);

export const timetableEntrySchema = z.object({
  sectionId: z.string().uuid("Choose a class"),
  weekday: z
    .number({ message: "Choose a day" })
    .int()
    .min(1, "Choose a day")
    .max(7, "Choose a day"),
  timeSlotId: z.string().uuid("Choose a period"),
  subjectId: z.string().uuid("Choose a subject"),
  /**
   * `""` rather than `undefined` for "nobody yet": a shadcn Select cannot hold
   * an undefined value without going uncontrolled, and the server maps the
   * empty string back to null. Same shape as `sectionSubjectSchema`.
   */
  teacherStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
  classRoomId: z.union([z.string().uuid(), z.literal("")]).optional(),
  note: z.string().max(200).optional(),
});
export type TimetableEntryInput = z.infer<typeof timetableEntrySchema>;

export const copyDaySchema = z
  .object({
    sectionId: z.string().uuid("Choose a class"),
    fromWeekday: z.number().int().min(1).max(7),
    toWeekday: z.number().int().min(1).max(7),
  })
  .refine((v) => v.fromWeekday !== v.toWeekday, {
    message: "Pick two different days",
    path: ["toWeekday"],
  });
export type CopyDayInput = z.infer<typeof copyDaySchema>;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

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
export function periodLabel(periodNumber: number, label: string | null) {
  return label?.trim() || `Period ${periodNumber}`;
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
