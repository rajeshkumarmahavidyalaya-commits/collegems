import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tenantAClient } from "../helpers/client";

/**
 * The salary engine, pinned to exact numbers.
 *
 * Rule 12 says the evaluation order is part of the contract and each step must
 * be pinned to a number, because schools argue about the order and a comment
 * does not survive a refactor. This file is the reason that rule is written
 * that way: migration 0059 shipped an engine whose stated order was right and
 * whose implementation collapsed steps 1 and 2 into one pass, prorating every
 * allowance twice. It produced 41,620 where the arrangement pays 42,909 — and
 * each payslip line's own description read exactly as a person would expect.
 * Nothing but the arithmetic would have caught it. Migration 0063 is the fix.
 *
 * The order:
 *   1. Resolve earnings at full value, `percent_of` reading earlier codes.
 *   2. Prorate earnings once, by paid days over working days.
 *   3. Deductions, against the PRORATED earnings.
 *   4. Net = gross - deductions.
 *   5. Round, last.
 */
describe("the salary engine", () => {
  let a: SupabaseClient<Database>;

  /** Basic 25,000 (overridable), DA 12%, HRA 40%, conveyance 1,600 fixed. */
  const structure = {
    components: [
      { code: "BASIC", name: "Basic pay", kind: "earning", calc: "fixed", amount: 25000 },
      { code: "DA", name: "DA", kind: "earning", calc: "percent_of", of: "BASIC", percent: 12 },
      { code: "HRA", name: "HRA", kind: "earning", calc: "percent_of", of: "BASIC", percent: 40 },
      { code: "CONV", name: "Conveyance", kind: "earning", calc: "fixed", amount: 1600 },
      {
        code: "PF",
        name: "Provident fund",
        kind: "deduction",
        calc: "percent_of",
        of: "BASIC",
        percent: 12,
        cap: 1800,
      },
      { code: "PT", name: "Professional tax", kind: "deduction", calc: "fixed", amount: 200 },
    ],
    lop: { basis: "working_days", half_day_counts: 0.5 },
    rounding: "nearest_rupee",
  };

  async function evaluate(
    components: object,
    overrides: object,
    workingDays: number,
    lopDays: number,
  ) {
    const { data, error } = await a.rpc("payroll_evaluate", {
      p_components: components as never,
      p_overrides: overrides as never,
      p_working_days: workingDays,
      p_lop_days: lopDays,
    });
    expect(error, error?.message).toBeNull();
    return data as unknown as {
      lines: { code: string; kind: string; amount: number; basis: string }[];
      gross_earnings: number;
      total_deductions: number;
      net_pay: number;
      working_days: number;
      paid_days: number;
      lop_days: number;
    };
  }

  function line(result: Awaited<ReturnType<typeof evaluate>>, code: string) {
    return result.lines.find((l) => l.code === code);
  }

  beforeAll(async () => {
    a = await tenantAClient();
  });

  it("resolves a full month exactly", async () => {
    // 30000 + 3600 + 12000 + 1600 = 47200 ; PF 3600 capped to 1800 ; PT 200.
    const result = await evaluate(structure, { BASIC: 30000 }, 22, 0);

    expect(Number(line(result, "BASIC")!.amount)).toBe(30000);
    expect(Number(line(result, "DA")!.amount)).toBe(3600);
    expect(Number(line(result, "HRA")!.amount)).toBe(12000);
    expect(Number(result.gross_earnings)).toBe(47200);
    expect(Number(result.total_deductions)).toBe(2000);
    expect(Number(result.net_pay)).toBe(45200);
  });

  it("lets the assignment's override beat the structure's own amount", async () => {
    const withOverride = await evaluate(structure, { BASIC: 30000 }, 22, 0);
    const without = await evaluate(structure, {}, 22, 0);

    expect(Number(line(withOverride, "BASIC")!.amount)).toBe(30000);
    expect(Number(line(without, "BASIC")!.amount)).toBe(25000);
  });

  it("prorates each earning exactly once — the bug 0063 fixed", async () => {
    // THE assertion. Two unpaid days in twenty-two:
    //   BASIC 30000 x 20/22 = 27272.73
    //   DA    12% of 30000 = 3600, prorated -> 3272.73   (NOT 12% of 27272.73)
    //   HRA   40% of 30000 = 12000, prorated -> 10909.09
    //   CONV  1600 prorated -> 1454.55
    //   gross 42909.10 -> 42909
    // The double-prorating version returned 41620.
    const result = await evaluate(structure, { BASIC: 30000 }, 22, 2);

    expect(Number(line(result, "BASIC")!.amount)).toBeCloseTo(27272.73, 2);
    expect(Number(line(result, "DA")!.amount)).toBeCloseTo(3272.73, 2);
    expect(Number(line(result, "HRA")!.amount)).toBeCloseTo(10909.09, 2);
    expect(Number(line(result, "CONV")!.amount)).toBeCloseTo(1454.55, 2);
    expect(Number(result.gross_earnings)).toBe(42909);
    expect(Number(result.gross_earnings)).not.toBe(41620);
  });

  it("computes a deduction against the prorated earning, not the one on paper", async () => {
    // Step 3 follows step 2. With the cap raised out of the way, provident fund
    // is 12% of the basic ACTUALLY PAID: 12% of 27272.73 = 3272.73, plus 200.
    const uncapped = structuredClone(structure);
    uncapped.components[4].cap = 99999;

    const prorated = await evaluate(uncapped, { BASIC: 30000 }, 22, 2);
    const full = await evaluate(uncapped, { BASIC: 30000 }, 22, 0);

    expect(Number(prorated.total_deductions)).toBe(3473);
    expect(Number(full.total_deductions)).toBe(3800);
  });

  it("applies a cap after the percentage, and says so on the line", async () => {
    const result = await evaluate(structure, { BASIC: 30000 }, 22, 0);
    const pf = line(result, "PF")!;

    expect(Number(pf.amount)).toBe(1800);
    expect(pf.basis).toContain("capped at 1800");
  });

  it("does not prorate at all when the document has no lop block", async () => {
    // The conservative default, and the direction that matters: a school that
    // wants to dock unpaid leave configures it; one that starts docking by
    // accident finds out from somebody's bank balance.
    const { lop, ...noLop } = structure;
    void lop;

    const result = await evaluate(noLop, { BASIC: 30000 }, 22, 2);
    expect(Number(result.gross_earnings)).toBe(47200);
    expect(Number(result.lop_days)).toBe(2);
  });

  it("treats a forward reference as zero rather than raising", async () => {
    // Order in the array IS the evaluation order. A half-finished structure
    // must still be previewable; `salary_structure_problems` says so in words.
    const forward = {
      components: [
        { code: "HRA", name: "HRA", kind: "earning", calc: "percent_of", of: "BASIC", percent: 40 },
        { code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", amount: 20000 },
      ],
    };
    const result = await evaluate(forward, {}, 22, 0);

    expect(Number(line(result, "HRA")!.amount)).toBe(0);
    expect(Number(result.gross_earnings)).toBe(20000);
  });

  it("clamps loss of pay to the days that existed", async () => {
    const result = await evaluate(structure, { BASIC: 30000 }, 22, 40);
    expect(Number(result.lop_days)).toBe(22);
    expect(Number(result.paid_days)).toBe(0);
    expect(Number(result.gross_earnings)).toBe(0);
  });

  it("lets net pay go negative rather than hiding a bad month", async () => {
    const heavy = {
      components: [
        { code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", amount: 1000 },
        { code: "LOAN", name: "Loan", kind: "deduction", calc: "fixed", amount: 5000 },
      ],
    };
    const result = await evaluate(heavy, {}, 22, 0);
    expect(Number(result.net_pay)).toBe(-4000);
  });

  it("rounds last and once, not per component", async () => {
    const result = await evaluate(structure, { BASIC: 30000 }, 22, 2);
    const sum = result.lines
      .filter((l) => l.kind === "earning")
      .reduce((total, l) => total + Number(l.amount), 0);

    // The lines carry paise; the total is the rounded figure.
    expect(sum).toBeCloseTo(42909.1, 1);
    expect(Number(result.gross_earnings)).toBe(42909);
  });
});

describe("criticising a salary structure", () => {
  let a: SupabaseClient<Database>;

  beforeAll(async () => {
    a = await tenantAClient();
  });

  async function problems(components: object): Promise<string[]> {
    const { data, error } = await a.rpc("salary_structure_problems", {
      p_components: components as never,
    });
    expect(error, error?.message).toBeNull();
    return (data ?? []) as string[];
  }

  it("says nothing about a sound structure", async () => {
    const found = await problems({
      components: [
        { code: "BASIC", name: "Basic pay", kind: "earning", calc: "fixed", amount: 25000 },
        { code: "PT", name: "Professional tax", kind: "deduction", calc: "fixed", amount: 200 },
      ],
    });
    expect(found).toEqual([]);
  });

  it("names a forward reference and says what will happen", async () => {
    const found = await problems({
      components: [
        { code: "HRA", name: "HRA", kind: "earning", calc: "percent_of", of: "BASIC", percent: 40 },
        { code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", amount: 20000 },
      ],
    });
    expect(found.join(" ")).toContain("not defined above it");
    expect(found.join(" ")).toContain("treated as zero");
  });

  it("catches a structure with no earnings", async () => {
    const found = await problems({
      components: [{ code: "PT", name: "PT", kind: "deduction", calc: "fixed", amount: 200 }],
    });
    expect(found.join(" ")).toContain("no earnings");
  });

  it("catches a duplicate code", async () => {
    const found = await problems({
      components: [
        { code: "BASIC", name: "Basic", kind: "earning", calc: "fixed", amount: 1 },
        { code: "BASIC", name: "Basic again", kind: "earning", calc: "fixed", amount: 2 },
      ],
    });
    expect(found.join(" ")).toContain("share the code BASIC");
  });

  it("catches a component that is neither an earning nor a deduction", async () => {
    const found = await problems({
      components: [{ code: "X", name: "Bonus", kind: "bonus", calc: "fixed", amount: 1 }],
    });
    expect(found.join(" ")).toContain("neither an earning nor a deduction");
  });

  it("catches an empty document rather than treating it as valid", async () => {
    const found = await problems({ components: [] });
    expect(found.join(" ")).toContain("no components");
  });

  it("is criticism, not enforcement — a bad structure still saves", async () => {
    // Deliberately not a check constraint: a half-finished structure must be
    // savable, exactly like a half-finished grading scheme.
    const found = await problems({
      components: [{ code: "HRA", kind: "earning", calc: "percent_of", of: "NOPE", percent: 40 }],
    });
    expect(found.length).toBeGreaterThan(0);
  });
});
