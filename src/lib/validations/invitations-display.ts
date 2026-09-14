/**
 * What a role stands for, and the question to ask about it.
 *
 * **No imports at all**, deliberately. These three exports were first written
 * in `platform.ts`, which begins `import { z } from "zod"` — and the moment the
 * invite picker imported `SUBJECT_PROMPT` from there, `/settings/team` went
 * **149 kB → 176 kB**. Twenty-seven kilobytes of Zod, shipped to a browser so
 * that a label could be read.
 *
 * That is `fees-display.ts`'s split, made a second time, and CLAUDE.md already
 * warns about it in the words that describe this file: *one `import { z }` and
 * it silently becomes the thing it was extracted from.* Measured after the
 * split: **150 kB**.
 */

/** The kinds of record a login can stand for — `roles.subject`, migration `0224`. */
export const ROLE_SUBJECTS = ["staff", "student", "guardian", "none"] as const;
export type RoleSubject = (typeof ROLE_SUBJECTS)[number];

/**
 * What the picker asks for, per kind.
 *
 * Which kind is a property of the **role**, not of the tier: `parent` and
 * `student` share the `student` tier and need a guardian and a student
 * respectively. `none` has no prompt because there is nothing to ask.
 */
export const SUBJECT_PROMPT: Record<Exclude<RoleSubject, "none">, string> = {
  staff: "Which member of staff is this login for?",
  student: "Which student is this login for?",
  guardian: "Whose parent or guardian is this login for?",
};
