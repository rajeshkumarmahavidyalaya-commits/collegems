import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * `promotion.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `promotion.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
/**
 * Phase 1.4 — promotion, as a preview you can argue with.
 *
 * The rules are a JSONB document (rule 12) and the evaluation order is part of
 * the contract, so it is written down here as well as in the migration and the
 * docs — a person reading the form needs to know that no-detention beats
 * attendance, which beats the examination.
 */

export const DECISIONS = [
  {
    value: "promote",
    label: "Promote",
    tone: "success",
    hint: "Moves up a class in the receiving session.",
  },
  {
    value: "repeat",
    label: "Repeat",
    tone: "warning",
    hint: "Stays in the same class in the receiving session.",
  },
  {
    value: "graduate",
    label: "Graduate",
    tone: "info",
    hint: "Leaves the school as an alumnus. No new enrolment.",
  },
  {
    value: "hold",
    label: "Hold",
    tone: "muted",
    hint: "Nothing happens. The outgoing enrolment stays open.",
  },
] as const;

export type Decision = (typeof DECISIONS)[number]["value"];

export const ON_MISSING_RESULT = [
  {
    value: "hold",
    label: "Hold them",
    hint: "The safe answer: somebody has to look at it.",
  },
  {
    value: "promote",
    label: "Promote anyway",
    hint: "Treat a missing result as a pass.",
  },
  {
    value: "repeat",
    label: "Make them repeat",
    hint: "Treat a missing result as a failure.",
  },
] as const;

export const EXAM_KINDS_FOR_PROMOTION = [
  { value: "annual", label: "Annual" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "term", label: "Term exam" },
  { value: "unit", label: "Unit test" },
] as const;

/**
 * The order in which the rules are consulted. Rendered on the screen because
 * "why was this child promoted despite failing" is answered by the order, not
 * by any single rule.
 */
export const EVALUATION_ORDER = [
  "The no-detention band promotes regardless of anything else.",
  "Attendance below the minimum makes a student repeat, even having passed.",
  "The examination decides everyone else.",
  "A missing result falls to whatever you chose for it — never silently a failure.",
] as const;

export function decisionLabel(value: string, t: Translator) {
  const decision = DECISIONS.find((d) => d.value === value);
  return decision
    ? labelFor(`promotion.decision.${decision.value}`, decision.label, t)
    : value;
}

/**
 * The sentence under each decision on the radio group, and the one under the
 * missing-result choice.
 *
 * Both render immediately beneath the name `decisionLabel` returns, so they are
 * part of the same control rather than documentation beside it. Translating the
 * name and leaving the explanation is how a screen comes to carry one decision
 * in two languages — the failure the label batches before this one recorded and
 * this is the module where it would have been most visible, because a rollover
 * is the screen somebody argues with.
 */
export function decisionHint(value: string, t: Translator) {
  const decision = DECISIONS.find((d) => d.value === value);
  return decision
    ? labelFor(`promotion.decisionHint.${decision.value}`, decision.hint, t)
    : "";
}

export function onMissingResultHint(value: string, t: Translator) {
  const option = ON_MISSING_RESULT.find((o) => o.value === value);
  return option
    ? labelFor(`promotion.onMissingResultHint.${option.value}`, option.hint, t)
    : "";
}

/**
 * *"Currently promote — …"* and *"12 promote, 3 repeat"*, as whole sentences.
 *
 * Both call sites wrote `decisionLabel(d).toLowerCase()` to fit the word into
 * running text. Rule 15 already names that: **`.toLowerCase()` on a translated
 * label is an English-only operation** — Hindi and Urdu have no letter case, so
 * it is a no-op in every locale except the one it was written for, and in
 * Turkish it is wrong. It survived the earlier sweep because this module's
 * label was still English, so the call was still doing something.
 *
 * The fix is the one that batch also settled: **the sentence is the unit, not
 * the word.** The lowercase form of "Promote" is a fact about the English
 * sentence, so the English sentence carries it and the other two say it their
 * own way.
 */
export function currentlySentence(value: string, t: Translator) {
  return t("promotion.currently", { decision: decisionLabel(value, t) });
}

export function tallySentence(value: string, count: number, t: Translator) {
  return t("promotion.tally", { count, decision: decisionLabel(value, t) });
}

export function decisionTone(value: string) {
  return DECISIONS.find((d) => d.value === value)?.tone ?? "muted";
}

/**
 * Which decisions a person may switch a row to, given where the student is.
 * `graduate` is not offered: whether there is a next class is a fact about the
 * school, not a choice — and offering it would let somebody graduate a
 * seven-year-old.
 */
export function switchableDecisions(hasNextClass: boolean): Decision[] {
  return hasNextClass ? ["promote", "repeat", "hold"] : ["repeat", "hold"];
}

/**
 * A promotion or a repeat has to land somewhere; a graduate and a hold must
 * not. The database says the same thing with a check constraint — this is so
 * the form can say it before the save is refused.
 */
export function needsTargetSection(decision: string) {
  return decision === "promote" || decision === "repeat";
}

/**
 * What a rollover is about to leave behind, as the server said it.
 *
 * `academics_session_problems()` speaks only in the last six weeks of a year
 * and afterwards, and goes quiet once the arrangements exist in the receiving
 * session — so a screen showing nothing here is a school that is either not
 * near a rollover or has already done one, and neither needs a sentence.
 */
export type SessionProblem = { severity: string; message: string };

export { severityTone } from "./severity";

/**
 * One thing a rollover cannot close, as `promotion_left_behind` said it.
 *
 * Deliberately not a `SessionProblem`: these carry a **kind** (what sort of
 * loose end this is), not a severity. Every one of them is worth a person's
 * attention or the function would not have returned it.
 */
export type LeftBehindNote = { kind: string; message: string };

export function leftBehindLabel(kind: string, t: Translator): string {
  if (kind === "library")
    return labelFor("promotion.leftBehind.library", "Library", t);
  if (kind === "balance")
    return labelFor("promotion.leftBehind.balance", "Money", t);
  return labelFor("promotion.leftBehind.other", "Note", t);
}

/**
 * The years a child can move into from `fromId`: the ones that start after it,
 * soonest first. The first is the default.
 *
 * Both pickers used to take "the first year that is not current" from a list
 * sorted oldest first, which on a college with three years is the year
 * *before* -- so the promotion screen opened set to promote every child into
 * last year, and the renewal launcher to carry every bus seat there. The
 * database refuses a backward run now (0276); this keeps the screen from
 * offering one. Dates are ISO strings and compared as strings, so no time zone
 * can move a boundary.
 */
export function laterYears<T extends { id: string; startDate: string }>(
  years: readonly T[],
  fromId: string,
): T[] {
  const from = years.find((y) => y.id === fromId);
  if (!from) return [];
  return years
    .filter((y) => y.startDate > from.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}
