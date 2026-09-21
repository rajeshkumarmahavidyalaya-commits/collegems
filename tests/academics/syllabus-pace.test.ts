import { describe, expect, it } from "vitest";
import {
  formatShare,
  paceRank,
  paceVerdict,
  PACE_VERDICT_LABEL,
  type PaceVerdict,
} from "@/lib/validations/syllabus-display";

/**
 * The pace verdict, pinned with the numbers.
 *
 * This is the TypeScript half of rule 12's "a rate needs two numbers": the
 * server returns three facts and this turns them into the one word a screen
 * shows. It is in a plain module rather than in the server action precisely so
 * a test can import it — the `/arrangements` lesson, where the rule that
 * shipped wrong once was unreachable from any test.
 *
 * No database.
 */
describe("a course with no syllabus has not covered 0% of it", () => {
  it("reads null as no-syllabus, whatever the year is doing", () => {
    for (const state of ["before", "during", "ended"]) {
      expect(paceVerdict(null, 0.5, state)).toBe("no-syllabus");
    }
  });

  it("renders null as a dash and never as 0%", () => {
    expect(formatShare(null)).toBe("—");
    expect(formatShare(0)).toBe("0%");
    // The two must not collide: that is the whole distinction.
    expect(formatShare(null)).not.toBe(formatShare(0));
  });
});

describe("during the year", () => {
  it("is behind only once it is further behind than the threshold", () => {
    // 40% covered against 60% elapsed is 20 points behind: past the default 15.
    expect(paceVerdict(0.4, 0.6, "during")).toBe("behind");
    // 50% against 60% is 10 points: inside it.
    expect(paceVerdict(0.5, 0.6, "during")).toBe("on-track");
    // And exactly at the threshold is not yet behind.
    expect(paceVerdict(0.45, 0.6, "during")).toBe("on-track");
  });

  it("takes the threshold from the college's own setting", () => {
    // A board-exam year runs tighter than a first-year course.
    expect(paceVerdict(0.5, 0.6, "during", 0.05)).toBe("behind");
    expect(paceVerdict(0.4, 0.6, "during", 0.3)).toBe("on-track");
  });

  it("is finished at 100% even if the year has months left", () => {
    expect(paceVerdict(1, 0.6, "during")).toBe("finished");
  });
});

describe("a year that has ended", () => {
  it("says it did not finish rather than that it is behind", () => {
    // There is nothing left to catch up on. Telling somebody to hurry in
    // September about a year that closed in March is the critic this codebase
    // refuses to ship.
    expect(paceVerdict(0.4, 1, "ended")).toBe("ended-short");
    expect(paceVerdict(0.4, 1, "ended")).not.toBe("behind");
    expect(paceVerdict(1, 1, "ended")).toBe("ended-done");
  });

  it("is the live state of this college, and reads as a sentence", () => {
    // The current session ran to 31 Mar 2026; it is now September.
    expect(PACE_VERDICT_LABEL[paceVerdict(0.4, 1, "ended")]).toBe("Did not finish");
  });
});

describe("a year that has not begun", () => {
  it("is not-started rather than behind by the whole course", () => {
    expect(paceVerdict(0, 0, "before")).toBe("not-started");
  });
});

describe("the list puts what needs doing first", () => {
  it("ranks behind above everything and a finished course last", () => {
    const all: PaceVerdict[] = [
      "finished",
      "on-track",
      "behind",
      "no-syllabus",
      "ended-short",
      "not-started",
      "ended-done",
    ];
    const sorted = [...all].sort((a, b) => paceRank(a) - paceRank(b));
    expect(sorted[0]).toBe("behind");
    expect(sorted[1]).toBe("ended-short");
    expect(sorted.at(-1)).toBe("ended-done");
  });

  it("gives every verdict a label and a distinct rank position", () => {
    const all = Object.keys(PACE_VERDICT_LABEL) as PaceVerdict[];
    for (const v of all) {
      expect(PACE_VERDICT_LABEL[v], `${v} has no label`).toBeTruthy();
      expect(paceRank(v), `${v} is not in the ordering`).toBeLessThan(all.length);
    }
  });
});
