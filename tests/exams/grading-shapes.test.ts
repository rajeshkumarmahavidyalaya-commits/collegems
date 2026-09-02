import { describe, expect, it } from "vitest";
import {
  enteredCount,
  examPaperSchema,
  examSchema,
  formatMark,
  formatPercent,
  gradingRulesSchema,
  markProblem,
  parseRules,
} from "@/lib/validations/exams";

/**
 * The exam module's pure logic.
 *
 * The engine itself lives in Postgres and is asserted in `grading-engine.test.ts`
 * against real marks; this file covers the boundary the browser owns — what a
 * teacher may type, and what a number means when it is missing.
 */

describe("marks are not numbers until they are", () => {
  it("treats an empty box as 'not entered', which is not an error", () => {
    // The difference between an unmarked paper and a zero is the difference
    // between an incomplete result and a failed one, so an empty box must never
    // be normalised into 0.
    expect(markProblem("", 100)).toBeNull();
    expect(markProblem("   ", 100)).toBeNull();
  });

  it("refuses a mark above the paper's maximum", () => {
    expect(markProblem("105", 100)).toBe("Above the maximum of 100");
  });

  it("refuses a negative mark", () => {
    expect(markProblem("-1", 100)).toBe("Cannot be negative");
  });

  it("refuses text", () => {
    expect(markProblem("absent", 100)).toBe("Not a number");
  });

  it("accepts a half mark and the maximum itself", () => {
    expect(markProblem("67.5", 100)).toBeNull();
    expect(markProblem("100", 100)).toBeNull();
    expect(markProblem("0", 100)).toBeNull();
  });
});

describe("displaying a mark", () => {
  it("shows an absence as AB, never as a zero", () => {
    expect(formatMark(null, true)).toBe("AB");
    expect(formatMark(0, true)).toBe("AB");
  });

  it("shows an unmarked paper as a dash, never as a zero", () => {
    expect(formatMark(null, false)).toBe("—");
  });

  it("shows a genuine zero as a zero", () => {
    expect(formatMark(0, false)).toBe("0");
  });
});

describe("counting a mark sheet", () => {
  it("counts an absence as dealt with, and an empty box as not", () => {
    const entries = [
      { marks: "45", isAbsent: false },
      { marks: "", isAbsent: true },
      { marks: "", isAbsent: false },
    ];
    expect(enteredCount(entries)).toBe(2);
  });
});

describe("percentages", () => {
  it("renders one decimal place", () => {
    expect(formatPercent(61.25)).toBe("61.3%");
  });

  it("renders a missing aggregate as a dash rather than NaN%", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("grading rules", () => {
  it("accepts an empty document, which is a coherent scheme", () => {
    // No grades, no grace, no substitution: a straight weighted mean with no
    // letter grade. That is a configuration, not an error.
    const parsed = parseRules("{}");
    expect(parsed.ok).toBe(true);
  });

  it("accepts the full document", () => {
    const rules = {
      grades: [
        { code: "A", min_percent: 75, point: 9 },
        { code: "F", min_percent: 0, point: 0, is_fail: true },
      ],
      pass: { aggregate_min_percent: 33 },
      grace: { max_marks: 5, max_subjects: 1 },
      aggregate: { method: "best_of", best_of: 5 },
      optional_subject: { replaces_worst: true, replaces_absent: false },
    };
    expect(gradingRulesSchema.safeParse(rules).success).toBe(true);
  });

  it("reports where the JSON is broken rather than throwing", () => {
    const parsed = parseRules("{ not json");
    expect(parsed.ok).toBe(false);
  });

  it("rejects an aggregate method the engine does not implement", () => {
    const parsed = parseRules('{"aggregate":{"method":"median"}}');
    expect(parsed.ok).toBe(false);
  });

  it("rejects a grade band outside 0-100", () => {
    const parsed = parseRules('{"grades":[{"code":"A","min_percent":140}]}');
    expect(parsed.ok).toBe(false);
  });

  it("leaves `replaces_absent` optional, defaulting to the conservative reading", () => {
    // Absent-is-not-substitutable is the default in Postgres (migration 0049),
    // so the schema must not require the key to express it.
    const parsed = gradingRulesSchema.safeParse({
      optional_subject: { replaces_worst: true },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("exam and paper validation", () => {
  const paper = {
    sectionId: "11111111-1111-4111-8111-111111111111",
    subjectId: "22222222-2222-4222-8222-222222222222",
    maxMarks: 100,
    passMarks: 33,
    weight: 1,
    isOptional: false,
    examDate: "",
  };

  it("accepts a well-formed paper", () => {
    expect(examPaperSchema.safeParse(paper).success).toBe(true);
  });

  it("refuses a pass mark above the maximum, on the pass-mark field", () => {
    const result = examPaperSchema.safeParse({ ...paper, passMarks: 120 });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.passMarks).toBeDefined();
  });

  it("refuses a zero or negative maximum", () => {
    expect(examPaperSchema.safeParse({ ...paper, maxMarks: 0 }).success).toBe(false);
  });

  it("refuses a zero weight, which would remove the subject from the aggregate silently", () => {
    expect(examPaperSchema.safeParse({ ...paper, weight: 0 }).success).toBe(false);
  });

  it("refuses an exam that ends before it starts", () => {
    const result = examSchema.safeParse({
      name: "Annual",
      kind: "annual",
      startsOn: "2026-03-10",
      endsOn: "2026-03-01",
    });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.endsOn).toBeDefined();
  });

  it("accepts an exam with no dates yet", () => {
    expect(
      examSchema.safeParse({ name: "Unit 1", kind: "unit", startsOn: "", endsOn: "" }).success,
    ).toBe(true);
  });
});
