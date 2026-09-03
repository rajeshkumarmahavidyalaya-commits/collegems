import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_STATUSES,
  paymentMethodLabel,
  paymentSchema,
  attendanceLabel,
  formatDays,
  formatMonth,
  formatOverrides,
  leaveDays,
  leaveRequestSchema,
  leaveTypeSchema,
  parseOverrides,
  parseSalaryDocument,
  salaryStructureSchema,
} from "@/lib/validations/hr";

/**
 * The HR module's pure logic.
 *
 * The salary engine is in Postgres and is asserted against exact numbers in
 * `payroll-engine.test.ts`. What is left here is what a person types and what a
 * number means when it is missing — which in this module is the interesting
 * half, because "no quota" and "a quota of zero" are different policies and
 * collapsing them changes somebody's pay.
 */

describe("a leave request", () => {
  const base = {
    leaveTypeId: "11111111-1111-4111-8111-111111111111",
    startsOn: "2026-03-02",
    endsOn: "2026-03-04",
    halfDayStart: false,
    halfDayEnd: false,
  };

  it("accepts the ordinary case", () => {
    expect(leaveRequestSchema.safeParse(base).success).toBe(true);
  });

  it("refuses a last day before the first", () => {
    const result = leaveRequestSchema.safeParse({ ...base, endsOn: "2026-03-01" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["endsOn"]);
  });

  it("allows a single-day request", () => {
    expect(
      leaveRequestSchema.safeParse({ ...base, startsOn: "2026-03-02", endsOn: "2026-03-02" })
        .success,
    ).toBe(true);
  });

  it("refuses a single day that is half at both ends, which would count as zero", () => {
    // Mirrors `leave_requests_half_day_chk`. A whole day off with extra steps.
    const result = leaveRequestSchema.safeParse({
      ...base,
      startsOn: "2026-03-02",
      endsOn: "2026-03-02",
      halfDayStart: true,
      halfDayEnd: true,
    });
    expect(result.success).toBe(false);
  });

  it("allows a range that is half at both ends", () => {
    expect(
      leaveRequestSchema.safeParse({ ...base, halfDayStart: true, halfDayEnd: true }).success,
    ).toBe(true);
  });
});

describe("counting leave days", () => {
  // Must match `hr_leave_days()` exactly: half days only ever sit at the ends.
  it("counts a single day as one", () => {
    expect(leaveDays("2026-03-02", "2026-03-02")).toBe(1);
  });

  it("counts an inclusive range", () => {
    expect(leaveDays("2026-03-02", "2026-03-04")).toBe(3);
  });

  it("takes half off each flagged end", () => {
    expect(leaveDays("2026-03-02", "2026-03-04", true, false)).toBe(2.5);
    expect(leaveDays("2026-03-02", "2026-03-04", false, true)).toBe(2.5);
    expect(leaveDays("2026-03-02", "2026-03-04", true, true)).toBe(2);
  });

  it("makes a half day on a single day count as half, not zero", () => {
    expect(leaveDays("2026-03-02", "2026-03-02", true, false)).toBe(0.5);
  });

  it("never returns less than half a day", () => {
    expect(leaveDays("2026-03-02", "2026-03-02", true, true)).toBe(0.5);
  });

  it("counts across a month boundary", () => {
    expect(leaveDays("2026-02-27", "2026-03-02")).toBe(4);
  });
});

describe("a leave type", () => {
  const base = {
    code: "CL",
    name: "Casual leave",
    annualQuotaDays: "12",
    isPaid: true,
    allowsHalfDay: true,
    isActive: true,
  };

  it("accepts a quota", () => {
    expect(leaveTypeSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a blank quota, which means 'as much as is approved'", () => {
    // A real policy for maternity or unpaid leave, and a different fact from a
    // quota of zero — which is why the field is a string.
    expect(leaveTypeSchema.safeParse({ ...base, annualQuotaDays: "" }).success).toBe(true);
    expect(leaveTypeSchema.safeParse({ ...base, annualQuotaDays: "0" }).success).toBe(true);
  });

  it("refuses a lowercase code, because the database refuses it too", () => {
    expect(leaveTypeSchema.safeParse({ ...base, code: "cl" }).success).toBe(false);
  });

  it("refuses a one-character code", () => {
    expect(leaveTypeSchema.safeParse({ ...base, code: "C" }).success).toBe(false);
  });
});

describe("attendance statuses", () => {
  it("gives every status a distinct single-key shortcut", () => {
    const shortcuts = ATTENDANCE_STATUSES.map((s) => s.short.toLowerCase());
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("names 'not marked' rather than showing it as present", () => {
    // The difference between a register nobody filled in and a school where
    // everybody turned up.
    expect(attendanceLabel(null)).toBe("Not marked");
    expect(attendanceLabel("present")).toBe("Present");
  });

  it("keeps on-duty separate from present", () => {
    // A teacher at a district sports meet is out of the building and fully
    // paid; a register that cannot say so gets them marked absent.
    const codes = ATTENDANCE_STATUSES.map((s) => s.value);
    expect(codes).toContain("on_duty");
    expect(codes).toContain("present");
  });
});

describe("salary overrides are typed, not authored in JSON", () => {
  it("reads CODE = amount, one per line", () => {
    const result = parseOverrides("BASIC = 32000\nHRA=1000");
    expect(result).toEqual({ ok: true, overrides: { BASIC: 32000, HRA: 1000 } });
  });

  it("accepts a colon as well as an equals sign", () => {
    const result = parseOverrides("BASIC: 25000");
    expect(result.ok && result.overrides.BASIC).toBe(25000);
  });

  it("ignores blank lines", () => {
    const result = parseOverrides("\n  BASIC = 100\n\n");
    expect(result.ok && Object.keys(result.overrides)).toEqual(["BASIC"]);
  });

  it("parses an empty document to no overrides, which keeps the structure's amounts", () => {
    expect(parseOverrides("")).toEqual({ ok: true, overrides: {} });
  });

  it("refuses a line that is not of the form", () => {
    const result = parseOverrides("basic pay is 32000");
    expect(result.ok).toBe(false);
  });

  it("refuses a negative amount and says what to do instead", () => {
    const result = parseOverrides("PF = -1800");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("deduction component");
  });

  it("round-trips through the formatter", () => {
    const text = formatOverrides({ BASIC: 32000, CONV: 1600 });
    const parsed = parseOverrides(text);
    expect(parsed.ok && parsed.overrides).toEqual({ BASIC: 32000, CONV: 1600 });
  });
});

describe("a salary document", () => {
  const document = {
    components: [
      { code: "BASIC", name: "Basic pay", kind: "earning", calc: "fixed", amount: 25000 },
      { code: "HRA", name: "HRA", kind: "earning", calc: "percent_of", of: "BASIC", percent: 40 },
    ],
    lop: { basis: "working_days" },
    rounding: "nearest_rupee",
  };

  it("accepts a well-formed document", () => {
    expect(parseSalaryDocument(JSON.stringify(document)).ok).toBe(true);
  });

  it("accepts an empty component list, because a half-finished structure must be savable", () => {
    expect(parseSalaryDocument('{"components": []}').ok).toBe(true);
  });

  it("accepts a document with no lop block — that is the conservative default", () => {
    // No `lop` means no proration, ever, which is the default in the direction
    // that matters: docking somebody by accident is discovered at the bank.
    const { lop, ...rest } = document;
    void lop;
    expect(parseSalaryDocument(JSON.stringify(rest)).ok).toBe(true);
  });

  it("reports invalid JSON as such", () => {
    expect(parseSalaryDocument("{not json").ok).toBe(false);
  });

  it("refuses an unknown loss-of-pay basis", () => {
    expect(
      parseSalaryDocument(JSON.stringify({ ...document, lop: { basis: "moon_phases" } })).ok,
    ).toBe(false);
  });

  it("refuses a component that is neither an earning nor a deduction", () => {
    const bad = { components: [{ code: "X", name: "X", kind: "bonus", calc: "fixed" }] };
    expect(parseSalaryDocument(JSON.stringify(bad)).ok).toBe(false);
  });

  it("requires the structure form itself to have a name", () => {
    expect(
      salaryStructureSchema.safeParse({
        name: "",
        isActive: true,
        components: '{"components":[]}',
      }).success,
    ).toBe(false);
  });
});

describe("display", () => {
  it("shows whole days without a decimal and half days with one", () => {
    expect(formatDays(22)).toBe("22");
    expect(formatDays("22.0")).toBe("22");
    expect(formatDays(21.5)).toBe("21.5");
    expect(formatDays(null)).toBe("—");
  });

  it("names a month rather than showing a date", () => {
    expect(formatMonth("2026-02-01")).toBe("February 2026");
  });
});

describe("recording a payment", () => {
  const base = {
    payslipId: "11111111-1111-4111-8111-111111111111",
    amount: "45200",
    method: "bank_transfer" as const,
  };

  it("accepts a positive amount", () => {
    expect(paymentSchema.safeParse(base).success).toBe(true);
  });

  it("refuses zero or a negative amount -- the RPC does the signing", () => {
    expect(paymentSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(paymentSchema.safeParse({ ...base, amount: "-100" }).success).toBe(false);
  });

  it("refuses a method it does not know", () => {
    expect(paymentSchema.safeParse({ ...base, method: "bitcoin" }).success).toBe(false);
  });

  it("names each method in words", () => {
    expect(paymentMethodLabel("bank_transfer")).toBe("Bank transfer");
    expect(paymentMethodLabel("cheque")).toBe("Cheque");
  });
});
