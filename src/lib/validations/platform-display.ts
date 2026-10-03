/**
 * The half of `platform.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `platform.ts` re-exports all of it.
 */

/**
 * A slug is a permanent, public address. The rule here is deliberately the same
 * regular expression `platform_start_school` enforces in SQL — the server
 * function is the gate (rule: "the client is a convenience"), and this exists so
 * a person is told before they submit rather than after.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * A short, honest list rather than the full IANA database. Every one of these
 * is a place this product is actually sold into; a 400-entry dropdown is a
 * worse answer to "where are you?" than six. Shared by the sign-up page and
 * Add New School (0323), so the two cannot offer different clocks.
 */
export const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Asia/Dubai",
  "UTC",
];

/**
 * Turn a school's name into a candidate address. Only ever a suggestion — the
 * person can overwrite it, and the database decides whether it is free.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
}
