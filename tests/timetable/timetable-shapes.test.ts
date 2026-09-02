import { describe, expect, it } from "vitest";
import {
  GRID_WEEKDAYS,
  WEEKDAYS,
  cellKey,
  copyDaySchema,
  fillRate,
  periodLabel,
  timetableEntrySchema,
  weekdayName,
  weekdayShort,
} from "@/lib/validations/timetable";

/**
 * The routine's pure logic, tested without a database.
 *
 * Weekday numbering is the thing most worth pinning down. ISO numbering
 * (1 = Monday … 7 = Sunday) is what `weekends`, `extract(isodow …)`,
 * `attendance` and every calendar query in this schema already use. A single
 * off-by-one here would put every lesson on the wrong day, silently, and the
 * grid would look entirely plausible while doing it.
 */

const validEntry = {
  sectionId: "11111111-1111-4111-8111-111111111111",
  weekday: 1,
  timeSlotId: "22222222-2222-4222-8222-222222222222",
  subjectId: "33333333-3333-4333-8333-333333333333",
  teacherStaffId: "44444444-4444-4444-8444-444444444444",
  classRoomId: "",
  note: "",
};

describe("weekday numbering", () => {
  it("is ISO: Monday is 1 and Sunday is 7", () => {
    expect(WEEKDAYS[0]).toMatchObject({ value: 1, label: "Monday" });
    expect(WEEKDAYS[WEEKDAYS.length - 1]).toMatchObject({ value: 7, label: "Sunday" });
  });

  it("draws Monday through Saturday, leaving Sunday to configuration", () => {
    // A six-day week is normal in this product's market; a seventh column that
    // is empty in every school that ever uses it is not worth the width.
    expect(GRID_WEEKDAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("names and abbreviates a day, and passes an unknown one through", () => {
    expect(weekdayName(3)).toBe("Wednesday");
    expect(weekdayShort(3)).toBe("Wed");
    expect(weekdayName(9)).toBe("9");
  });
});

describe("period labelling", () => {
  it("prefers the school's own name for a period", () => {
    expect(periodLabel(1, "Assembly")).toBe("Assembly");
  });

  it("falls back to the number when there is no name", () => {
    expect(periodLabel(4, null)).toBe("Period 4");
    expect(periodLabel(4, "   ")).toBe("Period 4");
  });
});

describe("cell identity", () => {
  it("is the day and the period together, not either alone", () => {
    expect(cellKey(1, "slot-a")).toBe("1:slot-a");
    expect(cellKey(1, "slot-a")).not.toBe(cellKey(2, "slot-a"));
    expect(cellKey(1, "slot-a")).not.toBe(cellKey(1, "slot-b"));
  });
});

describe("fill rate", () => {
  it("reports a percentage of the periods the grid could hold", () => {
    expect(fillRate(23, 30)).toBe(77);
    expect(fillRate(30, 30)).toBe(100);
  });

  it("does not divide by zero when no periods are configured", () => {
    expect(fillRate(0, 0)).toBe(0);
  });
});

describe("entry validation", () => {
  it("accepts a complete period", () => {
    expect(timetableEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it("accepts a period with no teacher and no room decided yet", () => {
    // Both are nullable in the schema on purpose: a subject can be on the
    // routine before the staffing is settled, and forcing a placeholder teacher
    // would make the clash index meaningless.
    const result = timetableEntrySchema.safeParse({
      ...validEntry,
      teacherStaffId: "",
      classRoomId: "",
    });
    expect(result.success).toBe(true);
  });

  it("refuses a weekday outside 1–7", () => {
    expect(timetableEntrySchema.safeParse({ ...validEntry, weekday: 0 }).success).toBe(false);
    expect(timetableEntrySchema.safeParse({ ...validEntry, weekday: 8 }).success).toBe(false);
  });

  it("refuses a period with no subject", () => {
    const result = timetableEntrySchema.safeParse({ ...validEntry, subjectId: "" });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.subjectId).toBeDefined();
  });

  it("refuses a teacher id that is not a uuid, rather than sending it to Postgres", () => {
    const result = timetableEntrySchema.safeParse({ ...validEntry, teacherStaffId: "nobody" });
    expect(result.success).toBe(false);
  });
});

describe("copy day validation", () => {
  it("accepts two different days", () => {
    const result = copyDaySchema.safeParse({
      sectionId: validEntry.sectionId,
      fromWeekday: 1,
      toWeekday: 2,
    });
    expect(result.success).toBe(true);
  });

  it("refuses copying a day onto itself, on the target field", () => {
    const result = copyDaySchema.safeParse({
      sectionId: validEntry.sectionId,
      fromWeekday: 3,
      toWeekday: 3,
    });
    expect(result.success).toBe(false);
    expect(result.error!.flatten().fieldErrors.toWeekday).toBeDefined();
  });
});
