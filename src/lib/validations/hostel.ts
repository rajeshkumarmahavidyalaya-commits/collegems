import { z } from "zod";

/**
 * Dormitory.
 *
 * The same division as transport: whether a placement is *allowed* — a full
 * room, a child already in a bed, a boys' hostel — is decided in Postgres,
 * because each of those is a fact about other rows or other tables. What is
 * here is the shape a form can catch and the sentences a screen reads out.
 */

export const HOSTEL_KINDS = [
  { value: "boys", label: "Boys", hint: "Only students recorded as male may be placed here." },
  { value: "girls", label: "Girls", hint: "Only students recorded as female may be placed here." },
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
export function genderAllowed(hostelKind: string, gender: string | null | undefined): boolean {
  if (hostelKind === "mixed") return true;
  if (gender !== "male" && gender !== "female") return true;
  return hostelKind === "boys" ? gender === "male" : gender === "female";
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const hostelSchema = z.object({
  name: z.string().min(1, "A hostel needs a name").max(120),
  kind: z.enum(["boys", "girls", "mixed"]),
  wardenStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
  feeHeadId: z.union([z.string().uuid(), z.literal("")]).optional(),
  address: z.string().max(300).optional(),
  isActive: z.boolean(),
});
export type HostelInput = z.infer<typeof hostelSchema>;

export const roomSchema = z.object({
  roomNumber: z.string().min(1, "A room needs a number").max(30),
  floor: z.string().max(30).optional(),
  beds: z
    .number({ message: "Enter how many beds the room has" })
    .int("Beds come in whole numbers")
    .positive("A room has at least one bed")
    .max(40, "That is a dormitory hall, not a room"),
  monthlyFare: z
    .number({ message: "Enter the monthly fare" })
    .min(0, "A fare cannot be negative")
    .max(1000000, "That is not a hostel fare"),
  isActive: z.boolean(),
  notes: z.string().max(400).optional(),
});
export type RoomInput = z.infer<typeof roomSchema>;

export const allocationSchema = z
  .object({
    studentId: z.string().uuid("Choose a student"),
    roomId: z.string().uuid("Choose a room"),
    startsOn: z.union([isoDate, z.literal("")]).optional(),
    endsOn: z.union([isoDate, z.literal("")]).optional(),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: "The stay cannot end before it starts",
    path: ["endsOn"],
  });
export type AllocationInput = z.infer<typeof allocationSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function hostelKindLabel(value: string) {
  return HOSTEL_KINDS.find((k) => k.value === value)?.label ?? value;
}

/** `3200` → `₹3,200.00`. */
export function formatFare(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(value));
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

export function occupancyTone(beds: number, occupied: number): "ok" | "warn" | "full" {
  if (beds <= 0) return "full";
  const ratio = occupied / beds;
  if (ratio >= 1) return "full";
  if (ratio >= 0.75) return "warn";
  return "ok";
}

/** Whether a stay is running today. Open-ended is the normal case. */
export function isCurrent(
  allocation: { status: string; startsOn: string; endsOn: string | null },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (allocation.status !== "active") return false;
  if (allocation.startsOn > today) return false;
  return allocation.endsOn === null || allocation.endsOn >= today;
}
