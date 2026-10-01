import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { UnreadableWorkbook, xlsxRows, xlsxToCsv } from "@/lib/import/xlsx";
import { parseCsv } from "@/lib/validations/import-display";

/**
 * An Excel workbook read without a spreadsheet library. Each workbook here is
 * built from the XML Excel writes, so the reader is checked against the file
 * format rather than against itself.
 */
function workbook(sheet: string, opts: { shared?: string[]; styles?: string; date1904?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns:r="r">${opts.date1904 ? '<workbookPr date1904="1"/>' : ""}<sheets><sheet name="Roll" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  };
  if (opts.shared) {
    files["xl/sharedStrings.xml"] = strToU8(
      `<sst>${opts.shared.map((s) => `<si><t xml:space="preserve">${s}</t></si>`).join("")}</sst>`,
    );
  }
  if (opts.styles) files["xl/styles.xml"] = strToU8(opts.styles);
  return zipSync(files);
}

// Style 0 is General; style 1 is the built-in date format 14; style 2 is a
// custom "dd/mm/yyyy"; style 3 is a custom number format with no date in it.
const STYLES = `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts>
<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`;

describe("reading an Excel workbook", () => {
  it("reads shared strings, inline strings, numbers and booleans, by column letter", () => {
    const bytes = workbook(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
       <row r="2"><c r="A2" t="inlineStr"><is><t>Aarav</t></is></c><c r="C2"><v>42</v></c></row>
       <row r="3"/>
       <row r="4"><c r="B4" t="b"><v>1</v></c><c r="C4" t="str"><v>=A1</v></c></row>`,
      { shared: ["First name", "Last name", "Roll"] },
    );
    expect(xlsxRows(bytes)).toEqual([
      ["First name", "Last name", "Roll"],
      ["Aarav", "", "42"],
      ["", "", ""],
      ["", "TRUE", "=A1"],
    ]);
  });

  it("keeps a number typed as text exactly, leading zero and all", () => {
    const bytes = workbook(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`, { shared: ["09876543210"] });
    expect(xlsxRows(bytes)).toEqual([["09876543210"]]);
  });

  it("turns a date-formatted cell into a date, and leaves a plain number alone", () => {
    // 45383 is 1 April 2024 in Excel's 1900 calendar.
    const bytes = workbook(
      `<row r="1"><c r="A1" s="1"><v>45383</v></c><c r="B1" s="2"><v>45383</v></c><c r="C1" s="3"><v>45383</v></c><c r="D1"><v>45383</v></c></row>`,
      { styles: STYLES },
    );
    expect(xlsxRows(bytes)).toEqual([["2024-04-01", "2024-04-01", "45383", "45383"]]);
  });

  it("honours the 1904 calendar a Mac workbook may use", () => {
    const bytes = workbook(`<row r="1"><c r="A1" s="1"><v>43921</v></c></row>`, { styles: STYLES, date1904: true });
    expect(xlsxRows(bytes)).toEqual([["2024-04-01"]]);
  });

  it("decodes XML entities and quotes what CSV needs quoted", () => {
    const bytes = workbook(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`, {
      shared: ["O&apos;Brien, R", "say &quot;hi&quot; &amp; go"],
    });
    expect(xlsxToCsv(bytes)).toBe('"O\'Brien, R","say ""hi"" & go"');
  });

  it("drops trailing empty rows, which are formatting rather than data", () => {
    const bytes = workbook(`<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2" s="0"/></row>`);
    expect(xlsxRows(bytes)).toEqual([["1"]]);
  });

  it("refuses something that is not a workbook, in a sentence", () => {
    expect(() => xlsxRows(strToU8("first name,last name"))).toThrow(UnreadableWorkbook);
  });

  it("feeds the same parser a CSV upload does", () => {
    const bytes = workbook(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
       <row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2" s="1"><v>45383</v></c><c r="E2" t="s"><v>8</v></c></row>`,
      {
        shared: ["Admission number", "First name", "Last name", "Admission date", "Class", "A-101", "Aarav", "Sharma", "Grade 1 A"],
        styles: STYLES,
      },
    );
    const parsed = parseCsv(xlsxToCsv(bytes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.rows).toHaveLength(1);
  });
});
