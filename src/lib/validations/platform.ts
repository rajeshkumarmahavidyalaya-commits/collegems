import { z } from "zod";

/**
 * The SaaS boundary: signing up, starting a school, and inviting colleagues.
 *
 * These three are the only schemas in the product that describe somebody who is
 * not yet a member of a tenant, which is why they live together rather than
 * under a module.
 */

export const signupSchema = z
  .object({
    email: z.string().min(1, "Enter your email").email("That does not look like an email address"),
    // Supabase's own floor is 6. Eight is not a security theatre choice: the
    // person signing up here is the administrator of a school's entire record,
    // and they are choosing this password in thirty seconds on a phone.
    password: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string().min(1, "Type the password again"),
  })
  .refine((v) => v.password === v.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * A slug is a permanent, public address. The rule here is deliberately the same
 * regular expression `platform_start_school` enforces in SQL — the server
 * function is the gate (rule: "the client is a convenience"), and this exists so
 * a person is told before they submit rather than after.
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export const startSchoolSchema = z.object({
  schoolName: z.string().min(2, "A school needs a name").max(160),
  slug: z
    .string()
    .min(3, "At least three characters")
    .max(50)
    .regex(SLUG_PATTERN, "Lower-case letters, numbers and hyphens only"),
  timezone: z.string().min(1).default("Asia/Kolkata"),
  // Both optional: a school starting in September should not have to argue with
  // a form about which academic year it is in. The function defaults to the
  // calendar year when these are absent.
  sessionName: z.string().max(40).optional(),
  sessionStart: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  sessionEnd: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
});

export type StartSchoolInput = z.infer<typeof startSchoolSchema>;

export const inviteSchema = z.object({
  email: z.string().min(1, "Enter an email").email("That does not look like an email address"),
  roleId: z.string().uuid("Choose a role"),
  // Optional links to the person this login will act as. Rule 5's identity model:
  // a login is not a person, it is an account that acts as one.
  staffId: z.union([z.string().uuid(), z.literal("")]).optional(),
  studentId: z.union([z.string().uuid(), z.literal("")]).optional(),
  guardianId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export type InviteInput = z.infer<typeof inviteSchema>;

/**
 * Turn a school's name into a candidate address. Only ever a suggestion — the
 * person can overwrite it, and the database decides whether it is free.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
    .replace(/-$/, "");
}
