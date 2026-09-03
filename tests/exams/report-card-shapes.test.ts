import { describe, expect, it } from "vitest";
import { gradingRulesSchema, parseRules, RANK_METHODS, RANK_SCOPES } from "@/lib/validations/exams";
import {
  attendancePercent,
  attendanceSentence,
  ordinal,
  paperMark,
  paperNote,
  parseCard,
  rankSentence,
  remarkSchema,
  type CardPaper,
} from "@/lib/validations/report-cards";

/**
 * The report card's pure half.
 *
 * Everything that decides *what* is on a card — the rank, the freeze, the
 * attendance rollup — is in Postgres, because it is a fact about a cohort or
 * about a moment. What is here is how those facts are read out loud, and two of
 * these have caught a real bug: an ordinal that says "11st", and an attendance
 * percentage that divides by a register nobody took.
 */

const paper = (over: Partial<CardPaper> = {}): CardPaper => ({
  subject: "Mathematics",
  code: "MATH",
  max: 100,
  pass: 33,
  obtained: 61,
  grace: null,
  effective: 61,
  percent: 61,
  passed: true,
  counted: true,
  optional: false,
  absent: false,
  note: null,
  ...over,
});

describe("ordinal", () => {
  it("uses the ordinary suffixes", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(103)).toBe("103rd");
  });

  // The teens are the whole reason this function exists rather than a suffix
  // lookup on the last digit.
  it("says eleventh, twelfth and thirteenth, not eleven-st", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(112)).toBe("112th");
  });
});

describe("rankSentence", () => {
  it("keeps the denominator, always", () => {
    expect(rankSentence({ position: 4, cohort_size: 38, scope: "section" })).toBe(
      "4th of 38 in the section",
    );
    expect(rankSentence({ position: 1, cohort_size: 92, scope: "class_level" })).toBe(
      "1st of 92 in the class",
    );
    expect(rankSentence({ position: 11, cohort_size: 301, scope: "school" })).toBe(
      "11th of 301 in the school",
    );
  });

  // A school that does not rank gets no sentence at all, not "0 of 0".
  it("returns null when there is no rank", () => {
    expect(rankSentence(null)).toBeNull();
  });

  it("does not invent a place for an unknown scope", () => {
    expect(rankSentence({ position: 2, cohort_size: 30, scope: "house" })).toBe(
      "2nd of 30 in the cohort",
    );
  });
});

describe("attendance", () => {
  const summary = { marked: 180, present: 165, absent: 8, late: 7, excused: 0 };

  it("counts a late arrival as attended and an excused absence as not", () => {
    expect(attendancePercent(summary)).toBe(95.6);
    expect(attendanceSentence(summary)).toBe("172 of 180 days");
  });

  // The demo tenant produced exactly this: a register that starts after the
  // exam ends. Dividing by it would have printed NaN% on a parent's card.
  it("refuses to divide by a register nobody took", () => {
    const empty = { marked: 0, present: 0, absent: 0, late: 0, excused: 0 };
    expect(attendancePercent(empty)).toBeNull();
    expect(attendanceSentence(empty)).toBe("No register was taken in this period");
  });

  it("says so when the card carries no attendance at all", () => {
    expect(attendancePercent(null)).toBeNull();
    expect(attendanceSentence(null)).toBe("Not recorded for this card");
  });
});

describe("paperMark", () => {
  it("distinguishes absent, unmarked and zero", () => {
    expect(paperMark(paper({ obtained: 0 }))).toBe("0");
    expect(paperMark(paper({ obtained: null }))).toBe("—");
    expect(paperMark(paper({ absent: true, obtained: null }))).toBe("AB");
  });
});

describe("paperNote", () => {
  it("prefers the engine's own sentence", () => {
    expect(paperNote(paper({ note: "Substituted by the additional subject" }))).toBe(
      "Substituted by the additional subject",
    );
  });

  it("explains a paper that was not counted", () => {
    expect(paperNote(paper({ counted: false }))).toBe("Not counted towards the aggregate");
  });

  it("says when grace was applied", () => {
    expect(paperNote(paper({ grace: 3 }))).toBe("Includes 3 grace mark(s)");
  });

  it("says nothing about an ordinary paper", () => {
    expect(paperNote(paper())).toBeNull();
  });
});

describe("the rank rules document", () => {
  it("accepts a school that ranks by section", () => {
    const parsed = parseRules(
      JSON.stringify({ rank: { scope: "section", method: "competition", include: "all" } }),
    );
    expect(parsed.ok).toBe(true);
  });

  // A missing key is the conservative reading and must stay a valid document:
  // an empty scheme means "this school does not rank", not "this scheme is
  // broken".
  it("accepts a scheme with no rank key at all", () => {
    expect(gradingRulesSchema.safeParse({}).success).toBe(true);
    expect(gradingRulesSchema.safeParse({ grades: [] }).success).toBe(true);
  });

  it("refuses a scope the engine would silently ignore", () => {
    const parsed = parseRules(JSON.stringify({ rank: { scope: "house" } }));
    expect(parsed.ok).toBe(false);
  });

  it("offers exactly the scopes and methods the engine implements", () => {
    expect(RANK_SCOPES.map((s) => s.value)).toEqual(["section", "class_level", "school"]);
    expect(RANK_METHODS.map((m) => m.value)).toEqual(["competition", "dense"]);
  });
});

describe("remarkSchema", () => {
  it("accepts an empty remark, which is how a teacher clears one", () => {
    expect(
      remarkSchema.safeParse({ studentId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d11", remark: "" })
        .success,
    ).toBe(true);
  });

  it("refuses an essay", () => {
    const result = remarkSchema.safeParse({
      studentId: "6f1d4d3e-0a1e-4b2c-9d5f-2b7c8e9a0d11",
      remark: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("parseCard", () => {
  const card = {
    school: { name: "Rajesh Kumar Mahavidyalaya" },
    session: { id: "9a710508-446b-4040-b358-ea8cd8a687e6", name: "2025-2026" },
    exam: {
      id: "4b498d4b-82e4-464c-afea-b64d3e542410",
      name: "Half-Yearly Examination",
      kind: "half_yearly",
      status: "published",
      starts_on: "2026-07-24",
      ends_on: "2026-08-03",
      published_at: "2026-09-03T20:36:10.158445+00:00",
    },
    provisional: false,
    student: {
      id: "83f1e640-45da-44df-811b-3d4a7093bb3c",
      name: "Vivaan Verma",
      admission_number: "SOS-2025-0001",
      roll_number: "01",
      section: "Grade 1 A",
      class_teacher: "Kiara Kumar",
    },
    papers: [paper()],
    totals: {
      obtained: 453,
      max: 700,
      percentage: 64.714,
      grade: "B2",
      grade_point: 7,
      result: "pass",
      subjects_counted: 7,
      subjects_failed: 0,
    },
    rank: { position: 11, cohort_size: 26, scope: "section" },
    attendance: { upto: "2026-09-03", marked: 20, present: 15, absent: 3, late: 1, excused: 1 },
    remark: { text: "A steady term.", updated_at: null },
  };

  it("reads a card straight out of Postgres", () => {
    const parsed = parseCard(card);
    expect(parsed?.student.name).toBe("Vivaan Verma");
    expect(rankSentence(parsed!.rank)).toBe("11th of 26 in the section");
  });

  it("accepts a card with no rank, no remark and no attendance", () => {
    const bare = { ...card, rank: null, remark: null, attendance: null, provisional: true };
    expect(parseCard(bare)).not.toBeNull();
  });

  // Half a report card is worse than none: a parent cannot tell which half is
  // missing, so a card that does not parse is not rendered at all.
  it("returns null rather than half a card", () => {
    const broken = { ...card, totals: { ...card.totals, percentage: "sixty-four" } };
    expect(parseCard(broken)).toBeNull();
    expect(parseCard(null)).toBeNull();
    expect(parseCard({})).toBeNull();
  });
});
