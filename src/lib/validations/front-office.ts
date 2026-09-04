import { z } from "zod";

/**
 * Front office — the admissions funnel and the gate register.
 *
 * Both are records of somebody who is **not yet in the identity model**. That
 * is the shape of the whole module, and the reason an enquiry is not a `person`
 * row: a name written on a pad at the desk is not yet a human this school holds
 * records about, and promoting it to one fills `people` with duplicates of
 * every family that ever asked about fees.
 */

export const ENQUIRY_SOURCES = [
  { value: "walk_in", label: "Walked in" },
  { value: "phone", label: "Telephoned" },
  { value: "website", label: "Website" },
  { value: "referral", label: "Referred" },
  { value: "advertisement", label: "Advertisement" },
  { value: "other", label: "Other" },
] as const;

/**
 * The funnel, in order. The order is load-bearing: it is what the board sorts
 * by and what the funnel chart counts down, and `admitted` and `lost` are the
 * two that end it.
 */
export const ENQUIRY_STAGES = [
  { value: "new", label: "New", open: true, hint: "Logged, nobody has called back yet." },
  { value: "contacted", label: "Contacted", open: true, hint: "Spoken to at least once." },
  { value: "visited", label: "Visited", open: true, hint: "Came to see the school." },
  { value: "applied", label: "Applied", open: true, hint: "Form submitted, not yet admitted." },
  { value: "admitted", label: "Admitted", open: false, hint: "Became a student." },
  { value: "lost", label: "Lost", open: false, hint: "Went elsewhere, and said why." },
] as const;

export const FOLLOW_UP_CHANNELS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "visit", label: "Visit" },
  { value: "other", label: "Other" },
] as const;

/** Outcomes a note may set. `admitted` is deliberately absent — see below. */
export const FOLLOW_UP_OUTCOMES = ENQUIRY_STAGES.filter(
  (s) => s.value !== "new" && s.value !== "admitted",
);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

export const enquirySchema = z
  .object({
    applicantFirstName: z.string().min(1, "The child needs a first name").max(80),
    applicantLastName: z.string().max(80).optional(),
    dateOfBirth: z.union([isoDate, z.literal("")]).optional(),
    gender: z.enum(["male", "female", "other", "undisclosed"]).optional(),
    classLevelId: z.union([z.string().uuid(), z.literal("")]).optional(),
    contactName: z.string().min(1, "Somebody has to be called back").max(120),
    contactPhone: z.string().max(30).optional(),
    contactEmail: z.union([z.string().email("That is not an email address"), z.literal("")]).optional(),
    relationship: z.string().max(40).optional(),
    source: z.enum(["walk_in", "phone", "website", "referral", "advertisement", "other"]),
    assignedStaffId: z.union([z.string().uuid(), z.literal("")]).optional(),
    nextFollowUpOn: z.union([isoDate, z.literal("")]).optional(),
    notes: z.string().max(2000).optional(),
  })
  // The one rule that makes the module worth having: an enquiry nobody can ring
  // back is an enquiry that will be forgotten. Enforced in Postgres too.
  .refine((v) => (v.contactPhone?.trim() ?? "") !== "" || (v.contactEmail?.trim() ?? "") !== "", {
    message: "Record a phone number or an email address, or nobody can follow this up",
    path: ["contactPhone"],
  });
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
    message: "Say why it was lost — a school that cannot say why it loses families cannot fix it",
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
    .union([z.string().regex(/^[0-9A-Za-z]{4}$/, "Just the last four characters"), z.literal("")])
    .optional(),
  vehicleNumber: z.string().max(20).optional(),
});
export type VisitorInput = z.infer<typeof visitorSchema>;

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function sourceLabel(value: string) {
  return ENQUIRY_SOURCES.find((s) => s.value === value)?.label ?? value;
}

export function stageLabel(value: string) {
  return ENQUIRY_STAGES.find((s) => s.value === value)?.label ?? value;
}

/** Whether a stage is still in play. `admitted` and `lost` are not. */
export function stageIsOpen(value: string): boolean {
  return ENQUIRY_STAGES.find((s) => s.value === value)?.open ?? false;
}

export function stageTone(value: string): "open" | "won" | "lost" {
  if (value === "admitted") return "won";
  if (value === "lost") return "lost";
  return "open";
}

/**
 * "3 days overdue", "due today", "in 2 days". The front office's whole morning
 * is this one question, so it reads as a phrase rather than a date to subtract.
 */
export function followUpPhrase(
  date: string | null,
  today = new Date().toISOString().slice(0, 10),
): string | null {
  if (!date) return null;
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000,
  );
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `in ${days} days`;
}

export function isOverdue(
  date: string | null,
  status: string,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (!date || !stageIsOpen(status)) return false;
  return date < today;
}

/** "1 h 40 m", for the gate register. */
export function durationPhrase(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}

/**
 * The conversion rate a head teacher asks about: admitted as a share of
 * everything that has *finished*, not of everything ever logged. Counting open
 * enquiries as failures makes the number meaningless in November and flattering
 * in March.
 */
export function conversionRate(counts: { status: string; count: number }[]): number | null {
  const admitted = counts.find((c) => c.status === "admitted")?.count ?? 0;
  const lost = counts.find((c) => c.status === "lost")?.count ?? 0;
  const settled = admitted + lost;
  if (settled === 0) return null;
  return Math.round((admitted / settled) * 1000) / 10;
}
