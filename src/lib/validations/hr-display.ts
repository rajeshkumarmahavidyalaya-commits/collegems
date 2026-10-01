import { labelFor, optionsFor } from "./labels";
import type { Translator } from "@/lib/i18n/translate";

/**
 * The half of `hr.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `hr.ts` re-exports all of it.
 */

export const ATTENDANCE_STATUSES = [
  { value: "present", label: "Present", short: "P", tone: "success" },
  { value: "absent", label: "Absent", short: "A", tone: "danger" },
  { value: "half_day", label: "Half day", short: "H", tone: "warning" },
  { value: "on_leave", label: "On leave", short: "L", tone: "info" },
  // Not a synonym for present: a teacher at a district sports meet is out of
  // the building and fully paid, and a register that cannot say so gets them
  // marked absent by whoever is covering the front desk.
  { value: "on_duty", label: "On duty", short: "D", tone: "info" },
] as const;

export const LEAVE_STATUSES = [
  { value: "pending", label: "Awaiting a decision", tone: "warning" },
  { value: "approved", label: "Approved", tone: "success" },
  { value: "rejected", label: "Refused", tone: "danger" },
  { value: "cancelled", label: "Withdrawn", tone: "muted" },
] as const;

export const RUN_STATUSES = [
  { value: "draft", label: "Draft", tone: "muted" },
  { value: "finalised", label: "Finalised", tone: "success" },
  { value: "discarded", label: "Discarded", tone: "muted" },
] as const;

export const PAYMENT_METHODS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
] as const;

// Not `fees-display.PAYMENT_METHODS`: a school pays its staff by four means
// and collects fees by seven. Same name, different vocabulary, different keys.
export function paymentMethodLabel(value: string, t: Translator) {
  const found = PAYMENT_METHODS.find((m) => m.value === value);
  return found ? labelFor(`hr.method.${value}`, found.label, t) : value;
}

export function formatOverrides(overrides: Record<string, unknown> | null | undefined): string {
  if (!overrides) return "";
  return Object.entries(overrides)
    .map(([code, value]) => `${code} = ${value}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

// The null branch is not a status. "Nobody marked this person" and "this
// person was absent" are different facts and the register must not collapse
// them -- rule 11's three-states rule, in one helper.
export function attendanceLabel(value: string | null, t: Translator) {
  if (!value) return t("hr.attendance.unmarked");
  const found = ATTENDANCE_STATUSES.find((s) => s.value === value);
  return found ? labelFor(`hr.attendance.${value}`, found.label, t) : value;
}

/** The same five, for the register's button row. `short` and `tone` survive. */
export function attendanceStatusOptions(t: Translator) {
  return optionsFor(ATTENDANCE_STATUSES, "hr.attendance", t);
}

export function leaveStatusLabel(value: string, t: Translator) {
  const found = LEAVE_STATUSES.find((s) => s.value === value);
  return found ? labelFor(`hr.leaveStatus.${value}`, found.label, t) : value;
}

export function runStatusLabel(value: string, t: Translator) {
  const found = RUN_STATUSES.find((s) => s.value === value);
  return found ? labelFor(`hr.runStatus.${value}`, found.label, t) : value;
}

/** `22` not `22.0`, `21.5` not `21.50`. Days are read, not computed with. */
export function formatDays(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The first of the month, for the payroll picker. */
export function monthValue(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Days in a leave request, matching `hr_leave_days()` exactly. Half days only
 * ever sit at the ends of a range, which is what makes this arithmetic rather
 * than a loop — and what the two booleans encode.
 */
export function leaveDays(
  startsOn: string,
  endsOn: string,
  halfStart = false,
  halfEnd = false,
): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;

  const whole = Math.round((end - start) / 86_400_000) + 1;
  return Math.max(whole - (halfStart ? 0.5 : 0) - (halfEnd ? 0.5 : 0), 0.5);
}
