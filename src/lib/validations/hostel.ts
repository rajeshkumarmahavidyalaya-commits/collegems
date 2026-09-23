import { z } from "zod";

// Everything that is not a schema lives in `hostel-display.ts` (no Zod).
export * from "./hostel-display";

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
