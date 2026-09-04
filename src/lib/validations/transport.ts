import { z } from "zod";

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
  { value: "pickup", label: "Pickup only", hint: "Morning only; the family collects." },
  { value: "drop", label: "Drop only", hint: "Afternoon only; the family drops off." },
] as const;

export type Direction = (typeof DIRECTIONS)[number]["value"];

/**
 * Which arrangements a route can carry. A `both` route takes anybody; a
 * one-way route takes only its own direction. This mirrors the CHECK in
 * migration 0084 exactly, and a test asserts that it does — the browser and the
 * database disagreeing about this would let somebody fill in a form that can
 * only be refused.
 */
export function directionAllowed(routeDirection: string, assignmentDirection: string): boolean {
  return routeDirection === "both" || assignmentDirection === routeDirection;
}

export function allowedDirections(routeDirection: string) {
  return DIRECTIONS.filter((d) => directionAllowed(routeDirection, d.value));
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const vehicleSchema = z.object({
  registrationNumber: z
    .string()
    .min(1, "A vehicle needs its registration number")
    .max(20, "That is longer than any registration plate"),
  model: z.string().max(120).optional(),
  capacity: z
    .number({ message: "Enter how many the vehicle seats" })
    .int("Seats come in whole numbers")
    .positive("A vehicle seats at least one")
    .max(200, "That is more than a bus"),
  driverStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
  attendantStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
  isActive: z.boolean(),
  notes: z.string().max(400).optional(),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const routeSchema = z.object({
  code: z.string().min(1, "A route needs a short code").max(20),
  name: z.string().min(1, "A route needs a name").max(120),
  direction: z.enum(["both", "pickup", "drop"]),
  vehicleId: z.union([z.string().uuid(), z.literal("")]).optional(),
  feeHeadId: z.union([z.string().uuid(), z.literal("")]).optional(),
  isActive: z.boolean(),
});
export type RouteInput = z.infer<typeof routeSchema>;

export const stopSchema = z.object({
  name: z.string().min(1, "A stop needs a name").max(120),
  landmark: z.string().max(160).optional(),
  sequence: z
    .number({ message: "Enter where this stop comes on the route" })
    .int()
    .positive("The first stop is 1"),
  pickupTime: z.union([z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"), z.literal("")]).optional(),
  dropTime: z.union([z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"), z.literal("")]).optional(),
  monthlyFare: z
    .number({ message: "Enter the monthly fare" })
    .min(0, "A fare cannot be negative")
    .max(1000000, "That is not a bus fare"),
});
export type StopInput = z.infer<typeof stopSchema>;

export const assignmentSchema = z
  .object({
    studentId: z.string().uuid("Choose a student"),
    stopId: z.string().uuid("Choose a stop"),
    direction: z.enum(["both", "pickup", "drop"]),
    startsOn: z.union([isoDate, z.literal("")]).optional(),
    endsOn: z.union([isoDate, z.literal("")]).optional(),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: "The arrangement cannot end before it starts",
    path: ["endsOn"],
  });
export type AssignmentInput = z.infer<typeof assignmentSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function directionLabel(value: string) {
  return DIRECTIONS.find((d) => d.value === value)?.label ?? value;
}

/** `1500` → `₹1,500.00`. Fares are money and print like money. */
export function formatFare(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(value));
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
export function seatsSentence(capacity: number | null, assigned: number): string {
  if (capacity === null || capacity === undefined) return "No vehicle assigned";
  const free = capacity - assigned;
  if (free <= 0) return `Full — ${assigned} of ${capacity}`;
  return `${free} of ${capacity} free`;
}

/** For the progress bar and for the badge tone; never colour alone. */
export function occupancyTone(capacity: number | null, assigned: number): "muted" | "ok" | "warn" | "full" {
  if (capacity === null || capacity === undefined || capacity <= 0) return "muted";
  const ratio = assigned / capacity;
  if (ratio >= 1) return "full";
  if (ratio >= 0.9) return "warn";
  return "ok";
}

/**
 * Whether an arrangement is running today. `ends_on` null means open-ended,
 * which is what most of them are — nobody types a leaving date in July for a
 * child who will ride the bus all year.
 */
export function isCurrent(
  assignment: { status: string; startsOn: string; endsOn: string | null },
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (assignment.status !== "active") return false;
  if (assignment.startsOn > today) return false;
  return assignment.endsOn === null || assignment.endsOn >= today;
}
