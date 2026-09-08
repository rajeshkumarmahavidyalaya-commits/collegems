/**
 * Carrying a bus seat or a hostel bed into the next academic year.
 *
 * The browser half of migrations 0184 and 0185. Nothing here validates against
 * the database — `renewal_start_run` and `renewal_apply` are the gate; these
 * are labels and shapes so a screen can describe a row without inventing its
 * own vocabulary.
 */

export const RENEWAL_KINDS = [
  {
    value: "transport",
    label: "Bus seats",
    /** Said on the button, so somebody knows what pressing it will look at. */
    blurb: "Every child with a seat this year, matched to the same stop on next year's route.",
  },
  {
    value: "hostel",
    label: "Hostel beds",
    blurb: "Every child with a bed this year, proposed into the same room.",
  },
] as const;

export type RenewalKind = (typeof RENEWAL_KINDS)[number]["value"];

export function renewalKindLabel(kind: string): string {
  return RENEWAL_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** What a row of the preview says. `toLabel` is null when there is no target. */
export type RenewalDecisionRow = {
  id: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  fromLabel: string;
  fromFare: number;
  toLabel: string | null;
  toFare: number | null;
  toStopId: string | null;
  toRoomId: string | null;
  direction: string | null;
  decision: string;
  reason: string;
  isOverride: boolean;
  appliedId: string | null;
  error: string | null;
};

export type RenewalRunRow = {
  id: string;
  kind: string;
  fromSessionName: string;
  toSessionName: string;
  status: string;
  appliedAt: string | null;
  createdAt: string;
  counts: { renew: number; skip: number };
  overrides: number;
  failures: number;
};

/**
 * The fare a family will actually be charged, and whether it moved.
 *
 * Both numbers are on the row deliberately: a renewal that quietly raised a
 * bus fare would be a rise nobody decided, and a screen that showed only the
 * new one could not say so.
 */
export function fareChange(fromFare: number, toFare: number | null): "same" | "up" | "down" | "unknown" {
  if (toFare === null || toFare === undefined) return "unknown";
  if (toFare > fromFare) return "up";
  if (toFare < fromFare) return "down";
  return "same";
}

export function decisionTone(decision: string, error: string | null): "default" | "secondary" | "destructive" {
  if (error) return "destructive";
  return decision === "renew" ? "default" : "secondary";
}
