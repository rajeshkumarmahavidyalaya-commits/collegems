import { z } from "zod";

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

  sectionId: z.string().uuid().optional().or(z.literal("")),
  rollNumber: z.string().max(20).optional(),
});

export type StudentInput = z.infer<typeof studentSchema>;

export const STUDENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "alumni", label: "Alumni" },
  { value: "transferred", label: "Transferred" },
  { value: "expelled", label: "Expelled" },
] as const;

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "undisclosed", label: "Undisclosed" },
] as const;
