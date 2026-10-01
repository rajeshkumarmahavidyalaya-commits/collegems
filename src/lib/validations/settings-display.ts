/**
 * The half of `settings.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `settings.ts` re-exports all of it.
 */

/**
 * Mirrors `reference.settings_catalog.value_type`.
 *
 * **There is no `secret`.** `public.settings` is readable by every tenant
 * member, so a credential stored there would be published to every family;
 * provider keys live on the Edge Functions and nowhere else. The omission is
 * the mechanism, here as in the migration.
 */
export const SETTING_TYPES = ["text", "number", "boolean", "email", "url", "object"] as const;

export type SettingType = (typeof SETTING_TYPES)[number];

/** The control to render for a declared type. */
export function inputType(type: SettingType): "text" | "number" | "email" | "url" {
  switch (type) {
    case "number":
      return "number";
    case "email":
      return "email";
    case "url":
      return "url";
    default:
      return "text";
  }
}

/**
 * A form field always carries a string; the database wants the declared JSON
 * type. This is the conversion, and it is where "" has to mean **null** rather
 * than `""` — an empty box is a value nobody entered, and storing an empty
 * string would make `settings_problems()` call the setting filled in.
 */
export function toJsonValue(raw: string, type: SettingType): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") return trimmed === "true";
  return trimmed;
}

/** The inverse, for putting a stored value back into a form. */
export function toFormValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * "Set" and "left at the default" are two different states and one value cannot
 * carry both. A school reading "Library fine per day: 2.00" needs to know
 * whether somebody chose 2.00 or whether nobody has ever opened this screen —
 * the same instinct as `attendance_coverage` and `audit_actor_label`.
 */
export function originSentence(setting: {
  isSet: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}): string {
  if (!setting.isSet) return "Not set — using the default";
  if (!setting.updatedAt) return "Set";
  const when = setting.updatedAt.slice(0, 10);
  return setting.updatedBy && setting.updatedBy !== "System"
    ? `Changed by ${setting.updatedBy} on ${when}`
    : `Set on ${when}`;
}
