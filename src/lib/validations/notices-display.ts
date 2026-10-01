import type { Translator } from "@/lib/i18n/translate";
import type { MessageKey } from "@/lib/i18n/messages/en";
import type { PublishResult } from "./notices";

/**
 * The half of `notices.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `notices.ts` re-exports all of it.
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

/**
 * A category's name, in the reader's language.
 *
 * This is the shape rule 15 already settled for formatters — *"a wrapper that
 * adds domain meaning keeps its name and gains a `locale` parameter"* — with a
 * translator instead of a locale, because a word has to be looked up rather
 * than computed. Every call site keeps the name it had and gains one argument.
 *
 * `Translator` is imported **as a type**, so this file still pulls nothing new
 * into the bundle: the catalogue reaches the call site through `t`, not through
 * here. That matters because `notices.ts` already imports Zod, and a label
 * helper that dragged the message catalogue in behind it would be the
 * `fees-display.ts` split undone.
 *
 * A value with no key falls back to the raw value rather than to the key — the
 * translator's own fallback would print `notices.category.staff_only`, which is
 * worse on a badge than the word the database actually stored.
 */
export function categoryLabel(category: string, t: Translator): string {
  return NOTICE_CATEGORIES.includes(category as NoticeCategory)
    ? t(`notices.category.${category}` as MessageKey)
    : category;
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

// Moved from `notices.ts` so a screen can use these without loading zod.

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
