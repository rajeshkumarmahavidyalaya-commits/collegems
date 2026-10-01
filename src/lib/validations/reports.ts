import { z } from "zod";
/**
 * Phase 6.1 — the reporting kernel's client half.
 *
 * The catalog in `reference.reports` describes each report's parameters and
 * columns as JSON. This file is the only place that knows how to read that
 * description, so adding a report stays "a function plus a catalog row" and
 * never becomes "a function, a catalog row, and a React component".
 */
import { COLUMN_TYPES } from "./reports-display";
export { COLUMN_TYPES, formatCell, cellHref, defaultDateRange, exportFilename, EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS, planExport, exportProgressSentence } from "./reports-display";
export type { ColumnType, ExportPlan } from "./reports-display";
export { missingRequired, alignFor } from "./reports-display";

/** What a parameter control is. Mirrors `reference.reports.parameters[].type`. */
export const PARAM_TYPES = [
  "section",
  "class_level",
  "staff",
  "route",
  "vehicle",
  "date",
  "number",
  "select",
  "text",
] as const;

export type ParamType = (typeof PARAM_TYPES)[number];

/**
 * The catalog is written only by migrations, so this is not a trust boundary —
 * but it is still parsed rather than cast. A report whose descriptor drifted
 * from what the UI can render should degrade to a plain text column, not crash
 * the page for every other report on it.
 */
export const paramDescriptorSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(PARAM_TYPES).catch("text"),
  required: z.boolean().optional().default(false),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional()
    .default([]),
});

export type ParamDescriptor = z.infer<typeof paramDescriptorSchema>;

export const columnDescriptorSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(COLUMN_TYPES).catch("text"),
  align: z.enum(["left", "right"]).optional(),
  /**
   * Where this cell goes, as a path with `{key}` placeholders filled from the
   * row — `/students/{student_id}`.
   *
   * **A list you cannot act from is a list you re-type.** `users.family_logins`
   * names 301 children whose family cannot sign in, and the office's next move
   * is the guardian card on each child's page; without this they copy an
   * admission number into a search box, 301 times.
   *
   * The destination belongs to the report rather than to the renderer, which is
   * why it is a catalogue column and not a `case` in the table: a fee defaulter
   * goes to their fee account and the same child on a different report goes to
   * their record.
   */
  href: z.string().optional(),
});

export type ColumnDescriptor = z.infer<typeof columnDescriptorSchema>;

export function parseParameters(raw: unknown): ParamDescriptor[] {
  const result = z.array(paramDescriptorSchema).safeParse(raw);
  return result.success ? result.data : [];
}

export function parseColumns(raw: unknown): ColumnDescriptor[] {
  const result = z.array(columnDescriptorSchema).safeParse(raw);
  return result.success ? result.data : [];
}

/**
 * Parameters go to Postgres as JSON of strings and are read there with
 * `report_param_*`, which treat a missing key, a JSON null and an empty string
 * identically. So the client only has to strip nothing — but it does drop empty
 * values anyway, to keep what is sent legible in a log.
 */
export const runReportSchema = z.object({
  key: z.string().min(1, "Choose a report"),
  params: z.record(z.string(), z.string()),
  limit: z.number().int().min(1).max(5000).optional(),
  /**
   * Which page. `report_run` caps a call at 5,000 rows and returns the true
   * total alongside, so an export walks the offsets — see `planExport` below.
   */
  offset: z.number().int().min(0).optional(),
});

export type RunReportInput = z.infer<typeof runReportSchema>;

export function cleanParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
}

/** Every parameter marked required has a value. Reported per field, not as one blanket error. */
/**
 * Whether this report can be run by a schedule.
 *
 * A digest runs once a morning with no parameters — there is nobody standing at
 * the screen to type a date range into. A report with a **required** parameter
 * therefore cannot be scheduled at all, and saying so is better than offering it
 * and failing every morning: *a control that will refuse you is worse than no
 * control, because it costs the person the work of trying.*
 *
 * Optional parameters are fine. The report applies its own defaults, which is
 * what it does for somebody who leaves the field blank.
 */
export function isSchedulable(descriptors: ParamDescriptor[]): boolean {
  return descriptors.every((d) => !d.required);
}
