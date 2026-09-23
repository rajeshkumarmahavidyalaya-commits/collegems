import { z } from "zod";

// Everything that is not a schema lives in `front-office-display.ts` (no Zod).
export * from "./front-office-display";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const enquirySchema = z
  .object({
    applicantFirstName: z
      .string()
      .min(1, "The child needs a first name")
      .max(80),
    applicantLastName: z.string().max(80).optional(),
    dateOfBirth: z.union([isoDate, z.literal("")]).optional(),
    gender: z.enum(["male", "female", "other", "undisclosed"]).optional(),
    classLevelId: z.union([z.string().uuid(), z.literal("")]).optional(),
    contactName: z.string().min(1, "Somebody has to be called back").max(120),
    contactPhone: z.string().max(30).optional(),
    contactEmail: z
      .union([z.string().email("That is not an email address"), z.literal("")])
      .optional(),
    relationship: z.string().max(40).optional(),
    source: z.enum([
      "walk_in",
      "phone",
      "website",
      "referral",
      "advertisement",
      "other",
    ]),
    assignedStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
    nextFollowUpOn: z.union([isoDate, z.literal("")]).optional(),
    notes: z.string().max(2000).optional(),
  })
  // The one rule that makes the module worth having: an enquiry nobody can ring
  // back is an enquiry that will be forgotten. Enforced in Postgres too.
  .refine(
    (v) =>
      (v.contactPhone?.trim() ?? "") !== "" ||
      (v.contactEmail?.trim() ?? "") !== "",
    {
      message:
        "Record a phone number or an email address, or nobody can follow this up",
      path: ["contactPhone"],
    },
  );

export type EnquiryInput = z.infer<typeof enquirySchema>;

export const followUpSchema = z
  .object({
    enquiryId: z.string().uuid(),
    note: z.string().min(1, "Say what was discussed").max(2000),
    channel: z.enum(["phone", "email", "sms", "visit", "other"]),
    outcome: z.enum(["contacted", "visited", "applied", "lost"]).optional(),
    nextFollowUpOn: z.union([isoDate, z.literal("")]).optional(),
    lostReason: z.string().max(300).optional(),
  })
  .refine((v) => v.outcome !== "lost" || (v.lostReason?.trim() ?? "") !== "", {
    message:
      "Say why it was lost — a school that cannot say why it loses families cannot fix it",
    path: ["lostReason"],
  });

export type FollowUpInput = z.infer<typeof followUpSchema>;

export const convertSchema = z.object({
  enquiryId: z.string().uuid(),
  admissionNumber: z.string().min(1, "An admission number is required").max(40),
  sectionId: z.union([z.string().uuid(), z.literal("")]).optional(),
  rollNumber: z.string().max(20).optional(),
  admissionDate: z.union([isoDate, z.literal("")]).optional(),
});

export type ConvertInput = z.infer<typeof convertSchema>;

export const visitorSchema = z.object({
  visitorName: z.string().min(1, "A pass needs a name").max(120),
  purpose: z.string().min(1, "Say why they are here").max(300),
  phone: z.string().max(30).optional(),
  organisation: z.string().max(120).optional(),
  hostStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
  hostNote: z.string().max(120).optional(),
  studentId: z.union([z.string().uuid(), z.literal("")]).optional(),
  idProofKind: z.string().max(40).optional(),
  /**
   * Four characters, never the whole number and never a scan. A photocopy of
   * somebody's identity document at a school gate is a liability, not a
   * security measure — the database enforces the same shape.
   */
  idProofLast4: z
    .union([
      z.string().regex(/^[0-9A-Za-z]{4}$/, "Just the last four characters"),
      z.literal(""),
    ])
    .optional(),
  vehicleNumber: z.string().max(20).optional(),
});

export type VisitorInput = z.infer<typeof visitorSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
