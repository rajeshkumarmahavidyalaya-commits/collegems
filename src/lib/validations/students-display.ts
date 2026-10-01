/**
 * The half of `students.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `students.ts` re-exports all of it.
 */

export const STUDENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "alumni", label: "Alumni" },
  { value: "transferred", label: "Transferred" },
  { value: "expelled", label: "Expelled" },
] as const;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "undisclosed", label: "Undisclosed" },
] as const;
