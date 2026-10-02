import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { loadAllPages, toCsv, toTsv, xlsxBytes } from "@/components/data-table/table-exports";

describe("table exports", () => {
  it("CSV quotes values and makes a leading formula character inert", () => {
    const csv = toCsv([["Name", "Value"], ['A "quoted", name', "=1+1"], ["B", "+SUM(A1)"], ["C", "-2"], ["D", "@x"]]);
    expect(csv).toContain('"A ""quoted"", name"');
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).toContain(`"'+SUM(A1)"`);
    expect(csv).toContain(`"'-2"`);
    expect(csv).toContain(`"'@x"`);
  });

  it("copied text keeps one row per line", () => {
    expect(toTsv([["a", "b\tc"], ["d\ne", "f"]])).toBe("a\tb c\nd e\tf");
  });

  it("Excel is a real workbook whose cells are text, never formulas", () => {
    const files = unzipSync(xlsxBytes([["Name", "Value"], ["A & <B>", "=1+1"]]));
    expect(Object.keys(files)).toContain("xl/workbook.xml");
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("A &amp; &lt;B&gt;");
    expect(sheet).toContain(">=1+1<");
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).not.toContain("<f>");
  });

  it("reads every page of the filtered set, in order", async () => {
    const all = Array.from({ length: 1234 }, (_, i) => i);
    const seen: number[] = [];
    const result = await loadAllPages(async (page, size) => {
      seen.push(page);
      return { rows: all.slice(page * size, page * size + size), total: all.length };
    });
    expect(result.refused).toBe(false);
    expect(result.rows).toEqual(all);
    expect(seen).toEqual([0, 1, 2]);
  });

  it("refuses a set past the limit instead of truncating it", async () => {
    let calls = 0;
    const result = await loadAllPages(async () => {
      calls++;
      return { rows: [1], total: 50_000 };
    }, 10_000);
    expect(result).toEqual({ rows: [], total: 50_000, refused: true });
    expect(calls).toBe(1);
  });

  it("every server-paged list passes a loader, so its export is the whole filtered set", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "students/students-table",
      "staff/staff-table",
      "fees/fees-table",
      "fees/invoices/invoices-table",
      "library/books/books-table",
      "library/issues/issues-table",
      "library/members/members-table",
      "attendance/report/attendance-report",
    ]) {
      const body = readFileSync(`src/app/(app)/${f}.tsx`, "utf8");
      expect(body, f).toMatch(/loadAll=\{/);
      expect(body, f).not.toMatch(/onExport=\{/);
    }
  });
});
