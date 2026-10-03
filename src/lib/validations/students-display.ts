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

/**
 * The reference's "Search Field" on Search Students: which column a keyword is
 * matched against. A whitelist, because the server action turns it into a
 * column name; the keyword itself is always a bound value, never part of a
 * filter string (rule 4, 0259).
 */
export const STUDENT_SEARCH_FIELDS = ["admission_number", "name", "phone", "email", "address"] as const;
export type StudentSearchField = (typeof STUDENT_SEARCH_FIELDS)[number];

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "undisclosed", label: "Undisclosed" },
] as const;
