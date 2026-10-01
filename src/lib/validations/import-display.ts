import { normaliseHeading, splitCsvLine } from "./csv";

/**
 * The half of `import.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `import.ts` re-exports all of it.
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
  /**
   * **The bare `Email` heading is the guardian's**, exactly as the bare `Phone`
   * heading above it already is.
   *
   * A school roll has one contact column of each kind and they are one person's
   * — the parent's. This one said `email` and landed on the *child*, so a
   * single spreadsheet's two contact columns were filed against two different
   * people, and the guardian finished every import with a phone and no address
   * while a seven-year-old held the email. Which of the two people a bare
   * heading means is a judgement call; that both bare headings mean the *same*
   * one is not.
   */
  { field: "guardianEmail", label: "Guardian email", required: false, aliases: ["email", "e-mail", "email id", "emailid", "parent email", "father email", "mother email"] },
  { field: "guardianRelationship", label: "Relationship", required: false, aliases: ["relationship", "relation"] },
  /**
   * The student's own, and only from a heading that says whose it is. A school
   * child has neither; a college student has both, which is why these are
   * collected rather than dropped — this product's first customer is a
   * mahavidyalaya.
   */
  { field: "email", label: "Student email", required: false, aliases: ["student email", "student e-mail", "child email", "pupil email"] },
  { field: "phone", label: "Student phone", required: false, aliases: ["student phone", "student mobile", "child phone", "pupil phone"] },
  { field: "addressLine1", label: "Address", required: false, aliases: ["address", "address line 1", "address1"] },
  { field: "city", label: "City", required: false, aliases: ["city", "town"] },
] as const;

export type ImportField = (typeof IMPORT_COLUMNS)[number]["field"];

export type ParsedRow = Partial<Record<ImportField, string>> & { lineNumber: number };

export type ParseResult =
  | { ok: true; rows: ParsedRow[]; headers: string[]; unmatched: string[] }
  | { ok: false; error: string };

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
