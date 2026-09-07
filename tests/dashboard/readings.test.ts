import { describe, expect, it } from "vitest";
import {
  attendanceTone,
  collectionRate,
  parseDashboardSummary,
  registerState,
  staffRegisterReading,
  studentRegisterReading,
  withheldSentence,
} from "@/lib/validations/dashboard";
import { formatCell } from "@/lib/validations/reports";

/**
 * The readings the home page's cards are built out of, pinned without a
 * database.
 *
 * These are small functions, and that is the point: the mistakes a dashboard
 * makes are not exotic. They are "0% present" printed over a register nobody
 * took, a collection rate of 0% for a school that has not billed anything yet,
 * and a percentage taken over the roll instead of over what was marked. Each of
 * those is one arithmetic decision, and each is pinned here to an exact number.
 */
describe("what a register card says", () => {
  it("says holiday rather than a number when the school is closed", () => {
    // A staff register on a Sunday: nobody marked, and that is correct.
    expect(
      staffRegisterReading({
        present: 0,
        absent: 0,
        half_day: 0,
        on_leave: 0,
        on_duty: 0,
        marked: 0,
        roll: 14,
        is_working_day: false,
      }),
    ).toEqual({ kind: "holiday" });
  });

  it("distinguishes 'nobody has been marked' from 'nobody was present'", () => {
    const notTaken = studentRegisterReading({
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      marked: 0,
    });
    expect(notTaken).toEqual({ kind: "not-taken" });

    // ...and a register that WAS taken, in which everybody was away, is a
    // different fact and must render as a number.
    const nobodyIn = studentRegisterReading({
      present: 0,
      late: 0,
      absent: 40,
      excused: 0,
      marked: 40,
    });
    expect(nobodyIn).toEqual({ kind: "taken", percent: 0 });
  });

  it("takes the percentage over what was marked, not over the roll", () => {
    // Twenty of forty children marked, eighteen of them in. That is 90%, not
    // 45% -- a register half taken must read as half taken, not as a school
    // half empty.
    expect(
      studentRegisterReading({ present: 18, late: 0, absent: 2, excused: 0, marked: 20 }),
    ).toEqual({ kind: "taken", percent: 90 });
  });

  it("counts a late arrival as present and an excused absence as neither", () => {
    // 8 present + 2 late = 10 in; 2 absent. Excused is not in the denominator,
    // so this is 10/12, not 10/14.
    expect(
      studentRegisterReading({ present: 10, late: 2, absent: 2, excused: 2, marked: 14 }),
    ).toEqual({ kind: "taken", percent: 83 });
  });

  it("counts a staff half day as half, and leave as neither", () => {
    // 8 present + 1 on duty + half of 2 half-days = 10 in, over
    // 8 + 1 + 2 + 1 absent = 12 counted. Three people on leave are excluded
    // from both halves.
    expect(
      staffRegisterReading({
        present: 8,
        absent: 1,
        half_day: 2,
        on_leave: 3,
        on_duty: 1,
        marked: 15,
        roll: 15,
        is_working_day: true,
      }),
    ).toEqual({ kind: "taken", percent: 83 });
  });

  it("treats a missing working-day flag as a working day", () => {
    // Conservative reading, per rule 12: a school that has not configured its
    // calendar should be shown an untaken register, not told it is a holiday.
    expect(registerState({ marked: 0, counted: 0, present: 0 })).toEqual({ kind: "not-taken" });
  });
});

describe("what the fees card says", () => {
  it("has no collection rate at all before anything is billed", () => {
    // Not 0%. A school that has not raised an invoice has not failed to
    // collect; an empty progress bar says it has.
    expect(collectionRate({ billed: 0, collected: 0 })).toBeNull();
  });

  it("reports the rate against what was billed", () => {
    expect(collectionRate({ billed: 5_023_424, collected: 3_859_200 })).toBe(77);
  });
});

describe("what the page says about the cards it is not showing", () => {
  it("says nothing when nothing is withheld", () => {
    expect(withheldSentence([])).toBeNull();
  });

  it("names one withheld block in the singular", () => {
    expect(withheldSentence(["fees"])).toBe(
      "Your role does not see fee figures, so that card is not shown.",
    );
  });

  it("lists several in a sentence a person can read", () => {
    expect(withheldSentence(["student_attendance", "staff_attendance", "fees"])).toBe(
      "Your role does not see student attendance, staff attendance and fee figures, so those cards are not shown.",
    );
  });

  it("falls back to the raw key rather than dropping an unknown block", () => {
    // A block added by a later migration that this build has no label for must
    // still be explained, not silently vanish.
    expect(withheldSentence(["transport"])).toContain("transport");
  });
});

describe("parsing the brief", () => {
  const minimal = {
    today: "2026-09-06",
    role: "librarian",
    session_id: null,
    library: { issued: 18, overdue: 5 },
    withheld: ["student_attendance", "staff_attendance", "fees", "exam"],
  };

  it("accepts a document with most of its blocks missing", () => {
    const parsed = parseDashboardSummary(minimal);
    expect(parsed).not.toBeNull();
    expect(parsed!.library).toEqual({ issued: 18, overdue: 5 });
    expect(parsed!.fees).toBeUndefined();
    expect(parsed!.withheld).toHaveLength(4);
  });

  it("returns null rather than throwing when the shape is wrong", () => {
    // The page renders a designed error state off this null. A home page that
    // throws takes down the one screen everybody starts from.
    expect(parseDashboardSummary({ nonsense: true })).toBeNull();
    expect(parseDashboardSummary(null)).toBeNull();
  });

  it("defaults withheld to an empty list rather than undefined", () => {
    const parsed = parseDashboardSummary({ today: "2026-09-06" });
    expect(parsed!.withheld).toEqual([]);
  });

  it("keeps a null staff count distinct from a zero one", () => {
    // Null means "you may see the roll but not the staff directory"; zero would
    // mean a school with nobody working at it.
    const parsed = parseDashboardSummary({
      today: "2026-09-06",
      school: { students: 302, sections: 12, staff: null },
    });
    expect(parsed!.school!.staff).toBeNull();
  });
});

describe("tone thresholds", () => {
  it("uses the same bands everywhere", () => {
    expect(attendanceTone(null)).toBe("default");
    expect(attendanceTone(85)).toBe("success");
    expect(attendanceTone(84)).toBe("warning");
    expect(attendanceTone(60)).toBe("warning");
    expect(attendanceTone(59)).toBe("danger");
  });
});

describe("a percentage column in a report", () => {
  it("agrees with the exams screen rather than printing the stored precision", () => {
    // `exam_results.percentage` is numeric to three places. The exams module
    // renders one. A report that renders three disagrees with the card the
    // child took home.
    expect(formatCell(63.286, "percent")).toBe("63.3%");
    expect(formatCell(62, "percent")).toBe("62%");
    expect(formatCell(null, "percent")).toBe("—");
  });
});
