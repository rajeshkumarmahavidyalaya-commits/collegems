import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import {
  STAFF_LEAVING_STATUSES,
  STAFF_STATUSES,
  staffStatusLabel,
  staffStatusTone,
} from "@/lib/validations/staff-display";
import { staffSchema } from "@/lib/validations/staff";

/**
 * Shapes, with no database. These run everywhere, which is the point: the
 * claims below are about the contract between the form, the badge and the
 * CHECK constraint, and none of them needs a school to be true.
 */
// The labels are looked up in the reader's catalogue now, so the tests
// supply one. English is asserted here; three-locale coverage is the floor in
// tests/i18n.
const t = createTranslator("en");

describe("staff statuses", () => {
  /**
   * `staff_status_check` allows exactly these five. A sixth in the list would
   * be a dropdown option the database refuses; a missing one would be a status
   * the roster filter cannot show.
   */
  it("mirrors the CHECK constraint, exactly", () => {
    expect(STAFF_STATUSES.map((s) => s.value)).toEqual([
      "active",
      "inactive",
      "resigned",
      "retired",
      "terminated",
    ]);
  });

  it("does not offer `active` as a way to leave", () => {
    expect(STAFF_LEAVING_STATUSES.map((s) => s.value)).not.toContain("active");
    expect(STAFF_LEAVING_STATUSES).toHaveLength(4);
  });

  it("gives every status a label, and an unknown one its own name", () => {
    for (const s of STAFF_STATUSES) expect(staffStatusLabel(s.value, t)).toBe(s.label);
    expect(staffStatusLabel("seconded", t)).toBe("seconded");
  });

  it("gives every status a tone, so a badge is never unstyled", () => {
    for (const s of STAFF_STATUSES) expect(staffStatusTone(s.value)).toBeTruthy();
    expect(staffStatusTone("seconded")).toBe("default");
  });
});

describe("the staff form's schema", () => {
  const valid = {
    firstName: "Asha",
    lastName: "Verma",
    employeeCode: "EMP-101",
    designation: "Primary Teacher",
    dateOfJoining: "2026-04-01",
  };

  it("accepts the four things a staff record cannot be without", () => {
    expect(staffSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a designation, because payroll and the timetable both read it", () => {
    const result = staffSchema.safeParse({ ...valid, designation: "" });
    expect(result.success).toBe(false);
  });

  /**
   * The load-bearing absence. A member of staff leaving ends nine
   * relationships, so it belongs to `staff_exit` — an edit form that could
   * write the word would be a second, quieter way to do it, which is exactly
   * the bug migration `0174` closed on the students side.
   */
  it("has no status field at all", () => {
    expect(Object.keys(staffSchema.shape)).not.toContain("status");
    expect(Object.keys(staffSchema.shape)).not.toContain("dateOfLeaving");
  });

  it("treats an untouched optional input ('') as missing, not invalid", () => {
    const result = staffSchema.safeParse({ ...valid, department: "", email: "", phone: "" });
    expect(result.success).toBe(true);
  });
});
