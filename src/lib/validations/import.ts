import { z } from "zod";

/**
 * Bulk student import.
 *
 * Rule 13 in full: the preview is **editable rows**, and apply writes what the
 * rows say rather than re-parsing the file. Rule 7's bound is 500 rows a run,
 * stated in the database and repeated here so the browser refuses a 4,000-row
 * file before uploading it rather than after.
 *
 * Parsing lives here rather than in Postgres because a CSV is a browser
 * problem — quoted commas, a UTF-8 BOM, Excel's date formats. *Judging* the
 * parsed rows lives in Postgres (`import_validate_run`), because that needs the
 * school's own data to check against.
 */

export const MAX_IMPORT_ROWS = 500;

/**
 * The columns an import understands, and the headings a real spreadsheet uses
 * for them. Matching is case- and space-insensitive, so "Admission No." and
 * "admission_number" both land in the same place.
 */
export const IMPORT_COLUMNS = [
  { field: "firstName", label: "First name", required: true, aliases: ["first name", "firstname", "given name", "name"] },
  { field: "middleName", label: "Middle name", required: false, aliases: ["middle name", "middlename"] },
  { field: "lastName", label: "Last name", required: false, aliases: ["last name", "lastname", "surname"] },
  { field: "admissionNumber", label: "Admission number", required: true, aliases: ["admission number", "admission no", "admissionno", "adm no", "admission"] },
  { field: "admissionDate", label: "Admission date", required: false, aliases: ["admission date", "date of admission", "doa"] },
  { field: "dateOfBirth", label: "Date of birth", required: false, aliases: ["date of birth", "dob", "birth date", "birthdate"] },
  { field: "gender", label: "Gender", required: false, aliases: ["gender", "sex"] },
  { field: "sectionLabel", label: "Class", required: false, aliases: ["class", "section", "class section", "grade"] },
  { field: "rollNumber", label: "Roll number", required: false, aliases: ["roll number", "roll no", "rollno", "roll"] },
  { field: "guardianName", label: "Guardian", required: false, aliases: ["guardian", "guardian name", "parent", "father name", "mother name"] },
  { field: "guardianPhone", label: "Guardian phone", required: false, aliases: ["guardian phone", "parent phone", "phone", "mobile", "contact"] },
  { field: "guardianRelationship", label: "Relationship", required: false, aliases: ["relationship", "relation"] },
  { field: "email", label: "Email", required: false, aliases: ["email", "e-mail"] },
  { field: "addressLine1", label: "Address", required: false, aliases: ["address", "address line 1", "address1"] },
  { field: "city", label: "City", required: false, aliases: ["city", "town"] },
] as const;

export type ImportField = (typeof IMPORT_COLUMNS)[number]["field"];

export type ParsedRow = Partial<Record<ImportField, string>> & { lineNumber: number };

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; headers: string[]; unmatched: string[] }
  | { ok: false; error: string };

function normaliseHeading(value: string): string {
  return (
    value
      .replace(/^﻿/, "")
      .toLowerCase()
      .replace(/[._-]+/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      // Trimmed **last**, not first: "Admission No." loses its dot to the
      // separator rule above and becomes "admission no " — a trailing space
      // that made every heading with punctuation fail to match.
      .trim()
  );
}

/**
 * A CSV line splitter that understands quotes, because school spreadsheets
 * contain `"Kumar, Rajesh"` and a naive `split(",")` turns one child into two.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.map((v) => v.trim());
}

/**
 * Turn a file into rows. Refuses rather than truncating when the file is over
 * the bound: silently importing the first 500 of 900 children is the worst
 * possible outcome, because nobody notices until April.
 */
export function parseCsv(text: string): ParseResult {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((line, index) => index === 0 || line.trim() !== "");

  if (lines.length === 0 || lines[0].trim() === "") {
    return { ok: false, error: "That file is empty." };
  }

  const headers = splitCsvLine(lines[0]);
  const map = new Map<number, ImportField>();
  const unmatched: string[] = [];

  headers.forEach((heading, index) => {
    const key = normaliseHeading(heading);
    const column = IMPORT_COLUMNS.find(
      // `aliases` is a readonly tuple of literals, so widen before searching.
      (c) => (c.aliases as readonly string[]).includes(key) || normaliseHeading(c.label) === key,
    );
    if (column) map.set(index, column.field);
    else if (heading.trim() !== "") unmatched.push(heading.trim());
  });

  const required = IMPORT_COLUMNS.filter((c) => c.required);
  const missing = required.filter((c) => ![...map.values()].includes(c.field));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The file needs a column for ${missing
        .map((c) => c.label.toLowerCase())
        .join(" and ")}. Found: ${headers.filter((h) => h.trim() !== "").join(", ") || "nothing"}.`,
    };
  }

  const body = lines.slice(1).filter((line) => line.trim() !== "");
  if (body.length === 0) {
    return { ok: false, error: "That file has headings but no rows." };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `That file has ${body.length} rows and an import takes at most ${MAX_IMPORT_ROWS}. Split it — importing the first ${MAX_IMPORT_ROWS} silently would be worse.`,
    };
  }

  const rows: ParsedRow[] = body.map((line, index) => {
    const cells = splitCsvLine(line);
    const row: ParsedRow = { lineNumber: index + 2 };
    map.forEach((field, position) => {
      const value = cells[position];
      if (value !== undefined && value !== "") row[field] = value;
    });
    return row;
  });

  return { ok: true, rows, headers, unmatched };
}

/**
 * Dates as schools actually write them: `2015-06-12`, `12/06/2015`,
 * `12-06-2015`. **Day first**, because that is what an Indian school office
 * types and getting it wrong silently swaps birthdays for every child born
 * before the 13th.
 */
export function parseImportDate(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (text === "") return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/** `M`, `Male`, `boy` → `male`. Anything unrecognised stays as typed, so the database's own check reports it. */
export function normaliseGender(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (["m", "male", "boy", "b"].includes(text)) return "male";
  if (["f", "female", "girl", "g"].includes(text)) return "female";
  if (["o", "other"].includes(text)) return "other";
  if (["u", "undisclosed", "not stated", "na", "n/a"].includes(text)) return "undisclosed";
  return text;
}

export const importRowEditSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().max(80).optional(),
  middleName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  admissionNumber: z.string().max(40).optional(),
  dateOfBirth: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), z.literal("")])
    .optional(),
  gender: z.string().max(20).optional(),
  sectionId: z.union([z.string().uuid(), z.literal("")]).optional(),
  rollNumber: z.string().max(20).optional(),
  guardianName: z.string().max(120).optional(),
  guardianPhone: z.string().max(30).optional(),
  skipped: z.boolean().optional(),
});
export type ImportRowEdit = z.infer<typeof importRowEditSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * What the apply button should say. The counts are the whole decision: nothing
 * ready means the button is wrong to offer at all, and a run with problems left
 * should say plainly that they are being left behind.
 */
export function applySentence(summary: {
  ready: number;
  withProblems: number;
  skipped: number;
}): string {
  if (summary.ready === 0) {
    return summary.withProblems > 0
      ? "Fix the problems below, or skip those rows"
      : "Nothing to import";
  }
  const base = `Import ${summary.ready} student${summary.ready === 1 ? "" : "s"}`;
  const left = summary.withProblems + summary.skipped;
  if (left === 0) return base;
  return `${base}, leaving ${left} behind`;
}

export function rowStatus(row: {
  skipped: boolean;
  problems: string[];
  appliedStudentId: string | null;
  applyError: string | null;
}): "applied" | "failed" | "skipped" | "problem" | "ready" {
  if (row.appliedStudentId) return "applied";
  if (row.applyError) return "failed";
  if (row.skipped) return "skipped";
  if (row.problems.length > 0) return "problem";
  return "ready";
}
