import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * `hostel.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `hostel.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
/**
 * Dormitory.
 *
 * The same division as transport: whether a placement is *allowed* — a full
 * room, a child already in a bed, a boys' hostel — is decided in Postgres,
 * because each of those is a fact about other rows or other tables. What is
 * here is the shape a form can catch and the sentences a screen reads out.
 */

export const HOSTEL_KINDS = [
  {
    value: "boys",
    label: "Boys",
    hint: "Only students recorded as male may be placed here.",
  },
  {
    value: "girls",
    label: "Girls",
    hint: "Only students recorded as female may be placed here.",
  },
  {
    value: "mixed",
    label: "Mixed",
    hint: "No gender rule — a junior boarding house, or a school that does not classify.",
  },
] as const;

/**
 * Whether a hostel would take a student of a given gender.
 *
 * Mirrors the check in `hostel_allocate`, including the part that is easy to
 * get wrong: **an unrecorded gender is not a refusal.** The office often places
 * a child before the admission form comes back, and blocking that pushes the
 * work onto paper. The database is the gate; this only saves a round trip.
 */
export function genderAllowed(
  hostelKind: string,
  gender: string | null | undefined,
): boolean {
  if (hostelKind === "mixed") return true;
  if (gender !== "male" && gender !== "female") return true;
  return hostelKind === "boys" ? gender === "male" : gender === "female";
}

export function hostelKindLabel(value: string, t: Translator) {
  const kind = HOSTEL_KINDS.find((k) => k.value === value);
  return kind ? labelFor(`hostel.kind.${kind.value}`, kind.label, t) : value;
}

/**
 * How full a room is, as a sentence. Unlike a bus, a room always has a bed
 * count — there is no "no vehicle assigned" case — so this never has to
 * distinguish unknown from zero.
 */
export function bedsSentence(beds: number, occupied: number): string {
  const free = beds - occupied;
  if (free <= 0) return `Full — ${occupied} of ${beds}`;
  return `${free} of ${beds} free`;
}

export function occupancyTone(
  beds: number,
  occupied: number,
): "ok" | "warn" | "full" {
  if (beds <= 0) return "full";
  const ratio = occupied / beds;
  if (ratio >= 1) return "full";
  if (ratio >= 0.75) return "warn";
  return "ok";
}

/**
 * Whether a stay is running today.
 *
 * Takes the **resolved** end date, never the typed one. A null `ends_on` means
 * "to the end of this academic year", not "for ever" -- and the place that
 * knows which year is the row itself, which carries `effective_ends_on` as a
 * generated column (migration 0178). Reading `ends_on` here would be a second
 * answer to a question Postgres already answers, and it is the answer that had
 * a bed in a boys' house occupied by a boy who left in March.
 */
export function isCurrent(
  allocation: { status: string; startsOn: string; effectiveEndsOn: string },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (allocation.status !== "active") return false;
  if (allocation.startsOn > today) return false;
  return allocation.effectiveEndsOn >= today;
}
