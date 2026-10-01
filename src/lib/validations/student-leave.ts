import { z } from "zod";
/**
 * Student leave — the client half.
 *
 * The vocabulary and the sentences a person reads. The judgements are all in
 * Postgres: who may apply, who may decide, and whether two requests overlap
 * (an exclusion constraint, because an application that checks first and
 * inserts second is a race).
 */
import { LEAVE_KINDS } from "./student-leave-display";
export { LEAVE_KINDS, KIND_LABEL, kindLabel, LEAVE_STATUSES, STATUS_LABEL, statusLabel, statusTone, leaveDays, leaveSentence, blocksTheDates } from "./student-leave-display";
export type { LeaveKind, LeaveStatus } from "./student-leave-display";

export const applyLeaveSchema = z
  .object({
    studentId: z.string().uuid("Choose a student"),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the first day"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day"),
    kind: z.enum(LEAVE_KINDS).default("other"),
    reason: z
      .string()
      .trim()
      .min(3, "Say why — a class teacher deciding this has nothing else to go on"),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The last day cannot be before the first",
    path: ["endsOn"],
  });

export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const decideLeaveSchema = z.object({
  leaveId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
