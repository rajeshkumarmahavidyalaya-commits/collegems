/**
 * The CSV half of an import, with **no imports at all** -- the student
 * importer and the staff importer both run it in the browser, and one
 * `import { z }` here would charge every importer for Zod (the
 * `fees-display.ts` split). Moved out of `import.ts`, which re-exports it.
 */

export function normaliseHeading(value: string): string {
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
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) return calendarDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

/**
 * A date only if the calendar has it. The ISO branch used to pad and return,
 * so `2024-13-40` passed the preview and failed later as a Postgres cast
 * error; and `31/02/2024` passed a 1-31 range check. Round-tripping through
 * `Date.UTC` refuses both, with no timezone in play.
 */
function calendarDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

/**
 * Text pasted from a spreadsheet arrives tab-separated. Quote each cell rather
 * than swapping tabs for commas, because "Sharma, Anita" is one cell. Shared
 * by the staff and book importers.
 */
export function fromPaste(text: string): string {
  if (!text.includes("\t")) return text;
  return text
    .split(/\r\n|\n|\r/)
    .map((line) =>
      line
        .split("\t")
        .map((cell) => `"${cell.replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
}
