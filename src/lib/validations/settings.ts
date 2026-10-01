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
export { severityTone } from "./severity";
import { SETTING_TYPES } from "./settings-display";
export { SETTING_TYPES, inputType, toJsonValue, toFormValue, originSentence } from "./settings-display";
export type { SettingType } from "./settings-display";

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

export const saveSettingSchema = z.object({
  key: z.string().min(1),
  /** Already converted to the declared JSON shape by the form. */
  value: z.unknown(),
});
