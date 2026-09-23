import { z } from "zod";

// Everything that is not a schema lives in `transport-display.ts` (no Zod).
export * from "./transport-display";

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
  pickupTime: z
    .union([z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"), z.literal("")])
    .optional(),
  dropTime: z
    .union([z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"), z.literal("")])
    .optional(),
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
