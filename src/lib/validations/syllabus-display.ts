/**
 * Syllabus: the display half.
 *
 * **This module has no imports and must keep none** — the `fees-display`
 * split. One `import { z }` and every route that renders a pace badge pays
 * 91 kB for Zod it does not use.
 *
 * `paceVerdict` lives here rather than in the server action for the reason
 * `/arrangements` learned: a `"use server"` module may only export async
 * functions, so a rule defined there can never be imported by a test — and
 * this is exactly the kind of rule that is wrong in a way nothing fails.
 */

export type UnitStatus = "pending" | "in_progress" | "covered";

export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  covered: "Covered",
};

export function unitStatusTone(status: string): "secondary" | "warning" | "success" {
  if (status === "covered") return "success";
  if (status === "in_progress") return "warning";
  return "secondary";
}

/**
 * What the three numbers add up to.
 *
 * Seven outcomes rather than a percentage with a colour, because the actions
 * they call for are different and several of them are not "catch up":
 *
 * | verdict       | what it means                                        |
 * |---------------|------------------------------------------------------|
 * | `no-syllabus` | nothing has been written down — **not** 0% covered   |
 * | `not-started` | the year has not begun                               |
 * | `finished`    | the whole course is covered                          |
 * | `behind`      | more than `behindBy` short of the year               |
 * | `on-track`    | keeping up                                           |
 * | `ended-short` | the year is over and the course did not finish       |
 * | `ended-done`  | the year is over and it did                          |
 *
 * `ended-short` is deliberately not `behind`: there is nothing left to catch
 * up on, and telling somebody to hurry in September about a year that closed
 * in March is the critic this codebase already refuses to ship.
 */
export type PaceVerdict =
  | "no-syllabus"
  | "not-started"
  | "finished"
  | "behind"
  | "on-track"
  | "ended-short"
  | "ended-done";

export function paceVerdict(
  shareCovered: number | null,
  shareElapsed: number | null,
  yearState: string,
  behindBy = 0.15,
): PaceVerdict {
  // First, because it is the one that is not a rate at all. A course with no
  // syllabus has not covered 0% of it; there is nothing to have covered.
  if (shareCovered === null) return "no-syllabus";
  if (yearState === "before") return "not-started";
  if (yearState === "ended") return shareCovered >= 1 ? "ended-done" : "ended-short";
  if (shareCovered >= 1) return "finished";
  if (shareElapsed !== null && shareCovered < shareElapsed - behindBy) return "behind";
  return "on-track";
}

export const PACE_VERDICT_LABEL: Record<PaceVerdict, string> = {
  "no-syllabus": "No syllabus",
  "not-started": "Not started",
  finished: "Finished",
  behind: "Behind",
  "on-track": "On track",
  "ended-short": "Did not finish",
  "ended-done": "Finished",
};

export function paceVerdictTone(
  verdict: PaceVerdict,
): "secondary" | "success" | "warning" | "outline" {
  if (verdict === "behind") return "warning";
  if (verdict === "finished" || verdict === "ended-done") return "success";
  if (verdict === "no-syllabus") return "outline";
  return "secondary";
}

/**
 * A share as a percentage, or a dash.
 *
 * Null is *"there is nothing to measure"* and must never render as `0%` —
 * the distinction the whole module is built on, and the one a `?? 0` in a
 * template would quietly erase.
 */
export function formatShare(share: number | null): string {
  if (share === null || Number.isNaN(share)) return "—";
  return `${Math.round(share * 100)}%`;
}

/** Courses worth showing first: the ones somebody has to do something about. */
export function paceRank(verdict: PaceVerdict): number {
  const order: PaceVerdict[] = [
    "behind",
    "ended-short",
    "no-syllabus",
    "on-track",
    "not-started",
    "finished",
    "ended-done",
  ];
  const at = order.indexOf(verdict);
  return at === -1 ? order.length : at;
}
