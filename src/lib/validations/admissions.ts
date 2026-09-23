import { z } from "zod";
import type { MessageKey } from "@/lib/i18n/messages/en";
import { ADMISSION_GENDERS, ADMISSION_LIMITS } from "./admissions-display";

export { ADMISSION_GENDERS, ADMISSION_LIMITS } from "./admissions-display";

/**
 * The public application form: the one screen in this product a person reaches
 * without an account.
 *
 * **This schema is a convenience, and `admission_apply` is the gate.** Rule 4's
 * sentence in its plainest form: the function is `SECURITY DEFINER`, granted
 * to `anon`, and re-checks every bound below in its own body, because anybody
 * holding the publishable key can call it without passing through this file.
 * The bounds are copied here for one reason only, which is to answer in the
 * reader's language before a round trip: Postgres refuses in English.
 *
 * `tests/admissions/public-form.test.ts` reads the migration and fails when the
 * two disagree, which is the only thing that makes a second copy safe to keep
 * (the `allowed_values` rule, rule 5).
 *
 * Every message is a **catalogue key**, not a sentence: the action resolves it
 * with `getT()` on the server, so the form ships no translation catalogue and a
 * Hindi reader is refused in Hindi.
 */

/** `^[0-9+() -]{6,20}$` in the migration, character for character. */
export const PHONE_PATTERN = /^[0-9+() -]{6,20}$/;

const key = (k: MessageKey) => k;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, key("apply.error.tooLong"))
    .optional()
    .transform((v) => (v ? v : undefined));

export const applicationSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, key("apply.error.firstName"))
      .max(ADMISSION_LIMITS.name, key("apply.error.tooLong")),
    lastName: optionalText(ADMISSION_LIMITS.name),
    dateOfBirth: z
      .string()
      .trim()
      .optional()
      .refine(
        (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isRealPastDate(v)),
        key("apply.error.dateOfBirth"),
      ),
    gender: z.union([z.enum(ADMISSION_GENDERS), z.literal("")]).optional(),
    classLevelId: z.union([z.string().uuid(key("apply.error.classLevel")), z.literal("")]).optional(),
    contactName: z
      .string()
      .trim()
      .min(1, key("apply.error.contactName"))
      .max(ADMISSION_LIMITS.contactName, key("apply.error.tooLong")),
    relationship: optionalText(ADMISSION_LIMITS.relationship),
    contactPhone: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || PHONE_PATTERN.test(v), key("apply.error.phone")),
    contactEmail: z
      .string()
      .trim()
      .max(ADMISSION_LIMITS.email, key("apply.error.tooLong"))
      .optional()
      .refine((v) => !v || z.string().email().safeParse(v).success, key("apply.error.email")),
    notes: optionalText(ADMISSION_LIMITS.notes),
  })
  // The one rule that makes an enquiry worth having, enforced in Postgres too:
  // an application nobody can reply to is one that will be forgotten.
  .refine((v) => Boolean(v.contactPhone) || Boolean(v.contactEmail), {
    message: key("apply.error.contact"),
    path: ["contactPhone"],
  });

export type ApplicationInput = z.infer<typeof applicationSchema>;

/**
 * Whether an ISO date is a real calendar day, not in the future and not more
 * than a century ago — the migration's three checks. Compared as ISO strings,
 * never as `Date` objects, so no timezone can move the boundary by a day (the
 * `arrangements.ts` rule).
 */
export function isRealPastDate(iso: string, today = new Date().toISOString().slice(0, 10)): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return false;
  }
  const floor = `${String(Number(today.slice(0, 4)) - 100).padStart(4, "0")}${today.slice(4)}`;
  return iso <= today && iso >= floor;
}

/**
 * The payload `admission_apply` reads, built from a parsed form. The keys are
 * the function's, and nothing else is sent — no college id, no year, no
 * source and no status: the function decides all four, and a client that sent
 * them would be sending suggestions nobody reads.
 */
export function applicationPayload(input: ApplicationInput): Record<string, string> {
  const out: Record<string, string> = {
    first_name: input.firstName,
    contact_name: input.contactName,
  };
  const optional: [string, string | undefined][] = [
    ["last_name", input.lastName],
    ["date_of_birth", input.dateOfBirth],
    ["gender", input.gender],
    ["class_level_id", input.classLevelId],
    ["relationship", input.relationship],
    ["contact_phone", input.contactPhone],
    ["contact_email", input.contactEmail],
    ["notes", input.notes],
  ];
  for (const [k, v] of optional) if (v) out[k] = v;
  return out;
}

/**
 * The refusals `admission_apply` can still raise after this schema has passed,
 * mapped to what the reader sees. Anything else it raises is a bound this file
 * failed to copy, and is shown as the function wrote it rather than swallowed;
 * anything that is not a refusal at all is the generic sentence.
 */
export function refusalKey(message: string): MessageKey | null {
  if (message.startsWith("This college is not taking applications")) return "apply.closed.body";
  if (message.startsWith("This college has received a lot of applications")) return "apply.error.busy";
  if (message.startsWith("Choose a class from the list")) return "apply.error.classLevel";
  return null;
}
