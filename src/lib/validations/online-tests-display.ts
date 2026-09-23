import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * What an online-test screen needs in the browser. **Only a type import and the
 * shared label helper**: `online-tests.ts` beside it begins `import { z }`, and
 * the paper a student sits must not ship Zod to draw a clock (rule 15's split).
 */

/**
 * `online_test_save` and `online_test_submit` accept a sitting for this long
 * past its `due_at`, for a network. The migration says `interval '2 minutes'`
 * in four places; `tests/online-tests/online-tests.test.ts` fails when this and
 * they disagree.
 */
export const GRACE_MS = 2 * 60_000;

/**
 * How often a sitting is saved while it changes. Every save is an UPDATE and
 * every UPDATE is an audit row (rule 9), so the paper saves at most this often,
 * when the page is hidden, and on submit -- a crash loses at most this much.
 */
export const SAVE_EVERY_MS = 30_000;

export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 6;

export type SittingState = "not_started" | "in_progress" | "submitted" | "lapsed";

export const SITTING_STATES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "submitted", label: "Submitted" },
  { value: "lapsed", label: "Time ran out" },
] as const;

/** Never colour alone: the badge carries this word. */
export function sittingStateLabel(state: string, t: Translator): string {
  const known = SITTING_STATES.find((s) => s.value === state);
  // The fallback is the value, not the key (rule 15).
  return known ? labelFor(`onlineTests.state.${state}`, known.label, t) : state;
}

/**
 * Which state a sitting is in at `now`, from the row a student or a family can
 * read. Instants only, so no timezone can move it.
 */
export function sittingState(
  attempt: { submittedAt: string | null; dueAt: string } | null,
  now: number = Date.now(),
): SittingState {
  if (!attempt) return "not_started";
  if (attempt.submittedAt) return "submitted";
  return now > Date.parse(attempt.dueAt) + GRACE_MS ? "lapsed" : "in_progress";
}

/** "12:05" of time left, never negative. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A score as "7 of 10"; the maximum always travels with it (rule 12). */
export function scoreText(score: number | null, max: number | null): string {
  if (score == null || max == null) return "—";
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
  return `${trim(score)} of ${trim(max)}`;
}
