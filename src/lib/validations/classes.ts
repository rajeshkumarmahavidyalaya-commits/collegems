import { z } from "zod";

/**
 * A class ("Grade 4", "B.A. Part 1") and its sections ("A", "Science") for the
 * current year. Until 0288 neither could be created anywhere in the product:
 * a newly signed-up college had no way to make its first class, and the
 * setup checklist pointed at a screen without the control.
 */
export const classLevelSchema = z.object({
  name: z.string().trim().min(1, "Give the class a name").max(60),
  /**
   * Position in lists and promotion order. No longer asked for on the form
   * (0328): a new class takes the next position in `class_level_add`, and a
   * rename keeps its own.
   */
  sequence: z.string().regex(/^\d{0,4}$/, "A whole number").optional(),
});
export type ClassLevelInput = z.infer<typeof classLevelSchema>;

export const sectionSchema = z.object({
  classLevelId: z.string().uuid("Choose a class"),
  name: z.string().trim().min(1, "Give the section a name").max(40),
  capacity: z.string().regex(/^\d{0,4}$/, "A whole number").optional(),
  /** `""` for nobody yet: a Select cannot hold undefined without going uncontrolled. */
  classTeacherStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
});
export type SectionInput = z.infer<typeof sectionSchema>;
