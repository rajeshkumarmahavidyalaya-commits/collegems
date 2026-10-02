import type { Table } from "@tanstack/react-table";
import { strToU8, zipSync } from "fflate";

/**
 * The reference's table buttons -- Copy, CSV, Excel, PDF, Print -- over this
 * product's server-paged tables.
 *
 * **Which rows.** A table that can read every row matching its filters passes
 * `loadAll`, and the export is that whole set, paged from the server as the
 * person who asked (rule 7: the browser assembles bounded pages, RLS stays the
 * gate). Past `EXPORT_LIMIT` it refuses and says the number rather than
 * truncating -- a file holding the first ten thousand of thirty looks complete
 * (rule 13). A table without `loadAll` exports the page in hand, and the
 * toolbar says so.
 *
 * **Which columns.** The visible ones with an accessor, under the header text
 * declared in `meta.label` -- the same columns the person is looking at.
 */

export const EXPORT_LIMIT = 10_000;
export const EXPORT_PAGE_SIZE = 500;

type ColumnMeta = { label?: string } | undefined;

function exportColumns<T>(table: Table<T>) {
  return table.getVisibleLeafColumns().filter((c) => c.accessorFn);
}

function headerOf<T>(column: ReturnType<Table<T>["getVisibleLeafColumns"]>[number]): string {
  const meta = column.columnDef.meta as ColumnMeta;
  return meta?.label ?? (typeof column.columnDef.header === "string" ? column.columnDef.header : column.id);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The rows on the current page, as text, with a header row. */
export function exportablePage<T>(table: Table<T>): string[][] {
  const columns = exportColumns(table);
  return [
    columns.map(headerOf),
    ...table.getRowModel().rows.map((row) => columns.map((c) => text(row.getValue(c.id)))),
  ];
}

/** Any rows of the table's type -- e.g. every page -- through its visible columns. */
export function exportableRows<T>(table: Table<T>, rows: T[]): string[][] {
  const columns = exportColumns(table);
  return [columns.map(headerOf), ...rows.map((row, i) => columns.map((c) => text(c.accessorFn!(row, i))))];
}

/**
 * Every row a paged reader returns for the same filters, page by page. The
 * caller's reader keeps its own order (every list here has a total order, so
 * pages neither repeat nor skip a row -- a-page-needs-a-total-order.test.ts).
 */
export async function loadAllPages<T>(
  readPage: (pageIndex: number, pageSize: number) => Promise<{ rows: T[]; total: number }>,
  limit = EXPORT_LIMIT,
): Promise<{ rows: T[]; total: number; refused: boolean }> {
  const first = await readPage(0, EXPORT_PAGE_SIZE);
  if (first.total > limit) return { rows: [], total: first.total, refused: true };
  const rows = [...first.rows];
  for (let page = 1; rows.length < first.total; page++) {
    const next = await readPage(page, EXPORT_PAGE_SIZE);
    if (next.rows.length === 0) break;
    rows.push(...next.rows);
  }
  return { rows, total: first.total, refused: false };
}

/** A spreadsheet opens CSV and runs formulas; a leading = + - @ is made text. */
function inert(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((v) => `"${inert(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
}

export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map((v) => v.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

function download(bytes: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(rows: string[][], name = "records") {
  // A byte-order mark so Excel reads Hindi and Urdu as UTF-8.
  download("﻿" + toCsv(rows), "text/csv;charset=utf-8", `${name}.csv`);
}

/**
 * A real .xlsx: one sheet of inline strings. Every value is written as text,
 * never as a formula, so a cell beginning "=" stays what was typed.
 */
export function xlsxBytes(rows: string[][]): Uint8Array {
  const xml = (s: string) =>
    s
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const column = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : column(Math.floor(i / 26) - 1) + column(i % 26));
  const sheet = rows
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row
          .map((v, j) => `<c r="${column(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`)
          .join("")}</row>`,
    )
    .join("");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zipSync({
    "[Content_Types].xml": strToU8(
      head +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      head +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Records" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      head + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    ),
  });
}

export function downloadExcel(rows: string[][], name = "records") {
  const bytes = xlsxBytes(rows);
  download(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    `${name}.xlsx`,
  );
}

/**
 * A print window of the rows, built with DOM text nodes (never HTML strings,
 * so a value cannot inject markup). "PDF" is this window's Save as PDF.
 * Returns false when the browser blocked the window.
 */
export function printRows(rows: string[][], title: string, direction: "ltr" | "rtl" = "ltr"): boolean {
  const popup = window.open("", "_blank", "width=1000,height=700");
  if (!popup) return false;
  const doc = popup.document;
  doc.title = title;
  doc.documentElement.dir = direction;
  const style = doc.createElement("style");
  style.textContent =
    "body{font:12px system-ui,Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;text-align:start}th{background:#f5f6ff}tr{break-inside:avoid}@page{size:landscape}";
  doc.head.appendChild(style);
  const heading = doc.createElement("h1");
  heading.textContent = title;
  doc.body.appendChild(heading);
  const table = doc.createElement("table");
  rows.forEach((cells, i) => {
    const tr = doc.createElement("tr");
    for (const value of cells) {
      const cell = doc.createElement(i === 0 ? "th" : "td");
      cell.textContent = value;
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  });
  doc.body.appendChild(table);
  popup.focus();
  popup.print();
  return true;
}
