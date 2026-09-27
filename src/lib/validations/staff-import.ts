import { normaliseGender, normaliseHeading, parseImportDate, splitCsvLine } from "./csv";

/**
 * Staff from a spreadsheet (audit M3).
 *
 * The student importer is a run -> rows -> apply pipeline in Postgres because
 * a roll is hundreds of children with guardians, sections and fees. A staff
 * list is a few dozen people and each one is exactly one `staff_admit` -- the
 * same function the *Add staff* form calls -- so this is the lighter shape of
 * rule 13: the preview is editable rows **in the browser**, and the apply
 * writes what the rows say, one person at a time, reporting each.
 *
 * No Zod here, deliberately: the page runs these judgements in the browser as
 * the office types, and the server action re-checks every row with
 * `staffSchema` -- the client is a convenience, the action is the gate.
 */

/** Refused past this, never truncated: see `parseCsv` in `import.ts`. */
export const MAX_STAFF_IMPORT_ROWS = 200;

export const STAFF_IMPORT_COLUMNS = [
  { field: "firstName", label: "First name", required: true, aliases: ["first name", "firstname", "given name"] },
  { field: "middleName", label: "Middle name", required: false, aliases: ["middle name", "middlename"] },
  { field: "lastName", label: "Last name", required: true, aliases: ["last name", "lastname", "surname", "family name"] },
  { field: "employeeCode", label: "Employee code", required: true, aliases: ["employee code", "emp code", "employee id", "emp id", "staff id", "staff code", "employee no", "emp no", "code"] },
  { field: "designation", label: "Designation", required: true, aliases: ["designation", "post", "position", "job title", "title"] },
  { field: "department", label: "Department", required: false, aliases: ["department", "dept"] },
  { field: "dateOfJoining", label: "Date of joining", required: true, aliases: ["date of joining", "joining date", "doj", "joined on", "joined"] },
  { field: "gender", label: "Gender", required: false, aliases: ["gender", "sex"] },
  { field: "dateOfBirth", label: "Date of birth", required: false, aliases: ["date of birth", "dob", "birth date"] },
  { field: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "mobile number", "phone number", "contact"] },
  { field: "email", label: "Email", required: false, aliases: ["email", "e mail", "email address", "mail"] },
] as const;

export type StaffImportField = (typeof STAFF_IMPORT_COLUMNS)[number]["field"];

/** One editable row. Every value is the text the office sees and can change. */
export type StaffImportRow = Record<StaffImportField, string> & { key: string; line: number };

export type StaffParseResult =
  | { ok: true; rows: StaffImportRow[]; unmatched: string[] }
  | { ok: false; error: string };

function emptyRow(key: string, line: number): StaffImportRow {
  const row = { key, line } as StaffImportRow;
  for (const c of STAFF_IMPORT_COLUMNS) row[c.field] = "";
  return row;
}

export function parseStaffCsv(text: string): StaffParseResult {
  const lines = text.split(/\r\n|\n|\r/);
  const headerLine = lines.find((l) => l.trim() !== "");
  if (!headerLine) return { ok: false, error: "That file is empty." };

  const headers = splitCsvLine(headerLine);
  const map = new Map<number, StaffImportField>();
  const unmatched: string[] = [];
  headers.forEach((heading, index) => {
    const key = normaliseHeading(heading);
    const column = STAFF_IMPORT_COLUMNS.find(
      (c) => (c.aliases as readonly string[]).includes(key) || normaliseHeading(c.label) === key,
    );
    // First heading wins: a second "Phone" column is reported, not merged.
    if (column && ![...map.values()].includes(column.field)) map.set(index, column.field);
    else if (heading.trim() !== "") unmatched.push(heading.trim());
  });

  const missing = STAFF_IMPORT_COLUMNS.filter(
    (c) => c.required && ![...map.values()].includes(c.field),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The file needs a column for ${missing.map((c) => c.label.toLowerCase()).join(", ")}. Found: ${
        headers.filter((h) => h.trim() !== "").join(", ") || "nothing"
      }.`,
    };
  }

  const start = lines.indexOf(headerLine) + 1;
  const body = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .slice(start)
    .filter((l) => l.line.trim() !== "");
  if (body.length === 0) return { ok: false, error: "That file has headings but no rows." };
  if (body.length > MAX_STAFF_IMPORT_ROWS) {
    return {
      ok: false,
      error: `That file has ${body.length} rows and one import takes at most ${MAX_STAFF_IMPORT_ROWS}. Split it -- importing the first ${MAX_STAFF_IMPORT_ROWS} silently would be worse.`,
    };
  }

  const rows = body.map(({ line, number }) => {
    const cells = splitCsvLine(line);
    const row = emptyRow(`line-${number}`, number);
    map.forEach((field, position) => {
      row[field] = cells[position] ?? "";
    });
    return row;
  });
  return { ok: true, rows, unmatched };
}

/** What the server receives for one row, already normalised. */
export type StaffImportPayload = {
  firstName: string;
  middleName: string;
  lastName: string;
  employeeCode: string;
  designation: string;
  department: string;
  dateOfJoining: string;
  gender?: string;
  dateOfBirth: string;
  phone: string;
  email: string;
};

const GENDERS = ["male", "female", "other", "undisclosed"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What is wrong with each row, re-judged over **all** rows after any edit
 * (rule 13): fixing one duplicate employee code clears the other row too.
 */
export function judgeStaffRows(rows: StaffImportRow[]): Map<string, string[]> {
  const codes = new Map<string, number>();
  for (const r of rows) {
    const code = r.employeeCode.trim().toLowerCase();
    if (code) codes.set(code, (codes.get(code) ?? 0) + 1);
  }

  const out = new Map<string, string[]>();
  for (const r of rows) {
    const problems: string[] = [];
    for (const c of STAFF_IMPORT_COLUMNS) {
      if (c.required && r[c.field].trim() === "") problems.push(`${c.label} is missing`);
    }
    const code = r.employeeCode.trim().toLowerCase();
    if (code && (codes.get(code) ?? 0) > 1) {
      problems.push(`Employee code ${r.employeeCode.trim()} appears more than once in this file`);
    }
    if (r.dateOfJoining.trim() && !parseImportDate(r.dateOfJoining)) {
      problems.push(`"${r.dateOfJoining}" is not a date -- write 2024-06-12 or 12/06/2024`);
    }
    if (r.dateOfBirth.trim() && !parseImportDate(r.dateOfBirth)) {
      problems.push(`"${r.dateOfBirth}" is not a date of birth`);
    }
    const gender = normaliseGender(r.gender);
    if (gender && !GENDERS.includes(gender)) {
      problems.push(`"${r.gender}" is not a gender this product records -- male, female, other or undisclosed`);
    }
    if (r.email.trim() && !EMAIL.test(r.email.trim())) {
      problems.push(`"${r.email}" is not an email address`);
    }
    out.set(r.key, problems);
  }
  return out;
}

export function toStaffPayload(r: StaffImportRow): StaffImportPayload {
  const gender = normaliseGender(r.gender);
  return {
    firstName: r.firstName.trim(),
    middleName: r.middleName.trim(),
    lastName: r.lastName.trim(),
    employeeCode: r.employeeCode.trim(),
    designation: r.designation.trim(),
    department: r.department.trim(),
    dateOfJoining: parseImportDate(r.dateOfJoining) ?? r.dateOfJoining.trim(),
    gender: gender ?? undefined,
    dateOfBirth: parseImportDate(r.dateOfBirth) ?? "",
    phone: r.phone.trim(),
    email: r.email.trim(),
  };
}

/** The template the page offers, so nobody has to guess the headings. */
export const STAFF_IMPORT_TEMPLATE =
  STAFF_IMPORT_COLUMNS.map((c) => c.label).join(",") +
  "\nAnita,,Sharma,T-014,Teacher,Science,01/06/2024,Female,,9876543210,anita@example.com\n";
