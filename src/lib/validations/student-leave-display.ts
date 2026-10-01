import { labelFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The half of `student-leave.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `student-leave.ts` re-exports all of it.
 */

export const LEAVE_KINDS = ["sick", "planned", "emergency", "other"] as const;

export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const KIND_LABEL: Record<LeaveKind, string> = {
  sick: "Illness",
  planned: "Planned",
  emergency: "Emergency",
  other: "Other",
};

export function kindLabel(kind: string, t: Translator): string {
  const fallback = KIND_LABEL[kind as LeaveKind];
  return fallback ? labelFor(`leave.kind.${kind}`, fallback, t) : kind;
}

export const LEAVE_STATUSES = ["pending", "approved", "refused", "cancelled"] as const;

export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  refused: "Refused",
  cancelled: "Cancelled",
};

export function statusLabel(status: string, t: Translator): string {
  const fallback = STATUS_LABEL[status as LeaveStatus];
  return fallback ? labelFor(`leave.status.${status}`, fallback, t) : status;
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
