import { z } from "zod";
import type { Translator } from "@/lib/i18n/translate";
import { formatWeekday } from "@/lib/i18n/format";
import { intlTag } from "@/lib/i18n/config";
import { labelFor } from "./labels";

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

export function kindLabel(kind: string, t: Translator): string {
  const known = KIND_LABEL[kind as ScheduleKind];
  return known ? labelFor(`schedules.kind.${kind}`, known, t) : kind;
}

/**
 * What the schedule actually does, under its name on the same card.
 *
 * Same reasoning as every other hint in this batch: it is part of the control,
 * not prose beside it, so it moves with the name or the card is bilingual.
 */
export function kindDescription(kind: string, t: Translator): string {
  const known = KIND_DESCRIPTION[kind as ScheduleKind];
  return known ? labelFor(`schedules.kindDescription.${kind}`, known, t) : "";
}

// ---------------------------------------------------------------------------
// When does this run
// ---------------------------------------------------------------------------

// `DAY_NAME` stood here: a **second** hardcoded weekday array, after the one
// `formatWeekday` replaced in `academics.ts`. Rule 15 had already written the
// sentence that condemns it — *"hardcoding the formatter's output is the same
// mistake one step further along"* — and this copy simply was not looked for
// when the first was deleted. **When you delete a hardcoded table, grep for the
// second one.**

/** `19:30:00` → `19:30`. Postgres sends seconds; nobody reads them. */
export function formatRunAt(runAt: string): string {
  return runAt.slice(0, 5);
}

/**
 * "1st", "2nd", "3rd", "11th" — and nothing at all in a language without them.
 *
 * The old body was `["th","st","nd","rd"][n % 10]` with a hand-written 11/12/13
 * exception, which is the whole English ordinal rule spelled out in a ternary.
 * Rule 15's sentence about `WEEKDAYS` applies exactly: **hardcoding the output
 * of a locale rule works for the first customer.**
 *
 * `Intl.PluralRules(..., { type: "ordinal" })` is the primitive that already
 * knows. English returns `one`/`two`/`few`/`other` and gets the teens right on
 * its own; Hindi and Urdu return `other` for every number, and their `other`
 * key is the bare numeral — so the suffix disappears rather than being wrong,
 * and the sentence around it does the work instead.
 *
 * The first draft of this dropped the ordinal entirely and rendered "On day 5
 * of each month". That was correct in three languages and *worse in English*
 * than what it replaced, which is not a trade worth making when `Intl` will
 * answer the question.
 */
function ordinal(n: number, t: Translator): string {
  let category = "other";
  try {
    category = new Intl.PluralRules(intlTag(t.locale), { type: "ordinal" }).select(n);
  } catch {
    // No ICU ordinal data: fall through to `other`, which is "{n}th" in English
    // and the bare numeral everywhere else. Never a wrong suffix.
  }
  return t(`schedules.ordinal.${category}` as Parameters<Translator>[0], { n });
}

/**
 * One sentence for the three columns.
 *
 * The empty case matters: no weekdays and no day of the month means *every*
 * day, which is the reading a school gets by saying nothing, and a screen that
 * rendered it as "on no days" would describe a schedule that fires daily as one
 * that never fires.
 */
export function scheduleSentence(
  schedule: {
    run_at: string;
    weekdays: number[] | null;
    day_of_month: number | null;
  },
  t: Translator,
): string {
  const time = formatRunAt(schedule.run_at);
  const days = schedule.weekdays ?? [];

  if (schedule.day_of_month) {
    return t("schedules.cadence.dayOfMonth", { day: ordinal(schedule.day_of_month, t), time });
  }
  // No weekdays and all seven mean the same thing, and the empty case is the
  // one that matters: a schedule that says nothing fires daily, and a screen
  // rendering that as "on no days" would describe it as one that never fires.
  if (days.length === 0 || days.length === 7) return t("schedules.cadence.daily", { time });

  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join() === "1,2,3,4,5") return t("schedules.cadence.weekdays", { time });
  if (sorted.join() === "1,2,3,4,5,6") return t("schedules.cadence.mondayToSaturday", { time });
  if (sorted.join() === "6,7") return t("schedules.cadence.weekends", { time });

  // `Intl.ListFormat` joins them, so the conjunction and the separator are the
  // reader's rather than English's — "Monday, Tuesday and Friday" against
  // "सोमवार, मंगलवार और शुक्रवार". Hand-joining with `" and "` was the same
  // class of mistake as the weekday array itself, one clause along.
  const names = sorted.map((d) => formatWeekday(d, t.locale));
  let list: string;
  try {
    list = new Intl.ListFormat(intlTag(t.locale), { style: "long", type: "conjunction" }).format(names);
  } catch {
    list = names.join(", ");
  }
  return t("schedules.cadence.days", { days: list, time });
}

/**
 * The grace window, said as a consequence rather than as a number.
 *
 * `grace_minutes` is the column that makes "no backfill" a policy rather than a
 * constant, and its whole point is that the right answer differs by kind — an
 * absence notice at midnight is worse than none, a fee reminder is not. A form
 * showing "180" teaches nobody that.
 */
export function graceSentence(minutes: number, t: Translator): string {
  if (minutes < 60) return t("schedules.grace.minutes", { minutes });
  if (minutes >= 1440) return t("schedules.grace.day");
  const hours = Math.round((minutes / 60) * 10) / 10;
  // `hour${hours === 1 ? "" : "s"}` was an English plural spelled at the call
  // site, which is what `t.plural` exists to stop. It is a separate key rather
  // than a plural group because `hours` can be 1.5 — and "1.5 hours" is the
  // `other` category in English while exactly 1 is `one`, so the two really are
  // two sentences.
  return hours === 1 ? t("schedules.grace.oneHour") : t("schedules.grace.hours", { hours });
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
