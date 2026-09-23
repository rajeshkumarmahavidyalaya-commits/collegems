import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * What a live-class screen needs in the browser.
 *
 * **Only a type import, and the label helper it already shares with every other
 * module.** `live-classes.ts` beside it begins `import { z }`; the dialog and
 * the Join button import from here, so a family opening the list is never sent
 * Zod to draw a badge (the `fees-display.ts` split, rule 15).
 */

/**
 * The four providers `live_classes_url_chk` accepts, in the order a school is
 * likeliest to use them. `jitsi` needs no link: the database makes the room.
 *
 * The names are brands and are **not translated** -- which is why this is a
 * table rather than a `*Label` helper, and why the i18n guard does not count
 * it.
 */
export const LIVE_CLASS_PROVIDERS = [
  { value: "jitsi", name: "Jitsi Meet", needsLink: false, example: "" },
  { value: "meet", name: "Google Meet", needsLink: true, example: "https://meet.google.com/abc-defg-hij" },
  { value: "zoom", name: "Zoom", needsLink: true, example: "https://us02web.zoom.us/j/12345678901?pwd=..." },
  { value: "teams", name: "Microsoft Teams", needsLink: true, example: "https://teams.microsoft.com/l/meetup-join/..." },
] as const;

export type LiveClassProvider = (typeof LIVE_CLASS_PROVIDERS)[number]["value"];

export function providerName(value: string): string {
  return LIVE_CLASS_PROVIDERS.find((p) => p.value === value)?.name ?? value;
}

/**
 * The migration's CHECK, character for character, so a pasted link is refused
 * in the dialog before a round trip. **The CHECK is the gate**; this is the
 * courtesy. `tests/live-classes/live-classes.test.ts` fails when the two drift.
 */
export const LIVE_CLASS_URL_PATTERNS: Record<LiveClassProvider, RegExp> = {
  jitsi: /^https:\/\/meet\.jit\.si\/SchoolOS[0-9a-f]{24}$/,
  meet: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/,
  zoom: /^https:\/\/([a-z0-9-]+\.)?zoom\.us\/j\/[0-9]{9,11}(\?pwd=[A-Za-z0-9._-]{1,64})?$/,
  teams: /^https:\/\/teams\.(microsoft|live)\.com\/(l\/meetup-join|meet)\/[A-Za-z0-9%._~/?=&:@+-]+$/,
};

/** How long before a lesson its Join button opens. */
export const JOIN_OPENS_MINUTES_BEFORE = 15;

export type JoinState = "early" | "open" | "ended" | "cancelled";

/**
 * Whether a lesson can be joined at `now`. Compared as **instants** (epoch
 * milliseconds), which have no timezone to get wrong -- the wall clock only
 * matters when the times are *shown*, and the page formats those where the
 * college is.
 */
export function joinState(
  lesson: { status: string; startsAt: string; endsAt: string },
  now: number = Date.now(),
): JoinState {
  if (lesson.status === "cancelled") return "cancelled";
  const opens = Date.parse(lesson.startsAt) - JOIN_OPENS_MINUTES_BEFORE * 60_000;
  const ends = Date.parse(lesson.endsAt);
  if (now >= ends) return "ended";
  if (now >= opens) return "open";
  return "early";
}

export const LESSON_STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "cancelled", label: "Cancelled" },
] as const;

/** Never colour alone: the badge carries this word beside its tone. */
export function lessonStatusLabel(status: string, t: Translator): string {
  const known = LESSON_STATUSES.find((s) => s.value === status);
  // The fallback is the value, not the key (rule 15).
  return known ? labelFor(`liveClasses.status.${status}`, known.label, t) : status;
}
