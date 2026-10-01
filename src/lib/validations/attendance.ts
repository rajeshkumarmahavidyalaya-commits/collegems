import { z } from "zod";
export { ATTENDANCE_STATUSES, STATUS_KEYS, statusLabel, attendanceStatusOptions } from "./attendance-display";
export type { AttendanceStatus } from "./attendance-display";

export const attendanceStatusSchema = z.enum(["present", "absent", "late", "excused"]);

/** `YYYY-MM-DD`, the shape both `<input type="date">` and Postgres `date` use. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const attendanceEntrySchema = z.object({
  enrolmentId: z.string().uuid(),
  status: attendanceStatusSchema,
  note: z.string().max(200).optional(),
});

/**
 * One register, submitted whole. The client never sends `session_id` or
 * `tenant_id` -- `mark_attendance()` resolves both server-side, which is
 * rule 2 in CLAUDE.md.
 *
 * `period` defaults to 0 ("whole day"). Period-wise marking needs the
 * timetable tables, which are still roadmap; the column is already there so
 * that arriving later is a data change, not a migration of the unique key.
 */
export const markAttendanceSchema = z.object({
  sectionId: z.string().uuid("Choose a class"),
  date: isoDate,
  period: z.number().int().min(0).max(20).default(0),
  entries: z.array(attendanceEntrySchema).min(1, "Mark at least one student"),
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;
