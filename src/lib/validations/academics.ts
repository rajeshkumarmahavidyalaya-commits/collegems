import { z } from "zod";

// Everything that is not a schema lives in `academics-display.ts` (no Zod).
export * from "./academics-display";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

/** `HH:MM`, what `<input type="time">` submits and what Postgres `time` takes. */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 08:45");

export const subjectSchema = z.object({
  name: z.string().min(1, "A name is required").max(100),
  code: z
    .string()
    .min(1, "A short code is required")
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only"),
  kind: z.enum(["theory", "practical"]),
  isActive: z.boolean(),
  /**
   * The classes that study it. Asked only when the subject is new: after that,
   * which classes study it (and who teaches each) is edited on *Who teaches
   * what*, where removing a class is a decision about a teacher too.
   */
  sectionIds: z.array(z.string().uuid()),
});

export type SubjectInput = z.infer<typeof subjectSchema>;

/**
 * A new subject must name at least one class. A subject on no class is on no
 * timetable, register, mark sheet or syllabus, which is why migration 0275
 * made adding it and assigning it one write.
 */
export const newSubjectSchema = subjectSchema.refine((v) => v.sectionIds.length > 0, {
  path: ["sectionIds"],
  message: "Choose at least one class that studies this subject",
});

export const classRoomSchema = z.object({
  name: z.string().min(1, "A name is required").max(100),
  capacity: z
    .number({ message: "Enter a capacity" })
    .int("Whole numbers only")
    .min(1, "At least one seat")
    .max(2000, "That is larger than any room this system will plan for"),
  isActive: z.boolean(),
});

export type ClassRoomInput = z.infer<typeof classRoomSchema>;

export const timeSlotSchema = z
  .object({
    kind: z.enum(["class", "exam"]),
    periodNumber: z
      .number({ message: "Enter a period number" })
      .int("Whole numbers only")
      .min(1, "Periods start at 1")
      .max(30),
    label: z.string().max(50).optional(),
    startsAt: clockTime,
    endsAt: clockTime,
    isBreak: z.boolean(),
  })
  // Mirrors the `time_slots_order_chk` constraint, so the form catches it
  // before Postgres has to.
  .refine((v) => v.endsAt > v.startsAt, {
    message: "The end time must be after the start time",
    path: ["endsAt"],
  });

export type TimeSlotInput = z.infer<typeof timeSlotSchema>;

export const holidaySchema = z
  .object({
    name: z.string().min(1, "A name is required").max(100),
    startsOn: isoDate,
    endsOn: isoDate,
    note: z.string().max(300).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The last day cannot be before the first",
    path: ["endsOn"],
  });

export type HolidayInput = z.infer<typeof holidaySchema>;

export const sectionSubjectSchema = z.object({
  sectionId: z.string().uuid("Choose a class"),
  subjectId: z.string().uuid("Choose a subject"),
  teacherStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export type SectionSubjectInput = z.infer<typeof sectionSubjectSchema>;

/**
 * An academic year.
 *
 * Shared by the year form and the server action. Dates are compared in the
 * database, not here: `academic_sessions_no_overlap` is the enforcement (rule
 * 4), and a check in the browser would be a second answer to a question
 * Postgres already answers -- and the only one of the two that sees the other
 * years.
 */
export const academicSessionSchema = z.object({
  name: z.string().min(1, "A name is required").max(50),
  startDate: z.string().min(1, "A start date is required"),
  endDate: z.string().min(1, "An end date is required"),
});

export type AcademicSessionInput = z.infer<typeof academicSessionSchema>;
