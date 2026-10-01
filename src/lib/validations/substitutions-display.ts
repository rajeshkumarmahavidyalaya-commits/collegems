import { PROBLEM_SEVERITIES } from "./severity";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The half of `substitutions.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `substitutions.ts` re-exports all of it.
 */

/** Worst first: a class with nobody in it outranks a note about a merge. */
export function severityRank(severity: string): number {
  const index = (PROBLEM_SEVERITIES as readonly string[]).indexOf(severity);
  return index === -1 ? PROBLEM_SEVERITIES.length : index;
}

/**
 * Why the server put this person near the top. The order is advice — a head of
 * department overruling it is the normal case — so the reason is shown rather
 * than the rank, which would read as a score somebody has to trust.
 */
export function candidateReason(candidate: {
  teachesSubject: boolean;
  coversToday: number;
  periodsToday: number;
}): string {
  const parts: string[] = [];
  parts.push(candidate.teachesSubject ? "Teaches the subject" : "Different subject");
  parts.push(
    candidate.coversToday === 0
      ? "no cover yet today"
      : candidate.coversToday === 1
        ? "1 cover already today"
        : `${candidate.coversToday} covers already today`,
  );
  parts.push(
    candidate.periodsToday === 1 ? "1 lesson of their own" : `${candidate.periodsToday} lessons of their own`,
  );
  return parts.join(" · ");
}

/**
 * The one line at the top of the screen. Two numbers, not one: "3 of 7
 * arranged" and "7 lessons need cover" are different mornings, and a single
 * percentage hides which.
 */
export function coverSummary(gaps: { arranged: boolean; reason?: string }[]): string {
  if (gaps.length === 0) return "Nobody is away. Nothing to arrange.";
  const arranged = gaps.filter((g) => g.arranged).length;
  const outstanding = gaps.length - arranged;
  const vacant = gaps.filter((g) => g.reason === "unassigned").length;
  const tail =
    vacant === 0
      ? ""
      : vacant === 1
        ? " One of them has no teacher at all."
        : ` ${vacant} of them have no teacher at all.`;
  if (outstanding === 0) {
    return (
      (gaps.length === 1
        ? "The one lesson needing cover is arranged."
        : `All ${gaps.length} lessons needing cover are arranged.`) + tail
    );
  }
  return `${outstanding} of ${gaps.length} still to arrange.` + tail;
}

/**
 * Why a lesson is on the morning list.
 *
 * `away` is a stopgap somebody arranges today. `unassigned` is a hole in the
 * timetable that will be there tomorrow too — covering it is fine, but the fix
 * is a teacher, and a screen that showed them identically would have the office
 * arranging the same emergency every day until July. See migration 0176.
 */
export function reasonLabel(reason: string, t: Translator): string {
  // Two reasons, two different problems for two different people -- rule 12's
  // own sentence about not conflating "not here today" with "nobody teaches
  // this any more". They stay two strings.
  return reason === "unassigned" ? t("cover.reason.unassigned") : t("cover.reason.away");
}

export function reasonTone(reason: string): "destructive" | "warning" {
  return reason === "unassigned" ? "destructive" : "warning";
}

/** "Period 3 · 10:15" — the two things a person actually looks for. */
export function periodLabel(
  periodNumber: number | null,
  startsAt: string | null,
  t: Translator,
): string {
  // Not the same function as `timetable.periodLabel` despite the name -- that
  // one resolves the school's own label, this one adds a clock time. A name
  // collision, not a duplicate, and it is why a grep by name over-counted the
  // call sites of both by 75.
  const period =
    periodNumber === null ? t("timetable.periodBare") : t("timetable.period", { n: periodNumber });
  if (!startsAt) return period;
  return `${period} · ${startsAt.slice(0, 5)}`;
}

/** Today, in the browser's own calendar, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
