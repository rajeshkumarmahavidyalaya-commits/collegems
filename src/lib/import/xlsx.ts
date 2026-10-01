import { strFromU8, unzipSync } from "fflate";

/**
 * The first sheet of an Excel workbook (.xlsx), as the CSV text the importers
 * already read.
 *
 * `docs/modules/import.md` listed "No Excel files": an office keeps its roll in
 * Excel and had to *Save as CSV* first, which is the step where a leading zero
 * on a phone number or an admission number is lost. An .xlsx file is a zip of
 * a few XML files, so this reads those directly rather than adding a
 * spreadsheet library: `fflate` unzips (about 8 kB, and loaded only when
 * somebody picks an Excel file), and the rest is the handful of XML shapes a
 * worksheet uses. The CSV then goes through exactly the same parser, column
 * matching and row checks as a CSV upload, so the two cannot disagree about
 * what a row means.
 *
 * What it reads: shared and inline strings, numbers (as typed, so `09876`
 * kept as text stays `09876`), booleans, formula results, and **dates** --
 * Excel stores a date as a day count with a date format on the cell, so the
 * styles are read to tell a date of birth from a roll number. What it does
 * not: more than the first sheet, merged cells, or the old binary `.xls`
 * format, which is refused by the caller in a sentence.
 */

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Every `<t>` inside a run of rich text, joined; phonetic hints left out. */
function textOf(xml: string): string {
  return decode(
    [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((m) => m[1])
      .join(""),
  );
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** "B" → 1, "AA" → 26. */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A day count in Excel's calendar as `YYYY-MM-DD`. */
function serialToIso(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function isDateFormat(id: number, custom: Map<number, string>): boolean {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  const code = custom.get(id);
  if (!code) return false;
  // Ignore quoted text and [colour]/[locale] blocks, then look for day/year.
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  return /[dy]/i.test(bare);
}

function resolve(target: string): string {
  const t = target.replace(/^\//, "");
  return t.startsWith("xl/") ? t : `xl/${t}`;
}

export class UnreadableWorkbook extends Error {}

/** The first sheet's cells, row by row, every row as long as the widest. */
export function xlsxRows(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new UnreadableWorkbook("That file is not an Excel workbook (.xlsx). Save it as .xlsx or .csv and try again.");
  }
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : null);

  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new UnreadableWorkbook("That file is not an Excel workbook (.xlsx). Save it as .xlsx or .csv and try again.");
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);

  const firstSheet = workbook.match(/<sheet\b[^>]*>/);
  const rid = firstSheet ? attr(firstSheet[0], "r:id") : null;
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  let sheetPath = "xl/worksheets/sheet1.xml";
  if (rid) {
    for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(rel[0], "Id") === rid) {
        const target = attr(rel[0], "Target");
        if (target) sheetPath = resolve(target);
      }
    }
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new UnreadableWorkbook("That workbook has no sheet this importer can read.");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const styles = read("xl/styles.xml") ?? "";
  const custom = new Map<number, string>(
    [...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [
      Number(attr(m[0], "numFmtId")),
      decode(attr(m[0], "formatCode") ?? ""),
    ]),
  );
  const cellXfs = styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  const dateStyle = [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map((m) =>
    isDateFormat(Number(attr(m[0], "numFmtId") ?? 0), custom),
  );

  const rows: string[][] = [];
  // A self-closing (empty) row first, or `<row r="5"/>` would be read as the
  // opening of a row running to the next one's close.
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = rowMatch[1] ?? rowMatch[2] ?? "";
    const r = Number(attr(` ${rowAttrs}`, "r") ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const c of (rowMatch[3] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = ` ${c[1]}`;
      const ref = attr(a, "r");
      const at = ref ? columnIndex(ref) : cells.length;
      const type = attr(a, "t");
      const style = Number(attr(a, "s") ?? 0);
      const inner = c[2] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = v !== undefined ? (shared[Number(v)] ?? "") : "";
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "str") value = decode(v ?? "");
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = "";
      else if (v !== undefined) {
        const n = Number(v);
        value = dateStyle[style] && Number.isFinite(n) ? serialToIso(n, date1904) : decode(v);
      }
      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }

  // Trailing rows that hold nothing are formatting, not data.
  while (rows.length && rows[rows.length - 1].every((v) => v.trim() === "")) rows.pop();
  const width = Math.max(0, ...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
}

/** The first sheet as CSV text, quoted wherever a value needs it. */
export function xlsxToCsv(bytes: Uint8Array): string {
  const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return xlsxRows(bytes)
    .map((row) => row.map(quote).join(","))
    .join("\n");
}
