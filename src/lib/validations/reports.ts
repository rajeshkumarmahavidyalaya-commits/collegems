import { z } from "zod";
import { formatMoney } from "./fees";
import { formatNumber } from "@/lib/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";

/**
 * Phase 6.1 — the reporting kernel's client half.
 *
 * The catalog in `reference.reports` describes each report's parameters and
 * columns as JSON. This file is the only place that knows how to read that
 * description, so adding a report stays "a function plus a catalog row" and
 * never becomes "a function, a catalog row, and a React component".
 */

/** What a parameter control is. Mirrors `reference.reports.parameters[].type`. */
export const PARAM_TYPES = ["section", "class_level", "staff", "date", "number", "select", "text"] as const;
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
      // One decimal, and none at all when the number is whole. `exam_results`
      // stores a percentage to three places, so the raw value renders as
      // "63.286%" -- which is not what the exams screen shows for the same
      // child, and a report that disagrees with the module it reads is the one
      // thing rule 11 asks a report not to do.
      const n = Number(value);
      if (!Number.isFinite(n)) return "—";
      return `${Number.isInteger(n) ? n : Number(n.toFixed(1))}%`;
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

// ---------------------------------------------------------------------------
// Exporting more than one page
// ---------------------------------------------------------------------------

/**
 * How a full export works, and why it is here rather than in a job.
 *
 * Rule 7 listed "full exports" as unbuilt `jobs` work, and the obstacle was
 * never the size of the answer — it was **who runs it**. `report_run` gates on
 * the caller's role, so a worker draining a queue has no role and cannot run a
 * report at all; every way round ends in inventing a service identity, which
 * rule 7 already refuses to do quietly for scheduled reports.
 *
 * A person asking for an export is *present while it runs*, and that changes
 * everything:
 *
 * > **A long export is the browser's job, not the server's.** The server
 * > answers bounded pages as the person who asked; the client assembles them.
 * > RLS stays the only gate, no service identity is invented, and progress and
 * > cancellation come free.
 */

/** One call's worth. The database caps at this too, so asking for more is moot. */
export const EXPORT_PAGE_SIZE = 5000;

/**
 * The ceiling, stated out loud rather than silently applied.
 *
 * Rule 13's instruction, twice learnt: *"Refuse an oversized input rather than
 * truncating it... nobody notices until April."* A spreadsheet with the first
 * 100,000 of 340,000 rows looks complete, so an export past this refuses and
 * says the number.
 */
export const EXPORT_MAX_ROWS = 100_000;

export type ExportPlan =
  | { ok: true; pages: number[]; rows: number }
  | { ok: false; reason: string };

/**
 * The offsets to fetch, or a sentence saying why not.
 *
 * Pure and separately tested, because the two ways this goes wrong are both
 * silent: an off-by-one in the page walk drops the last partial page, and an
 * unchecked total turns a mis-parameterised report into a browser that stops
 * responding.
 */
export function planExport(totalRows: number, locale: Locale = DEFAULT_LOCALE): ExportPlan {
  // Through `formatNumber`, never a locale tag written here: rule 15. It also
  // matters more than usual for these numbers — `en-IN` groups a hundred
  // thousand as "1,00,000", which is what a bursar in Nagpur reads and what
  // "100,000" is not.
  const n = (value: number) => formatNumber(value, locale);

  if (totalRows <= 0) {
    return { ok: false, reason: "There is nothing to export — the report returned no rows." };
  }
  if (totalRows > EXPORT_MAX_ROWS) {
    return {
      ok: false,
      reason:
        `That is ${n(totalRows)} rows, and an export here stops at ${n(EXPORT_MAX_ROWS)}. ` +
        `Narrow the date range or the class and try again — a spreadsheet with only part of ` +
        `the answer in it is worse than none.`,
    };
  }

  const pages: number[] = [];
  for (let offset = 0; offset < totalRows; offset += EXPORT_PAGE_SIZE) {
    pages.push(offset);
  }
  return { ok: true, pages, rows: totalRows };
}

/** A count somebody can watch rather than a spinner. */
export function exportProgressSentence(
  fetched: number,
  total: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return `Fetching ${formatNumber(fetched, locale)} of ${formatNumber(total, locale)} rows…`;
}
