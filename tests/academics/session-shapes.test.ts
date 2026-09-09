import { describe, expect, it } from "vitest";
import { academicSessionSchema } from "@/lib/validations/academics";

/**
 * The year form's schema, with no database.
 *
 * What is worth pinning here is what the schema deliberately does **not** do.
 * Overlap and ordering are enforced by `academic_sessions_no_overlap` and
 * `academic_sessions_dates_chk`, and a copy of either rule in the browser would
 * be a second answer — and the weaker one, because only Postgres can see the
 * other years.
 */
describe("the academic year form's schema", () => {
  const valid = { name: "2026-2027", startDate: "2026-04-01", endDate: "2027-03-31" };

  it("requires a name and both dates", () => {
    expect(academicSessionSchema.safeParse(valid).success).toBe(true);
    expect(academicSessionSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(academicSessionSchema.safeParse({ ...valid, startDate: "" }).success).toBe(false);
    expect(academicSessionSchema.safeParse({ ...valid, endDate: "" }).success).toBe(false);
  });

  it("does not check that the end follows the start", () => {
    // `academic_sessions_dates_chk` does, and `academics_session_update` turns
    // it into a sentence. A duplicate here would drift the day somebody
    // relaxes one of them.
    const backwards = { name: "2026-2027", startDate: "2027-03-31", endDate: "2026-04-01" };
    expect(academicSessionSchema.safeParse(backwards).success).toBe(true);
  });

  it("has no is_current field", () => {
    // Making a year current is its own act, with its own confirmation, because
    // it changes where every subsequent row is filed. A checkbox on an edit
    // form would make it a side effect of renaming one.
    expect(Object.keys(academicSessionSchema.shape)).not.toContain("isCurrent");
  });
});
