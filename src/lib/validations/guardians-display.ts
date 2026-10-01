import { optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The half of `guardians.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `guardians.ts` re-exports all of it.
 */

/**
 * The guardian write path's client half.
 *
 * ## The list, and why there are two copies of it
 *
 * `guardian_student.relationship` has carried
 * `check (relationship in ('father', 'mother', 'guardian', 'other'))` since
 * migration `0003`, and the convention says *"a list of valid values belongs in
 * one place, and the constraint is usually that place"*.
 *
 * A `<Select>` cannot ask a CHECK what to draw, so there is a second copy here
 * — and the honest thing is to say which one is load-bearing. **The constraint
 * is.** This array decides what the office is *offered*; Postgres decides what
 * is *stored*, and since migration `0222` it says so in words rather than by
 * constraint name. `tests/students/guardians.test.ts` reads the migration and
 * fails if the two ever stop agreeing, which is the only way a second copy is
 * safe to keep.
 */
export const GUARDIAN_RELATIONSHIPS = [
  { value: "father", label: "Father" },
  { value: "mother", label: "Mother" },
  { value: "guardian", label: "Guardian" },
  { value: "other", label: "Other" },
] as const;

/** The picker's options — the constant's second reader, per `optionsFor`. */
export function relationshipOptions(t: Translator) {
  return optionsFor(GUARDIAN_RELATIONSHIPS, "guardians.relationship", t);
}
