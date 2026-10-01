import { z } from "zod";
/**
 * Fee concessions — the client half.
 *
 * The arithmetic is entirely in Postgres (`fees_concession_lines`), because a
 * second implementation is a second answer and this one decides what a family
 * is charged. What lives here is the vocabulary, the sentences, and the one
 * thing a form has to get right: a percentage and a fixed amount are different
 * quantities wearing the same input.
 */
export { severityTone } from "./severity";
import { CONCESSION_KINDS } from "./concessions-display";
export { CONCESSION_KINDS, KIND_LABEL, kindLabel, statusLabel, statusTone, concessionSentence } from "./concessions-display";
export type { ConcessionKind } from "./concessions-display";

export const AWARD_STATUSES = ["active", "revoked"] as const;

export type AwardStatus = (typeof AWARD_STATUSES)[number];

/**
 * Whether an award is still doing anything on the date given.
 *
 * Matches `fees_concession_lines`'s own test exactly — active, started, not
 * ended — because a screen that shows an award as live when the engine has
 * stopped crediting it is the version of this bug a parent finds first.
 */
export function isLiveOn(
  award: { status: string; grantedOn: string; endsOn: string | null },
  on: string,
): boolean {
  if (award.status !== "active") return false;
  if (award.grantedOn > on) return false;
  return award.endsOn === null || award.endsOn >= on;
}

export const createConcessionSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, "Give it a short code")
      .max(30)
      .regex(/^[A-Z0-9_]+$/, "Capitals, digits and underscores"),
    name: z.string().trim().min(3, "Name it as a family would recognise it").max(80),
    description: z.string().trim().max(300).optional(),
    kind: z.enum(CONCESSION_KINDS),
    value: z.number().positive("A concession of nothing is not a concession"),
    maxAmount: z.number().positive().nullable().default(null),
    priority: z.number().int().min(1).max(999).default(100),
    feeHeadIds: z.array(z.string().uuid()).default([]),
  })
  .refine((v) => v.kind !== "percentage" || v.value <= 100, {
    message: "A percentage cannot be more than 100",
    path: ["value"],
  })
  .refine((v) => v.kind === "percentage" || v.maxAmount === null, {
    // The database says the same thing in a CHECK. Saying it here too is the
    // convention's "the client is a convenience, the server is the gate" —
    // this one just gets to say it before the round trip.
    message: "A ceiling only means something for a percentage",
    path: ["maxAmount"],
  });

export type CreateConcessionInput = z.infer<typeof createConcessionSchema>;

export const awardConcessionSchema = z.object({
  studentId: z.string().uuid("Choose a student"),
  concessionId: z.string().uuid("Choose a concession"),
  reason: z
    .string()
    .trim()
    .min(3, "Say why — a discount with no reason is the one an auditor asks about"),
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});

export const revokeConcessionSchema = z.object({
  awardId: z.string().uuid(),
  reason: z.string().trim().min(3, "Say why this is being withdrawn"),
});
