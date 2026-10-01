/**
 * The half of `mobile.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `mobile.ts` re-exports all of it.
 */

export const PLATFORMS = [
  { value: "ios", label: "iPhone / iPad" },
  { value: "android", label: "Android" },
  { value: "web", label: "Web push" },
] as const;
