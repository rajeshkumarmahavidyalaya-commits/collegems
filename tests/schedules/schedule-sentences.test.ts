import { describe, expect, it } from "vitest";
import {
  formatRunAt,
  graceSentence,
  kindLabel,
  paramsFor,
  runSentence,
  runStatusTone,
  scheduleSchema,
  scheduleSentence,
} from "@/lib/validations/schedules";

/**
 * The sentences a schedule is read as, pinned without a database.
 *
 * `run_at`, `weekdays` and `day_of_month` are three columns that a person reads
 * as one fact, and the same two functions render that fact on the creation
 * dialog and on the card afterwards — so what somebody agreed to and what they
 * see a month later cannot say different things. These tests are what holds
 * that.
 */

describe("when does this run", () => {
  const at = (run_at: string, weekdays: number[] | null, day_of_month: number | null) =>
    scheduleSentence({ run_at, weekdays, day_of_month });

  it("reads an empty day list as every day, not as no days", () => {
    // The one that would be a real bug: no weekdays and no day-of-month means
    // daily, and a screen saying "on no days" would describe a schedule that
    // fires every day as one that never fires.
    expect(at("19:30:00", [], null)).toBe("Every day, at 19:30");
    expect(at("19:30:00", null, null)).toBe("Every day, at 19:30");
    expect(at("19:30:00", [1, 2, 3, 4, 5, 6, 7], null)).toBe("Every day, at 19:30");
  });

  it("names the common shapes rather than listing them", () => {
    expect(at("08:00:00", [1, 2, 3, 4, 5], null)).toBe("Every weekday, at 08:00");
    expect(at("08:00:00", [1, 2, 3, 4, 5, 6], null)).toBe("Monday to Saturday, at 08:00");
    expect(at("08:00:00", [6, 7], null)).toBe("At weekends, at 08:00");
  });

  it("lists an unusual set in a readable order", () => {
    expect(at("16:00:00", [3, 1], null)).toBe("Monday and Wednesday, at 16:00");
    expect(at("16:00:00", [1], null)).toBe("Monday, at 16:00");
    expect(at("16:00:00", [1, 3, 5], null)).toBe("Monday, Wednesday and Friday, at 16:00");
  });

  it("says a monthly schedule as an ordinal", () => {
    expect(at("10:00:00", [], 5)).toBe("On the 5th of each month, at 10:00");
    expect(at("10:00:00", [], 1)).toBe("On the 1st of each month, at 10:00");
    expect(at("10:00:00", [], 2)).toBe("On the 2nd of each month, at 10:00");
    expect(at("10:00:00", [], 3)).toBe("On the 3rd of each month, at 10:00");
    expect(at("10:00:00", [], 11)).toBe("On the 11th of each month, at 10:00");
    expect(at("10:00:00", [], 22)).toBe("On the 22nd of each month, at 10:00");
  });

  it("drops the seconds Postgres sends and nobody reads", () => {
    expect(formatRunAt("19:30:00")).toBe("19:30");
  });
});

describe("how late is too late", () => {
  it("says the consequence rather than the number", () => {
    expect(graceSentence(30)).toBe("Skipped if more than 30 minutes late");
    expect(graceSentence(120)).toBe("Skipped if more than 2 hours late");
    expect(graceSentence(60)).toBe("Skipped if more than 1 hour late");
    expect(graceSentence(1440)).toBe("Skipped if more than a day late");
  });
});

describe("what a run says about itself", () => {
  it("prefers the note the database wrote", () => {
    expect(
      runSentence({ status: "missed", matched: 0, notified: 0, note: "Not run: 300 minutes late." }),
    ).toBe("Not run: 300 minutes late.");
  });

  it("distinguishes matched from told", () => {
    // The gap is the useful number: a run that matched forty children and told
    // nobody is not a success, however green its status is.
    expect(runSentence({ status: "done", matched: 40, notified: 12, note: null })).toBe(
      "12 of 40 were told.",
    );
    expect(runSentence({ status: "done", matched: 0, notified: 0, note: null })).toBe(
      "Nothing matched, so nothing was sent.",
    );
  });

  it("tones a status without relying on the tone to carry the meaning", () => {
    expect(runStatusTone("done")).toBe("success");
    expect(runStatusTone("missed")).toBe("warning");
    expect(runStatusTone("failed")).toBe("destructive");
    expect(runStatusTone("running")).toBe("secondary");
  });
});

describe("what the form sends", () => {
  const base = {
    kind: "attendance.absentees" as const,
    name: "Evening absence notice",
    runAt: "19:30",
    weekdays: [1, 2, 3, 4, 5],
    dayOfMonth: null,
    graceMinutes: 120,
    minAmount: null,
    minDaysOver: null,
    isEnabled: false,
  };

  it("accepts a weekly schedule", () => {
    expect(scheduleSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a schedule that is both weekly and monthly", () => {
    // The database says the same thing in a check constraint. Saying it here
    // too is not duplication -- it is the difference between a sentence next to
    // the field and "violates constraint schedules_weekly_or_monthly".
    const both = { ...base, dayOfMonth: 5 };
    const result = scheduleSchema.safeParse(both);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/either/i);
    }
  });

  it("refuses a day of the month past the 28th", () => {
    expect(scheduleSchema.safeParse({ ...base, weekdays: [], dayOfMonth: 31 }).success).toBe(false);
  });

  it("keeps the grace window inside what the column allows", () => {
    expect(scheduleSchema.safeParse({ ...base, graceMinutes: 4 }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...base, graceMinutes: 1441 }).success).toBe(false);
  });

  it("only sends a kind's own settings", () => {
    // A minimum amount on an absence notice would be a parameter nothing reads,
    // which is how a params document quietly fills with keys that mean nothing.
    expect(paramsFor({ ...base, minAmount: 500 })).toEqual({});
    expect(paramsFor({ ...base, kind: "fees.due_reminder", minAmount: 500 })).toEqual({
      min_amount: 500,
    });
    expect(paramsFor({ ...base, kind: "library.overdue", minDaysOver: 3 })).toEqual({
      min_days_over: 3,
    });
  });
});

describe("labels", () => {
  it("names every kind and falls back to the raw value", () => {
    expect(kindLabel("attendance.absentees")).toBe("Absence notice");
    expect(kindLabel("something.new")).toBe("something.new");
  });
});
