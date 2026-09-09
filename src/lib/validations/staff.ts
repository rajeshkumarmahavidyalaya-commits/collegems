import { z } from "zod";

/**
 * Shared by the staff form and the server action, so the two cannot drift.
 *
 * Optional text fields accept "" (what an untouched input submits) and are
 * normalised to null in the database function, rather than being rejected here
 * -- an empty department is missing data, not invalid data.
 *
 * **There is no `status` here, deliberately.** A member of staff leaving is
 * nine relationships ending, not a word changing, so it belongs to
 * `staff_exit` and to nothing else. An edit form with a status dropdown would
 * be a second way to write the flag, and the quieter one -- which is exactly
 * the bug migration `0174` closed on the students side.
 */
export const staffSchema = z.object({
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

  employeeCode: z.string().min(1, "An employee code is required").max(50),
  designation: z.string().min(1, "A designation is required").max(100),
  department: z.string().max(100).optional(),
  dateOfJoining: z.string().min(1, "A joining date is required"),
});

export type StaffInput = z.infer<typeof staffSchema>;
