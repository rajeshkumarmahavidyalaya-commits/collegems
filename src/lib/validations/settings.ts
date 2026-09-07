import { z } from "zod";

/**
 * Settings — the client half.
 *
 * The catalogue in `reference.settings_catalog` describes each key as data, so
 * this file is the only place that knows how to read that description — the
 * same bargain `src/lib/validations/reports.ts` makes, and for the same reason:
 * adding a setting stays "one row in a migration" and never becomes "one row
 * and a React component".
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

export const settingFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(SETTING_TYPES).catch("text"),
  help: z.string().optional(),
});
export type SettingField = z.infer<typeof settingFieldSchema>;

export function parseFields(raw: unknown): SettingField[] {
  const result = z.array(settingFieldSchema).safeParse(raw);
  return result.success ? result.data : [];
}

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
 * Whether a value counts as filled in — matching `settings_problems()`'s test
 * exactly, including the case that had been true of `school.profile` in every
 * tenant since the module shipped: an object with eight keys and every one of
 * them null is **not** filled in, however present the row is.
 */
export function isFilledIn(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).some(isFilledIn);
  }
  return true;
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

export function severityTone(severity: string): "warning" | "secondary" {
  return severity === "warning" ? "warning" : "secondary";
}

export const saveSettingSchema = z.object({
  key: z.string().min(1),
  /** Already converted to the declared JSON shape by the form. */
  value: z.unknown(),
});
