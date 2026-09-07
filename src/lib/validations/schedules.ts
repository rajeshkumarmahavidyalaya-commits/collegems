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

export const SCHEDULE_KINDS = [
  "attendance.absentees",
  "fees.due_reminder",
  "library.overdue",
] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const KIND_LABEL: Record<ScheduleKind, string> = {
  "attendance.absentees": "Absence notice",
  "fees.due_reminder": "Fee reminder",
  "library.overdue": "Overdue book reminder",
};

/** What each one actually does, in the words somebody deciding would use. */
export const KIND_DESCRIPTION: Record<ScheduleKind, string> = {
  "attendance.absentees":
    "Tells each absent child's family, on the day they were absent. Nothing is sent for a day nobody took the register.",
  "fees.due_reminder":
    "Tells the family of every student with money outstanding. Set a minimum so a two-rupee rounding difference does not generate a message.",
  "library.overdue":
    "Tells the family of every student holding a book past its due date. Staff borrowers are settled through payroll and are not included.",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as ScheduleKind] ?? kind;
}

// ---------------------------------------------------------------------------
// When does this run
// ---------------------------------------------------------------------------

const DAY_NAME = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** `19:30:00` → `19:30`. Postgres sends seconds; nobody reads them. */
export function formatRunAt(runAt: string): string {
  return runAt.slice(0, 5);
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * One sentence for the three columns.
 *
 * The empty case matters: no weekdays and no day of the month means *every*
 * day, which is the reading a school gets by saying nothing, and a screen that
 * rendered it as "on no days" would describe a schedule that fires daily as one
 * that never fires.
 */
export function scheduleSentence(schedule: {
  run_at: string;
  weekdays: number[] | null;
  day_of_month: number | null;
}): string {
  const at = `at ${formatRunAt(schedule.run_at)}`;
  const days = schedule.weekdays ?? [];

  if (schedule.day_of_month) {
    return `On the ${ordinal(schedule.day_of_month)} of each month, ${at}`;
  }
  if (days.length === 0) {
    return `Every day, ${at}`;
  }
  if (days.length === 7) {
    return `Every day, ${at}`;
  }

  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === "1,2,3,4,5") return `Every weekday, ${at}`;
  if (sorted.join() === "1,2,3,4,5,6") return `Monday to Saturday, ${at}`;
  if (sorted.join() === "6,7") return `At weekends, ${at}`;

  const names = sorted.map((d) => DAY_NAME[d]).filter(Boolean);
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list}, ${at}`;
}

/**
 * The grace window, said as a consequence rather than as a number.
 *
 * `grace_minutes` is the column that makes "no backfill" a policy rather than a
 * constant, and its whole point is that the right answer differs by kind — an
 * absence notice at midnight is worse than none, a fee reminder is not. A form
 * showing "180" teaches nobody that.
 */
export function graceSentence(minutes: number): string {
  if (minutes < 60) return `Skipped if more than ${minutes} minutes late`;
  if (minutes >= 1440) return "Skipped if more than a day late";
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `Skipped if more than ${hours} hour${hours === 1 ? "" : "s"} late`;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const RUN_STATUSES = ["running", "done", "missed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  done: "Ran",
  missed: "Missed",
  failed: "Failed",
};

/** Never colour alone — the label is the meaning; this only tints it. */
export function runStatusTone(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "done":
      return "success";
    case "missed":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

/**
 * What a finished run should say about itself.
 *
 * `matched` and `notified` are different numbers and the gap is the useful one:
 * a run that matched forty children and told nobody is not a success, however
 * green its status is.
 */
export function runSentence(run: {
  status: string;
  matched: number;
  notified: number;
  note: string | null;
}): string {
  if (run.note) return run.note;
  if (run.status === "done" && run.matched === 0) return "Nothing matched, so nothing was sent.";
  if (run.status === "done") return `${run.notified} of ${run.matched} were told.`;
  return RUN_STATUS_LABEL[run.status as RunStatus] ?? run.status;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

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
    isEnabled: z.boolean().default(false),
  })
  .refine((v) => v.dayOfMonth === null || v.weekdays.length === 0, {
    message: "Choose either days of the week or a day of the month, not both",
    path: ["dayOfMonth"],
  });

export type ScheduleInput = z.infer<typeof scheduleSchema>;

/** The kind's own settings, assembled for `schedules.params`. */
export function paramsFor(input: ScheduleInput): Record<string, number> {
  if (input.kind === "fees.due_reminder" && input.minAmount !== null) {
    return { min_amount: input.minAmount };
  }
  if (input.kind === "library.overdue" && input.minDaysOver !== null) {
    return { min_days_over: input.minDaysOver };
  }
  return {};
}
