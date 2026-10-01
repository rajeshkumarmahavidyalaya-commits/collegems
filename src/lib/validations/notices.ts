import { z } from "zod";
import { audienceSchema, audienceToJson, type AudienceInput } from "./notifications";
/**
 * The notice board's client half.
 *
 * The audience vocabulary is imported rather than redefined: a notice and a
 * message mean the same thing by "Grade 4's parents", and the day those two
 * definitions differ is the day a circular reaches a different set of people
 * than the SMS about it did.
 */
import { NOTICE_CATEGORIES } from "./notices-display";
export { NOTICE_CATEGORIES, categoryLabel, categoryTone, NOTICE_STATUSES, STATUS_LABEL, statusTone } from "./notices-display";
export type { NoticeCategory, NoticeStatus } from "./notices-display";
export { publishSentence } from "./notices-display";

export const noticeSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3, "Give it a title people will recognise"),
    body: z.string().trim().min(10, "There is nothing in this notice yet"),
    category: z.enum(NOTICE_CATEGORIES).default("general"),
    audience: audienceSchema,
    isPinned: z.boolean().default(false),
    startsOn: z.string().optional().nullable(),
    expiresOn: z.string().optional().nullable(),
  })
  .refine(
    (v) => !v.startsOn || !v.expiresOn || v.expiresOn >= v.startsOn,
    { message: "It cannot come off the board before it goes up", path: ["expiresOn"] },
  );

export type NoticeInput = z.infer<typeof noticeSchema>;

export const withdrawSchema = z.object({
  noticeId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(4, "Say why — people have already read it"),
});

export function noticeAudienceJson(audience: AudienceInput) {
  return audienceToJson(audience);
}

// ---------------------------------------------------------------------------
// What publishing did
// ---------------------------------------------------------------------------

export const publishResultSchema = z.object({
  notice_id: z.string(),
  status: z.string(),
  announced: z.boolean(),
  error: z.string().nullish(),
  note: z.string().nullish(),
});

export type PublishResult = z.infer<typeof publishResultSchema>;

/** How many of the people it was for have opened it. Null when it was for nobody. */
export function readRate(summary: { audience: number; read: number }): number | null {
  if (summary.audience <= 0) return null;
  return Math.round((summary.read / summary.audience) * 100);
}

export const readSummarySchema = z.object({
  audience: z.coerce.number().default(0),
  read: z.coerce.number().default(0),
  announced: z.coerce.number().default(0),
  last_announce_error: z.string().nullish(),
});

export type ReadSummary = z.infer<typeof readSummarySchema>;

export function parseReadSummary(raw: unknown): ReadSummary | null {
  const parsed = readSummarySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
