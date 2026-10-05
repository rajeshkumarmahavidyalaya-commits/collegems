import { normaliseHeading, splitCsvLine } from "./csv";

/**
 * Books from a spreadsheet: the reference's "Add New Books In Bulk" (0339).
 *
 * The staff importer's shape of rule 13: the file is read and judged in the
 * browser as editable rows, and the apply writes what the rows say. Unlike
 * staff, the apply is one call to `library_import_books`, because a catalogue
 * is long and a call per book would be a request that times out (rule 7).
 *
 * No Zod here, deliberately: the page runs these judgements as the librarian
 * types, and both the server action and the function check every row again.
 */

/** Refused past this, never truncated. The function holds the same number. */
export const MAX_BOOK_IMPORT_ROWS = 500;

/** In the reference's order, then the two it does not ask for. */
export const BOOK_IMPORT_COLUMNS = [
  { field: "title", label: "Title", required: true, aliases: ["title", "book title", "name", "book name", "book"] },
  { field: "author", label: "Author", required: true, aliases: ["author", "authors", "writer", "author name"] },
  { field: "subject", label: "Subject", required: false, aliases: ["subject", "category", "genre"] },
  { field: "price", label: "Price", required: false, aliases: ["price", "cost", "mrp", "rate"] },
  { field: "quantity", label: "Quantity", required: false, aliases: ["quantity", "qty", "copies", "no of copies", "number of copies", "total copies"] },
  { field: "rack", label: "Rack Number", required: false, aliases: ["rack number", "rack", "rack no", "shelf", "shelf location", "location"] },
  { field: "bookNumber", label: "Book Number", required: false, aliases: ["book number", "book no", "accession number", "accession no", "acc no"] },
  { field: "isbn", label: "ISBN Number", required: false, aliases: ["isbn number", "isbn", "isbn no"] },
  { field: "publisher", label: "Publisher", required: false, aliases: ["publisher", "publication"] },
  { field: "edition", label: "Edition", required: false, aliases: ["edition"] },
] as const;

export type BookImportField = (typeof BOOK_IMPORT_COLUMNS)[number]["field"];

/** One editable row. Every value is the text the librarian sees and can change. */
export type BookImportRow = Record<BookImportField, string> & { key: string; line: number };

export type BookParseResult =
  | { ok: true; rows: BookImportRow[]; unmatched: string[] }
  | { ok: false; error: string };

function emptyRow(key: string, line: number): BookImportRow {
  const row = { key, line } as BookImportRow;
  for (const c of BOOK_IMPORT_COLUMNS) row[c.field] = "";
  return row;
}

export function parseBookCsv(text: string): BookParseResult {
  const lines = text.split(/\r\n|\n|\r/);
  const headerLine = lines.find((l) => l.trim() !== "");
  if (!headerLine) return { ok: false, error: "That file is empty." };

  const headers = splitCsvLine(headerLine);
  const map = new Map<number, BookImportField>();
  const unmatched: string[] = [];
  headers.forEach((heading, index) => {
    const key = normaliseHeading(heading);
    const column = BOOK_IMPORT_COLUMNS.find(
      (c) => (c.aliases as readonly string[]).includes(key) || normaliseHeading(c.label) === key,
    );
    // First heading wins: a second "Price" column is reported, not merged.
    if (column && ![...map.values()].includes(column.field)) map.set(index, column.field);
    else if (heading.trim() !== "") unmatched.push(heading.trim());
  });

  const missing = BOOK_IMPORT_COLUMNS.filter((c) => c.required && ![...map.values()].includes(c.field));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The file needs a column for ${missing.map((c) => c.label.toLowerCase()).join(" and ")}. Found: ${
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
  if (body.length > MAX_BOOK_IMPORT_ROWS) {
    return {
      ok: false,
      error: `That file has ${body.length} rows and one import takes at most ${MAX_BOOK_IMPORT_ROWS}. Split it: importing the first ${MAX_BOOK_IMPORT_ROWS} silently would be worse.`,
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

/** A price as written in a spreadsheet: "₹1,250.00", "1250", "1,250". Null when it is not one. */
export function parsePrice(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

/**
 * What is wrong with each row, re-judged over **all** rows after any edit
 * (rule 13): fixing one duplicate book number clears the other row too.
 * A number already in the catalogue is the function's to report, per row,
 * after Add: the browser does not hold the whole catalogue.
 */
export function judgeBookRows(rows: BookImportRow[]): Map<string, string[]> {
  const numbers = new Map<string, number>();
  for (const r of rows) {
    const n = r.bookNumber.trim().toLowerCase();
    if (n) numbers.set(n, (numbers.get(n) ?? 0) + 1);
  }

  const out = new Map<string, string[]>();
  for (const r of rows) {
    const problems: string[] = [];
    for (const c of BOOK_IMPORT_COLUMNS) {
      if (c.required && r[c.field].trim() === "") problems.push(`${c.label} is missing`);
    }
    const n = r.bookNumber.trim().toLowerCase();
    if (n && (numbers.get(n) ?? 0) > 1) {
      problems.push(`Book number ${r.bookNumber.trim()} appears more than once in this file`);
    }
    if (r.bookNumber.trim().length > 50) problems.push("A book number is at most 50 characters");
    const price = parsePrice(r.price);
    if (price !== null && Number.isNaN(price)) {
      problems.push(`"${r.price}" is not a price -- write 250 or 250.50`);
    }
    const qty = r.quantity.trim();
    if (qty && (!/^\d+$/.test(qty) || Number(qty) < 1 || Number(qty) > 1000)) {
      problems.push(`"${r.quantity}" is not a quantity -- a whole number from 1 to 1000`);
    }
    out.set(r.key, problems);
  }
  return out;
}

/** What the server receives for one row, already normalised. */
export type BookImportPayload = {
  line: number;
  title: string;
  author: string;
  subject: string;
  bookNumber: string;
  isbn: string;
  rack: string;
  price: number | null;
  quantity: number;
  publisher: string;
  edition: string;
};

export function toBookPayload(r: BookImportRow): BookImportPayload {
  const price = parsePrice(r.price);
  return {
    line: r.line,
    title: r.title.trim(),
    author: r.author.trim(),
    subject: r.subject.trim(),
    bookNumber: r.bookNumber.trim(),
    isbn: r.isbn.trim(),
    rack: r.rack.trim(),
    price: price === null || Number.isNaN(price) ? null : price,
    quantity: r.quantity.trim() ? Number(r.quantity.trim()) : 1,
    publisher: r.publisher.trim(),
    edition: r.edition.trim(),
  };
}

/**
 * Subjects the rows name that the college does not have yet, as the rows spell
 * them. They are created by the import; the screen says so first, so a typo
 * shows up as a new subject before anything is written.
 */
export function newSubjects(rows: BookImportRow[], existing: readonly string[]): string[] {
  const have = new Set(existing.map((s) => s.trim().toLowerCase()));
  const seen = new Map<string, string>();
  for (const r of rows) {
    const s = r.subject.trim();
    if (s && !have.has(s.toLowerCase()) && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  }
  return [...seen.values()];
}

/** The template the page offers, so nobody has to guess the headings. */
export const BOOK_IMPORT_TEMPLATE =
  BOOK_IMPORT_COLUMNS.map((c) => c.label).join(",") +
  "\nA Brief History of Time,Stephen Hawking,Physics,350,2,R-04,LIB-0001,9780553380163,Bantam,10th\n";
