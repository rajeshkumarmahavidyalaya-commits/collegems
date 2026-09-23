import type { Translator } from "@/lib/i18n/translate";
import { labelFor } from "./labels";

/**
 * `front-office.ts` without Zod: its constants, labels and display helpers. The
 * schemas stay in `front-office.ts`, which re-exports everything here, so server
 * callers are unchanged and a client screen that only draws a badge imports
 * from this file and ships no schema library (rule 15's `fees-display.ts` split).
 */
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
  {
    value: "new",
    label: "New",
    open: true,
    hint: "Logged, nobody has called back yet.",
  },
  {
    value: "contacted",
    label: "Contacted",
    open: true,
    hint: "Spoken to at least once.",
  },
  {
    value: "visited",
    label: "Visited",
    open: true,
    hint: "Came to see the school.",
  },
  {
    value: "applied",
    label: "Applied",
    open: true,
    hint: "Form submitted, not yet admitted.",
  },
  {
    value: "admitted",
    label: "Admitted",
    open: false,
    hint: "Became a student.",
  },
  {
    value: "lost",
    label: "Lost",
    open: false,
    hint: "Went elsewhere, and said why.",
  },
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

export function sourceLabel(value: string, t: Translator) {
  const source = ENQUIRY_SOURCES.find((s) => s.value === value);
  return source
    ? labelFor(`frontOffice.source.${source.value}`, source.label, t)
    : value;
}

export function stageLabel(value: string, t: Translator) {
  const stage = ENQUIRY_STAGES.find((s) => s.value === value);
  return stage
    ? labelFor(`frontOffice.stage.${stage.value}`, stage.label, t)
    : value;
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
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000,
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
export function conversionRate(
  counts: { status: string; count: number }[],
): number | null {
  const admitted = counts.find((c) => c.status === "admitted")?.count ?? 0;
  const lost = counts.find((c) => c.status === "lost")?.count ?? 0;
  const settled = admitted + lost;
  if (settled === 0) return null;
  return Math.round((admitted / settled) * 1000) / 10;
}
