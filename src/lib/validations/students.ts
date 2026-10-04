import { z } from "zod";
export { STUDENT_STATUSES, GENDERS } from "./students-display";

/**
 * Shared by the student form and the server action, so the two cannot drift.
 *
 * Optional text fields accept "" (what an untouched input submits) and are
 * normalised to null in the database function, rather than being rejected
 * here -- an empty middle name is missing data, not invalid data.
 */
export const studentSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  middleName: z.string().max(100).optional(),
  lastName: z.string().min(1, "Last name is required").max(100),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["male", "female", "other", "undisclosed"]).optional(),
  bloodGroup: z.string().max(8).optional(),
  email: z.union([z.string().email("Enter a valid email address"), z.literal("")]).optional(),
  phone: z.string().max(20).optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),

  admissionNumber: z.string().min(1, "Admission number is required").max(50),
  admissionDate: z.string().min(1, "Admission date is required"),
  status: z.enum(["active", "inactive", "alumni", "transferred", "expelled"]),

  /** The form's first picker; the section beneath it is what is enrolled. */
  classLevelId: z.string().optional(),
  sectionId: z.string().uuid().optional().or(z.literal("")),
  rollNumber: z.string().max(20).optional(),

  // Kind of student, medium and house (0328). `""` is "not set": a Select
  // cannot hold undefined without going uncontrolled.
  studentTypeId: z.string().uuid().optional().or(z.literal("")),
  mediumId: z.string().uuid().optional().or(z.literal("")),
  houseId: z.string().uuid().optional().or(z.literal("")),

  // At admission only (0296), each optional: a bus stop and a hostel room,
  // so a boarder on the bus is one form rather than three screens. Ignored
  // by an edit, where the record's own cards do it.
  busStopId: z.string().uuid().optional().or(z.literal("")),
  hostelRoomId: z.string().uuid().optional().or(z.literal("")),
});

export type StudentInput = z.infer<typeof studentSchema>;

/**
 * Admitting a child names their class and their kind. A child admitted with
 * no section is on no register, no timetable and no invoice run -- invisible
 * to every screen that lists a class -- and a college asked that it be
 * impossible. Editing keeps both optional, because an alumnus has no class
 * this year.
 */
export const admissionSchema = studentSchema.extend({
  sectionId: z.string().uuid("Choose the class and section the student joins"),
  studentTypeId: z.string().uuid("Choose the kind of student"),
});

