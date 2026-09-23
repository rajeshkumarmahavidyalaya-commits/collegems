import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * `transport.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `transport.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
/**
 * Phase 5.2 — transport.
 *
 * The shape rules a form can catch before the server has to. What it cannot
 * catch is here on purpose: seats free, a child already on another bus, a stop
 * that belongs to a different route. Those are facts about other rows, so
 * Postgres owns them — see `docs/modules/transport.md`.
 */

export const DIRECTIONS = [
  {
    value: "both",
    label: "Both ways",
    hint: "Picked up in the morning and dropped in the afternoon.",
  },
  {
    value: "pickup",
    label: "Pickup only",
    hint: "Morning only; the family collects.",
  },
  {
    value: "drop",
    label: "Drop only",
    hint: "Afternoon only; the family drops off.",
  },
] as const;

export type Direction = (typeof DIRECTIONS)[number]["value"];

/**
 * Which arrangements a route can carry. A `both` route takes anybody; a
 * one-way route takes only its own direction. This mirrors the CHECK in
 * migration 0084 exactly, and a test asserts that it does — the browser and the
 * database disagreeing about this would let somebody fill in a form that can
 * only be refused.
 */
export function directionAllowed(
  routeDirection: string,
  assignmentDirection: string,
): boolean {
  return routeDirection === "both" || assignmentDirection === routeDirection;
}

export function allowedDirections(routeDirection: string) {
  return DIRECTIONS.filter((d) => directionAllowed(routeDirection, d.value));
}

export function directionLabel(value: string, t: Translator) {
  const direction = DIRECTIONS.find((d) => d.value === value);
  return direction
    ? labelFor(`transport.direction.${direction.value}`, direction.label, t)
    : value;
}

/** `"07:05:00"` → `"07:05"`. A timetable does not need seconds. */
export function formatStopTime(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 5);
}

/**
 * How full a bus is, as a sentence.
 *
 * Null capacity is not zero capacity: "no seats free" and "we have not said
 * which bus runs this yet" are different answers, and a screen that shows the
 * same thing for both is lying about one of them.
 */
export function seatsSentence(
  capacity: number | null,
  assigned: number,
): string {
  if (capacity === null || capacity === undefined) return "No vehicle assigned";
  const free = capacity - assigned;
  if (free <= 0) return `Full — ${assigned} of ${capacity}`;
  return `${free} of ${capacity} free`;
}

/** For the progress bar and for the badge tone; never colour alone. */
export function occupancyTone(
  capacity: number | null,
  assigned: number,
): "muted" | "ok" | "warn" | "full" {
  if (capacity === null || capacity === undefined || capacity <= 0)
    return "muted";
  const ratio = assigned / capacity;
  if (ratio >= 1) return "full";
  if (ratio >= 0.9) return "warn";
  return "ok";
}

/**
 * Whether an arrangement is running today.
 *
 * `ends_on` null means open-ended, which is what most of them are — nobody
 * types a leaving date in July for a child who will ride the bus all year. It
 * does **not** mean for ever: an arrangement stops with the academic year it
 * was made for, and the row carries that resolved date as `effective_ends_on`
 * (migration 0178). This function takes the resolved one so that the browser
 * and the bill cannot disagree about who is on the bus.
 */
export function isCurrent(
  assignment: { status: string; startsOn: string; effectiveEndsOn: string },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (assignment.status !== "active") return false;
  if (assignment.startsOn > today) return false;
  return assignment.effectiveEndsOn >= today;
}
