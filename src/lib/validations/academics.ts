import { z } from "zod";

/**
 * The academic structure the rest of Phase 1 and 3 stand on: what is taught,
 * by whom, where, when, and on which days the school is open.
 */

export const SUBJECT_KINDS = [
  { value: "theory", label: "Theory" },
  { value: "practical", label: "Practical" },
] as const;

export const SLOT_KINDS = [
  { value: "class", label: "Class periods" },
  { value: "exam", label: "Exam periods" },
] as const;

/**
 * ISO weekday numbering (1 = Monday … 7 = Sunday), matching
 * `extract(isodow …)` so the app, the RPCs and every calendar query agree
 * without a translation table in someone's head.
 */
export const WEEKDAYS = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

/** `HH:MM`, what `<input type="time">` submits and what Postgres `time` takes. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 08:45");

export const subjectSchema = z.object({
  name: z.string().min(1, "A name is required").max(100),
  code: z
    .string()
    .min(1, "A short code is required")
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes and underscores only"),
  kind: z.enum(["theory", "practical"]),
  isActive: z.boolean(),
});
export type SubjectInput = z.infer<typeof subjectSchema>;

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

export function subjectKindLabel(value: string) {
  return SUBJECT_KINDS.find((k) => k.value === value)?.label ?? value;
}

export function weekdayLabel(value: number) {
  return WEEKDAYS.find((d) => d.value === value)?.label ?? String(value);
}

/** `08:45:00` from Postgres, `08:45` in a form — normalise on the way in. */
export function toClockTime(value: string) {
  return value.slice(0, 5);
}

export function formatSlotRange(startsAt: string, endsAt: string) {
  return `${toClockTime(startsAt)} – ${toClockTime(endsAt)}`;
}
