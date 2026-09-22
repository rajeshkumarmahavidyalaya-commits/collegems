import { labelFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * How bad a finding is, in one place.
 *
 * ## Why this file exists
 *
 * Every `*_problems()` function in Postgres returns `severity text`. Nothing
 * constrains the word — a set-returning function cannot carry a CHECK — so the
 * vocabulary lives wherever somebody wrote it down. Swept, before this module:
 *
 * | | |
 * |---|---|
 * | the list of words | **twice** — `substitutions.ts` and `certificates.ts`, agreeing |
 * | `severityTone` | **six copies**, in six modules, under one name |
 * | the conservative default | **once**, as `z.enum(...).catch("warning")` in `certificates.ts` |
 * | the migrations | 13 critics said `warning`, 3 said **`warn`** |
 *
 * That is `formatMoney`-under-four-names (rule 15) with a consequence, because
 * the copies compare the word: `severity === "warning" ? "warning" :
 * "secondary"`. A `warn` fell through to the neutral tone — the same grey an
 * `info` gets — and on the live college the row carrying it was
 *
 * > *302 of 302 active students have nobody who can sign in.*
 *
 * drawn as an aside. Migration `0266` fixed the three emitters; this is the
 * half that stops the next one mattering.
 *
 * ## The default is loud, and that was already decided
 *
 * `certificates.ts` had `.catch("warning")` from the day it shipped: a value
 * this product does not recognise is treated as *check this*, never as a note.
 * Rule 12's conservative reading, applied to a colour — and the point is that
 * somebody had already made the decision correctly and five renderers never
 * found it.
 *
 * Three of the six copies could not return `destructive` at all, having no
 * `error` branch. Correct for their own critic **today**, and wrong the morning
 * one of them grows an `error` — which is the whole argument for one
 * definition rather than six that happen to agree.
 */
export const PROBLEM_SEVERITIES = ["error", "warning", "info"] as const;
export type ProblemSeverity = (typeof PROBLEM_SEVERITIES)[number];

export const SEVERITY_LABEL: Record<ProblemSeverity, string> = {
  error: "Needs fixing",
  warning: "Check this",
  info: "Note",
};

/** Whether the database said a word this product knows. */
export function isProblemSeverity(value: string): value is ProblemSeverity {
  return (PROBLEM_SEVERITIES as readonly string[]).includes(value);
}

/**
 * The word a person reads — and for an unrecognised one, **the word the
 * database sent**.
 *
 * Rule 15 settled this and a first draft of this module broke it: *"the
 * fallback is the value, not the key… `notices.category.staff_only` on a badge
 * is worse than the word the database stored."* Labelling a `catastrophe` as
 * *Check this* would be the product telling somebody it understood.
 *
 * > **The colour is a judgement; the word is a fact.** `severityTone` is
 * > deliberately loud about a word it does not know, because the cost of being
 * > wrong there is a row nobody reads. `severityLabel` is deliberately literal
 * > about the same word, because the cost of being wrong *there* is somebody
 * > believing the product classified something it did not.
 *
 * `tests/timetable/substitution-shapes.test.ts` has pinned both halves since
 * the substitutions module shipped, and it is what caught the draft.
 */
export function severityLabel(severity: string, t: Translator): string {
  if (!isProblemSeverity(severity)) return severity;
  return labelFor(`severity.${severity}`, SEVERITY_LABEL[severity], t);
}

/**
 * Never colour alone — `severityLabel` always sits beside this.
 *
 * `secondary` is reserved for `info`. Anything else, recognised or not, is at
 * least a warning: a finding this product cannot classify is a finding
 * somebody should look at, and the failure mode of guessing the other way is a
 * row nobody reads.
 *
 * This is the one behaviour the six copies did not have, and the one that
 * matters: they compared `=== "warning"` and fell through to `secondary`.
 */
export function severityTone(severity: string): "destructive" | "warning" | "secondary" {
  if (severity === "error") return "destructive";
  if (severity === "info") return "secondary";
  return "warning";
}
