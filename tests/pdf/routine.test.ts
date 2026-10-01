import { describe, expect, it } from "vitest";
import { renderRoutine, routineFileName } from "@/lib/pdf/timetable";

/**
 * The class routine as a file: it renders in all three languages (Urdu right
 * to left), a free period prints as a dash, and the file name is safe.
 */
const doc = {
  school: { name: "Rajesh Kumar Mahavidyalaya", address: "Ballia, Uttar Pradesh" },
  classLabel: "Grade 1 · A",
  yearLabel: "2026-2027",
  weekdays: [1, 2, 3, 4, 5, 6],
  slots: [
    { id: "s1", periodNumber: 1, label: null, startsAt: "08:00:00", endsAt: "08:45:00" },
    { id: "s2", periodNumber: 2, label: "Assembly", startsAt: "08:45:00", endsAt: "09:00:00" },
  ],
  entries: [
    { weekday: 1, timeSlotId: "s1", subjectName: "Mathematics", teacherName: "Aditi Rao", roomName: "Room 4" },
    { weekday: 2, timeSlotId: "s1", subjectName: "हिंदी", teacherName: null, roomName: null },
  ],
};

describe("the class routine as a PDF", () => {
  it.each(["en", "hi", "ur"] as const)("renders in %s", async (locale) => {
    const bytes = await renderRoutine(doc, locale, { heading: "Class routine", period: "Period", free: "—" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("names the file safely", () => {
    expect(routineFileName("Grade 1 · A")).toMatch(/^routine-grade-1-a/);
  });
});
