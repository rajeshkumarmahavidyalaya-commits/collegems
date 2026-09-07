import { z } from "zod";

/**
 * Student leave — the client half.
 *
 * The vocabulary and the sentences a person reads. The judgements are all in
 * Postgres: who may apply, who may decide, and whether two requests overlap
 * (an exclusion constraint, because an application that checks first and
 * inserts second is a race).
 */

export const LEAVE_KINDS = ["sick", "planned", "emergency", "other"] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const KIND_LABEL: Record<LeaveKind, string> = {
  sick: "Illness",
  planned: "Planned",
  emergency: "Emergency",
  other: "Other",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as LeaveKind] ?? kind;
}

export const LEAVE_STATUSES = ["pending", "approved", "refused", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  refused: "Refused",
  cancelled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as LeaveStatus] ?? status;
}

/** Never colour alone — the label is always beside it. */
export function statusTone(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "approved":
      return "success";
    case "pending":
      return "warning";
    case "refused":
      return "destructive";
    default:
      return "secondary";
  }
}

/**
 * Inclusive of both ends, which is how a family counts days off and how the
 * exclusion constraint's `daterange(starts_on, ends_on, '[]')` counts them.
 * An exclusive reading here would show "3 days" for a request the database
 * treats as four.
 */
export function leaveDays(startsOn: string, endsOn: string): number {
  const start = Date.parse(startsOn);
  const end = Date.parse(endsOn);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function leaveSentence(leave: { starts_on: string; ends_on: string }): string {
  const days = leaveDays(leave.starts_on, leave.ends_on);
  if (leave.starts_on === leave.ends_on) return `${leave.starts_on} · one day`;
  return `${leave.starts_on} to ${leave.ends_on} · ${days} days`;
}

/**
 * Whether a request still has a live claim on those dates.
 *
 * Matches the exclusion constraint's `where` clause exactly — `pending` and
 * `approved` block, `refused` and `cancelled` do not. The two must agree, or
 * the screen offers a re-application the database then refuses.
 */
export function blocksTheDates(status: string): boolean {
  return status === "pending" || status === "approved";
}

export const applyLeaveSchema = z
  .object({
    studentId: z.string().uuid("Choose a student"),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the first day"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day"),
    kind: z.enum(LEAVE_KINDS).default("other"),
    reason: z
      .string()
      .trim()
      .min(3, "Say why — a class teacher deciding this has nothing else to go on"),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The last day cannot be before the first",
    path: ["endsOn"],
  });

export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const decideLeaveSchema = z.object({
  leaveId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
