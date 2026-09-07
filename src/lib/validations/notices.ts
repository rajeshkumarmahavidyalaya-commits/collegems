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

export const NOTICE_CATEGORIES = [
  "general",
  "circular",
  "event",
  "examination",
  "holiday",
  "urgent",
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NoticeCategory, string> = {
  general: "General",
  circular: "Circular",
  event: "Event",
  examination: "Examination",
  holiday: "Holiday",
  urgent: "Urgent",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category as NoticeCategory] ?? category;
}

/**
 * Only `urgent` is tinted, and it is tinted amber rather than red.
 *
 * CLAUDE.md is explicit that the palette's amber is for sparing emphasis, and a
 * board where every category has its own colour is a board where none of them
 * means anything. The word is always there; the colour is the extra.
 */
export function categoryTone(category: string): "warning" | "outline" {
  return category === "urgent" ? "warning" : "outline";
}

export const NOTICE_STATUSES = ["draft", "published", "withdrawn"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

export const STATUS_LABEL: Record<NoticeStatus, string> = {
  draft: "Draft",
  published: "Published",
  withdrawn: "Withdrawn",
};

export function statusTone(status: string): "success" | "secondary" | "destructive" {
  if (status === "published") return "success";
  if (status === "withdrawn") return "destructive";
  return "secondary";
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

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

/**
 * The sentence to show after publishing.
 *
 * Three outcomes, and conflating them is how a school comes to believe four
 * hundred parents were told:
 *
 *   - published *and* announced;
 *   - published, and the announcement could not go anywhere — which is not a
 *     failure to publish, because the board is the point and the announcement
 *     is a courtesy;
 *   - published again, deliberately not re-announced.
 */
export function publishSentence(result: PublishResult): string {
  if (result.announced) return "Published, and everybody it is for has been told.";
  if (result.error) {
    return `Published. Nobody was notified: ${result.error}. It is on the board either way.`;
  }
  if (result.note) return `Published. ${result.note}`;
  return "Published.";
}

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
