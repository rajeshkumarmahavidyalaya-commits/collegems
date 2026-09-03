import { z } from "zod";

/**
 * Phase 2.3 — staff attendance, leave, and payroll.
 *
 * The salary engine itself lives in Postgres and is asserted against exact
 * numbers in `tests/hr/payroll-engine.test.ts`; whether a *particular*
 * structure makes sense is answered by `salary_structure_problems()`, next to
 * the engine, so the thing that judges a document and the thing that evaluates
 * it cannot drift. What is left here is the boundary the browser owns.
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

export const COMPONENT_KINDS = [
  { value: "earning", label: "Earning" },
  { value: "deduction", label: "Deduction" },
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Pick a real date");

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 08:45");

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export const leaveTypeSchema = z.object({
  code: z
    .string()
    .min(2, "At least two characters")
    .max(12)
    .regex(/^[A-Z0-9_]+$/, "Capitals, digits and underscores only"),
  name: z.string().min(1, "A name is required").max(60),
  // A string, because an empty box means "as much as is approved" — a real
  // policy for maternity or unpaid leave — which is a different fact from a
  // quota of zero. `z.coerce` would collapse the two.
  annualQuotaDays: z.string(),
  isPaid: z.boolean(),
  allowsHalfDay: z.boolean(),
  isActive: z.boolean(),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

export const leaveRequestSchema = z
  .object({
    staffId: z.union([z.string().uuid(), z.literal("")]).optional(),
    leaveTypeId: z.string().uuid("Choose a kind of leave"),
    startsOn: isoDate,
    endsOn: isoDate,
    halfDayStart: z.boolean(),
    halfDayEnd: z.boolean(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The last day cannot be before the first",
    path: ["endsOn"],
  })
  // Mirrors `leave_requests_half_day_chk`: a one-day request that is half at
  // both ends is a whole day off with extra steps, and would count as zero.
  .refine((v) => v.startsOn < v.endsOn || !(v.halfDayStart && v.halfDayEnd), {
    message: "A single day cannot be half at both ends. Take the whole day instead.",
    path: ["halfDayEnd"],
  });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const attendanceEntrySchema = z.object({
  staffId: z.string().uuid(),
  // Empty string is "not marked", which must never become "present" — the
  // difference between a register nobody filled in and a school where
  // everybody turned up.
  status: z.string(),
  checkIn: z.union([clockTime, z.literal("")]).optional(),
  checkOut: z.union([clockTime, z.literal("")]).optional(),
  note: z.string().max(200).optional(),
});
export type AttendanceEntryInput = z.infer<typeof attendanceEntrySchema>;

export const attendanceSheetSchema = z.object({
  date: isoDate,
  entries: z.array(attendanceEntrySchema),
});
export type AttendanceSheetInput = z.infer<typeof attendanceSheetSchema>;

// ---------------------------------------------------------------------------
// Salary
// ---------------------------------------------------------------------------

export const salaryComponentSchema = z.object({
  code: z
    .string()
    .min(1, "A code is required")
    .max(16)
    .regex(/^[A-Z0-9_]+$/, "Capitals, digits and underscores only"),
  name: z.string().min(1, "A name is required").max(60),
  kind: z.enum(["earning", "deduction"]),
  calc: z.enum(["fixed", "percent_of"]),
  amount: z.number().min(0).optional(),
  of: z.string().optional(),
  percent: z.number().min(0).max(1000).optional(),
  cap: z.number().min(0).optional(),
});
export type SalaryComponent = z.infer<typeof salaryComponentSchema>;

export const salaryDocumentSchema = z.object({
  components: z.array(salaryComponentSchema).default([]),
  lop: z
    .object({
      basis: z.enum(["working_days", "calendar_days"]),
      half_day_counts: z.number().min(0).max(1).optional(),
    })
    .optional(),
  rounding: z.enum(["nearest_rupee"]).optional(),
});
export type SalaryDocument = z.infer<typeof salaryDocumentSchema>;

export const salaryStructureSchema = z.object({
  name: z.string().min(1, "A structure needs a name").max(120),
  description: z.string().max(400).optional(),
  isActive: z.boolean(),
  /** The document arrives as JSON text from a code editor, so parsing is the gate. */
  components: z.string().min(2, "The document cannot be empty"),
});
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;

export const salaryAssignmentSchema = z
  .object({
    staffId: z.string().uuid("Choose a member of staff"),
    structureId: z.string().uuid("Choose a structure"),
    /** `{"BASIC": 32000}` as typed — one amount per line, `CODE = amount`. */
    overrides: z.string(),
    effectiveFrom: isoDate,
    effectiveTo: z.union([isoDate, z.literal("")]).optional(),
    note: z.string().max(200).optional(),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, {
    message: "The last day cannot be before the first",
    path: ["effectiveTo"],
  });
export type SalaryAssignmentInput = z.infer<typeof salaryAssignmentSchema>;

export const payslipEditSchema = z.object({
  payslipId: z.string().uuid(),
  grossEarnings: z.string(),
  totalDeductions: z.string(),
  note: z.string().max(300).optional(),
});
export type PayslipEditInput = z.infer<typeof payslipEditSchema>;

/**
 * Parse a salary document a person typed. This reports only what the *shape*
 * gets wrong — is it JSON, and is it JSON of the right form. Whether the rules
 * behave sensibly is a different question, answered by
 * `salary_structure_problems()` in Postgres.
 */
export function parseSalaryDocument(
  text: string,
): { ok: true; document: unknown } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That is not valid JSON." };
  }

  const result = salaryDocumentSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, error: `${first.path.join(".") || "document"}: ${first.message}` };
  }
  return { ok: true, document: parsed };
}

/**
 * `BASIC = 32000` per line, which is what an office types. JSON for one number
 * per person is a format that exists to be got wrong at four in the afternoon
 * on payday.
 */
export function parseOverrides(
  text: string,
): { ok: true; overrides: Record<string, number> } | { ok: false; error: string } {
  const overrides: Record<string, number> = {};
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = /^([A-Z0-9_]+)\s*[=:]\s*(-?[\d.]+)$/.exec(line);
    if (!match) {
      return { ok: false, error: `"${line}" is not of the form CODE = amount.` };
    }
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      return { ok: false, error: `"${line}" does not end in a number.` };
    }
    if (value < 0) {
      return { ok: false, error: `${match[1]} is negative. Use a deduction component instead.` };
    }
    overrides[match[1]] = value;
  }
  return { ok: true, overrides };
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

export function attendanceLabel(value: string | null) {
  if (!value) return "Not marked";
  return ATTENDANCE_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export function attendanceTone(value: string | null) {
  if (!value) return "muted";
  return ATTENDANCE_STATUSES.find((s) => s.value === value)?.tone ?? "muted";
}

export function leaveStatusLabel(value: string) {
  return LEAVE_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export function runStatusLabel(value: string) {
  return RUN_STATUSES.find((s) => s.value === value)?.label ?? value;
}

/** `₹45,200`. Rupees, grouped the Indian way, because that is who this is for. */
export function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/** `22` not `22.0`, `21.5` not `21.50`. Days are read, not computed with. */
export function formatDays(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** `2026-02-01` → `February 2026`. */
export function formatMonth(periodMonth: string) {
  const [year, month] = periodMonth.split("-").map(Number);
  if (!year || !month) return periodMonth;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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
