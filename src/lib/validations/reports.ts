import { z } from "zod";
import { formatMoney } from "./fees";

/**
 * Phase 6.1 — the reporting kernel's client half.
 *
 * The catalog in `reference.reports` describes each report's parameters and
 * columns as JSON. This file is the only place that knows how to read that
 * description, so adding a report stays "a function plus a catalog row" and
 * never becomes "a function, a catalog row, and a React component".
 */

/** What a parameter control is. Mirrors `reference.reports.parameters[].type`. */
export const PARAM_TYPES = ["section", "class_level", "date", "number", "select", "text"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** How a column is rendered. Mirrors `reference.reports.columns[].type`. */
export const COLUMN_TYPES = [
  "text",
  "number",
  "money",
  "percent",
  "date",
  "datetime",
  "badge",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

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
});
export type RunReportInput = z.infer<typeof runReportSchema>;

export function cleanParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null));
}

/** Every parameter marked required has a value. Reported per field, not as one blanket error. */
export function missingRequired(
  descriptors: ParamDescriptor[],
  params: Record<string, string>,
): string[] {
  return descriptors.filter((d) => d.required && !params[d.name]?.trim()).map((d) => d.name);
}

// ---------------------------------------------------------------------------
// Rendering a cell
// ---------------------------------------------------------------------------

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * One formatter for every report, driven by the column's declared type.
 *
 * `null` renders as an em dash rather than an empty cell: a blank in a printed
 * roster is ambiguous between "no value" and "the column ran off the page",
 * and a dash is not.
 */
export function formatCell(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "—";

  switch (type) {
    case "money":
      return formatMoney(Number(value));

    case "percent": {
      const n = Number(value);
      return Number.isFinite(n) ? `${n}%` : "—";
    }

    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString("en-IN") : String(value);
    }

    case "date": {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime())
        ? String(value)
        : parsed.toLocaleDateString("en-IN", DATE_FORMAT);
    }

    case "datetime": {
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime())
        ? String(value)
        : parsed.toLocaleString("en-IN", { ...DATE_FORMAT, hour: "2-digit", minute: "2-digit" });
    }

    case "badge":
      // Title-cased from a snake_case enum value, so `transferred_out` reads as
      // "Transferred out" without a lookup table per report.
      return String(value)
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());

    default:
      // `true`/`false` come back from jsonb as booleans and would otherwise
      // render as the strings "true"/"false", which reads as a bug.
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
  }
}

/** Numeric-ish columns are right-aligned unless the catalog says otherwise. */
export function alignFor(column: ColumnDescriptor): "left" | "right" {
  if (column.align) return column.align;
  return column.type === "money" || column.type === "number" || column.type === "percent"
    ? "right"
    : "left";
}

/** Today, and 30 days back, as `yyyy-mm-dd` in the viewer's own zone. */
export function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  return { from: iso(from), to: iso(now) };
}

/**
 * A filename a person can find again: the report, the date it was taken, and
 * nothing else. Never the parameters — a filename carrying a section id is
 * unreadable, and one carrying a student's name is a privacy problem in a
 * downloads folder.
 */
export function exportFilename(reportKey: string): string {
  return `${reportKey.replace(/\./g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
}
