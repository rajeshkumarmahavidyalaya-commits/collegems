import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * A ticket's priorities and statuses (0348), the same lists the CHECKs on
 * `tickets` hold. Types and one helper only, so a label costs a page nothing
 * (docs/performance.md).
 */
export const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const STATUS_LABEL: Record<string, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };

/** The fallback is the value, not a key (rule 15). */
export function ticketPriorityLabel(value: string, t: Translator): string {
  return PRIORITY_LABEL[value] ? labelFor(`tickets.priority.${value}`, PRIORITY_LABEL[value], t) : value;
}

export function ticketStatusLabel(value: string, t: Translator): string {
  return STATUS_LABEL[value] ? labelFor(`tickets.status.${value}`, STATUS_LABEL[value], t) : value;
}
