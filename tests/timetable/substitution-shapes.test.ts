import { describe, expect, it } from "vitest";
import {
  arrangeCoverSchema,
  reasonLabel,
  reasonTone,
  candidateReason,
  clearCoverSchema,
  coverSummary,
  periodLabel,
  PROBLEM_SEVERITIES,
  severityLabel,
  severityRank,
  severityTone,
  todayIso,
} from "@/lib/validations/substitutions";

/**
 * The cover roster's client half, without a database.
 *
 * The one that pins an agreement with Postgres rather than a preference is
 * `substituteStaffId`: null is a *value* there, not a missing field. A schema
 * that required it would make "the class is merged into 5B" unsayable, and the
 * screen would then leave a silent gap instead of a recorded decision.
 */

describe("arranging cover", () => {
  const lesson = "3acf9da4-e93c-4175-85d2-8562b79bba69";
  const teacher = "df24ad12-d0c7-420d-b412-2e90c263a2fa";

  it("accepts a named substitute", () => {
    const parsed = arrangeCoverSchema.parse({
      timetableEntryId: lesson,
      onDate: "2026-09-07",
      substituteStaffId: teacher,
      note: "Comprehension, page 40",
    });
    expect(parsed.substituteStaffId).toBe(teacher);
  });

  it("treats nobody as an answer, not as a missing field", () => {
    // A row with no substitute is an arrangement -- "merged into 5B",
    // "supervised study". The *gap* is the absence of a row. Requiring a
    // substitute here would make the honest answer unrecordable.
    const named = arrangeCoverSchema.parse({
      timetableEntryId: lesson,
      onDate: "2026-09-07",
      substituteStaffId: null,
    });
    expect(named.substituteStaffId).toBeNull();

    const omitted = arrangeCoverSchema.parse({
      timetableEntryId: lesson,
      onDate: "2026-09-07",
    });
    expect(omitted.substituteStaffId).toBeNull();
  });

  it("refuses a day that is not a day", () => {
    const result = arrangeCoverSchema.safeParse({
      timetableEntryId: lesson,
      onDate: "next Tuesday",
    });
    expect(result.success).toBe(false);
  });

  it("clearing needs the same two things arranging did", () => {
    expect(
      clearCoverSchema.safeParse({ timetableEntryId: lesson, onDate: "2026-09-07" }).success,
    ).toBe(true);
    expect(clearCoverSchema.safeParse({ timetableEntryId: lesson }).success).toBe(false);
  });
});

describe("what the morning line says", () => {
  it("distinguishes nobody away from everybody covered", () => {
    // These are different mornings and a single percentage hides which.
    expect(coverSummary([])).toBe("Nobody is away. Nothing to arrange.");
    expect(coverSummary([{ arranged: true }])).toBe("The one lesson needing cover is arranged.");
    expect(coverSummary([{ arranged: true }, { arranged: true }])).toBe(
      "All 2 lessons needing cover are arranged.",
    );
  });

  it("counts what is left, not what is done", () => {
    expect(coverSummary([{ arranged: true }, { arranged: false }, { arranged: false }])).toBe(
      "2 of 3 still to arrange.",
    );
  });
});

describe("why a lesson is on the morning list", () => {
  it("distinguishes a stopgap from a hole in the timetable", () => {
    // `away` is arranged today. `unassigned` will be there tomorrow too, and
    // showing them identically would have the office arranging the same
    // emergency every day until July. Migration 0176.
    expect(reasonLabel("away")).toBe("Teacher away");
    expect(reasonLabel("unassigned")).toBe("No teacher assigned");
    expect(reasonTone("unassigned")).toBe("destructive");
    expect(reasonTone("away")).toBe("warning");
  });

  it("counts the vacant ones in the summary, because they need a different fix", () => {
    expect(
      coverSummary([
        { arranged: true, reason: "away" },
        { arranged: true, reason: "unassigned" },
      ]),
    ).toBe("All 2 lessons needing cover are arranged. One of them has no teacher at all.");

    expect(
      coverSummary([
        { arranged: false, reason: "unassigned" },
        { arranged: false, reason: "unassigned" },
        { arranged: true, reason: "away" },
      ]),
    ).toBe("2 of 3 still to arrange. 2 of them have no teacher at all.");
  });

  it("says nothing extra when every gap is an ordinary absence", () => {
    expect(coverSummary([{ arranged: true, reason: "away" }])).toBe(
      "The one lesson needing cover is arranged.",
    );
  });
});

describe("severity", () => {
  it("orders worst first", () => {
    const shuffled = ["info", "error", "warning"];
    expect([...shuffled].sort((a, b) => severityRank(a) - severityRank(b))).toEqual([
      "error",
      "warning",
      "info",
    ]);
  });

  it("never relies on colour alone", () => {
    // Every severity the function can return has a word beside the tone.
    for (const severity of PROBLEM_SEVERITIES) {
      expect(severityLabel(severity)).not.toBe(severity);
      expect(severityTone(severity)).toBeTruthy();
    }
  });

  it("degrades to something readable for a severity it has never seen", () => {
    expect(severityLabel("catastrophe")).toBe("catastrophe");
    expect(severityTone("catastrophe")).toBe("secondary");
  });
});

describe("the two things a person looks for", () => {
  it("puts the period and the clock together", () => {
    expect(periodLabel(3, "10:15:00")).toBe("Period 3 · 10:15");
  });

  it("says what it knows when it does not know the time", () => {
    expect(periodLabel(3, null)).toBe("Period 3");
    expect(periodLabel(null, null)).toBe("Period");
  });
});

describe("why this person is suggested", () => {
  it("says the reason rather than a score nobody can check", () => {
    expect(
      candidateReason({ teachesSubject: true, coversToday: 0, periodsToday: 4 }),
    ).toBe("Teaches the subject · no cover yet today · 4 lessons of their own");
  });

  it("counts one of a thing as one, not as 1s", () => {
    expect(
      candidateReason({ teachesSubject: false, coversToday: 1, periodsToday: 1 }),
    ).toBe("Different subject · 1 cover already today · 1 lesson of their own");
  });
});

describe("today", () => {
  it("is the browser's own calendar day, not a UTC slice of it", () => {
    // `new Date().toISOString().slice(0, 10)` is yesterday for anybody east of
    // UTC after midnight, which is most of this product's users.
    const lateEvening = new Date(2026, 8, 7, 23, 30);
    expect(todayIso(lateEvening)).toBe("2026-09-07");
  });

  it("pads a single-digit month and day", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
