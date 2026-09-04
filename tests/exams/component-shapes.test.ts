import { describe, expect, it } from "vitest";
import {
  componentTotal,
  componentTotalProblem,
  enteredCount,
  examComponentSchema,
  examComponentSetSchema,
  gradingRulesSchema,
  markProblem,
  parseMarkCell,
} from "@/lib/validations/exams";

/**
 * The shapes a split paper is allowed to take, in the browser.
 *
 * The arithmetic that matters — the parts adding up, a part that cannot be
 * lowered below a mark already awarded — belongs to Postgres, because only
 * Postgres can see the marks. What is checked here is the half a person is
 * typing at: that "AB" means absent, that one part is never a split, and that
 * the running total says which way it is wrong.
 */
describe("a mark cell", () => {
  it("reads a blank as not entered, which is not a zero", () => {
    expect(parseMarkCell("", 70)).toEqual({ kind: "empty" });
    expect(parseMarkCell("   ", 70)).toEqual({ kind: "empty" });
    expect(parseMarkCell("0", 70)).toEqual({ kind: "value", value: 0 });
  });

  it("reads the absence tokens a mark register actually uses", () => {
    for (const token of ["A", "AB", "ab", "Abs", "absent"]) {
      expect(parseMarkCell(token, 70), token).toEqual({ kind: "absent" });
    }
  });

  it("refuses a mark above the part's own maximum, not the paper's", () => {
    expect(parseMarkCell("65", 70)).toEqual({ kind: "value", value: 65 });
    expect(markProblem("65", 30)).toBe("Above the maximum of 30");
  });

  it("says what a cell may contain when it contains something else", () => {
    expect(markProblem("banana", 70)).toBe("A mark, or AB for absent");
    expect(markProblem("-1", 70)).toBe("Cannot be negative");
  });
});

describe("counting a split sheet", () => {
  it("counts a child only once every part is resolved", () => {
    const rows = [
      { cells: ["55", "24"] },
      { cells: ["55", "AB"] },
      { cells: ["55", ""] },
      { cells: ["", ""] },
    ];
    expect(enteredCount(rows, [70, 30])).toBe(2);
  });
});

describe("the parts adding up", () => {
  it("adds them up", () => {
    expect(componentTotal([{ maxMarks: 70 }, { maxMarks: 30 }])).toBe(100);
  });

  it("says nothing about a paper that is not split", () => {
    expect(componentTotalProblem([], 100)).toBeNull();
  });

  it("says which way it is wrong, and by how much", () => {
    expect(componentTotalProblem([{ maxMarks: 70 }, { maxMarks: 25 }], 100)).toBe(
      "The parts add up to 95 but the paper is out of 100, so they are 5 short.",
    );
    expect(componentTotalProblem([{ maxMarks: 70 }, { maxMarks: 40 }], 100)).toBe(
      "The parts add up to 110 but the paper is out of 100, so they are 10 over.",
    );
  });

  it("accepts an exact split", () => {
    expect(componentTotalProblem([{ maxMarks: 70 }, { maxMarks: 30 }], 100)).toBeNull();
  });
});

describe("one part", () => {
  it("refuses a minimum above the part's own maximum", () => {
    const result = examComponentSchema.safeParse({
      code: "PR",
      name: "Practical",
      maxMarks: 30,
      passMarks: 31,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a part with no minimum of its own", () => {
    const result = examComponentSchema.safeParse({
      code: "PR",
      name: "Practical",
      maxMarks: 30,
      passMarks: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe("the whole split", () => {
  const part = (code: string, maxMarks: number) => ({
    code,
    name: code,
    maxMarks,
    passMarks: 0,
  });

  it("accepts no parts at all, which is how a paper goes back to being one", () => {
    const result = examComponentSetSchema.safeParse({
      examSubjectId: "00000000-0000-4000-8000-000000000001",
      components: [],
    });
    expect(result.success).toBe(true);
  });

  it("refuses a single part, because a paper split into one part is a paper", () => {
    const result = examComponentSetSchema.safeParse({
      examSubjectId: "00000000-0000-4000-8000-000000000001",
      components: [part("TH", 100)],
    });
    expect(result.success).toBe(false);
  });

  it("refuses two parts sharing a code, however they are cased", () => {
    const result = examComponentSetSchema.safeParse({
      examSubjectId: "00000000-0000-4000-8000-000000000001",
      components: [part("TH", 70), part("th", 30)],
    });
    expect(result.success).toBe(false);
  });
});

describe("the components rule", () => {
  it("is absent by default, which means the paper total is the only gate", () => {
    const rules = gradingRulesSchema.parse({ grades: [] });
    expect(rules.components).toBeUndefined();
  });

  it("is a boolean when it is there at all", () => {
    const rules = gradingRulesSchema.parse({
      grades: [],
      components: { must_pass_each: true },
    });
    expect(rules.components?.must_pass_each).toBe(true);

    expect(
      gradingRulesSchema.safeParse({ grades: [], components: { must_pass_each: "yes" } }).success,
    ).toBe(false);
  });
});
