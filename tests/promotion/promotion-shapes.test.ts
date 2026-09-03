import { describe, expect, it } from "vitest";
import {
  DECISIONS,
  EVALUATION_ORDER,
  decisionLabel,
  needsTargetSection,
  promotionFormSchema,
  promotionRulesSchema,
  switchableDecisions,
  toRules,
  type PromotionFormInput,
} from "@/lib/validations/promotion";

/**
 * The promotion module's pure logic.
 *
 * The engine lives in Postgres and is asserted in `promotion-flow.test.ts`
 * against a real cohort; this file covers the translation between the form and
 * the rules document, where a mistake is silent — a key spelled wrongly is
 * still valid JSON, and `promotion_preview` would read it as "no rule" and
 * promote a school it should have held.
 */

const base: PromotionFormInput = {
  fromSessionId: "11111111-1111-4111-8111-111111111111",
  toSessionId: "22222222-2222-4222-8222-222222222222",
  noDetentionUpTo: "",
  requireExamPass: true,
  examKind: "annual",
  maxFailedSubjects: "0",
  minAttendancePercent: "",
  onMissingResult: "hold",
  carryForwardFees: true,
};

describe("form to rules", () => {
  it("produces the keys Postgres reads", () => {
    const rules = toRules(base);
    expect(rules).toEqual({
      criteria: {
        require_exam_pass: true,
        exam_kind: "annual",
        max_failed_subjects: 0,
      },
      on_missing_result: "hold",
      carry_forward_fees: true,
    });
  });

  it("omits an unset band rather than sending null", () => {
    // `promotion_preview` reads a missing key as "no band". Sending an explicit
    // null would mean the same thing twice, and the two would eventually be
    // read differently.
    expect(toRules(base)).not.toHaveProperty("no_detention_up_to_sequence");
    expect(toRules({ ...base, noDetentionUpTo: "8" }).no_detention_up_to_sequence).toBe(8);
  });

  it("omits an unset attendance minimum", () => {
    expect(toRules(base).criteria).not.toHaveProperty("min_attendance_percent");
    expect(toRules({ ...base, minAttendancePercent: "75" }).criteria?.min_attendance_percent).toBe(
      75,
    );
  });

  it("treats a blank allowance as zero, not as unlimited", () => {
    // An empty box must be the strict reading. Falling back to "no limit" would
    // promote a whole school on a form somebody did not finish filling in.
    expect(toRules({ ...base, maxFailedSubjects: "" }).criteria?.max_failed_subjects).toBe(0);
  });

  it("ignores text typed into a number box rather than sending NaN", () => {
    expect(toRules({ ...base, noDetentionUpTo: "eight" })).not.toHaveProperty(
      "no_detention_up_to_sequence",
    );
  });

  it("round-trips through the rules schema", () => {
    const rules = toRules({ ...base, noDetentionUpTo: "8", minAttendancePercent: "75" });
    expect(promotionRulesSchema.safeParse(rules).success).toBe(true);
  });
});

describe("rules validation", () => {
  it("accepts an empty document, which promotes everyone with somewhere to go", () => {
    expect(promotionRulesSchema.safeParse({}).success).toBe(true);
  });

  it("refuses an attendance minimum above 100", () => {
    const result = promotionRulesSchema.safeParse({
      criteria: { min_attendance_percent: 140 },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a missing-result answer the engine does not implement", () => {
    expect(
      promotionRulesSchema.safeParse({ on_missing_result: "graduate" }).success,
    ).toBe(false);
  });
});

describe("form validation", () => {
  it("accepts two different sessions", () => {
    expect(promotionFormSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a session id that is not a uuid", () => {
    expect(promotionFormSchema.safeParse({ ...base, toSessionId: "next" }).success).toBe(false);
  });
});

describe("what a person may change a row to", () => {
  it("offers promote, repeat and hold where there is a next class", () => {
    expect(switchableDecisions(true)).toEqual(["promote", "repeat", "hold"]);
  });

  it("does not offer promote in the final class", () => {
    expect(switchableDecisions(false)).not.toContain("promote");
  });

  it("never offers graduate", () => {
    // Whether there is a next class is a fact about the school, not a choice.
    // Offering it would let somebody graduate a seven-year-old.
    expect(switchableDecisions(true)).not.toContain("graduate");
    expect(switchableDecisions(false)).not.toContain("graduate");
  });
});

describe("where a decision lands", () => {
  it("requires a class for a promotion or a repeat", () => {
    expect(needsTargetSection("promote")).toBe(true);
    expect(needsTargetSection("repeat")).toBe(true);
  });

  it("requires none for a graduate or a hold", () => {
    // The database says the same with a check constraint; this is so the form
    // can say it before the save is refused.
    expect(needsTargetSection("graduate")).toBe(false);
    expect(needsTargetSection("hold")).toBe(false);
  });
});

describe("vocabulary", () => {
  it("names all four outcomes", () => {
    expect(DECISIONS.map((d) => d.value)).toEqual(["promote", "repeat", "graduate", "hold"]);
    expect(decisionLabel("hold")).toBe("Hold");
  });

  it("states the evaluation order, which the screen renders", () => {
    // Schools argue about the order, so it is written down where a person can
    // read it rather than left implicit in the SQL.
    expect(EVALUATION_ORDER[0]).toContain("no-detention");
    expect(EVALUATION_ORDER).toHaveLength(4);
  });
});
