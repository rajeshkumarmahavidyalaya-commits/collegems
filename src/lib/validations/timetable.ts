import { z } from "zod";
import { WEEKDAYS, toClockTime } from "./academics-display";
/**
 * Phase 1.2 — the class routine.
 *
 * Weekday numbering, the teaching-week configuration and the bell schedule all
 * come from the academic structure module; this file deliberately re-exports
 * rather than redefining them, because two lists of weekdays is two chances to
 * disagree about whether Sunday is 0 or 7.
 */
export { WEEKDAYS, toClockTime };
export { GRID_WEEKDAYS, weekdayShort, weekdayName, periodLabel, cellKey, fillRate } from "./timetable-display";

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
  /**
   * The lesson being edited. Without it the save ADDS a lesson to the period,
   * which the database allows beside another only when both are choices in one
   * elective group for the class (0286) -- so "edit" and "add a parallel
   * elective" are the same form with and without this id.
   */
  entryId: z.union([z.string().uuid(), z.literal("")]).optional(),
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
