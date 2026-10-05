import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOK_IMPORT_TEMPLATE,
  MAX_BOOK_IMPORT_ROWS,
  judgeBookRows,
  newSubjects,
  parseBookCsv,
  parsePrice,
  toBookPayload,
} from "@/lib/validations/book-import";

/**
 * "Add New Books In Bulk" (0339). The browser half is pinned here; the
 * function was probed in a rolled-back transaction (docs/audit-2026-10.md).
 */
describe("reading a book spreadsheet", () => {
  it("reads the template it offers", () => {
    const r = parseBookCsv(BOOK_IMPORT_TEMPLATE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].title).toBe("A Brief History of Time");
    expect(r.rows[0].bookNumber).toBe("LIB-0001");
    expect(judgeBookRows(r.rows).get(r.rows[0].key)).toEqual([]);
  });

  it("matches the headings a library register uses, and names the rest", () => {
    const r = parseBookCsv("Book Name,Writer,Category,Accession No,Copies,Remarks\nGitanjali,Tagore,Poetry,A-1,2,old\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]).toMatchObject({ title: "Gitanjali", author: "Tagore", subject: "Poetry", bookNumber: "A-1", quantity: "2" });
    expect(r.unmatched).toEqual(["Remarks"]);
  });

  it("refuses a file without a title or an author column, in a sentence", () => {
    const r = parseBookCsv("Title,Price\nX,10\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("author");
  });

  it("refuses an oversized file rather than cutting it short", () => {
    const body = Array.from({ length: MAX_BOOK_IMPORT_ROWS + 1 }, (_, i) => `T${i},A`).join("\n");
    const r = parseBookCsv(`Title,Author\n${body}\n`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(String(MAX_BOOK_IMPORT_ROWS + 1));
  });
});

describe("judging the rows", () => {
  const read = (csv: string) => {
    const r = parseBookCsv(csv);
    if (!r.ok) throw new Error(r.error);
    return r.rows;
  };

  it("re-judges every row: a duplicate number is on both, and fixing one clears both", () => {
    const rows = read("Title,Author,Book Number\nA,X,N-1\nB,Y,n-1\n");
    const p = judgeBookRows(rows);
    expect(p.get(rows[0].key)?.join()).toContain("more than once");
    expect(p.get(rows[1].key)?.join()).toContain("more than once");
    rows[1].bookNumber = "N-2";
    const q = judgeBookRows(rows);
    expect(q.get(rows[0].key)).toEqual([]);
    expect(q.get(rows[1].key)).toEqual([]);
  });

  it("names a price or a quantity that is not one", () => {
    const rows = read("Title,Author,Price,Quantity\nA,X,abc,0\nB,Y,,\n");
    expect(judgeBookRows(rows).get(rows[0].key)).toHaveLength(2);
    expect(judgeBookRows(rows).get(rows[1].key)).toEqual([]);
  });

  it("reads a price as a spreadsheet writes it", () => {
    expect(parsePrice("₹1,250.50")).toBe(1250.5);
    expect(parsePrice("Rs. 300")).toBe(300);
    expect(parsePrice("")).toBeNull();
    expect(Number.isNaN(parsePrice("-5"))).toBe(true);
  });

  it("a missing quantity is one copy, a missing price is not free", () => {
    const [row] = read("Title,Author\nA,X\n");
    expect(toBookPayload(row)).toMatchObject({ quantity: 1, price: null });
  });

  it("names the subjects the import will create, once each and ignoring case", () => {
    const rows = read("Title,Author,Subject\nA,X,Physics\nB,Y, physics\nC,Z,Chemistry\nD,W,Maths\n");
    expect(newSubjects(rows, ["Maths"])).toEqual(["Physics", "Chemistry"]);
  });
});

describe("the action and the function agree on the row", () => {
  const action = readFileSync(join(process.cwd(), "src/app/(app)/library/books/import/actions.ts"), "utf8");
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0339_books_from_a_spreadsheet.sql"), "utf8");
  const sent = [...action.slice(action.indexOf("rows.push({")).matchAll(/^\s+(\w+):/gm)]
    .map((m) => m[1])
    .slice(0, 11);
  const read = new Set([...sql.matchAll(/v_row\s*(?:->>|->)\s*'(\w+)'/g)].map((m) => m[1]));

  it("every key the function reads is sent", () => {
    for (const key of read) expect(sent, key).toContain(key);
  });

  it("every key sent is read", () => {
    for (const key of sent) expect(read.has(key), key).toBe(true);
  });
});
