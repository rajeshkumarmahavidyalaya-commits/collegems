import type { Translator } from "@/lib/i18n/translate";
import { labelFor, optionsFor } from "./labels";

/**
 * The half of `attendance.ts` a screen needs without a form: labels, lists and
 * sentences. **No `import { z }` here** -- one and it silently becomes the
 * thing it was split from (CLAUDE.md, "A conditional render is not a
 * conditional load"). `attendance.ts` re-exports all of it.
 */

/**
 * Attendance is a small vocabulary, and it is the same one in the database
 * check constraint, the RPC, and here. Keeping the list in one exported
 * constant is what stops the three from drifting apart.
 */
export const ATTENDANCE_STATUSES = [
  { value: "present", label: "Present", short: "P" },
  { value: "absent", label: "Absent", short: "A" },
  { value: "late", label: "Late", short: "L" },
  { value: "excused", label: "Excused", short: "E" },
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]["value"];

/** Keyboard shortcuts for the marking grid, and the legend that documents them. */
export const STATUS_KEYS: Record<string, AttendanceStatus> = {
  p: "present",
  a: "absent",
  l: "late",
  e: "excused",
};

export function statusLabel(status: string, t: Translator): string {
  const found = ATTENDANCE_STATUSES.find((s) => s.value === status);
  return found ? labelFor(`attendance.status.${status}`, found.label, t) : status;
}

/** The same four, for a picker. See `optionsFor` for why both exist. */
export function attendanceStatusOptions(t: Translator) {
  return optionsFor(ATTENDANCE_STATUSES, "attendance.status", t);
}
