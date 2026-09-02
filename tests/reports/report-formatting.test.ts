import { describe, expect, it } from "vitest";
import {
  alignFor,
  cleanParams,
  exportFilename,
  formatCell,
  missingRequired,
  parseColumns,
  parseParameters,
} from "@/lib/validations/reports";

/**
 * The kernel's client half, tested without a database.
 *
 * The catalog descriptor is written only by migrations, so this is not a trust
 * boundary — but it is parsed rather than cast, because a descriptor that
 * drifted from what the UI can render must degrade to something readable
 * instead of taking down the page for every other report on it.
 */

describe("catalog parsing", () => {
  it("reads a well-formed column descriptor", () => {
    const columns = parseColumns([
      { key: "outstanding", label: "Outstanding", type: "money", align: "right" },
    ]);
    expect(columns).toEqual([
      { key: "outstanding", label: "Outstanding", type: "money", align: "right" },
    ]);
  });

  it("degrades an unknown column type to text rather than dropping the column", () => {
    const columns = parseColumns([{ key: "x", label: "X", type: "sparkline" }]);
    expect(columns).toHaveLength(1);
    expect(columns[0].type).toBe("text");
  });

  it("degrades an unknown parameter type to a text input", () => {
    const params = parseParameters([{ name: "q", label: "Query", type: "regex" }]);
    expect(params[0].type).toBe("text");
  });

  it("returns nothing for a descriptor that is not a list at all", () => {
    expect(parseColumns({ key: "x" })).toEqual([]);
    expect(parseParameters(null)).toEqual([]);
  });

  it("defaults a parameter to optional with no options", () => {
    const params = parseParameters([{ name: "section_id", label: "Class", type: "section" }]);
    expect(params[0].required).toBe(false);
    expect(params[0].options).toEqual([]);
  });
});

describe("required parameters", () => {
  const descriptors = parseParameters([
    { name: "from", label: "From", type: "date", required: true },
    { name: "section_id", label: "Class", type: "section", required: false },
  ]);

  it("names each missing field rather than reporting one blanket error", () => {
    expect(missingRequired(descriptors, { from: "", section_id: "" })).toEqual(["from"]);
  });

  it("treats whitespace as missing", () => {
    expect(missingRequired(descriptors, { from: "   " })).toEqual(["from"]);
  });

  it("is satisfied by a value", () => {
    expect(missingRequired(descriptors, { from: "2026-01-01" })).toEqual([]);
  });
});

describe("parameter cleaning", () => {
  it("drops empty values, which Postgres would read as 'no filter' anyway", () => {
    expect(cleanParams({ section_id: "", from: "2026-01-01", status: "" })).toEqual({
      from: "2026-01-01",
    });
  });
});

describe("cell formatting", () => {
  it("renders an absent value as a dash, never as an empty cell", () => {
    // A blank in a printed roster is ambiguous between "no value" and "the
    // column ran off the page". A dash is not.
    expect(formatCell(null, "text")).toBe("—");
    expect(formatCell(undefined, "money")).toBe("—");
    expect(formatCell("", "date")).toBe("—");
  });

  it("keeps a real zero, which is not the same as absent", () => {
    expect(formatCell(0, "number")).toBe("0");
  });

  it("formats money in rupees", () => {
    expect(formatCell(8640, "money")).toContain("8,640");
  });

  it("formats a percentage", () => {
    expect(formatCell(91.5, "percent")).toBe("91.5%");
  });

  it("renders a boolean as a word, not as the string 'true'", () => {
    expect(formatCell(true, "text")).toBe("Yes");
    expect(formatCell(false, "text")).toBe("No");
  });

  it("title-cases a snake_case enum for a badge", () => {
    expect(formatCell("transferred_out", "badge")).toBe("Transferred out");
    expect(formatCell("sent", "badge")).toBe("Sent");
  });

  it("passes an unparseable date through instead of showing 'Invalid Date'", () => {
    expect(formatCell("not-a-date", "date")).toBe("not-a-date");
  });
});

describe("alignment", () => {
  it("right-aligns numeric columns by default", () => {
    const [money] = parseColumns([{ key: "a", label: "A", type: "money" }]);
    const [count] = parseColumns([{ key: "b", label: "B", type: "number" }]);
    const [pct] = parseColumns([{ key: "c", label: "C", type: "percent" }]);
    expect(alignFor(money)).toBe("right");
    expect(alignFor(count)).toBe("right");
    expect(alignFor(pct)).toBe("right");
  });

  it("left-aligns text", () => {
    const [text] = parseColumns([{ key: "d", label: "D", type: "text" }]);
    expect(alignFor(text)).toBe("left");
  });

  it("lets the catalog override the default", () => {
    const [forced] = parseColumns([{ key: "e", label: "E", type: "money", align: "left" }]);
    expect(alignFor(forced)).toBe("left");
  });
});

describe("export filename", () => {
  it("names the report and the date, and nothing else", () => {
    // Never the parameters: a filename carrying a section id is unreadable, and
    // one carrying a student's name is a privacy problem in a downloads folder.
    const name = exportFilename("fees.defaulters");
    expect(name).toMatch(/^fees-defaulters-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
