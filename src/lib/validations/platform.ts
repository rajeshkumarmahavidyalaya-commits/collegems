import { z } from "zod";

/**
 * The SaaS boundary: signing up, starting a school, and inviting colleagues.
 *
 * These three are the only schemas in the product that describe somebody who is
 * not yet a member of a tenant, which is why they live together rather than
 * under a module.
 */
// `roles.subject` and its prompts live in `invitations-display.ts`, which has
// no imports: a client component reading a label must not drag Zod in behind
// it. Re-exported so a caller that already imports this module has one import
// to remember.
export {
  ROLE_SUBJECTS,
  SUBJECT_PROMPT,
  describeAnnouncement,
  joinWords,
  type RoleSubject,
  type AnnouncedChannel,
} from "./invitations-display";
import { SLUG_PATTERN } from "./platform-display";
export { SLUG_PATTERN, slugify } from "./platform-display";

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
  /**
   * **One field, not three.** The role decides which column this lands in, so
   * the client cannot put a student's id into `guardian_id` — and there is no
   * three-way "exactly one of these" rule in the browser to get wrong. The
   * server resolves the role's subject and writes the right column; the
   * composite key and `invitations_subject_present` are still the boundary.
   */
  subjectId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export type InviteInput = z.infer<typeof inviteSchema>;
