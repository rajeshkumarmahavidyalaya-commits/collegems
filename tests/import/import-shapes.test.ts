import { describe, expect, it } from "vitest";
import {
  applySentence,
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  normaliseGender,
  parseCsv,
  parseImportDate,
  rowStatus,
  splitCsvLine,
} from "@/lib/validations/import";

/**
 * Bulk import, browser half.
 *
 * Parsing lives here rather than in Postgres because a CSV is a browser problem
 * — quoted commas, a BOM, Excel's date formats. Two of these pin decisions that
 * would corrupt real records if they were wrong: **day-first dates**, and
 * **refusing rather than truncating** an oversized file.
 */

describe("splitCsvLine", () => {
  // "Kumar, Rajesh" in one cell is the reason this is not `split(",")`.
  it("keeps a quoted comma inside its cell", () => {
    expect(splitCsvLine('Aarav,"Kumar, Rajesh",6A')).toEqual(["Aarav", "Kumar, Rajesh", "6A"]);
  });

  it("understands a doubled quote as a literal one", () => {
    expect(splitCsvLine('a,"He said ""hi""",b')).toEqual(["a", 'He said "hi"', "b"]);
  });

  it("keeps empty cells in position", () => {
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("parseCsv", () => {
  const header = "First Name,Last Name,Admission No.,Class\n";

  it("matches headings loosely", () => {
    const result = parseCsv(`${header}Aarav,Khanna,ADM-1,Grade 1 A`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].firstName).toBe("Aarav");
    expect(result.rows[0].admissionNumber).toBe("ADM-1");
    expect(result.rows[0].sectionLabel).toBe("Grade 1 A");
    // Line 2 of the file, so a message can name the row the person is looking at.
    expect(result.rows[0].lineNumber).toBe(2);
  });

  it("survives a UTF-8 byte order mark on the first heading", () => {
    const result = parseCsv(`﻿${header}Aarav,Khanna,ADM-1,Grade 1 A`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0].firstName).toBe("Aarav");
  });

  it("names the columns it could not use rather than dropping them silently", () => {
    const result = parseCsv("First Name,Admission No.,Blood Group\nAarav,ADM-1,O+");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.unmatched).toEqual(["Blood Group"]);
  });

  it("refuses a file with no admission number column, and says what it found", () => {
    const result = parseCsv("First Name,Class\nAarav,Grade 1 A");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/admission number/i);
      expect(result.error).toMatch(/First Name, Class/);
    }
  });

  it("refuses an empty file and a headings-only file differently", () => {
    expect(parseCsv("")).toMatchObject({ ok: false });
    const headingsOnly = parseCsv(header);
    expect(headingsOnly.ok).toBe(false);
    if (!headingsOnly.ok) expect(headingsOnly.error).toMatch(/no rows/i);
  });

  // The decision that matters most: importing the first 500 of 900 children
  // silently is the worst possible outcome, because nobody notices until April.
  it("refuses an oversized file rather than truncating it", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A,B,ADM-${i},Grade 1 A`);
    const result = parseCsv(header + body.join("\n"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(new RegExp(String(MAX_IMPORT_ROWS)));
      expect(result.error).toMatch(/split it/i);
    }
  });

  it("ignores blank lines in the middle of a file", () => {
    const result = parseCsv(`${header}Aarav,Khanna,ADM-1,Grade 1 A\n\nIshita,Malhotra,ADM-2,Grade 1 A`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });
});

describe("parseImportDate", () => {
  it("reads ISO dates", () => {
    expect(parseImportDate("2015-06-12")).toBe("2015-06-12");
    expect(parseImportDate("2015-6-2")).toBe("2015-06-02");
  });

  // Day first, because that is what an Indian school office types. Getting this
  // backwards silently swaps birthdays for every child born before the 13th.
  it("reads a slashed date day-first", () => {
    expect(parseImportDate("12/06/2015")).toBe("2015-06-12");
    expect(parseImportDate("01-02-2015")).toBe("2015-02-01");
  });

  it("returns null rather than guessing at nonsense", () => {
    expect(parseImportDate("June 12 2015")).toBeNull();
    expect(parseImportDate("32/01/2015")).toBeNull();
    expect(parseImportDate("12/13/2015")).toBeNull();
    expect(parseImportDate("")).toBeNull();
    expect(parseImportDate(undefined)).toBeNull();
  });
});

describe("normaliseGender", () => {
  it("accepts what a spreadsheet actually contains", () => {
    expect(normaliseGender("M")).toBe("male");
    expect(normaliseGender("female")).toBe("female");
    expect(normaliseGender("Boy")).toBe("male");
    expect(normaliseGender("G")).toBe("female");
  });

  // Left as typed so the database's own check reports it as a problem the
  // person can see, rather than being silently coerced to something wrong.
  it("leaves an unrecognised value alone", () => {
    expect(normaliseGender("martian")).toBe("martian");
    expect(normaliseGender("")).toBeNull();
  });
});

describe("applySentence", () => {
  it("says what will happen, including what is left behind", () => {
    expect(applySentence({ ready: 40, withProblems: 0, skipped: 0 })).toBe("Import 40 students");
    expect(applySentence({ ready: 1, withProblems: 0, skipped: 0 })).toBe("Import 1 student");
    expect(applySentence({ ready: 38, withProblems: 2, skipped: 1 })).toBe(
      "Import 38 students, leaving 3 behind",
    );
  });

  it("does not offer to import nothing", () => {
    expect(applySentence({ ready: 0, withProblems: 3, skipped: 0 })).toMatch(/fix the problems/i);
    expect(applySentence({ ready: 0, withProblems: 0, skipped: 4 })).toBe("Nothing to import");
  });
});

describe("rowStatus", () => {
  const base = { skipped: false, problems: [], appliedStudentId: null, applyError: null };

  it("reports what actually happened, in precedence order", () => {
    expect(rowStatus({ ...base, appliedStudentId: "x" })).toBe("applied");
    expect(rowStatus({ ...base, applyError: "duplicate" })).toBe("failed");
    expect(rowStatus({ ...base, skipped: true })).toBe("skipped");
    expect(rowStatus({ ...base, problems: ["A first name is required"] })).toBe("problem");
    expect(rowStatus(base)).toBe("ready");
  });

  // An applied row that also carries an old problem is applied — the outcome
  // beats the prediction.
  it("prefers the outcome over the prediction", () => {
    expect(rowStatus({ ...base, appliedStudentId: "x", problems: ["stale"] })).toBe("applied");
  });
});

describe("the column list", () => {
  it("requires exactly a name and an admission number", () => {
    expect(IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.field)).toEqual([
      "firstName",
      "admissionNumber",
    ]);
  });
});
