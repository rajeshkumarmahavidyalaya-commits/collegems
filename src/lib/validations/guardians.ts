import { z } from "zod";
import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The guardian write path's client half.
 *
 * ## The list, and why there are two copies of it
 *
 * `guardian_student.relationship` has carried
 * `check (relationship in ('father', 'mother', 'guardian', 'other'))` since
 * migration `0003`, and the convention says *"a list of valid values belongs in
 * one place, and the constraint is usually that place"*.
 *
 * A `<Select>` cannot ask a CHECK what to draw, so there is a second copy here
 * — and the honest thing is to say which one is load-bearing. **The constraint
 * is.** This array decides what the office is *offered*; Postgres decides what
 * is *stored*, and since migration `0222` it says so in words rather than by
 * constraint name. `tests/students/guardians.test.ts` reads the migration and
 * fails if the two ever stop agreeing, which is the only way a second copy is
 * safe to keep.
 */
export const GUARDIAN_RELATIONSHIPS = [
  { value: "father", label: "Father" },
  { value: "mother", label: "Mother" },
  { value: "guardian", label: "Guardian" },
  { value: "other", label: "Other" },
] as const;

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number]["value"];

const RELATIONSHIP_VALUES = GUARDIAN_RELATIONSHIPS.map((r) => r.value) as readonly string[];

/**
 * A relationship's name, in the reader's language.
 *
 * Rule 15's label-helper shape. The fallback is the *value*, not the key: a
 * school whose rows predate a value being added reads `father` on a badge
 * rather than `guardians.relationship.father`.
 */
export function relationshipLabel(relationship: string, t: Translator): string {
  const known = GUARDIAN_RELATIONSHIPS.find((r) => r.value === relationship);
  if (!known) return relationship;
  return labelFor(`guardians.relationship.${relationship}`, known.label, t);
}

/** The picker's options — the constant's second reader, per `optionsFor`. */
export function relationshipOptions(t: Translator) {
  return optionsFor(GUARDIAN_RELATIONSHIPS, "guardians.relationship", t);
}

/**
 * `Mother`, `MOTHER`, ` mother ` → `mother`. An unrecognised word stays as
 * typed, so the database's own check reports it — `normaliseGender`'s comment,
 * and deliberately its behaviour too.
 *
 * Case is normalised because `Mother` and `mother` are one value typed two
 * ways. A word outside the list is **not** guessed at: filing a grandmother as
 * `guardian` is a decision, and it belongs to the person holding the
 * spreadsheet rather than to this function.
 */
export function normaliseRelationship(value: string | undefined | null): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (["dad", "papa", "f"].includes(text)) return "father";
  if (["mom", "mum", "mummy", "m"].includes(text)) return "mother";
  return text;
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

const relationship = z
  .string()
  .refine((v) => RELATIONSHIP_VALUES.includes(v), "Pick a relationship");

/**
 * A guardian is a `people` row plus an `occupation`, so the form is the
 * person's fields and one more. Deliberately **not** the whole of `people`: a
 * date of birth and a blood group belong to a child's record and asking a
 * parent for them at admission is a form nobody finishes.
 */
export const guardianSchema = z.object({
  firstName: z.string().trim().min(1, "A guardian needs a name").max(80),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  occupation: z.string().trim().max(80).optional(),
  relationship,
  isPrimary: z.boolean(),
  canPickup: z.boolean(),
});
export type GuardianInput = z.infer<typeof guardianSchema>;

/** Linking somebody who already exists — which is what a sibling is (rule 5). */
export const guardianLinkSchema = z.object({
  guardianId: z.string().uuid(),
  relationship,
  isPrimary: z.boolean(),
  canPickup: z.boolean(),
});
export type GuardianLinkInput = z.infer<typeof guardianLinkSchema>;
