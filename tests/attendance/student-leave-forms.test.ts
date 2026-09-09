import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  applyLeaveSchema,
  blocksTheDates,
  decideLeaveSchema,
  kindLabel,
  leaveDays,
  leaveSentence,
  statusLabel,
  statusTone,
} from "@/lib/validations/student-leave";

/**
 * Student leave's client half, without a database.
 *
 * Two of these pin agreements with Postgres rather than preferences:
 * `leaveDays` has to count the way the exclusion constraint's
 * `daterange(starts_on, ends_on, '[]')` counts, and `blocksTheDates` has to
 * match that constraint's `where` clause exactly. If either drifts, the screen
 * offers something the database then refuses.
 */

describe("counting the days", () => {
  it("counts both ends, the way a family counts days off", () => {
    // Inclusive, matching `daterange(..., '[]')`. An exclusive reading would
    // show "3 days" for a request the database treats as four.
    expect(leaveDays("2026-09-07", "2026-09-10")).toBe(4);
    expect(leaveDays("2026-09-07", "2026-09-07")).toBe(1);
  });

  it("survives a month boundary", () => {
    expect(leaveDays("2026-09-29", "2026-10-02")).toBe(4);
  });

  it("returns nothing sensible rather than NaN for rubbish", () => {
    expect(leaveDays("not a date", "2026-09-10")).toBe(0);
  });

  it("says one day as one day rather than as a range", () => {
    expect(leaveSentence({ starts_on: "2026-09-07", ends_on: "2026-09-07" })).toBe(
      "2026-09-07 · one day",
    );
    expect(leaveSentence({ starts_on: "2026-09-07", ends_on: "2026-09-09" })).toBe(
      "2026-09-07 to 2026-09-09 · 3 days",
    );
  });
});

describe("which requests hold their dates", () => {
  it("matches the exclusion constraint's partial predicate exactly", () => {
    // `where (status in ('pending', 'approved'))`. A refused or cancelled
    // request must not block re-applying -- a family whose first note was
    // refused for want of detail has to be able to send a better one.
    expect(blocksTheDates("pending")).toBe(true);
    expect(blocksTheDates("approved")).toBe(true);
    expect(blocksTheDates("refused")).toBe(false);
    expect(blocksTheDates("cancelled")).toBe(false);
  });
});

describe("applying", () => {
  const base = {
    studentId: "00000000-0000-4000-8000-000000000001",
    startsOn: "2026-09-07",
    endsOn: "2026-09-10",
    kind: "sick" as const,
    reason: "Chickenpox — the doctor advises a week at home",
  };

  it("accepts a well-formed request", () => {
    expect(applyLeaveSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a range that ends before it starts", () => {
    const result = applyLeaveSchema.safeParse({ ...base, endsOn: "2026-09-01" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/cannot be before/);
    }
  });

  it("insists on a reason", () => {
    // The class teacher deciding this has nothing else to go on, so a blank
    // is refused here and again in Postgres.
    expect(applyLeaveSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(applyLeaveSchema.safeParse({ ...base, reason: "  x " }).success).toBe(false);
  });

  it("accepts a single day", () => {
    expect(applyLeaveSchema.safeParse({ ...base, endsOn: base.startsOn }).success).toBe(true);
  });

  it("makes the decision a boolean rather than a status string", () => {
    // Approve or refuse, and nothing else. A free-text status from the client
    // is how "aproved" ends up in a check constraint's error message.
    const id = "00000000-0000-4000-8000-000000000001";
    expect(decideLeaveSchema.safeParse({ leaveId: id, approve: true }).success).toBe(true);
    expect(decideLeaveSchema.safeParse({ leaveId: id, approve: "yes" }).success).toBe(false);
  });
});

describe("labels", () => {
  it("names every kind and status, and falls back to the raw value", () => {
    // The label is looked up in the reader's catalogue now (see
    // `src/lib/validations/labels.ts`), so the test supplies one. English is
    // asserted here; the three-locale coverage is `tests/i18n`'s floor.
    const t = createTranslator("en");
    expect(kindLabel("sick", t)).toBe("Illness");
    expect(statusLabel("pending", t)).toBe("Waiting");

    // A value the catalogue has never heard of falls back to itself, never to
    // the key: `leave.kind.sabbatical` on a badge is worse than the raw word.
    expect(kindLabel("sabbatical", t)).toBe("sabbatical");
    expect(statusLabel("unknown", t)).toBe("unknown");
  });

  it("tones a status without the tone carrying the meaning", () => {
    expect(statusTone("approved")).toBe("success");
    expect(statusTone("pending")).toBe("warning");
    expect(statusTone("refused")).toBe("destructive");
    expect(statusTone("cancelled")).toBe("secondary");
  });
});
