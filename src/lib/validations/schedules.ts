import { z } from "zod";
/**
 * Schedules — the client half.
 *
 * The interesting function here is `scheduleSentence`, and it earns its place:
 * `run_at`, `weekdays` and `day_of_month` are three columns that a person reads
 * as one fact — *"every weekday at half past seven"* — and a screen that shows
 * them as three fields makes somebody assemble that sentence in their head
 * every time they check whether the thing is set up right.
 */
import { SCHEDULE_KINDS } from "./schedules-display";
export { SCHEDULE_KINDS, KIND_LABEL, KIND_DESCRIPTION, kindLabel, kindDescription, formatRunAt, scheduleSentence, graceSentence, RUN_STATUSES, RUN_STATUS_LABEL, runStatusTone, runSentence, reportKeyOf } from "./schedules-display";
export type { ScheduleKind, RunStatus } from "./schedules-display";

export const scheduleSchema = z
  .object({
    id: z.string().uuid().optional(),
    kind: z.enum(SCHEDULE_KINDS),
    name: z.string().trim().min(2, "Give it a name somebody will recognise"),
    runAt: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time"),
    // "" means every day. A form cannot send an empty array through a checkbox
    // group without ambiguity, so the empty list is explicit here.
    weekdays: z.array(z.number().int().min(1).max(7)).default([]),
    dayOfMonth: z.number().int().min(1).max(28).nullable().default(null),
    graceMinutes: z.number().int().min(5).max(1440),
    minAmount: z.number().min(0).nullable().default(null),
    minDaysOver: z.number().int().min(1).nullable().default(null),
    reportKey: z.string().trim().min(1).nullable().default(null),
    isEnabled: z.boolean().default(false),
  })
  .refine((v) => v.dayOfMonth === null || v.weekdays.length === 0, {
    message: "Choose either days of the week or a day of the month, not both",
    path: ["dayOfMonth"],
  })
  .refine((v) => v.kind !== "report.digest" || v.reportKey !== null, {
    message: "Choose which report to run",
    path: ["reportKey"],
  });

export type ScheduleInput = z.infer<typeof scheduleSchema>;

/** The kind's own settings, assembled for `schedules.params`. */
export function paramsFor(input: ScheduleInput): Record<string, string | number> {
  if (input.kind === "fees.due_reminder" && input.minAmount !== null) {
    return { min_amount: input.minAmount };
  }
  if (input.kind === "library.overdue" && input.minDaysOver !== null) {
    return { min_days_over: input.minDaysOver };
  }
  if (input.kind === "report.digest" && input.reportKey) {
    return { report_key: input.reportKey };
  }
  return {};
}
